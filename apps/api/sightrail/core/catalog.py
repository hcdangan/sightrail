"""Model catalog: the checkpoints the UI offers out of the box.

Keys are the checkpoint file names understood by Ultralytics (``yolo11n.pt`` …).
Names are grouped by task so the frontend can render a task-aware model picker
and download a checkpoint on first use.
"""

from __future__ import annotations

from typing import Any, Literal

from ..schemas.base import TaskName

ModelSize = Literal["n", "s", "m", "l", "x"]

_SIZE_LABELS: dict[str, str] = {
    "n": "Nano - fastest, lowest accuracy",
    "nu": "Nano (P6) - fastest, extra large inputs",
    "t": "Tiny - fastest",
    "s": "Small - balanced",
    "su": "Small (P6) - balanced, extra large inputs",
    "b": "Base - mid size",
    "m": "Medium - higher accuracy",
    "mu": "Medium (P6) - higher accuracy, extra large inputs",
    "c": "Compact - accuracy/size trade-off",
    "l": "Large - high accuracy, slower",
    "lu": "Large (P6) - high accuracy, extra large inputs",
    "x": "Extra large - best accuracy, slowest",
    "xu": "Extra large (P6) - best accuracy, extra large inputs",
    "e": "Extra - largest variant",
}

_SIZE_PARAMS_M: dict[str, float] = {
    "n": 2.6,
    "nu": 3.2,
    "t": 2.0,
    "s": 9.4,
    "su": 11.4,
    "b": 19.3,
    "m": 20.1,
    "mu": 25.9,
    "c": 25.3,
    "l": 25.3,
    "lu": 43.7,
    "x": 56.9,
    "xu": 68.2,
    "e": 58.1,
}


#: Ultralytics asset release tag used for the catalog's fallback download URL.
#: The engine's own downloader is preferred and resolves the correct tag for the
#: installed version; this URL is only used when it is unavailable.
_ASSET_RELEASE = "v8.4.0"


def _entry(family: str, size: str, task: TaskName) -> dict[str, Any]:
    suffix = ""
    if task is TaskName.POSE:
        suffix = "-pose"
    elif task is TaskName.SEGMENT and family not in {"sam2", "mobile_sam", "fastsam"}:
        suffix = "-seg"
    elif task is TaskName.CLASSIFY:
        suffix = "-cls"
    elif task is TaskName.OBB:
        suffix = "-obb"
    model_id = f"{family}{size}{suffix}.pt"
    return {
        "id": model_id,
        "family": family,
        "size": size,
        "task": task.value,
        "label": model_id.removesuffix(".pt"),
        "description": _SIZE_LABELS.get(size, f"{size} variant"),
        "approx_params_m": _SIZE_PARAMS_M.get(size),
        "download_url": f"https://github.com/ultralytics/assets/releases/download/{_ASSET_RELEASE}/{model_id}",
    }


def _family(
    family: str, tasks: tuple[TaskName, ...], sizes: tuple[str, ...] = ("n", "s", "m", "l", "x")
) -> list[dict[str, Any]]:
    return [_entry(family, size, task) for task in tasks for size in sizes]


#: Curated catalog. Icons/ordering metadata lives with the definition so the
#: frontend can render an accurate model picker without hardcoding anything.
CATALOG: list[dict[str, Any]] = [
    *_family("yolo11", (TaskName.DETECT, TaskName.SEGMENT, TaskName.POSE, TaskName.OBB)),
    *_family("yolov8", (TaskName.DETECT, TaskName.SEGMENT, TaskName.POSE, TaskName.OBB)),
    *_family("yolo11", (TaskName.CLASSIFY,), sizes=("n", "s", "m", "l", "x")),
    *_family("yolov8", (TaskName.CLASSIFY,), sizes=("n", "s", "m", "l", "x")),
    *_family("yolo12", (TaskName.DETECT,), sizes=("n", "s", "m", "l", "x")),
    *_family("yolov10", (TaskName.DETECT,), sizes=("n", "s", "m", "l", "x")),
    *_family("yolov9", (TaskName.DETECT,), sizes=("t", "s", "m", "c", "e")),
    *_family("yolov5", (TaskName.DETECT,), sizes=("nu", "su", "mu", "lu", "xu")),
    # RT-DETR: transformer based detector
    *_family("rtdetr", (TaskName.DETECT,), sizes=("l", "x")),
    # Promptable segmentation backbones used by the segmentation solutions.
    *_family("sam2", (TaskName.SEGMENT,), sizes=("t", "s", "b", "l")),
    *_family("mobile_sam", (TaskName.SEGMENT,), sizes=("t",)),
    *_family("fastsam", (TaskName.SEGMENT,), sizes=("s", "x")),
]

#: Model families we consider "current" and therefore show first / by default.
PREFERRED_FAMILIES = ("yolo11", "yolov8")

DEFAULT_MODELS: dict[str, str] = {
    TaskName.DETECT.value: "yolo11n.pt",
    TaskName.SEGMENT.value: "yolo11n-seg.pt",
    TaskName.CLASSIFY.value: "yolo11n-cls.pt",
    TaskName.POSE.value: "yolo11n-pose.pt",
    TaskName.OBB.value: "yolo11n-obb.pt",
}


def list_catalog() -> list[dict[str, Any]]:
    return CATALOG


def catalog_by_task(task: str) -> list[dict[str, Any]]:
    return [entry for entry in CATALOG if entry["task"] == task]


def catalog_entry(model_id: str) -> dict[str, Any] | None:
    for entry in CATALOG:
        if entry["id"] == model_id:
            return entry
    return None


def is_catalog_model(model_id: str) -> bool:
    return catalog_entry(model_id) is not None


def default_model_for_task(task: str) -> str:
    return DEFAULT_MODELS.get(task, DEFAULT_MODELS[TaskName.DETECT.value])
