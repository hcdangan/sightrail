"""The Ultralytics engine facade.

This module is the single place that touches the ``ultralytics`` package. It
owns:

* a thread-safe LRU **model registry** so repeated requests reuse weights,
* **checkpoint resolution** (catalog download, local file, run artifact, HEF),
* thin, well-typed wrappers around every Ultralytics **mode**
  (predict, track, val, export, benchmark) and every **task** family,
* serialisation of results into the API's JSON contracts.

Device handling lives in ``core.device``: a choice such as ``cuda:0`` or
``hailo`` is normalised there and translated into the string Ultralytics
expects. Hailo is special - it loads a compiled ``.hef`` and drives it from the
host CPU - so :meth:`Engine.load` swaps in the HEF whenever the Hailo profile is
selected.

Anything that needs a GPU or a multi-minute runtime is expected to be called
from the job pool (see ``core.jobs``) rather than a request handler.
"""

from __future__ import annotations

import contextlib
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import settings
from ..schemas.base import TaskName
from ..schemas.results import InferResponse, ModelMeta, ResultPayload
from . import catalog as catalog_mod
from .device import engine_device, is_hailo, resolve_device
from .hailo import resolve_hailo_checkpoint
from .serialize import model_meta, result_to_payload, serialise_names

# ---------------------------------------------------------------------------
# errors
# ---------------------------------------------------------------------------


class EngineUnavailable(RuntimeError):
    """Raised when torch/ultralytics are not importable."""


class ModelNotFound(FileNotFoundError):
    """Raised when a checkpoint cannot be located or downloaded."""


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------


@dataclass
class ModelRecord:
    """A cached ``YOLO`` instance plus bookkeeping for cache invalidation."""

    key: str
    path: Path
    model: Any
    task: str
    names: dict[int, str]
    device: str = "cpu"
    format: str = "pt"
    loaded_at: float = field(default_factory=time.time)
    mtime: float = 0.0
    hits: int = 0

    def meta(self) -> dict[str, Any]:
        return model_meta(self.model, source=str(self.path))


class ModelRegistry:
    """LRU cache of loaded checkpoints, safe for concurrent requests.

    The cache key includes the device and task because the same file can be
    loaded differently - most visibly on Hailo, where a ``.hef`` is loaded
    instead of a checkpoint, but also when a caller overrides the task head.
    """

    def __init__(self, capacity: int | None = None) -> None:
        self._capacity = capacity or settings.model_cache_size
        self._records: OrderedDict[str, ModelRecord] = OrderedDict()
        self._lock = threading.RLock()

    # -- public ------------------------------------------------------------
    def load(self, model_id: str, device: str | None = None, task: str | None = None) -> ModelRecord:
        """Return a cached, loaded model, downloading/resolving it if needed."""
        target = resolve_device(device)
        path, resolved_task = self._resolve(model_id, target, task)
        key = f"{path.resolve()}::{resolved_task or ''}::{target}"

        with self._lock:
            record = self._records.get(key)
            if record is not None and record.mtime == _safe_mtime(path):
                record.hits += 1
                self._records.move_to_end(key)
                return record

        model = _instantiate(path, resolved_task, engine_device(target))
        names = serialise_names(getattr(model, "names", None))
        record = ModelRecord(
            key=key,
            path=path,
            model=model,
            task=str(getattr(model, "task", None) or resolved_task or "detect"),
            names=names,
            device=target,
            format=path.suffix.lower().lstrip(".") or "pt",
            mtime=_safe_mtime(path),
        )
        with self._lock:
            self._records[key] = record
            self._records.move_to_end(key)
            while len(self._records) > self._capacity:
                self._records.popitem(last=False)
        return record

    @staticmethod
    def _resolve(model_id: str, target: str, task: str | None) -> tuple[Path, str | None]:
        """Pick the artefact to load for a device.

        On Hailo the artefact is always a compiled ``.hef``: either the one named
        by the request/config, or the one discovered under ``storage/weights``.
        A ``.pt`` checkpoint cannot run on the NPU, so asking for one raises a
        :class:`HailoError` that explains the export step instead of failing
        deep inside the runtime.
        """
        if not is_hailo(target):
            return resolve_checkpoint(model_id), task

        candidate = Path(model_id).expanduser() if model_id else None
        explicit = str(candidate) if candidate and candidate.suffix.lower() == ".hef" else None
        if candidate and candidate.suffix.lower() not in {".hef", ".pt", ""} and candidate.exists():
            explicit = str(candidate)

        hef = resolve_hailo_checkpoint(explicit)
        return hef, task or "detect"

    def get_loaded(self, model_id: str, device: str | None = None) -> ModelRecord | None:
        """The resident record for a model, regardless of which device loaded it."""
        try:
            path = resolve_checkpoint(model_id)
        except ModelNotFound:
            return None
        target = resolve_device(device) if device is not None else None
        with self._lock:
            for record in self._records.values():
                if record.path == path and (target is None or record.device == target):
                    return record
        return None

    def evict(self, model_id: str | None = None) -> int:
        """Drop one model (or the whole cache) from memory."""
        with self._lock:
            if model_id is None:
                count = len(self._records)
                self._records.clear()
                return count
            path = None
            with contextlib.suppress(ModelNotFound):
                path = resolve_checkpoint(model_id)
            keys = [key for key, record in self._records.items() if path is not None and record.path == path]
            for key in keys:
                self._records.pop(key, None)
            return len(keys)

    def loaded(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "key": record.key,
                    "path": str(record.path),
                    "task": record.task,
                    "classes": len(record.names),
                    "hits": record.hits,
                    "resident_s": round(time.time() - record.loaded_at, 1),
                }
                for record in self._records.values()
            ]


