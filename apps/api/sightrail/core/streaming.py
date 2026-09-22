"""Live inference: MJPEG over HTTP and JSON over WebSocket.

Two complementary transports are exposed:

``/api/stream/video``
    Server-driven MJPEG for video files and webcams. Frames are annotated in
    Python (optionally through a built-in Ultralytics *solution*) and pushed to
    an ``<img>`` tag, while the parallel WebSocket publishes per-frame analytics.
``/api/stream/live``
    Client-driven WebSocket: the browser sends camera frames and receives
    detection geometry so it can draw a perfectly crisp overlay locally.

Both share :class:`FrameProcessor`, which keeps per-session state (tracker
predictor, solution instance, counters) across frames.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from ..config import settings
from ..schemas.base import JobProgress
from ..schemas.results import ResultPayload
from .engine import engine
from .serialize import frame_to_data_url, frame_to_jpeg_bytes, result_to_payload, serialise_names

# ---------------------------------------------------------------------------
# solutions catalog
# ---------------------------------------------------------------------------

#: Built-in Ultralytics solutions exposed in Live Studio.
SOLUTION_CATALOG: list[dict[str, Any]] = [
    {
        "id": "none",
        "label": "Plain inference",
        "description": "Detect / segment / pose with no post-processing layers.",
        "tasks": ["detect", "segment", "pose", "obb", "classify"],
        "needs_region": False,
    },
    {
        "id": "object_counter",
        "label": "Object Counter",
        "description": "Count objects crossing a line or entering a region.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "line",
        "default_region": [[100, 300], [900, 300]],
    },
    {
        "id": "region_counter",
        "label": "Region Counter",
        "description": "Count objects per polygon region with live totals.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygon",
        "default_region": [[200, 200], [800, 200], [800, 600], [200, 600]],
    },
    {
        "id": "queue_management",
        "label": "Queue Manager",
        "description": "Monitor a queue and report current length and average wait time.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygon",
        "default_region": [[300, 200], [700, 200], [700, 600], [300, 600]],
    },
    {
        "id": "heatmap",
        "label": "Heatmap",
        "description": "Accumulate object positions into a colour heatmap.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "trackzone",
        "label": "Track Zone",
        "description": "Only track objects inside a chosen zone.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygon",
        "default_region": [[100, 100], [900, 100], [900, 600], [100, 600]],
    },
    {
        "id": "speed_estimation",
        "label": "Speed Estimator",
        "description": "Estimate per-object speed from a perspective region.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygon",
        "default_region": [[100, 400], [900, 400], [900, 600], [100, 600]],
    },
    {
        "id": "ai_gym",
        "label": "AI Gym",
        "description": "Count exercise repetitions from pose keypoints.",
        "tasks": ["pose"],
        "needs_region": False,
    },
    {
        "id": "distance_calculation",
        "label": "Distance Calculation",
        "description": "Measure the pixel/real-world distance between two objects.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "vision_eye",
        "label": "Vision Eye",
        "description": "Draw a gaze line from a source point to the nearest object.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "security_alarm",
        "label": "Security Alarm",
        "description": "Raise an alarm when objects enter a monitored region.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygon",
        "default_region": [[200, 200], [800, 200], [800, 600], [200, 600]],
    },
    {
        "id": "object_blurrer",
        "label": "Object Blurrer",
        "description": "Blur detected objects for privacy-preserving analytics.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "object_cropper",
        "label": "Object Cropper",
        "description": "Crop every detection into an individual image tile.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "instance_segmentation",
        "label": "Instance Segmentation",
        "description": "Segmentation driven analytic layer with object IDs.",
        "tasks": ["segment"],
        "needs_region": False,
    },
    {
        "id": "analytics",
        "label": "Analytics",
        "description": "Generic per-class counting and charting layer.",
        "tasks": ["detect"],
        "needs_region": False,
    },
    {
        "id": "parking_management",
        "label": "Parking Management",
        "description": "Per-bay occupancy from a polygon map of parking spaces.",
        "tasks": ["detect"],
        "needs_region": True,
        "region_kind": "polygons",
        "default_region": [
            [[50, 400], [250, 400], [250, 600], [50, 600]],
            [[300, 400], [500, 400], [500, 600], [300, 600]],
        ],
    },
]

SOLUTION_BY_ID = {item["id"]: item for item in SOLUTION_CATALOG}

#: Extra keyword arguments each solution accepts from the UI.
_SOLUTION_KWARGS: dict[str, tuple[str, ...]] = {
    "object_counter": ("show_in", "show_out", "show", "line_width", "classes"),
    "region_counter": ("show", "line_width", "classes", "region_color"),
    "queue_management": ("show", "line_width", "classes"),
    "heatmap": ("colormap", "show", "line_width", "classes", "blur_ratio"),
    "trackzone": ("show", "line_width", "classes"),
    "speed_estimation": ("show", "line_width", "classes", "max_hist"),
    "ai_gym": ("show", "line_width", "classes", "up_angle", "down_angle", "kpts"),
    "distance_calculation": ("show", "line_width", "classes", "centroid_color"),
    "vision_eye": ("show", "line_width", "classes"),
    "security_alarm": ("show", "line_width", "classes", "records"),
    "object_blurrer": ("show", "line_width", "classes"),
    "object_cropper": ("show", "line_width", "classes", "crop_dir"),
    "instance_segmentation": ("show", "line_width", "classes"),
    "analytics": ("show", "line_width", "classes", "analytics_type"),
    "parking_management": ("show", "line_width", "classes", "json_file"),
}


def list_solutions() -> list[dict[str, Any]]:
    return SOLUTION_CATALOG


def _region_to_pixels(region: Any, shape: tuple[int, ...] | None) -> tuple[Any, bool]:
    """Scale a 0..1 ROI into source pixels.

    Ultralytics solutions take region geometry in source pixel coordinates, but
    the UI cannot know the frame size before a webcam stream starts. Sending
    fractions and resolving them against the real frame size keeps a saved ROI
    correct at every resolution instead of pinned to whatever the defaults were
    authored against.

    Returns ``(region, resolved)``. ``resolved`` is False when the frame size was
    unavailable, which the caller must treat as "no region" — passing 0..1
    fractions through as if they were pixels would silently place the ROI in the
    top-left corner of the frame rather than reporting a problem.

    A region that already looks like pixels (any coordinate above 1) is passed
    through untouched, so pixel-space callers keep working.
    """
    if not region or not shape:
        return region, False

    height, width = int(shape[0]), int(shape[1])
    if height <= 0 or width <= 0:
        return region, False

    def _is_point(value: Any) -> bool:
        """A usable coordinate pair — some clients can send `[[1]]`."""
        return isinstance(value, (list, tuple)) and len(value) >= 2

    def _convert(points: Any) -> Any:
        return [(float(point[0]) * width, float(point[1]) * height) for point in points]

    def _looks_normalised(points: Any) -> bool:
        if not isinstance(points, (list, tuple)) or len(points) < 2:
            return False
        if not all(_is_point(point) for point in points):
            return False
        try:
            return all(0.0 <= float(value) <= 1.0 for point in points for value in point[:2])
        except (TypeError, ValueError):
            return False

    # Multi-polygon: a list of polygons rather than a list of points.
    if isinstance(region, (list, tuple)) and region and isinstance(region[0], (list, tuple)) and region[0]:
        if isinstance(region[0][0], (list, tuple)):
            polygons = [polygon for polygon in region if _looks_normalised(polygon)]
            return ([_convert(polygon) for polygon in polygons], True) if polygons else (None, False)
        if _looks_normalised(region):
            return _convert(region), True
    return None, False


def _build_solution(
    solution_id: str,
    *,
    model_id: str,
    region: Any,
    region_kind: str | None,
    overrides: dict[str, Any],
    frame_shape: tuple[int, ...] | None = None,
    region_normalised: bool = False,
) -> Any:
    """Instantiate a built-in solution, degrading gracefully when unsupported."""
    if solution_id in {"none", ""}:
        return None

    from ultralytics import solutions as ul_solutions

    class_name = "".join(part.capitalize() for part in solution_id.split("_"))
    solution_cls = getattr(ul_solutions, class_name, None)
    if solution_cls is None:
        raise ValueError(f"Solution '{solution_id}' is not available in this Ultralytics build.")

    spec = SOLUTION_BY_ID.get(solution_id, {})
    if region_normalised and spec.get("needs_region"):
        region, resolved = _region_to_pixels(region, frame_shape)
        if not resolved:
            # Better to run without an ROI than with one in the wrong place; the
            # sessions endpoint reports this so the UI can say so.
            region = None

    kwargs: dict[str, Any] = {"model": model_id, "verbose": False}
    if spec.get("needs_region") and region:
        if spec.get("region_kind") == "line" and region_kind != "polygons":
            kwargs["region"] = [tuple(point) for point in region]
        else:
            kwargs["region"] = region

    allowed = set(_SOLUTION_KWARGS.get(solution_id, ()))
    signature = inspect.signature(solution_cls.__init__)
    accepted = set(signature.parameters)
    for key, value in overrides.items():
        if value is None or key in {"model", "region"}:
            continue
        if key in accepted or key in allowed:
            kwargs[key] = value

    # Only pass arguments the class actually declares — but `region` is special.
    # Several solutions (ObjectCounter among them) are declared as
    # `def __init__(self, **kwargs)` and forward `region` to the base class, so it
    # is absent from `signature.parameters` and would be filtered out here. That
    # silently discarded the caller's ROI: the solution fell back to its own
    # internal default while the API still reported the region as applied.
    passthrough = {"model", "region"}
    kwargs = {k: v for k, v in kwargs.items() if k in accepted or k in passthrough}
    return solution_cls(**kwargs)


def _graceful_shutdown(solution: Any) -> None:
    with contextlib.suppress(Exception):
        if hasattr(solution, "stop"):
            solution.stop()


#: Fields read from ``SolutionResults`` that are actual analytics values.
_COUNTER_FIELDS: tuple[str, ...] = (
    "in_count",
    "out_count",
    "classwise_count",
    "queue_count",
    "workout_count",
    "workout_angle",
    "workout_stage",
    "pixels_distance",
    "available_slots",
    "filled_slots",
    "email_sent",
    "total_tracks",
    "region_counts",
    "track_history",
)


def apply_solution(solution: Any, frame: np.ndarray, frame_number: int) -> tuple[np.ndarray, dict[str, Any]]:
    """Run a solution's ``process()`` and normalise its result.

    Ultralytics solutions return a ``SolutionResults`` object whose ``plot_im``
    holds the annotated frame and whose remaining fields carry the analytics.
    ``Analytics`` additionally requires the frame index, so it is passed only to
    the solutions that declare it.
    """
    counters: dict[str, Any] = {}
    method = getattr(solution, "process", None)
    if method is None:
        return frame, counters

    signature = inspect.signature(method)
    args: tuple[Any, ...] = (frame, frame_number) if len(signature.parameters) > 1 else (frame,)
    output = method(*args)

    if isinstance(output, np.ndarray):
        return output, counters

    plot = getattr(output, "plot_im", None)
    annotated = plot if isinstance(plot, np.ndarray) else frame

    # ``field`` is the API's term for these analytics keys; the loop variable is
    # named to match the wire format rather than the dataclass helper.
    for counter_field in _COUNTER_FIELDS:
        value = getattr(output, counter_field, None)
        if value is None or value == [] or value == {}:
            continue
        counters[counter_field] = _jsonable(value)
    if not counters:
        counters["solution"] = type(solution).__name__
    return annotated, counters


def _jsonable(value: Any) -> Any:
    """Convert numpy scalars/arrays into JSON-safe values."""
    if isinstance(value, (int, float, str, bool)):
        return value
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return str(value)


# ---------------------------------------------------------------------------
# frame processing
# ---------------------------------------------------------------------------


@dataclass
class StreamConfig:
    """Everything needed to render an annotated frame."""

    model_id: str
    task: str | None = None
    device: str | None = None
    tracker: str | None = "bytetrack.yaml"
    conf: float | None = None
    iou: float | None = None
    imgsz: int | None = None
    classes: list[int] | None = None
    solution: str = "none"
    solution_kwargs: dict[str, Any] = field(default_factory=dict)
    region: Any = None
    region_kind: str | None = None
    #: When true, ``region`` holds 0..1 fractions instead of source pixels. The
    #: UI uses this because it cannot know the frame size before the stream
    #: starts: a default region hard-coded in pixels is only correct for one
    #: resolution, which is exactly how the reported "line ROI is in the wrong
    #: place" behaviour arose.
    region_normalised: bool = False
    #: Source frame ``(height, width)`` when it is known before the first frame
    #: (a video file's dimensions, or the browser's camera size). Required to
    #: resolve a normalised region into pixels.
    frame_shape: tuple[int, int] | None = None
    show_boxes: bool = True
    jpeg_quality: int = 80
    #: Encode an annotated JPEG per frame. The client camera loop draws its own
    #: overlay from the geometry, so it turns this off and saves a full JPEG
    #: encode plus a base64 copy on every frame.
    render_frames: bool = True
    max_history: int = 240


class StreamSession:
    """Per-client state for MJPEG streaming."""

    def __init__(self, config: StreamConfig, source: str | int) -> None:
        self.id = uuid.uuid4().hex[:10]
        self.config = config
        self.source = source
        self.model = engine.registry.load(config.model_id, device=config.device, task=config.task)
        self.names = self.model.names
        self.solution = _build_solution(
            config.solution,
            model_id=str(self.model.path),
            region=config.region,
            region_kind=config.region_kind,
            overrides=config.solution_kwargs,
            frame_shape=config.frame_shape,
            region_normalised=config.region_normalised,
        )
        self.counts: dict[str, Any] = {}
        self.history: deque[dict[str, Any]] = deque(maxlen=config.max_history)
        self.frames = 0
        self.started_at = time.time()
        self.last_frame_at = time.time()
        self.fps = 0.0
        self._stop = threading.Event()

    # -- lifecycle ---------------------------------------------------------
    def stop(self) -> None:
        self._stop.set()

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    def release(self) -> None:
        with contextlib.suppress(Exception):
            if self.solution is not None and hasattr(self.solution, "stop"):
                self.solution.stop()
        engine.release_session(self.id)

    # -- per-frame ---------------------------------------------------------
    def process(self, frame: np.ndarray) -> tuple[np.ndarray, ResultPayload | None, dict[str, Any]]:
        """Annotate a single frame, returning (image, serialised result, counters)."""
        config = self.config
        rendered = frame
        payload: ResultPayload | None = None
        counters: dict[str, Any] = {}

        # 1. Analytics layer (Ultralytics solution) draws onto the frame.
        if self.solution is not None:
            try:
                rendered, counters = apply_solution(self.solution, frame.copy(), self.frames)
            except Exception:
                self.solution = None
                counters = {}

        # 2. Model inference provides the structured geometry for the client.
        if config.show_boxes or payload is None:
            kwargs: dict[str, Any] = {
                "conf": config.conf,
                "iou": config.iou,
                "imgsz": config.imgsz,
                "classes": config.classes,
                "verbose": False,
            }
            if config.tracker:
                result = engine.track_frame(
                    self.id,
                    frame,
                    model_id=config.model_id,
                    tracker=config.tracker,
                    device=config.device,
                    conf=config.conf,
                    iou=config.iou,
                    imgsz=config.imgsz,
                    classes=config.classes,
                )
            else:
                results = engine.predict(config.model_id, frame, device=config.device, task=config.task, **kwargs)
                result = results[0] if isinstance(results, list) else results
            if result is not None:
                names = serialise_names(getattr(result, "names", self.names))
                payload = result_to_payload(result, names=names, mask_limit=32)
                if self.solution is None:
                    with contextlib.suppress(Exception):
                        rendered = result.plot()

        self.frames += 1
        now = time.time()
        delta = now - self.last_frame_at
        if delta > 0:
            instant = 1.0 / delta
            self.fps = instant if self.fps == 0 else (self.fps * 0.8 + instant * 0.2)
        self.last_frame_at = now
        self.counts = counters
        return rendered, payload, counters

    def stats(self) -> dict[str, Any]:
        return {
            "session_id": self.id,
            "frames": self.frames,
            "fps": round(self.fps, 2),
            "uptime_s": round(time.time() - self.started_at, 1),
            "solution": self.config.solution,
            "counters": self.counts,
            "model": str(self.model.path.name) if hasattr(self.model, "path") else self.config.model_id,
        }


# ---------------------------------------------------------------------------
# frame sources
# ---------------------------------------------------------------------------


def open_source(source: str | int) -> Any:
    """Open a video file, image sequence or webcam index with OpenCV."""
    import cv2

    if isinstance(source, int):
        capture = cv2.VideoCapture(source, cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else 0)
    else:
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"Video source not found: {source}")
        capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video source: {source}")
    return capture


def available_cameras(max_index: int | None = None) -> list[dict[str, Any]]:
    """Probe the first few webcam indexes; only reports ones that open."""
    import cv2

    limit = max_index or settings.webcam_scan_indexes
    found: list[dict[str, Any]] = []
    for index in range(limit):
        backend = cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else 0
        capture = cv2.VideoCapture(index, backend)
        try:
            if capture.isOpened():
                ok, frame = capture.read()
                if ok and frame is not None:
                    height, width = frame.shape[:2]
                    found.append(
                        {
                            "id": index,
                            "label": f"Camera {index}",
                            "resolution": f"{width}x{height}",
                        }
                    )
        except Exception:  # pragma: no cover - device specific
            continue
        finally:
            capture.release()
    return found


#: Consecutive failed reads tolerated before an MJPEG stream gives up.
MAX_CONSECUTIVE_READ_FAILURES = 30


def mjpeg_frames(session: StreamSession):
    """Yield multipart JPEG chunks for a streaming HTTP response.

    A failed ``read()`` must never be processed: for a looping file the frame
    would be the previous one (or ``None``), and handing that to the model makes
    the whole stream 500. Reads are retried a bounded number of times instead,
    and a live source that stops producing ends the stream cleanly.
    """
    import cv2

    capture = open_source(session.source)
    failures = 0
    try:
        while not session.stopped:
            ok, frame = capture.read()
            if not ok or frame is None:
                failures += 1
                if isinstance(session.source, int):
                    # A webcam that stops producing is finished, not looping.
                    break
                if failures >= MAX_CONSECUTIVE_READ_FAILURES:
                    break
                # Rewind a file source to loop it, then try again.
                capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            failures = 0
            rendered, payload, _counters = session.process(frame)
            buffer = frame_to_jpeg_bytes(rendered, session.config.jpeg_quality)
            if payload is not None:
                session.history.append(
                    {
                        "frame": session.frames,
                        "count": (payload.detections.count if payload.detections else 0)
                        + (payload.masks.count if payload.masks else 0),
                        "classes": {},
                        "fps": round(session.fps, 2),
                    }
                )
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(buffer)).encode()
                + b"\r\n\r\n"
                + buffer
                + b"\r\n"
            )
    finally:
        capture.release()
        session.release()


def video_jobs_frames(session: StreamSession, path: Path, job: Any):
    """Process a video file to completion, emitting progress into a job."""
    import cv2

    capture = open_source(str(path))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0

    # A VideoWriter built with a zero dimension silently discards every frame,
    # so the job would "succeed" and register an empty artifact. Fail loudly.
    if width <= 0 or height <= 0:
        capture.release()
        session.release()
        raise RuntimeError(
            f"Could not determine the frame size of '{path.name}' (reported {width}x{height}); "
            "the file may be corrupt or use an unsupported codec."
        )

    output_path = settings.outputs_dir / "video" / f"{path.stem}_annotated_{job.id}.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # `cv2.VideoWriter.fourcc` is the modern spelling; the older module-level
    # `VideoWriter_fourcc` is absent from the OpenCV 5.x bindings.
    fourcc = cv2.VideoWriter.fourcc(*"mp4v")  # type: ignore[attr-defined]
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
    if not writer.isOpened():
        capture.release()
        session.release()
        raise RuntimeError(f"OpenCV could not open a video writer for '{output_path.name}'.")

    timeline: list[dict[str, Any]] = []
    per_frame: list[dict[str, Any]] = []
    index = 0
    try:
        while True:
            if job.cancel_requested:
                break
            ok, frame = capture.read()
            if not ok:
                break
            rendered, payload, _counters = session.process(frame)
            writer.write(rendered)
            if payload is not None:
                detections = []
                for source_payload in (payload.detections, payload.obb):
                    if source_payload is None:
                        continue
                    for item in source_payload.items:
                        detections.append(
                            {
                                "track_id": item.track_id,
                                "class_name": item.class_name,
                                "confidence": item.confidence,
                                "xyxy": [round(v, 1) for v in item.xyxy[:4]],
                            }
                        )
                per_frame.append({"frame": index, "detections": detections})
                timeline.append(
                    {
                        "frame": index,
                        "t": round(index / fps, 3),
                        "count": len(detections),
                        "unique_ids": len({d["track_id"] for d in detections if d["track_id"] is not None}),
                        "by_class": _tally(detections),
                        "fps": round(session.fps, 1),
                    }
                )
            if index % 5 == 0 or index == total:
                percent = (100.0 * index / total) if total else 0.0
                job.set_progress(percent, f"Frame {index}/{total or '?'}")
                job.emit(
                    JobProgress(
                        kind="metric",
                        message="frame",
                        data={
                            "frame": index,
                            "objects": timeline[-1]["count"] if timeline else 0,
                            "unique_ids": timeline[-1]["unique_ids"] if timeline else 0,
                            "fps": round(session.fps, 1),
                        },
                    )
                )
    finally:
        writer.release()
        capture.release()
        session.release()

    return {
        "frames": index,
        "fps": round(fps, 2),
        "resolution": [width, height],
        "video": str(output_path),
        "per_frame": per_frame[:4000],
        "timeline": timeline,
    }


def _tally(detections: list[dict[str, Any]]) -> dict[str, int]:
    tally: dict[str, int] = {}
    for detection in detections:
        tally[detection["class_name"]] = tally.get(detection["class_name"], 0) + 1
    return tally


# ---------------------------------------------------------------------------
# client-driven websocket sessions
# ---------------------------------------------------------------------------


class LiveSession:
    """State for the WebSocket live-camera mode (frames arrive from the client)."""

    def __init__(self, config: StreamConfig) -> None:
        self.id = uuid.uuid4().hex[:10]
        self.config = config
        self.model = engine.registry.load(config.model_id, device=config.device, task=config.task)
        self.solution = _build_solution(
            config.solution,
            model_id=str(self.model.path),
            region=config.region,
            region_kind=config.region_kind,
            overrides=config.solution_kwargs,
            frame_shape=config.frame_shape,
            region_normalised=config.region_normalised,
        )
        self.frames = 0
        self.ema_ms = 0.0
        self.started_at = time.time()

    def release(self) -> None:
        engine.release_session(self.id)

    def handle(self, frame: np.ndarray) -> dict[str, Any]:
        started = time.perf_counter()
        payload: ResultPayload | None = None
        rendered_url: str | None = None

        kwargs: dict[str, Any] = {
            "conf": self.config.conf,
            "iou": self.config.iou,
            "imgsz": self.config.imgsz,
            "classes": self.config.classes,
            "verbose": False,
        }
        if self.config.tracker:
            result = engine.track_frame(
                self.id,
                frame,
                model_id=self.config.model_id,
                tracker=self.config.tracker,
                device=self.config.device,
                conf=self.config.conf,
                iou=self.config.iou,
                imgsz=self.config.imgsz,
                classes=self.config.classes,
            )
        else:
            results = engine.predict(
                self.config.model_id, frame, device=self.config.device, task=self.config.task, **kwargs
            )
            result = results[0] if isinstance(results, list) else results

        if result is not None:
            names = serialise_names(getattr(result, "names", self.model.names))
            payload = result_to_payload(result, names=names, mask_limit=24)

        counters: dict[str, Any] = {}
        if self.solution is not None:
            try:
                annotated, counters = apply_solution(self.solution, frame.copy(), self.frames)
                if annotated is not None and self.config.render_frames:
                    rendered_url = frame_to_data_url(annotated, self.config.jpeg_quality)
            except Exception:
                self.solution = None
        elif self.config.show_boxes and self.config.render_frames and result is not None:
            with contextlib.suppress(Exception):
                rendered_url = frame_to_data_url(result.plot(), self.config.jpeg_quality)

        self.frames += 1
        elapsed = (time.perf_counter() - started) * 1000
        self.ema_ms = elapsed if self.ema_ms == 0 else (self.ema_ms * 0.8 + elapsed * 0.2)
        return {
            "frame": self.frames,
            "latency_ms": round(elapsed, 1),
            "avg_latency_ms": round(self.ema_ms, 1),
            "fps": round(1000.0 / self.ema_ms, 1) if self.ema_ms else None,
            "result": payload.model_dump() if payload else None,
            "rendered": rendered_url,
            "counters": counters,
            "session": self.id,
            "uptime_s": round(time.time() - self.started_at, 1),
        }


def decode_base64_frame(data: str) -> np.ndarray:
    """Decode a browser ``canvas.toDataURL`` payload into a BGR frame."""
    import base64

    import cv2

    encoded = data.split(",", 1)[1] if "," in data else data
    buffer: np.ndarray = np.frombuffer(base64.b64decode(encoded), dtype=np.uint8)
    frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Unable to decode the submitted frame.")
    return frame


async def pump(generator: Any) -> Any:
    """Iterate a blocking generator without stalling the event loop."""
    loop = asyncio.get_running_loop()
    iterator = iter(generator)
    while True:
        try:
            item = await loop.run_in_executor(None, next, iterator)
        except StopIteration:
            return
        yield item
