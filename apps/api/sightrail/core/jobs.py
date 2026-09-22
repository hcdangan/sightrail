"""Background job orchestration.

Long-running Ultralytics modes (train, val, export, benchmark, dataset prep) are
executed on a bounded thread pool. Each job owns an in-memory event log that the
REST API can poll and the WebSocket hub can stream, so the UI gets a live console
and progress bar without any message broker.

Ultralytics writes its progress to stdout via ``tqdm``-like output, so the job
runner parses that stream into structured ``progress``/``metric``/``log`` events.
"""

from __future__ import annotations

import contextlib
import io
import re
import threading
import time
import traceback
import uuid
from collections import OrderedDict, deque
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..config import settings
from ..schemas.base import Artifact, JobDetail, JobKind, JobProgress, JobStatus, JobSummary

# ---------------------------------------------------------------------------
# stdout parsing
# ---------------------------------------------------------------------------

#: TQDM writes ANSI colour codes and carriage returns; strip them before parsing.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

_NUMBER = r"[\d.]+(?:e[-+]?\d+)?"
#: ``      1/100      1.42G      0.031      0.045      0.012         8        640: 100%|…``
#: (detect/segment/pose/obb training row: epoch, memory, box, cls, dfl, instances, size)
_TRAIN_ROW_RE = re.compile(
    r"^\s*(?P<current>\d+)/(?P<total>\d+)\s+"
    r"(?P<mem>[\d.]+[A-Za-z]?)\s+"
    rf"(?P<box>{_NUMBER})\s+"
    rf"(?P<cls>{_NUMBER})\s+"
    rf"(?P<dfl>{_NUMBER})\s+"
    r"(?P<instances>\d+)\s+"
    r"(?P<size>\d+\s*:\s*\d+)"
    r"(?:\s+(?P<pct>\d+)%)?"
)
#: ``      1/50      0.98G      0.4321     0.8765        640: 60%|…``
#: (classification training row: epoch, memory, loss, accuracy, size)
_CLS_ROW_RE = re.compile(
    r"^\s*(?P<current>\d+)/(?P<total>\d+)\s+"
    r"(?P<mem>[\d.]+[A-Za-z]?)\s+"
    rf"(?P<loss>{_NUMBER})\s+"
    rf"(?P<acc>{_NUMBER})\s+"
    r"(?P<size>\d+\s*:\s*\d+)"
    r"(?:\s+(?P<pct>\d+)%)?"
)
#: ``Epoch    GPU_mem   box_loss   cls_loss   dfl_loss  Instances       Size``
_HEADER_RE = re.compile(r"^\s*Epoch\s+GPU_mem", re.IGNORECASE)
#: tqdm bars for the validation/scanning steps.
_BAR_PCT_RE = re.compile(r"(?P<pct>\d{1,3})%\s*[|━─╸╺]")
#: ``key: value`` pairs on a summary line (mAP50, precision, …)
_METRIC_PAIRS_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_ /()-]*?)\s*[:=]\s*(-?[\d.]+(?:e-?\d+)?)", re.IGNORECASE)


def clean_engine_line(line: str) -> str:
    """Remove ANSI escapes and tqdm carriage-return artefacts."""
    return _ANSI_RE.sub("", line).replace("\r", "").rstrip()


def _looks_like_metric_key(pairs: dict[str, float]) -> bool:
    """Reject table headers such as ``class images instances box(p r map50``."""
    if not pairs or len(pairs) > 12:
        return False
    return all(len(key) <= 32 and "_" * 3 not in key and key.count("_") <= 4 for key in pairs)