# ---------------------------------------------------------------------------
# checkpoint resolution
# ---------------------------------------------------------------------------

#: ``yolo11n-seg.pt`` -> segment
_TASK_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("-seg", TaskName.SEGMENT.value),
    ("-cls", TaskName.CLASSIFY.value),
    ("-pose", TaskName.POSE.value),
    ("-obb", TaskName.OBB.value),
)


def infer_task_from_name(name: str) -> str | None:
    lowered = name.lower()
    for suffix, task in _TASK_SUFFIXES:
        if suffix in lowered:
            return task
    return None


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _import_yolo() -> Any:
    try:
        from ultralytics import YOLO
    except Exception as exc:  # pragma: no cover - depends on install
        raise EngineUnavailable(
            "The `ultralytics` package is not available. Run `uv pip install -r apps/api/requirements.txt`."
        ) from exc
    return YOLO


#: Artifact formats Ultralytics can load for inference, mapped to the task hint
#: that should accompany them. ``.hef`` (Hailo) and the other exported formats
#: carry their own metadata, so a task is only inferred for checkpoints.
def _instantiate(path: Path, task: str | None, device: str = "cpu") -> Any:
    """Create a ``YOLO`` instance for an artifact, with the right hints.

    ``device`` is stored on the model so ``model.to()``-style inspection and the
    registry stay honest, but Ultralytics still receives the device per call.
    """
    YOLO = _import_yolo()
    keywords: dict[str, Any] = {}
    if task:
        keywords["task"] = task
    elif (guessed := infer_task_from_name(path.name)) is not None and str(path.suffix).lower() in {
        ".pt",
        ".yaml",
        ".yml",
    }:
        keywords["task"] = guessed
    model = YOLO(str(path), **keywords)
    if device and device != "cpu":
        # Warm the device selection so the first inference does not pay for it.
        with contextlib.suppress(Exception):
            model.to(device)
    return model


def resolve_checkpoint(model_id: str | None) -> Path:
    """Resolve a model identifier into a local checkpoint path.

    Accepts (in order of precedence): an existing filesystem path, a catalog id
    such as ``yolo11n-seg.pt`` (downloaded on demand), or a bare filename
    previously placed in ``storage/weights``.
    """
    if not model_id:
        model_id = settings.default_model

    candidate = Path(model_id).expanduser()
    if candidate.exists() and candidate.is_file():
        return candidate.resolve()

    for search_root in (settings.weights_dir, settings.storage_root, Path.cwd()):
        direct = search_root / model_id
        if direct.is_file():
            return direct.resolve()

    if catalog_mod.is_catalog_model(model_id) or model_id.startswith(
        ("yolo", "rtdetr", "sam", "fastsam", "mobile_sam")
    ):
        return download_checkpoint(model_id)

    raise ModelNotFound(
        f"Model '{model_id}' was not found. Provide a path to a local checkpoint or pick one from the catalog."
    )


