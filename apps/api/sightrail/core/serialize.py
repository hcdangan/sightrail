"""Result serialisation: turn Ultralytics ``Results`` objects into JSON.

The UI renders overlays itself (canvas), which keeps annotations crisp at any
zoom level and lets users toggle classes/masks/keypoints interactively. To make
that possible we emit *pixel space* geometry together with the source image
dimensions, and we keep the annotated (server-rendered) image as a secondary
artefact for one-click download or side-by-side comparison.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

from ..schemas.results import (
    BoxPayload,
    ClassPrediction,
    DetectionPayload,
    KeypointPayload,
    MaskPayload,
    ModelMeta,
    OBBPayload,
    ProbsPayload,
    ResultPayload,
    SpeedPayload,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def to_float(value: Any) -> float | None:
    """Coerce numpy/torch scalars into plain JSON-safe floats."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def _f(value: Any) -> float | None:  # backwards-compatible alias
    return to_float(value)


def _tolist(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def _names_to_list(names: Any) -> list[str]:
    """Normalise ``model.names`` (dict or list) into an ordered list."""
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=lambda x: int(x))]
    if isinstance(names, (list, tuple)):
        return [str(n) for n in names]
    return []


def serialise_names(names: Any) -> dict[int, str]:
    """Normalise a ``names`` mapping to ``{int: str}``.

    Accepts a dict, a list/tuple, or ``None``. Callers reach this with whatever
    the engine happened to expose, so it must never raise: a missing or ``None``
    ``names`` attribute means "no class labels", not an error.
    """
    if isinstance(names, dict):
        return {int(k): str(v) for k, v in names.items()}
    if isinstance(names, (list, tuple)):
        return {i: str(v) for i, v in enumerate(names)}
    return {}


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------


def _boxes_payload(boxes: Any, names: dict[int, str]) -> DetectionPayload | None:
    if boxes is None or len(boxes) == 0:
        return None
    xyxy = _tolist(boxes.xyxy) or []
    xywhn = _tolist(boxes.xywhn) or []
    xyxy_n = _tolist(boxes.xyxyn) or []
    confs = _tolist(boxes.conf) or []
    clss = _tolist(boxes.cls) or []
    ids = _tolist(boxes.id) if getattr(boxes, "is_track", False) else None

    payload: list[BoxPayload] = []
    for index, coords in enumerate(xyxy):
        cls_id = int(clss[index]) if index < len(clss) else -1
        payload.append(
            BoxPayload(
                index=index,
                class_id=cls_id,
                class_name=names.get(cls_id, str(cls_id)),
                confidence=_f(confs[index]) if index < len(confs) else None,
                xyxy=[_f(v) or 0.0 for v in coords],
                xywhn=[_f(v) or 0.0 for v in xywhn[index]] if index < len(xywhn) else None,
                xyxyn=[_f(v) or 0.0 for v in xyxy_n[index]] if index < len(xyxy_n) else None,
                track_id=int(ids[index]) if ids is not None and index < len(ids) else None,
            )
        )
    return DetectionPayload(type="boxes", count=len(payload), items=payload)


def _obb_payload(obb: Any, names: dict[int, str]) -> OBBPayload | None:
    if obb is None or len(obb) == 0:
        return None
    xyxyxyxy = _tolist(obb.xyxyxyxy) or []
    xywhr = _tolist(obb.xywhr) or []
    confs = _tolist(obb.conf) or []
    clss = _tolist(obb.cls) or []

    items: list[BoxPayload] = []
    for index, corners in enumerate(xyxyxyxy):
        cls_id = int(clss[index]) if index < len(clss) else -1
        rect = xywhr[index] if index < len(xywhr) else None
        items.append(
            BoxPayload(
                index=index,
                class_id=cls_id,
                class_name=names.get(cls_id, str(cls_id)),
                confidence=_f(confs[index]) if index < len(confs) else None,
                xyxy=[_f(v) or 0.0 for v in corners],
                xywhr=[_f(v) or 0.0 for v in rect] if rect is not None else None,
            )
        )
    return OBBPayload(type="obb", count=len(items), items=items)


