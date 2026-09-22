"""Request bodies for the write endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from ..config import settings
from ..core.models_meta import DEFAULT_TRACKER
from .base import APIModel, TaskName


class SourceSpec(APIModel):
    """How to obtain the input media for an inference call.

    Exactly one of the fields is expected. ``upload_id``/``path`` refer to files
    already known to the service (see ``/api/uploads``), ``data_url`` carries an
    inline base64 image, ``url`` is fetched over HTTP(S) and ``camera`` selects a
    local webcam index.
    """

    upload_id: str | None = None
    path: str | None = None
    data_url: str | None = None
    url: str | None = None
    camera: int | None = None
    sample: str | None = Field(default=None, description="A bundled sample asset, e.g. 'bus.jpg'")

    def is_empty(self) -> bool:
        return not any([self.upload_id, self.path, self.data_url, self.url, self.camera is not None, self.sample])


class InferOptions(APIModel):
    """The prediction knobs exposed in the UI."""

    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.7, ge=0.0, le=1.0)
    imgsz: int = Field(default=640, ge=32, le=4096)
    max_det: int = Field(default=300, ge=1, le=3000)
    classes: list[int] | None = None
    device: str = "auto"
    augment: bool = False
    agnostic_nms: bool = False
    retina_masks: bool = False
    half: bool | None = None
    save_rendered: bool = True
    mask_limit: int = Field(default=64, ge=1, le=256)

    @field_validator("classes")
    @classmethod
    def _clean_classes(cls, value: list[int] | None) -> list[int] | None:
        if not value:
            return None
        return sorted({int(item) for item in value})


class InferRequest(APIModel):
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    source: SourceSpec
    options: InferOptions = Field(default_factory=InferOptions)


class BatchInferRequest(APIModel):
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    source: SourceSpec
    options: InferOptions = Field(default_factory=InferOptions)

    @model_validator(mode="after")
    def _require_batchable(self) -> BatchInferRequest:
        if self.source.camera is not None:
            raise ValueError("Batch inference does not accept a camera source.")
        return self


class TrackRequest(APIModel):
    model: str = Field(default=settings.default_model)
    source: SourceSpec
    tracker: str = DEFAULT_TRACKER
    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.7, ge=0.0, le=1.0)
    imgsz: int = Field(default=640, ge=32, le=4096)
    classes: list[int] | None = None
    device: str = "auto"
    session: str | None = None
    max_frames: int = Field(default=180, ge=1, le=5000)
    reset: bool = False


class StreamStartRequest(APIModel):
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    source: SourceSpec
    tracker: str | None = DEFAULT_TRACKER
    solution: str = "none"
    solution_kwargs: dict[str, Any] = Field(default_factory=dict)
    region: Any = None
    region_kind: str | None = None
    show_boxes: bool = True
    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.7, ge=0.0, le=1.0)
    imgsz: int = Field(default=640, ge=32, le=4096)
    classes: list[int] | None = None
    device: str = "auto"
    jpeg_quality: int = Field(default=80, ge=30, le=95)


class VideoAnalysisRequest(APIModel):
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    source: SourceSpec
    tracker: str | None = DEFAULT_TRACKER
    solution: str = "none"
    solution_kwargs: dict[str, Any] = Field(default_factory=dict)
    region: Any = None
    region_kind: str | None = None
    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.7, ge=0.0, le=1.0)
    imgsz: int = Field(default=640, ge=32, le=4096)
    classes: list[int] | None = None
    device: str = "auto"
    name: str | None = None


class TrainRequest(APIModel):
    model: str = Field(default=settings.default_model)
    data: str
    task: TaskName | None = None
    device: str = "auto"
    epochs: int = Field(default=50, ge=1, le=2000)
    batch: int | float = -1
    imgsz: int = Field(default=640, ge=32, le=4096)
    workers: int = Field(default=0, ge=0, le=32)
    name: str | None = None
    pretrained: bool = True
    optimizer: str = "auto"
    lr0: float = Field(default=0.01, gt=0)
    lrf: float = Field(default=0.01, ge=0)
    momentum: float = 0.937
    weight_decay: float = 0.0005
    warmup_epochs: float = 3.0
    cos_lr: bool = False
    patience: int = Field(default=50, ge=0)
    seed: int = 0
    deterministic: bool = True
    val: bool = True
    resume: bool = False
    cache: bool | str = False
    rect: bool = False
    amp: bool = True
    fraction: float = Field(default=1.0, gt=0, le=1.0)
    freeze: int | list[int] | None = None
    single_cls: bool = False
    dropout: float = Field(default=0.0, ge=0, le=1)
    overlap_mask: bool = True
    mask_ratio: int = Field(default=4, ge=1, le=8)
    close_mosaic: int = Field(default=10, ge=0)
    hsv_h: float = 0.015
    hsv_s: float = 0.7
    hsv_v: float = 0.4
    degrees: float = 0.0
    translate: float = 0.1
    scale: float = 0.5
    shear: float = 0.0
    perspective: float = 0.0
    flipud: float = 0.0
    fliplr: float = 0.5
    mosaic: float = 1.0
    mixup: float = 0.0
    copy_paste: float = 0.0
    erasing: float = 0.4
    auto_augment: str = "randaugment"


class ValRequest(APIModel):
    model: str = Field(default=settings.default_model)
    data: str | None = None
    task: TaskName | None = None
    split: Literal["val", "train", "test"] = "val"
    device: str = "auto"
    imgsz: int = Field(default=640, ge=32, le=4096)
    batch: int = Field(default=16, ge=1, le=256)
    conf: float = Field(default=0.001, ge=0.0, le=1.0)
    iou: float = Field(default=0.6, ge=0.0, le=1.0)
    max_det: int = Field(default=300, ge=1, le=3000)
    half: bool = False
    name: str | None = None


class ExportRequest(APIModel):
    model: str = Field(default=settings.default_model)
    format: str = "onnx"
    imgsz: int = Field(default=640, ge=32, le=4096)
    half: bool = False
    int8: bool = False
    dynamic: bool = False
    simplify: bool = True
    opset: int | None = Field(default=None, ge=9, le=20)
    workspace: float | None = None
    nms: bool = False
    batch: int = Field(default=1, ge=1, le=64)
    device: str = "auto"
    optimize: bool = False
    keras: bool = False
    data: str | None = None
    name: str | None = None
    #: Hailo target architecture (``format="hailo"`` only): ``hailo8l`` (Raspberry
    #: Pi AI HAT), ``hailo8``, ``hailo10h``, ``hailo15h`` or ``hailo15l``.
    hailo_arch: str | None = None


class BenchmarkRequest(APIModel):
    model: str = Field(default=settings.default_model)
    formats: list[str] = Field(default_factory=lambda: ["onnx", "openvino", "torchscript"])
    data: str | None = "coco8.yaml"
    task: TaskName | None = None
    imgsz: int = Field(default=640, ge=32, le=4096)
    device: str = "auto"

    @field_validator("formats")
    @classmethod
    def _non_empty(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("Select at least one export format to benchmark.")
        return value


class AnnotateRequest(APIModel):
    """Auto-annotate uploaded images into a trainable YOLO dataset."""

    name: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    upload_ids: list[str] = Field(default_factory=list)
    paths: list[str] = Field(default_factory=list)
    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.7, ge=0.0, le=1.0)
    imgsz: int = Field(default=640, ge=32, le=4096)
    device: str = "auto"
    classes: list[int] | None = None
    val_split: float = Field(default=0.15, ge=0.0, le=0.5)


class ModelDownloadRequest(APIModel):
    model: str = Field(min_length=1)


class FolderAnnotationRequest(APIModel):
    """Annotate every image found in a server-side folder."""

    folder: str
    name: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    model: str = Field(default=settings.default_model)
    task: TaskName | None = None
    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    device: str = "auto"
    val_split: float = Field(default=0.15, ge=0.0, le=0.5)
    limit: int = Field(default=500, ge=1, le=10000)