def download_checkpoint(model_id: str) -> Path:
    """Download a catalog checkpoint into ``storage/weights`` and return it."""
    settings.ensure_dirs()
    target = settings.weights_dir / Path(model_id).name
    if target.is_file() and target.stat().st_size > 0:
        return target.resolve()

    entry = catalog_mod.catalog_entry(Path(model_id).name)
    url = entry["download_url"] if entry else None

    # Preferred path: let Ultralytics manage the download (it knows every asset
    # URL, including re-released weights).
    try:
        YOLO = _import_yolo()
        task = (entry or {}).get("task") or infer_task_from_name(model_id)
        keywords = {"task": task} if task else {}
        model = YOLO(Path(model_id).name, **keywords)
        source = Path(str(getattr(model, "ckpt_path", "") or ""))
        if source.is_file():
            if source.resolve() != target.resolve():
                try:
                    target.write_bytes(source.read_bytes())
                    return target.resolve()
                except OSError:  # pragma: no cover - read-only source dir
                    return source.resolve()
            return source.resolve()
    except EngineUnavailable:
        raise
    except Exception as exc:
        if not url:
            raise ModelNotFound(f"Unable to obtain checkpoint '{model_id}': {exc}") from exc

    if not url:
        raise ModelNotFound(f"Unable to obtain checkpoint '{model_id}'.")

    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 - trusted host
            target.write_bytes(response.read())
    except Exception as exc:
        raise ModelNotFound(f"Download failed for '{model_id}': {exc}") from exc
    return target.resolve()


def local_checkpoints() -> list[dict[str, Any]]:
    """Every downloadable/loadable checkpoint already present on disk."""
    settings.ensure_dirs()
    seen: dict[str, dict[str, Any]] = {}
    roots = [settings.weights_dir, settings.runs_dir, settings.storage_root]
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.suffix.lower() not in {".pt", ".onnx", ".engine", ".torchscript", ".tflite", ".mlpackage", ".xml"}:
                continue
            if not path.is_file():
                continue
            key = str(path.resolve())
            seen[key] = {
                "id": path.name,
                "path": str(path),
                "size_bytes": path.stat().st_size,
                "modified": _safe_mtime(path),
                "task": infer_task_from_name(path.name),
                "exported": path.suffix.lower() != ".pt",
                "in_weights_dir": settings.weights_dir in path.parents,
            }
    return sorted(seen.values(), key=lambda item: item["modified"], reverse=True)


# ---------------------------------------------------------------------------
# engine
# ---------------------------------------------------------------------------