def parse_engine_line(line: str) -> JobProgress | None:
    """Translate one line of Ultralytics stdout into a structured event."""
    stripped = clean_engine_line(line)
    if not stripped:
        return None

    if _HEADER_RE.match(stripped):
        return JobProgress(kind="log", message=stripped, level="debug")

    match = _TRAIN_ROW_RE.match(stripped)
    if match:
        current, total = int(match.group("current")), int(match.group("total")) or 1
        pct = match.group("pct")
        percent = float(pct) if pct else round(100.0 * current / total, 1)
        return JobProgress(
            kind="progress",
            message=stripped,
            percent=percent,
            data={
                "epoch": current,
                "epochs": total,
                "gpu_mem": match.group("mem"),
                "box_loss": float(match.group("box")),
                "cls_loss": float(match.group("cls")),
                "dfl_loss": float(match.group("dfl")),
                "instances": int(match.group("instances")),
                "size": match.group("size"),
            },
        )

    cls_match = _CLS_ROW_RE.match(stripped)
    if cls_match:
        current, total = int(cls_match.group("current")), int(cls_match.group("total")) or 1
        pct = cls_match.group("pct")
        percent = float(pct) if pct else round(100.0 * current / total, 1)
        return JobProgress(
            kind="progress",
            message=stripped,
            percent=percent,
            data={
                "epoch": current,
                "epochs": total,
                "gpu_mem": cls_match.group("mem"),
                "loss": float(cls_match.group("loss")),
                "accuracy": float(cls_match.group("acc")),
                "size": cls_match.group("size"),
            },
        )

    # Any other tqdm bar (dataset scanning, validation batches, downloads).
    bar = _BAR_PCT_RE.search(stripped)
    if bar:
        return JobProgress(kind="progress", message=stripped, percent=float(bar.group("pct")))

    if stripped.startswith(("Validating", "Optimizer", "AMP:", "Speed:")):
        return JobProgress(kind="log", message=stripped, level="debug")

    pairs = {key.strip().lower().replace(" ", "_"): float(value) for key, value in _METRIC_PAIRS_RE.findall(stripped)}
    if pairs and ("map" in stripped.lower() or "accuracy" in stripped.lower()) and _looks_like_metric_key(pairs):
        return JobProgress(kind="metric", message=stripped, data=pairs)

    lowered = stripped.lower()
    level = (
        "error" if ("error" in lowered or "traceback" in lowered) else ("warning" if "warning" in lowered else "info")
    )
    return JobProgress(kind="log", message=stripped, level=level)


# ---------------------------------------------------------------------------
# job model
# ---------------------------------------------------------------------------


@dataclass
class Job:
    """Mutable job state plus a fan-out event buffer."""

    id: str
    kind: JobKind
    title: str
    params: dict[str, Any]
    created_at: datetime
    status: JobStatus = JobStatus.QUEUED
    started_at: datetime | None = None
    finished_at: datetime | None = None
    percent: float = 0.0
    message: str = "Queued"
    error: str | None = None
    result: dict[str, Any] | None = None
    artifacts: list[Artifact] = field(default_factory=list)
    metrics: dict[str, list[Any]] = field(default_factory=dict)
    log: deque[JobProgress] = field(default_factory=lambda: deque(maxlen=settings.job_log_buffer))
    cancel_requested: bool = False
    _seq: int = 0
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    _subscribers: list[Callable[[JobProgress], None]] = field(default_factory=list, repr=False)

    # -- events ------------------------------------------------------------
    def emit(self, event: JobProgress) -> None:
        with self._lock:
            self._seq += 1
            event.seq = self._seq
            self.log.append(event)
            if event.kind == "progress" and event.percent is not None:
                self.percent = event.percent
            if event.message:
                self.message = event.message
            if event.kind == "metric":
                for key, value in event.data.items():
                    self.metrics.setdefault(key, []).append(value)
            subscribers = list(self._subscribers)
        for callback in subscribers:
            with contextlib.suppress(Exception):
                callback(event)

    def log_line(self, message: str, level: str = "info") -> None:
        self.emit(JobProgress(kind="log", message=message, level=level))  # type: ignore[arg-type]

    def set_progress(self, percent: float, message: str | None = None) -> None:
        self.emit(JobProgress(kind="progress", percent=max(0.0, min(100.0, percent)), message=message or self.message))

    def subscribe(self, callback: Callable[[JobProgress], None]) -> None:
        with self._lock:
            self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[JobProgress], None]) -> None:
        with self._lock:
            if callback in self._subscribers:
                self._subscribers.remove(callback)

    def request_cancel(self) -> None:
        self.cancel_requested = True
        self.log_line("Cancellation requested; stopping after the current step.", level="warning")

    # -- snapshots ---------------------------------------------------------
    @property
    def duration_s(self) -> float | None:
        if self.started_at is None:
            return None
        end = self.finished_at or datetime.now(timezone.utc)
        return round((end - self.started_at).total_seconds(), 2)

    def summary(self) -> JobSummary:
        with self._lock:
            return JobSummary(
                id=self.id,
                kind=self.kind,
                status=self.status,
                title=self.title,
                params=self.params,
                created_at=self.created_at,
                started_at=self.started_at,
                finished_at=self.finished_at,
                duration_s=self.duration_s,
                percent=round(self.percent, 1),
                message=self.message,
                error=self.error,
                result=self.result,
                artifacts=list(self.artifacts),
                metrics=dict(self.metrics),
            )

    def detail(self) -> JobDetail:
        base = self.summary()
        with self._lock:
            log = list(self.log)
        return JobDetail(**base.model_dump(), log=log)


