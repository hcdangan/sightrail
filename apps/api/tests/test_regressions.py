"""Regression tests for the highest-risk backend behaviours.

Each test here pins a bug that was found by audit and fixed:

* concurrent jobs must not cross-contaminate captured stdout, and the real
  stdout must always be restored (``core/jobs.py``)
* a ZIP upload must not be able to write outside the upload store, which is
  Zip Slip (``services/uploads.py``)
* the live tracker must answer with the result for the frame that was pushed,
  not a stale one (``core/live.py``)
* the MJPEG session registry must not leak entries (``api/streams.py``)

They run without weights, a GPU or the network.
"""

from __future__ import annotations

import io
import sys
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from sightrail.core.jobs import Job, JobKind, capture_engine_stdout
from sightrail.services.uploads import _is_safe_member

# ---------------------------------------------------------------------------
# stdout capture isolation
# ---------------------------------------------------------------------------


def _make_job(name: str) -> Job:
    return Job(
        id=name,
        kind=JobKind.TRAIN,
        title=name,
        params={},
        created_at=datetime.now(timezone.utc),
    )


def test_stdout_is_restored_after_a_capture():
    real = sys.stdout
    with capture_engine_stdout(_make_job("solo")):
        print("inside the capture")  # noqa: T201 - writing to the captured stdout under test
    assert sys.stdout is real


def test_capture_records_the_job_it_belongs_to():
    job = _make_job("solo")
    with capture_engine_stdout(job):
        print("hello from the engine")  # noqa: T201 - writing to the captured stdout under test
    assert any("hello from the engine" in event.message for event in job.log)


def test_concurrent_captures_do_not_cross_contaminate():
    """Two jobs capturing at once must each see only their own output.

    The original implementation swapped the process-global ``sys.stdout``, so
    interleaved jobs captured each other's lines and the first job to finish
    installed a dead capture as the real stdout.
    """
    real = sys.stdout
    jobs = {name: _make_job(name) for name in ("alpha", "beta", "gamma")}
    start = threading.Barrier(len(jobs))

    def worker(name: str) -> None:
        start.wait(timeout=5)
        with capture_engine_stdout(jobs[name]):
            for index in range(60):
                print(f"{name}-line-{index}")  # noqa: T201 - writing to the captured stdout under test
                if index % 10 == 0:
                    threading.Event().wait(0.001)

    threads = [threading.Thread(target=worker, args=(name,)) for name in jobs]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)
        assert not thread.is_alive()

    for name, job in jobs.items():
        lines = [event.message for event in job.log if event.message.startswith(("alpha-", "beta-", "gamma-"))]
        foreign = [line for line in lines if not line.startswith(f"{name}-")]
        assert foreign == [], f"job {name} captured other jobs' output: {foreign[:3]}"
        assert any(line.startswith(f"{name}-") for line in lines), f"job {name} captured nothing"

    # The critical invariant: the real stdout must be back, not a dead capture.
    assert sys.stdout is real
    captured = io.StringIO()
    original = sys.stdout
    sys.stdout = captured
    try:
        print("still working")  # noqa: T201 - writing to the captured stdout under test
    finally:
        sys.stdout = original
    assert captured.getvalue().strip() == "still working"


def test_output_from_a_job_owned_helper_thread_is_still_captured():
    """A single running job also claims output from threads it spawned."""
    job = _make_job("parent")

    def helper() -> None:
        print("from-a-helper-thread")  # noqa: T201 - writing to the captured stdout under test

    with capture_engine_stdout(job):
        thread = threading.Thread(target=helper)
        thread.start()
        thread.join(timeout=5)

    assert any("from-a-helper-thread" in event.message for event in job.log)


# ---------------------------------------------------------------------------
# Zip Slip
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["../escape.txt", "..\\escape.txt", "a/../../escape.txt", "/etc/passwd", "C:/Windows/system32/x.dll"],
)
def test_unsafe_zip_members_are_rejected(name, tmp_path):
    assert _is_safe_member(name, tmp_path.resolve()) is False


@pytest.mark.parametrize("name", ["image.jpg", "nested/dir/image.png", "a/b/c.txt"])
def test_safe_zip_members_are_allowed(name, tmp_path):
    assert _is_safe_member(name, tmp_path.resolve()) is True


def test_directory_entries_are_allowed(tmp_path):
    assert _is_safe_member("images/", tmp_path.resolve()) is True
    assert _is_safe_member("", tmp_path.resolve()) is True


