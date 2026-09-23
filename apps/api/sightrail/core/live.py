"""Blocking frame bridge for live tracking.

Ultralytics' ``track`` mode is a *streaming* API: it expects one long-lived
iterable of frames and keeps tracker state between iterations. A camera loop
pushes frames one at a time, so we bridge the two with a queue-backed loader plus
a background thread that consumes the model's generator.

The bridge subclasses ``LoadStreams`` so Ultralytics treats it as a real video
stream, which is what enables per-frame ID persistence for ByteTrack, BoT-SORT,
OC-SORT and the other trackers.
"""

from __future__ import annotations

import contextlib
import queue
import threading
import time
from typing import Any

import numpy as np

from .device import engine_device
from .engine import Engine
from .serialize import serialise_names

#: How long a single frame may take before the caller gives up (seconds).
FRAME_TIMEOUT = 60.0


def _load_streams_base() -> type:
    """Return ``LoadStreams`` so the bridge is recognised as a stream source."""
    from ultralytics.data.loaders import LoadStreams

    return LoadStreams


# The base class is resolved at import time by `_load_streams_base()`, which mypy
# cannot model; the ignore covers that one dynamic-base diagnostic.
class FrameStream(_load_streams_base()):  # type: ignore[misc]
    """A ``LoadStreams`` that yields frames pushed from another thread.

    Only the attributes the Ultralytics predictor reads are initialised: the
    normal ``LoadStreams.__init__`` expects real RTSP/USB sources.
    """

    def __init__(self, name: str = "live") -> None:
        from ultralytics.data.loaders import SourceTypes

        self.name = name
        self.mode = "stream"
        self.frame = 0
        self.bs = 1
        self.fps = 30
        self.nf = 0
        self.ni = 0
        self.files: list[str] = []
        self.video_flag: list[bool] = []
        self.cap = None
        self.vid_stride = 1
        self.cv2_flag = 1  # cv2.IMREAD_COLOR
        self.source_type = SourceTypes(stream=True)
        self._queue: queue.Queue[tuple[int, np.ndarray]] = queue.Queue(maxsize=1)
        self._closed = False
        #: Sequence number of the most recent frame offered to the model. Set at
        #: push time (not consume time) so a dropped frame cannot desynchronise it.
        self.pushed_seq = 0

    # -- producer ---------------------------------------------------------
    def push(self, frame: np.ndarray, seq: int) -> None:
        """Queue the newest frame, dropping any frame that is still pending."""
        if self._closed:
            return
        item = (seq, frame)
        self.pushed_seq = seq
        with contextlib.suppress(queue.Full):
            self._queue.put_nowait(item)
            return
        # Queue is full: replace the stale frame so inference never lags behind.
        with contextlib.suppress(queue.Empty):
            self._queue.get_nowait()
        with contextlib.suppress(queue.Full):
            self._queue.put_nowait(item)

    def close(self) -> None:
        self._closed = True
        # Unblock a waiting ``__next__`` so the generator can exit.
        with contextlib.suppress(queue.Full):
            self._queue.put_nowait((self.pushed_seq, np.zeros((1, 1, 3), dtype=np.uint8)))

    # -- consumer ---------------------------------------------------------
    def __iter__(self) -> FrameStream:
        return self

    def __next__(self) -> tuple[list[str], list[np.ndarray], list[str]]:
        if self._closed:
            raise StopIteration
        try:
            _seq, frame = self._queue.get(timeout=FRAME_TIMEOUT)
        except queue.Empty:
            raise StopIteration from None
        if self._closed:
            raise StopIteration
        self.frame += 1
        return [f"{self.name}.jpg"], [frame], [f"{self.name}: "]

    def __len__(self) -> int:  # pragma: no cover - stream has no length
        return 1