# ---------------------------------------------------------------------------
# store + executor
# ---------------------------------------------------------------------------


class JobStore:
    """Thread-safe registry of jobs with bounded retention."""

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.RLock()
        self._executor = self._new_executor()
        self._futures: dict[str, Future[Any]] = {}

    @staticmethod
    def _new_executor() -> ThreadPoolExecutor:
        return ThreadPoolExecutor(
            max_workers=max(1, settings.max_concurrent_jobs),
            thread_name_prefix="yolo-job",
        )

    def _ensure_executor(self) -> ThreadPoolExecutor:
        """Return a live executor, recreating it after a shutdown.

        The store outlives any single application lifespan (test clients are
        created and closed repeatedly), so a shut-down pool is transparently
        replaced instead of raising "cannot schedule new futures after shutdown".
        """
        if getattr(self._executor, "_shutdown", False):
            self._executor = self._new_executor()
        return self._executor

    # -- lifecycle ---------------------------------------------------------
    def create(self, kind: JobKind, title: str, params: dict[str, Any]) -> Job:
        job = Job(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            title=title,
            params=params,
            created_at=datetime.now(timezone.utc),
        )
        with self._lock:
            self._jobs[job.id] = job
            self._evict_locked()
        return job

    def submit(self, job: Job, target: Callable[[Job], dict[str, Any] | None]) -> Job:
        """Run ``target(job)`` on the pool, wiring status transitions."""

        def _run() -> None:
            job.status = JobStatus.RUNNING
            job.started_at = datetime.now(timezone.utc)
            job.set_progress(0.0, "Starting")
            try:
                result = target(job) or {}
                if job.cancel_requested:
                    job.status = JobStatus.CANCELLED
                    job.message = "Cancelled"
                else:
                    job.status = JobStatus.SUCCEEDED
                    job.result = result
                    job.percent = 100.0
                    job.message = "Completed"
            except Exception as exc:
                job.status = JobStatus.FAILED
                job.error = f"{type(exc).__name__}: {exc}"
                job.message = "Failed"
                job.log_line(traceback.format_exc(), level="error")
            finally:
                job.finished_at = datetime.now(timezone.utc)
                job.emit(JobProgress(kind="status", message=job.status.value, data={"status": job.status.value}))

        with self._lock:
            self._futures[job.id] = self._ensure_executor().submit(_run)
        return job

    def run(self, job: Job, target: Callable[[Job], dict[str, Any] | None]) -> Job:
        return self.submit(job, target)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job is None:
            return None
        job.request_cancel()
        with contextlib.suppress(Exception):
            self._futures.get(job_id, None) and self._futures[job_id].cancel()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(self, kind: JobKind | None = None, limit: int = 50) -> list[Job]:
        """Newest-first job summaries.

        Named ``list_jobs`` rather than ``list`` so the method does not shadow the
        builtin ``list`` inside this class body, which confuses both readers and
        type checkers (``-> list[Job]`` resolves to this method, not the type).
        """
        with self._lock:
            jobs = list(self._jobs.values())
        if kind is not None:
            jobs = [job for job in jobs if job.kind == kind]
        jobs.sort(key=lambda job: job.created_at, reverse=True)
        return jobs[:limit]

    def active(self) -> list[Job]:
        return [job for job in self.list_jobs(limit=200) if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}]

    def clear_finished(self) -> int:
        with self._lock:
            finished = [
                jid
                for jid, job in self._jobs.items()
                if job.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}
            ]
            for jid in finished:
                self._jobs.pop(jid, None)
                self._futures.pop(jid, None)
            return len(finished)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # -- internals ---------------------------------------------------------
    def _evict_locked(self) -> None:
        cutoff = time.time() - settings.job_retention_seconds
        while len(self._jobs) > 100:
            old_id, old_job = next(iter(self._jobs.items()))
            if old_job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
                break
            self._jobs.pop(old_id, None)
            self._futures.pop(old_id, None)
        for jid, job in list(self._jobs.items()):
            if job.finished_at and job.finished_at.timestamp() < cutoff:
                self._jobs.pop(jid, None)
                self._futures.pop(jid, None)