def _keypoints_payload(keypoints: Any, names: dict[int, str]) -> KeypointPayload | None:
    if keypoints is None or len(keypoints) == 0:
        return None
    xy = _tolist(keypoints.xy) or []
    xyn = _tolist(keypoints.xyn) or []
    conf = _tolist(keypoints.conf) if getattr(keypoints, "conf", None) is not None else None

    payload: list[dict[str, Any]] = []
    for index, points in enumerate(xy):
        payload.append(
            {
                "index": index,
                # The Keypoints class carries no per-instance class id; the paired
                # detection boxes do. Default to class 0 (person) which is the
                # only class pose models are trained on.
                "class_id": 0,
                "class_name": names.get(0, "person"),
                "xy": [[_f(p[0]) or 0.0, _f(p[1]) or 0.0] for p in points],
                "xyn": ([[_f(p[0]) or 0.0, _f(p[1]) or 0.0] for p in xyn[index]] if index < len(xyn) else None),
                "confidence": ([_f(c) for c in conf[index]] if conf is not None and index < len(conf) else None),
            }
        )
    kpt_shape = _tolist(getattr(getattr(keypoints, "data", None), "shape", None))
    return KeypointPayload(
        type="keypoints",
        count=len(payload),
        items=payload,  # type: ignore[arg-type]
        shape=[int(v) for v in kpt_shape[1:]] if kpt_shape and len(kpt_shape) >= 3 else None,
    )


def _masks_payload(masks: Any, boxes: Any, names: dict[int, str], limit: int = 64) -> MaskPayload | None:
    if masks is None or len(masks) == 0:
        return None
    segments = _tolist(getattr(masks, "xyn", None)) or []
    clss = _tolist(getattr(boxes, "cls", [])) if boxes is not None else []
    confs = _tolist(getattr(boxes, "conf", [])) if boxes is not None else []

    items: list[dict[str, Any]] = []
    truncated = False
    for index, polygon in enumerate(segments):
        if index >= limit:
            truncated = True
            break
        cls_id = int(clss[index]) if index < len(clss) else -1
        items.append(
            {
                "index": index,
                "class_id": cls_id,
                "class_name": names.get(cls_id, str(cls_id)),
                "confidence": _f(confs[index]) if index < len(confs) else None,
                # normalised polygon points, flattened as [x0, y0, x1, y1, ...]
                "polygon": [round(float(v), 5) for point in polygon for v in point],
                "point_count": len(polygon),
            }
        )
    return MaskPayload(type="masks", count=len(segments), items=items, truncated=truncated)  # type: ignore[arg-type]


def _probs_payload(probs: Any, names: dict[int, str] | None = None) -> ProbsPayload | None:
    if probs is None:
        return None
    # ``Results.names`` is authoritative; ``probs.names`` is sometimes truncated
    # (e.g. only the top-5 window), so prefer the caller-supplied mapping.
    resolved = names or serialise_names(getattr(probs, "names", {}))
    top1 = int(getattr(probs, "top1", -1))
    data = _tolist(getattr(probs, "data", None))
    top5 = _tolist(getattr(probs, "top5", None))
    top5conf = _tolist(getattr(probs, "top5conf", None))

    items: list[ClassPrediction] = []
    if top5 is not None and top5conf is not None:
        for rank, (cls_id, conf) in enumerate(zip(top5, top5conf, strict=False)):
            class_index = int(cls_id)
            items.append(
                ClassPrediction(
                    class_id=class_index,
                    class_name=resolved.get(class_index, str(class_index)),
                    confidence=_f(conf) or 0.0,
                    rank=rank,
                )
            )

    all_scores = [_f(v) or 0.0 for v in data] if data else None
    top1_conf = _f(top5conf[0]) if top5conf else None
    if top1_conf is None and all_scores and 0 <= top1 < len(all_scores):
        top1_conf = all_scores[top1]

    return ProbsPayload(
        type="probs",
        top1=top1,
        top1_name=resolved.get(top1),
        top1_conf=top1_conf,
        top5=items,
        all_scores=all_scores,
    )