class LiveTracker:
    """Owns a tracking generator fed by a :class:`FrameStream`."""

    def __init__(
        self,
        engine: Engine,
        *,
        model_id: str,
        tracker: str = "bytetrack.yaml",
        device: str | None = None,
        conf: float | None = None,
        iou: float | None = None,
        imgsz: int | None = None,
        classes: list[int] | None = None,
        verbose: bool = False,
    ) -> None:
        self._engine = engine
        self._stream = FrameStream()
        self._lock = threading.Lock()
        self._ready = threading.Event()
        self._result: Any = None
        #: Sequence numbers let infer() reject a result for an earlier frame.
        self._seq = 0
        self._result_seq = -1
        self._error: BaseException | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = False
        self.model_record = engine.registry.load(model_id, device=device)
        self.names = serialise_names(getattr(self.model_record.model, "names", {}))
        # Hailo resolves to itself but drives the engine as cpu, so the record's
        # device is authoritative for what Ultralytics will accept.
        self._kwargs: dict[str, Any] = {
            "tracker": tracker,
            # Ultralytics rejects `auto`: "Invalid CUDA 'device=auto' requested".
            # `predict` resolves the device inside the registry, but the `track`
            # path forwarded the requested string verbatim, which broke live
            # tracking on every host that does not resolve to the literal request.
            "device": engine_device(device),
            "conf": conf,
            "iou": iou,
            "imgsz": imgsz,
            "classes": classes,
            "verbose": verbose,
        }

    # -- lifecycle --------------------------------------------------------
    def start(self) -> None:
        """Consume the first real frame, which spins up the predictor."""
        if self._started:
            return
        self._started = True
        self._thread = threading.Thread(target=self._run, name="live-tracker", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            generator = self.model_record.model.track(
                source=self._stream,
                stream=True,
                persist=True,
                **{key: value for key, value in self._kwargs.items() if value is not None},
            )
            for result in generator:
                with self._lock:
                    # Tag the result with the sequence number of the frame that
                    # produced it, so infer() can refuse a stale hand-off.
                    self._result_seq = self._stream.pushed_seq
                    self._result = result
                self._ready.set()
                if self._stop.is_set():
                    break
        except BaseException as exc:
            self._error = exc
        finally:
            self._ready.set()

    def stop(self) -> None:
        self._stop.set()
        self._stream.close()
        if self._thread is not None:
            self._thread.join(timeout=5.0)

    # -- inference --------------------------------------------------------
    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and self._error is None

    def infer(self, frame: np.ndarray, timeout: float = FRAME_TIMEOUT) -> Any:
        """Push a frame and return the tracker's result *for that frame*.

        Two races are possible when a camera loop hands frames to a streaming
        tracker, and both are handled here:

        1. A result for an *earlier* frame can arrive after the sequence number
           has advanced. It is ignored, so the answer always corresponds to the
           frame that was pushed.
        2. A result can land in the window *before* the event is cleared. The
           loop therefore re-reads the result state on every pass and treats the
           event purely as a low-latency wake-up, rather than trusting a single
           signal.
        """
        if self._error is not None:
            raise self._error

        with self._lock:
            self._seq += 1
            seq = self._seq
        self._ready.clear()
        self._stream.push(frame, seq)

        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                result = self._result
                matched = self._result_seq == seq
            if matched and result is not None:
                return result
            if self._error is not None:
                raise self._error
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            # Wake early on a new result; the state is re-checked regardless, so
            # a signal that arrived before the clear cannot be lost.
            self._ready.wait(timeout=min(0.05, remaining))

        if self._error is not None:
            raise self._error
        raise TimeoutError("The tracking loop did not return a result in time.")


class LiveTrackerPool:
    """Keeps one :class:`LiveTracker` per session id."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._trackers: dict[str, LiveTracker] = {}
        self._lock = threading.RLock()

    def get(self, session: str, **kwargs: Any) -> LiveTracker:
        with self._lock:
            tracker = self._trackers.get(session)
            if tracker is not None and tracker.alive:
                return tracker
            if tracker is not None:
                with contextlib.suppress(Exception):
                    tracker.stop()
            tracker = LiveTracker(self._engine, **kwargs)
            tracker.start()
            self._trackers[session] = tracker
            return tracker

    def release(self, session: str) -> bool:
        with self._lock:
            tracker = self._trackers.pop(session, None)
        if tracker is None:
            return False
        with contextlib.suppress(Exception):
            tracker.stop()
        return True

    def sessions(self) -> list[str]:
        with self._lock:
            return list(self._trackers)

    def stop_all(self) -> None:
        with self._lock:
            trackers = list(self._trackers.values())
            self._trackers.clear()
        for tracker in trackers:
            with contextlib.suppress(Exception):
                tracker.stop()