# ---------------------------------------------------------------------------
# stdout capture
# ---------------------------------------------------------------------------


class StdoutCapture(io.TextIOBase):
    """File-like object that forwards engine output into a job's event log."""

    def __init__(self, job: Job) -> None:
        super().__init__()
        self._job = job
        self._buffer = ""
        self._lock = threading.Lock()

    def writable(self) -> bool:  # pragma: no cover - io protocol
        return True

    def write(self, text: str) -> int:  # type: ignore[override]
        if not text:
            return 0
        with self._lock:
            self._buffer += text.replace("\r", "\n")
            *lines, self._buffer = self._buffer.split("\n")
        for line in lines:
            clean = line.strip()
            if not clean:
                continue
            event = parse_engine_line(line)
            if event is not None:
                self._job.emit(event)
        return len(text)

    def flush(self) -> None:  # pragma: no cover - io protocol
        with self._lock:
            if self._buffer.strip():
                event = parse_engine_line(self._buffer)
                self._buffer = ""
                if event is not None:
                    self._job.emit(event)


class _StdoutRouter(io.TextIOBase):
    """Routes stdout/stderr writes to the capture belonging to the calling thread.

    Ultralytics logs through the *global* ``sys.stdout``. Swapping that global
    per job works only while one job runs at a time: with
    ``max_concurrent_jobs > 1`` two jobs interleave, each captures the other's
    output, and whichever finishes first restores a *dead* capture as the real
    stdout - after which every log line silently disappears.

    A single process-wide router that dispatches on ``threading.get_ident()``
    keeps each job's stream separate and, because the global is only replaced
    while at least one capture is active, always restores the true original.
    """

    def __init__(self, original_out: Any, original_err: Any) -> None:
        super().__init__()
        self._original_out = original_out
        self._original_err = original_err
        self._routes: dict[int, StdoutCapture] = {}
        self._lock = threading.Lock()

    # -- registration ------------------------------------------------------
    def register(self, thread_id: int, capture: StdoutCapture) -> None:
        with self._lock:
            self._routes[thread_id] = capture

    def unregister(self, thread_id: int) -> None:
        with self._lock:
            self._routes.pop(thread_id, None)

    @property
    def empty(self) -> bool:
        with self._lock:
            return not self._routes

    # -- io protocol -------------------------------------------------------
    def writable(self) -> bool:  # pragma: no cover - io protocol
        return True

    def _target(self) -> StdoutCapture | None:
        with self._lock:
            capture = self._routes.get(threading.get_ident())
        if capture is not None:
            return capture
        # Output from a helper thread a job spawned (dataloader workers, the
        # live tracker thread) still belongs to the job that owns the process
        # while exactly one job is running.
        with self._lock:
            if len(self._routes) == 1:
                return next(iter(self._routes.values()))
        return None

    def write(self, text: str) -> int:  # type: ignore[override]
        capture = self._target()
        if capture is not None:
            return capture.write(text)
        self._original_out.write(text)
        return len(text)

    def flush(self) -> None:  # pragma: no cover - io protocol
        capture = self._target()
        if capture is not None:
            capture.flush()
        with contextlib.suppress(Exception):
            self._original_out.flush()

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        # Some libraries introspect fileno(); delegate to the real stream.
        return self._original_out.fileno()


