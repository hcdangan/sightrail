"""Auto-annotation: turn a folder of images into a YOLO-format dataset.

Bootstrapping a dataset normally means hand-labeling hundreds of images. This
module uses a pretrained checkpoint to *pre-label* a folder, writing standard
YOLO label files that can be corrected in any labeling tool and then trained
directly through Sightrail. It exercises the full Ultralytics result API:
boxes, polygons (``masks.xyn``), keypoints and oriented boxes.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..config import settings
from .engine import engine
from .serialize import serialise_names

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}

#: Subset of COCO used for bootstrapping detection/segmentation datasets.
DEFAULT_CLASSES: list[str] = [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush",
]

#: Label-file layout per task (documented in docs/FEATURES.md).
TASK_LABEL_HINT: dict[str, str] = {
    "detect": "class cx cy w h (normalised)",
    "segment": "class x1 y1 x2 y2 ... (normalised polygon)",
    "pose": "class cx cy w h px1 py1 v1 ... (normalised)",
    "obb": "class cx cy w h angle (normalised)",
    "classify": "folder-per-class structure (no label files)",
}


@dataclass
class AnnotationStats:
    images: int = 0
    annotated: int = 0
    skipped: int = 0
    objects: int = 0
    per_class: dict[str, int] = field(default_factory=dict)
    labels_written: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "images": self.images,
            "annotated": self.annotated,
            "skipped": self.skipped,
            "objects": self.objects,
            "per_class": dict(sorted(self.per_class.items(), key=lambda kv: -kv[1])),
            "labels_written": self.labels_written,
        }


class DatasetBuilder:
    """Builds ``storage/datasets/<name>`` from an image folder plus a model."""

    def __init__(
        self,
        name: str,
        images: list[Path],
        *,
        model_id: str,
        task: str | None = None,
        conf: float = 0.25,
        iou: float = 0.7,
        imgsz: int = 640,
        device: str | None = None,
        classes: list[int] | None = None,
        val_split: float = 0.15,
        class_names: list[str] | None = None,
    ) -> None:
        self.name = name
        self.images = images
        self.model_id = model_id
        self.task = task
        self.conf = conf
        self.iou = iou
        self.imgsz = imgsz
        self.device = device
        self.classes = classes
        self.val_split = max(0.0, min(0.5, val_split))
        self.class_names = class_names
        self.stats = AnnotationStats()

    # -- paths -------------------------------------------------------------
    @property
    def root(self) -> Path:
        return settings.datasets_dir / self.name

    def layout(self, split: str) -> tuple[Path, Path]:
        return self.root / "images" / split, self.root / "labels" / split

    # -- public ------------------------------------------------------------
    def build(self, progress: Any | None = None) -> dict[str, Any]:
        """Annotate every image and write ``data.yaml``. Returns a report."""
        import cv2

        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

        for split in ("train", "val"):
            images_dir, labels_dir = self.layout(split)
            images_dir.mkdir(parents=True, exist_ok=True)
            labels_dir.mkdir(parents=True, exist_ok=True)

        ordered = sorted(self.images)
        if self.val_split > 0 and len(ordered) > 4:
            cut = max(1, int(len(ordered) * (1 - self.val_split)))
            splits = {"train": ordered[:cut], "val": ordered[cut:]}
        else:
            splits = {"train": ordered, "val": []}

        total = len(ordered)
        processed = 0
        detected_names: dict[int, str] = {}

        for split, files in splits.items():
            images_dir, labels_dir = self.layout(split)
            for source in files:
                processed += 1
                image = cv2.imread(str(source))
                if image is None:
                    self.stats.skipped += 1
                    continue
                self.stats.images += 1
                target_image = images_dir / source.name
                if not target_image.exists():
                    shutil.copy2(source, target_image)

                try:
                    results = engine.predict(
                        self.model_id,
                        image,
                        device=self.device,
                        task=self.task,
                        conf=self.conf,
                        iou=self.iou,
                        imgsz=self.imgsz,
                        classes=self.classes,
                        verbose=False,
                    )
                except Exception:
                    self.stats.skipped += 1
                    continue

                result = results[0] if isinstance(results, list) else results
                if result is None:
                    self.stats.skipped += 1
                    continue

                names = serialise_names(getattr(result, "names", {}))
                detected_names.update(names)
                lines = self._label_lines(result)
                label_path = labels_dir / f"{source.stem}.txt"
                label_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
                if lines:
                    self.stats.annotated += 1
                    self.stats.labels_written += 1
                self.stats.objects += len(lines)

                if progress is not None:
                    progress(processed, total, source.name)

        data_yaml = self._write_yaml(detected_names)
        return {
            "name": self.name,
            "root": str(self.root),
            "data_yaml": str(data_yaml),
            "task": self.task or "detect",
            "stats": self.stats.as_dict(),
            "layout": TASK_LABEL_HINT.get(self.task or "detect", ""),
        }

    # -- label encoding ----------------------------------------------------
    def _label_lines(self, result: Any) -> list[str]:
        task = str(getattr(result, "task", self.task or "detect"))
        if task == "pose":
            return self._pose_lines(result)
        if task == "obb":
            return self._obb_lines(result)
        if task == "segment":
            return self._segment_lines(result)
        if task == "classify":
            return []  # classification datasets are folder-structured
        return self._detect_lines(result)

    def _detect_lines(self, result: Any) -> list[str]:
        boxes = getattr(result, "boxes", None)
        if boxes is None or boxes.xywhn is None:
            return []
        lines: list[str] = []
        for coords, cls in zip(boxes.xywhn.tolist(), boxes.cls.tolist(), strict=False):
            class_id = int(cls)
            lines.append(f"{class_id} " + " ".join(f"{v:.6f}" for v in coords))
            self._tally(class_id)
        return lines

    def _segment_lines(self, result: Any) -> list[str]:
        masks = getattr(result, "masks", None)
        boxes = getattr(result, "boxes", None)
        if masks is None or boxes is None:
            return []
        lines: list[str] = []
        polygons = masks.xyn.tolist() if masks.xyn is not None else []
        for polygon, cls in zip(polygons, boxes.cls.tolist(), strict=False):
            if len(polygon) < 3:
                continue
            class_id = int(cls)
            flat = " ".join(f"{v:.6f}" for point in polygon for v in point)
            lines.append(f"{class_id} {flat}")
            self._tally(class_id)
        return lines

    def _pose_lines(self, result: Any) -> list[str]:
        boxes = getattr(result, "boxes", None)
        keypoints = getattr(result, "keypoints", None)
        if boxes is None or keypoints is None:
            return []
        lines: list[str] = []
        coords_list = boxes.xywhn.tolist() if boxes.xywhn is not None else []
        points_list = keypoints.xyn.tolist() if keypoints.xyn is not None else []
        conf_list = keypoints.conf.tolist() if getattr(keypoints, "conf", None) is not None else []
        for index, (coords, cls) in enumerate(zip(coords_list, boxes.cls.tolist(), strict=False)):
            class_id = int(cls)
            parts = [f"{class_id}"] + [f"{v:.6f}" for v in coords]
            if index < len(points_list):
                confidences = conf_list[index] if index < len(conf_list) else [1.0] * len(points_list[index])
                for point, conf in zip(points_list[index], confidences, strict=False):
                    visibility = 2 if (conf or 0) > 0.5 else (1 if (conf or 0) > 0.1 else 0)
                    parts.extend([f"{point[0]:.6f}", f"{point[1]:.6f}", str(visibility)])
            lines.append(" ".join(parts))
            self._tally(class_id)
        return lines

    def _obb_lines(self, result: Any) -> list[str]:
        obb = getattr(result, "obb", None)
        if obb is None or obb.xywhr is None:
            return []
        shape = getattr(result, "orig_shape", None) or (1, 1)
        height, width = int(shape[0]) or 1, int(shape[1]) or 1
        lines: list[str] = []
        for rect, cls in zip(obb.xywhr.tolist(), obb.cls.tolist(), strict=False):
            class_id = int(cls)
            cx, cy, w, h, angle = rect
            normalised = [cx / width, cy / height, w / width, h / height, angle]
            lines.append(f"{class_id} " + " ".join(f"{v:.6f}" for v in normalised))
            self._tally(class_id)
        return lines

    def _tally(self, class_id: int) -> None:
        name = (
            (self.class_names or DEFAULT_CLASSES)[class_id]
            if class_id < len(self.class_names or DEFAULT_CLASSES)
            else str(class_id)
        )
        self.stats.per_class[name] = self.stats.per_class.get(name, 0) + 1

    # -- yaml --------------------------------------------------------------
    def _write_yaml(self, detected: dict[int, str]) -> Path:
        """Write ``data.yaml`` with a class list that matches the label files.

        Label files store the *model's* class ids verbatim, so the ``names``
        mapping must be indexed identically. Deriving it from only the classes
        that happened to be detected would renumber everything - if class 0 never
        appeared, every other label would silently point at the wrong name.

        The list is therefore always dense and index-aligned: the known classes
        first, then a placeholder for every gap, then any detected class beyond
        the known range.
        """
        names: list[str] = list(self.class_names or DEFAULT_CLASSES)
        if detected:
            highest = max(detected)
            # Pad gaps so a detected id lands on its own index rather than the
            # next free slot.
            while len(names) <= highest:
                index = len(names)
                names.append(detected.get(index, f"class_{index}"))
        task = self.task or "detect"
        payload: dict[str, Any] = {
            "path": str(self.root).replace("\\", "/"),
            "train": "images/train",
            "val": "images/val"
            if (self.root / "images" / "val").exists() and any((self.root / "images" / "val").iterdir())
            else "images/train",
            "names": dict(enumerate(names)),
            "task": task,
            "description": f"Auto-annotated with {Path(self.model_id).name} by Sightrail",
        }
        if task == "pose":
            payload["kpt_shape"] = [17, 3]
        data_yaml = self.root / "data.yaml"
        data_yaml.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
        return data_yaml
