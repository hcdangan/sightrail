"""Inference result schemas shared by every task family."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from .base import APIModel, TaskName


class BoxPayload(APIModel):
    """An axis-aligned box, a rotated box, or a polygon corner list."""

    index: int
    class_id: int
    class_name: str
    confidence: float | None = None
    #: ``[x1, y1, x2, y2]`` in pixels for detection boxes, or the flattened
    #: ``[x1, y1, x2, y2, x3, y3, x4, y4]`` corners for OBB results.
    xyxy: list[float] = Field(default_factory=list)
    xywhn: list[float] | None = None
    xyxyn: list[float] | None = None
    #: ``[cx, cy, w, h, radians]`` for oriented boxes.
    xywhr: list[float] | None = None
    track_id: int | None = None


class DetectionPayload(APIModel):
    type: str = "boxes"
    count: int = 0
    items: list[BoxPayload] = Field(default_factory=list)


class OBBPayload(APIModel):
    type: str = "obb"
    count: int = 0
    items: list[BoxPayload] = Field(default_factory=list)


class KeypointInstance(APIModel):
    index: int
    class_id: int
    class_name: str
    #: pixel coordinates, ``[[x, y], ...]`` per keypoint
    xy: list[list[float]] = Field(default_factory=list)
    #: normalised coordinates, ``[[x, y], ...]`` per keypoint
    xyn: list[list[float]] | None = None
    confidence: list[float | None] | None = None


class KeypointPayload(APIModel):
    type: str = "keypoints"
    count: int = 0
    items: list[KeypointInstance] = Field(default_factory=list)
    shape: list[int] | None = None


class MaskInstance(APIModel):
    index: int
    class_id: int
    class_name: str
    confidence: float | None = None
    #: flattened normalised polygon, ``[x0, y0, x1, y1, ...]``
    polygon: list[float] = Field(default_factory=list)
    point_count: int = 0


class MaskPayload(APIModel):
    type: str = "masks"
    count: int = 0
    items: list[MaskInstance] = Field(default_factory=list)
    truncated: bool = False


class ClassPrediction(APIModel):
    class_id: int
    class_name: str
    confidence: float
    rank: int = 0


class ProbsPayload(APIModel):
    type: str = "probs"
    top1: int | None = None
    top1_name: str | None = None
    top1_conf: float | None = None
    top5: list[ClassPrediction] = Field(default_factory=list)
    all_scores: list[float] | None = None


ClassificationPayload = ProbsPayload


class SpeedPayload(APIModel):
    preprocess_ms: float | None = None
    inference_ms: float | None = None
    postprocess_ms: float | None = None

    @property
    def total_ms(self) -> float | None:
        parts = [self.preprocess_ms, self.inference_ms, self.postprocess_ms]
        if all(p is None for p in parts):
            return None
        return sum(p or 0.0 for p in parts)


class ModelMeta(APIModel):
    source: str = ""
    task: str = "detect"
    names: dict[int, str] = Field(default_factory=dict)
    classes: int = 0
    info: dict[str, Any] = Field(default_factory=dict)


class ResultPayload(APIModel):
    """Everything the UI needs to render one inference result."""

    task: TaskName
    path: str = ""
    original_shape: list[int] = Field(default_factory=lambda: [0, 0])
    names: dict[int, str] = Field(default_factory=dict)
    speed: SpeedPayload | None = None
    detections: DetectionPayload | None = None
    obb: OBBPayload | None = None
    keypoints: KeypointPayload | None = None
    masks: MaskPayload | None = None
    probs: ProbsPayload | None = None
    rendered_url: str | None = None
    original_url: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class InferResponse(APIModel):
    """Envelope returned by /api/infer and friends."""

    id: str
    model: ModelMeta
    results: list[ResultPayload] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    elapsed_ms: float = 0.0