#: The process-wide router, created on the first capture and reused afterwards.
_stdout_router: _StdoutRouter | None = None
_router_lock = threading.Lock()


@contextlib.contextmanager
def capture_engine_stdout(job: Job) -> Iterator[None]:
    """Redirect this thread's stdout/stderr into ``job``'s event log."""
    global _stdout_router
    import sys

    capture = StdoutCapture(job)
    thread_id = threading.get_ident()

    with _router_lock:
        if _stdout_router is None or sys.stdout is not _stdout_router:
            _stdout_router = _StdoutRouter(sys.stdout, sys.stderr)
            sys.stdout, sys.stderr = _stdout_router, _stdout_router
        router = _stdout_router
        router.register(thread_id, capture)

    try:
        yield
    finally:
        capture.flush()
        router.unregister(thread_id)
        with _router_lock:
            # Only the last capture out restores the real streams, and it does so
            # with the originals captured at router construction - never with
            # another job's capture object.
            if router.empty:
                sys.stdout, sys.stderr = router._original_out, router._original_err
                _stdout_router = None


_ARTIFACT_KINDS: dict[str, str] = {
    "png": "image",
    "jpg": "image",
    "jpeg": "image",
    "webp": "image",
    "svg": "image",
    "bmp": "image",
    "mp4": "video",
    "avi": "video",
    "webm": "video",
    "mov": "video",
    "csv": "csv",
    "yaml": "yaml",
    "yml": "yaml",
    "json": "json",
    "pt": "model",
    "onnx": "model",
    "engine": "model",
    "torchscript": "model",
    "tflite": "model",
    "txt": "text",
    "md": "text",
}


def artifact_for_path(path: Any) -> Artifact:
    """Describe a single produced file as a downloadable artifact."""
    from pathlib import Path

    from .serialize import media_url

    resolved = Path(path)
    suffix = resolved.suffix.lower().lstrip(".")
    kind = _ARTIFACT_KINDS.get(suffix, "other")
    try:
        size = resolved.stat().st_size
    except OSError:  # pragma: no cover
        size = 0
    return Artifact(
        name=resolved.name,
        path=str(resolved),
        url=media_url(resolved, "runs") if kind in {"image", "video"} else "",
        kind=kind,  # type: ignore[arg-type]
        size_bytes=size,
    )


def progress_artifacts(
    _job: Job | None,
    directory: Any,
    patterns: tuple[str, ...],
    _category: str = "runs",
) -> list[Artifact]:
    """Collect produced files into job artifacts (used by every heavy mode)."""
    from pathlib import Path

    root = Path(directory)
    found: list[Artifact] = []
    if not root.exists():
        return found
    for pattern in patterns:
        for path in sorted(root.rglob(pattern)):
            if path.is_file():
                found.append(artifact_for_path(path))
    return found


#: Process-wide job store.
job_store = JobStore()