def _speed_payload(speed: Any) -> SpeedPayload | None:
    if not isinstance(speed, dict):
        return None
    return SpeedPayload(
        preprocess_ms=_f(speed.get("preprocess")),
        inference_ms=_f(speed.get("inference")),
        postprocess_ms=_f(speed.get("postprocess")),
    )


def model_meta(model: Any, source: str | None = None) -> ModelMeta:
    """Extract lightweight metadata from a loaded ``YOLO`` model."""
    names = serialise_names(getattr(model, "names", {}))
    info: dict[str, Any] = {}
    try:
        raw = model.info(verbose=False)
        if isinstance(raw, (list, tuple)) and len(raw) >= 4:
            info = {
                "layers": int(raw[0]),
                "parameters": int(raw[1]),
                "gradients": int(raw[2]),
                "gflops": _f(raw[3]),
            }
    except Exception:  # pragma: no cover - informational only
        info = {}
    return ModelMeta(
        source=source or str(getattr(model, "ckpt_path", "") or getattr(model, "model_name", "")),
        task=str(getattr(model, "task", "detect")),
        names=names,
        classes=len(names),
        info=info,
    )


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------


def result_to_payload(
    result: Any,
    *,
    names: dict[int, str] | None = None,
    task: str | None = None,
    rendered_url: str | None = None,
    original_url: str | None = None,
    extra: dict[str, Any] | None = None,
    mask_limit: int = 64,
) -> ResultPayload:
    """Convert a single ``ultralytics.engine.results.Results`` into JSON.

    ``task`` overrides ``Results.task``, which is not always populated (for
    example classification results omit it entirely).
    """
    resolved_names = names or serialise_names(getattr(result, "names", {}))
    shape = getattr(result, "orig_shape", None)
    height = int(shape[0]) if shape else 0
    width = int(shape[1]) if shape else 0

    resolved_task = task or getattr(result, "task", None) or "detect"
    boxes = getattr(result, "boxes", None)
    masks = getattr(result, "masks", None)
    keypoints = getattr(result, "keypoints", None)
    obb = getattr(result, "obb", None)
    probs = getattr(result, "probs", None)

    return ResultPayload(
        task=resolved_task,  # type: ignore[arg-type]
        path=str(getattr(result, "path", "") or ""),
        original_shape=[height, width],
        names=resolved_names,
        speed=_speed_payload(getattr(result, "speed", None)),
        detections=_boxes_payload(boxes, resolved_names),
        obb=_obb_payload(obb, resolved_names) if obb is not None else None,
        keypoints=_keypoints_payload(keypoints, resolved_names),
        masks=_masks_payload(masks, boxes if boxes is not None else obb, resolved_names, mask_limit),
        probs=_probs_payload(probs, resolved_names),
        rendered_url=rendered_url,
        original_url=original_url,
        extra=extra or {},
    )


def class_histogram(result: ResultPayload) -> dict[str, int]:
    """Count detections per class name - feeds the UI's summary charts."""
    histogram: dict[str, int] = {}
    for source in (result.detections, result.obb):
        if source is None:
            continue
        for item in source.items:
            histogram[item.class_name] = histogram.get(item.class_name, 0) + 1
    return dict(sorted(histogram.items(), key=lambda kv: -kv[1]))


def frame_to_data_url(image: np.ndarray, quality: int = 80) -> str:
    """Encode a BGR frame as a JPEG data URL (used by the live streams)."""
    import base64

    import cv2

    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:  # pragma: no cover - defensive
        raise RuntimeError("Failed to encode frame as JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def media_url(path: str | Path, category: str) -> str:
    """Build a URL served by the media router for a file inside storage."""
    return f"/api/media/{category}/{Path(path).name}"


def frame_to_jpeg_bytes(image: np.ndarray, quality: int = 80) -> bytes:
    """Encode a BGR frame with OpenCV for MJPEG streaming."""
    import cv2

    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:  # pragma: no cover - defensive
        raise RuntimeError("Failed to encode frame as JPEG")
    return buffer.tobytes()