class Engine:
    """High level inference/training facade used by the API routers."""

    def __init__(self) -> None:
        self.registry = ModelRegistry()
        #: Persistent tracking generators (track mode over a video source).
        self._trackers: dict[str, Any] = {}
        self._tracker_lock = threading.RLock()
        #: Live per-frame trackers used by the WebSocket camera channel.
        self._live_pool: Any | None = None

    # -- live tracking -----------------------------------------------------
    @property
    def live(self) -> Any:
        """Lazily constructed pool of per-frame live trackers."""
        if self._live_pool is None:
            from .live import LiveTrackerPool

            self._live_pool = LiveTrackerPool(self)
        return self._live_pool

    def start_live_track(self, session: str, **kwargs: Any) -> Any:
        """Open (or reuse) a persistent live tracker for a session."""
        return self.live.get(session, **kwargs)

    def track_frame(self, session: str, frame: Any, **kwargs: Any) -> Any:
        """Run one frame through a persistent live tracker."""
        tracker = self.live.get(session, **kwargs)
        return tracker.infer(frame)

    # -- shared helpers ----------------------------------------------------
    @staticmethod
    def available() -> bool:
        try:
            _import_yolo()
        except EngineUnavailable:
            return False
        return True

    def describe(self, model_id: str, device: str | None = None) -> dict[str, Any]:
        record = self.registry.load(model_id, device=device)
        return {
            **record.meta(),
            "device": record.device,
            "engine_device": engine_device(device),
            "format": record.format,
            "path": str(record.path),
        }

    def predict(
        self,
        model_id: str,
        source: Any,
        *,
        task: str | None = None,
        device: str | None = None,
        conf: float | None = None,
        iou: float | None = None,
        imgsz: int | None = None,
        max_det: int = 300,
        classes: list[int] | None = None,
        augment: bool = False,
        agnostic_nms: bool = False,
        retina_masks: bool = False,
        half: bool | None = None,
        verbose: bool = False,
        save: bool = False,
        save_dir: Path | None = None,
        stream: bool = False,
        extra: dict[str, Any] | None = None,
    ) -> Any:
        """Run predict mode; returns the raw Ultralytics result(s).

        ``device`` is translated through :func:`engine_device`, so a Hailo
        request drives the loaded HEF while Ultralytics sees a normal CPU host.
        """
        record = self.registry.load(model_id, device=device, task=task)
        kwargs: dict[str, Any] = {
            "source": source,
            "device": engine_device(device),
            "conf": settings.default_confidence if conf is None else conf,
            "iou": settings.default_iou if iou is None else iou,
            "imgsz": imgsz or settings.default_imgsz,
            "max_det": max_det,
            "augment": augment,
            "agnostic_nms": agnostic_nms,
            "retina_masks": retina_masks,
            "verbose": verbose,
            "save": save,
            "stream": stream,
            "project": str(settings.outputs_dir),
            "name": save_dir.name if save_dir else "predict",
            "exist_ok": True,
        }
        if save_dir is not None:
            kwargs["save_dir"] = str(save_dir)
        if classes:
            kwargs["classes"] = classes
        if half is not None:
            kwargs["half"] = half
        if extra:
            kwargs.update({k: v for k, v in extra.items() if v is not None})
        return record.model.predict(**kwargs)

    def track(
        self,
        model_id: str,
        source: Any = None,
        *,
        tracker: str = "bytetrack.yaml",
        device: str | None = None,
        conf: float | None = None,
        iou: float | None = None,
        imgsz: int | None = None,
        classes: list[int] | None = None,
        persist: bool = True,
        stream: bool = True,
        session: str | None = None,
        save: bool = False,
        save_dir: Path | None = None,
        verbose: bool = False,
        extra: dict[str, Any] | None = None,
    ) -> Any:
        """Run track mode, optionally through a persistent per-session stream.

        Ultralytics' track mode is a *streaming* API: one long-lived generator per
        source that keeps tracker state between frames. When ``session`` is given
        the generator is cached and reused, so callers can simply keep calling it
        for the next frame (see :meth:`track_session_frames`).
        """
        record = self.registry.load(model_id, device=device)
        kwargs: dict[str, Any] = {
            "tracker": tracker,
            "device": engine_device(device),
            "conf": settings.default_confidence if conf is None else conf,
            "iou": settings.default_iou if iou is None else iou,
            "imgsz": imgsz or settings.default_imgsz,
            "persist": True if session else persist,
            "stream": True if session else stream,
            "verbose": verbose,
            "save": save,
            "project": str(settings.outputs_dir),
            "name": save_dir.name if save_dir else "track",
            "exist_ok": True,
        }
        if save_dir is not None:
            kwargs["save_dir"] = str(save_dir)
        if classes:
            kwargs["classes"] = classes
        if extra:
            kwargs.update({k: v for k, v in extra.items() if v is not None})

        if session:
            with self._tracker_lock:
                generator = self._trackers.get(session)
                if generator is None:
                    generator = record.model.track(source, **kwargs)
                    self._trackers[session] = generator
                return generator
        return record.model.track(source, **kwargs)

    def track_frames(self, session: str, **kwargs: Any) -> Any:
        """Return the cached tracking generator for a session (creating it lazily)."""
        with self._tracker_lock:
            generator = self._trackers.get(session)
        if generator is None:
            generator = self.track(source=None, session=session, **kwargs)
        return generator

    def release_session(self, session: str) -> bool:
        released = False
        if self._live_pool is not None:
            released = self._live_pool.release(session)
        with self._tracker_lock:
            self._trackers.pop(session, None)
        return released

    def sessions(self) -> list[str]:
        names: list[str] = []
        if self._live_pool is not None:
            names.extend(self._live_pool.sessions())
        with self._tracker_lock:
            names.extend(name for name in self._trackers if name not in names)
        return names

    def shutdown(self) -> None:
        """Stop every live tracker (called from the app lifespan)."""
        if self._live_pool is not None:
            self._live_pool.stop_all()
        with self._tracker_lock:
            self._trackers.clear()

    # -- validation / export / benchmark ----------------------------------
    def validate(self, model_id: str, *, data: str | None = None, **kwargs: Any) -> Any:
        record = self.registry.load(model_id)
        return record.model.val(data=data, **kwargs)

    def export(self, model_id: str, *, fmt: str = "onnx", **kwargs: Any) -> str:
        record = self.registry.load(model_id)
        return record.model.export(format=fmt, **kwargs)

    def benchmark(
        self, model_id: str, *, formats: list[str] | None = None, data: str | None = None, **kwargs: Any
    ) -> Any:
        record = self.registry.load(model_id)
        return record.model.benchmark(data=data, format=",".join(formats or ["onnx"]), **kwargs)

    def train(self, model_id: str, **kwargs: Any) -> Any:
        record = self.registry.load(model_id)
        return record.model.train(**kwargs)

    # -- serialisation -----------------------------------------------------
    def to_response(
        self,
        result: Any,
        *,
        model_id: str,
        device: str | None,
        rendered_dir: Path | None = None,
        save_rendered: bool = True,
        mask_limit: int = 64,
        name_hint: str | None = None,
    ) -> InferResponse:
        import uuid

        started = time.perf_counter()
        payloads: list[ResultPayload] = []
        names = serialise_names(getattr(result, "names", None))

        rendered_url = None
        if save_rendered:
            rendered_url = self._save_rendered(result, rendered_dir, name_hint=name_hint)

        record = self.registry.get_loaded(model_id)
        resolved_task = record.task if record is not None else (getattr(result, "task", None) or "detect")
        payloads.append(
            result_to_payload(
                result,
                names=names,
                task=resolved_task,
                rendered_url=rendered_url,
                mask_limit=mask_limit,
            )
        )

        if record is not None:
            meta = model_meta(record.model, source=str(record.path))
        else:
            meta = ModelMeta(
                source=model_id,
                task=resolved_task,
                names=names,
                classes=len(names),
                info={},
            )
        elapsed = (time.perf_counter() - started) * 1000
        return InferResponse(
            id=uuid.uuid4().hex[:12],
            model=meta,
            results=payloads,
            stats={
                "device": resolve_device(device),
                "engine_device": engine_device(device),
                "count": len(payloads),
            },
            elapsed_ms=round(elapsed, 2),
        )

    def _save_rendered(self, result: Any, rendered_dir: Path | None, name_hint: str | None = None) -> str | None:
        """Persist the annotated frame and return its media URL."""
        from .serialize import media_url

        try:
            plotted = result.plot()
        except Exception:  # pragma: no cover - some tasks have no plot
            return None
        if plotted is None:
            return None

        import cv2

        target_dir = rendered_dir or (settings.outputs_dir / "predict")
        target_dir.mkdir(parents=True, exist_ok=True)
        raw_path = str(getattr(result, "path", "") or "")
        # ``Results.path`` is ``image0.jpg`` when the source was an in-memory array.
        stem = Path(raw_path).stem if raw_path and not Path(raw_path).stem.startswith("image") else ""
        stem = stem or name_hint or "render"
        target = target_dir / f"{stem}_{time.time_ns() % 1_000_000_000}.jpg"
        if not cv2.imwrite(str(target), plotted):  # pragma: no cover - disk issues
            return None
        return media_url(target, "outputs")


#: Process-wide engine instance.
engine = Engine()