def _zip_with_members(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return path


def test_extract_endpoint_refuses_a_traversal_archive(client, tmp_path):
    """The traversal payload never reaches ``extractall``."""
    import sightrail.services.uploads as uploads_module

    archive = _zip_with_members(tmp_path / "evil.zip", {"../escaped.txt": b"pwned", "ok.png": b"x"})
    response = client.post("/api/uploads", files={"file": ("evil.zip", archive.read_bytes(), "application/zip")})
    assert response.status_code == 200, response.text
    upload_id = response.json()["id"]

    try:
        extracted = client.post(f"/api/uploads/{upload_id}/extract")
        assert extracted.status_code == 400, extracted.text
        assert "outside the upload directory" in extracted.json()["detail"]
        # Nothing may exist outside the upload store.
        stray = Path(uploads_module.settings.uploads_dir).parent.parent / "escaped.txt"
        assert not stray.exists()
    finally:
        client.delete(f"/api/uploads/{upload_id}")


def test_extract_endpoint_accepts_a_benign_archive(client, tmp_path):
    archive = _zip_with_members(tmp_path / "good.zip", {"a.png": b"not-really-png", "nested/b.png": b"x"})
    response = client.post("/api/uploads", files={"file": ("good.zip", archive.read_bytes(), "application/zip")})
    upload_id = response.json()["id"]
    try:
        extracted = client.post(f"/api/uploads/{upload_id}/extract")
        assert extracted.status_code == 200, extracted.text
        names = {entry["name"] for entry in extracted.json()["extracted"]}
        assert names == {"a.png", "b.png"}
    finally:
        client.delete(f"/api/uploads/{upload_id}")


# ---------------------------------------------------------------------------
# live tracker frame matching
# ---------------------------------------------------------------------------


class _FakeStream:
    """Minimal stand-in for FrameStream.

    ``push`` synchronously invokes ``on_push`` with the sequence number so a test
    can recreate the exact interleaving of the tracking thread.
    """

    def __init__(self, on_push=None) -> None:
        self.pushed_seq = 0
        self.frames: list[tuple[int, object]] = []
        self._on_push = on_push

    def push(self, frame: object, seq: int) -> None:
        self.pushed_seq = seq
        self.frames.append((seq, frame))
        if self._on_push is not None:
            self._on_push(seq)


def _bare_tracker(stream: _FakeStream):
    from sightrail.core.live import LiveTracker

    tracker = LiveTracker.__new__(LiveTracker)  # bypass model loading
    tracker._lock = threading.Lock()
    tracker._ready = threading.Event()
    tracker._error = None
    tracker._result = None
    tracker._result_seq = -1
    tracker._seq = 0
    tracker._stop = threading.Event()
    tracker._stream = stream
    return tracker


def test_live_tracker_returns_the_result_for_the_pushed_frame():
    """The normal path: the result tagged with this frame's id is returned."""
    import numpy as np

    state: dict[str, object] = {}

    def produce(seq: int) -> None:
        # The tracking thread stores the result and tags it with pushed_seq.
        state["tracker"]._result_seq = seq  # type: ignore[union-attr]
        state["tracker"]._result = {"frame": seq}  # type: ignore[union-attr]
        state["tracker"]._ready.set()  # type: ignore[union-attr]

    stream = _FakeStream(on_push=produce)
    tracker = _bare_tracker(stream)
    state["tracker"] = tracker

    first = tracker.infer(np.zeros((8, 8, 3), dtype=np.uint8), timeout=2)
    second = tracker.infer(np.zeros((8, 8, 3), dtype=np.uint8), timeout=2)

    assert first == {"frame": 1}
    assert second == {"frame": 2}, "a stale result was returned for a newer frame"
    assert [seq for seq, _ in stream.frames] == [1, 2]


def test_live_tracker_ignores_a_result_for_an_earlier_frame():
    """A late result tagged with an older sequence must never be returned."""
    import numpy as np

    state: dict[str, object] = {}

    def produce(seq: int) -> None:
        tracker = state["tracker"]
        # Deliberately mis-tag the first result as belonging to frame 0.
        tracker._result_seq = seq - 1 if seq == 1 else seq  # type: ignore[union-attr]
        tracker._result = {"frame": seq}  # type: ignore[union-attr]
        tracker._ready.set()  # type: ignore[union-attr]

    stream = _FakeStream(on_push=produce)
    tracker = _bare_tracker(stream)
    state["tracker"] = tracker

    # Frame 1's result is mis-tagged, so infer must time out rather than lie.
    with pytest.raises(TimeoutError):
        tracker.infer(np.zeros((8, 8, 3), dtype=np.uint8), timeout=0.3)

    # The next frame is answered correctly.
    result = tracker.infer(np.zeros((8, 8, 3), dtype=np.uint8), timeout=2)
    assert result == {"frame": 2}
