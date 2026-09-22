"""Dataset discovery and YAML resolution.

Ultralytics ships a large library of dataset descriptors under
``ultralytics/cfg/datasets``. We surface those (plus anything the user drops in
``storage/datasets``) so the Train and Val pages can offer a real picker instead
of a free-text field.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from ..config import settings

#: Datasets used for smoke-testing each task family.  Small enough to be
#: downloaded and trained on in seconds, which is what makes the demo usable.
QUICKSTART_DATASETS: list[dict[str, Any]] = [
    {
        "id": "coco8.yaml",
        "label": "COCO8 (detect)",
        "task": "detect",
        "images": 8,
        "classes": 80,
        "note": "8 images - the canonical Ultralytics smoke test",
    },
    {
        "id": "coco8-seg.yaml",
        "label": "COCO8-Seg (segment)",
        "task": "segment",
        "images": 8,
        "classes": 80,
        "note": "Instance segmentation smoke test",
    },
    {
        "id": "coco8-pose.yaml",
        "label": "COCO8-Pose (pose)",
        "task": "pose",
        "images": 8,
        "classes": 1,
        "note": "Person keypoints smoke test",
    },
    {
        "id": "coco8-obb.yaml",
        "label": "DOTA8 (obb)",
        "task": "obb",
        "images": 8,
        "classes": 15,
        "note": "Oriented bounding boxes smoke test",
    },
    {
        "id": "imagenet10",
        "label": "ImageNet10 (classify)",
        "task": "classify",
        "images": 20,
        "classes": 10,
        "note": "Classification smoke test",
    },
    {
        "id": "coco128.yaml",
        "label": "COCO128 (detect)",
        "task": "detect",
        "images": 128,
        "classes": 80,
        "note": "128 COCO images - a few minutes of training",
    },
    {
        "id": "VOC.yaml",
        "label": "Pascal VOC (detect)",
        "task": "detect",
        "images": 16551,
        "classes": 20,
        "note": "Full VOC 2007/2012 trainval",
    },
    {
        "id": "coco.yaml",
        "label": "COCO (detect)",
        "task": "detect",
        "images": 118287,
        "classes": 80,
        "note": "Full COCO - hours of training",
    },
]


@dataclass
class DatasetInfo:
    id: str
    label: str
    task: str | None
    path: str | None
    source: str  # "ultralytics" | "local"
    images: int | None = None
    classes: int | None = None
    note: str | None = None
    downloaded: bool = False
    exists: bool = False
    names: list[str] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "task": self.task,
            "path": self.path,
            "source": self.source,
            "images": self.images,
            "classes": self.classes,
            "note": self.note,
            "downloaded": self.downloaded,
            "exists": self.exists,
            "names": self.names,
        }


def _ultralytics_datasets_dir() -> Path | None:
    try:
        import ultralytics

        return Path(ultralytics.__file__).parent / "cfg" / "datasets"
    except Exception:  # pragma: no cover - engine optional
        return None


def _quickstart_index() -> dict[str, dict[str, Any]]:
    return {entry["id"]: entry for entry in QUICKSTART_DATASETS}


def dataset_yaml_path(dataset_id: str) -> Path | None:
    """Locate a dataset YAML, preferring user-local overrides."""
    settings.ensure_dirs()
    local = settings.datasets_dir / dataset_id
    if local.is_file():
        return local.resolve()
    if Path(dataset_id).is_file():
        return Path(dataset_id).resolve()
    ultra_dir = _ultralytics_datasets_dir()
    if ultra_dir and (ultra_dir / dataset_id).is_file():
        return (ultra_dir / dataset_id).resolve()
    return None


def read_dataset_yaml(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except Exception:  # pragma: no cover - malformed user file
        return {}
    return data if isinstance(data, dict) else {}


def _resolve_split_root(data: dict[str, Any], key: str) -> Path | None:
    value = data.get(key)
    if not value:
        return None
    root = data.get("path")
    base = Path(root).expanduser() if root else Path.cwd()
    if not base.is_absolute():
        base = (settings.datasets_dir / base).resolve()
    return (base / str(value)).resolve() if not Path(str(value)).is_absolute() else Path(str(value))


def describe_local_dataset(path: Path) -> DatasetInfo:
    data = read_dataset_yaml(path)
    names = data.get("names")
    if isinstance(names, dict):
        name_list = [str(names[k]) for k in sorted(names, key=lambda x: int(x))]
    elif isinstance(names, list):
        name_list = [str(n) for n in names]
    else:
        name_list = None

    train_root = _resolve_split_root(data, "train") or _resolve_split_root(data, "train2017")
    images = None
    if train_root and train_root.exists() and train_root.is_dir():
        images = sum(1 for p in train_root.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"})

    return DatasetInfo(
        id=path.name,
        label=path.stem,
        task=data.get("task"),
        path=str(path),
        source="local",
        images=images,
        classes=len(name_list) if name_list else None,
        note=str(data.get("description") or "") or None,
        downloaded=True,
        exists=train_root.exists() if train_root else False,
        names=name_list[:200] if name_list else None,
    )


def list_datasets() -> list[dict[str, Any]]:
    """Merge the quickstart catalog, Ultralytics descriptors and local YAMLs."""
    settings.ensure_dirs()
    seen: dict[str, dict[str, Any]] = {}

    for entry in QUICKSTART_DATASETS:
        path = dataset_yaml_path(entry["id"])
        info = DatasetInfo(
            id=entry["id"],
            label=entry["label"],
            task=entry["task"],
            path=str(path) if path else None,
            source="ultralytics",
            images=entry["images"],
            classes=entry["classes"],
            note=entry["note"],
            downloaded=path is not None,
            exists=_dataset_present(path),
        )
        seen[entry["id"]] = info.as_dict()

    for path in sorted(settings.datasets_dir.glob("*.yaml")):
        if path.name not in seen:
            seen[path.name] = describe_local_dataset(path).as_dict()

    ultra_dir = _ultralytics_datasets_dir()
    if ultra_dir and ultra_dir.is_dir():
        quick = _quickstart_index()
        for path in sorted(ultra_dir.glob("*.yaml")):
            if path.name in seen or path.name in quick:
                continue
            info = describe_local_dataset(path)
            info.source = "ultralytics"
            info.exists = _dataset_present(path)
            seen[path.name] = info.as_dict()

    return sorted(seen.values(), key=lambda item: (item["source"] != "ultralytics", item["label"].lower()))


def _dataset_present(path: Path | None) -> bool:
    if path is None:
        return False
    data = read_dataset_yaml(path)
    for key in ("train", "train2017", "val", "val2017"):
        root = _resolve_split_root(data, key)
        if root and root.exists():
            return True
    return False


def resolve_dataset(dataset_id: str, *, download: bool = True) -> str:
    """Return the YAML path Ultralytics should receive for this dataset.

    When ``download`` is true and the dataset is a known Ultralytics descriptor
    or URL, the descriptor string is returned as-is: Ultralytics' own downloader
    pulls the archives and caches them under its settings directory.
    """
    if not dataset_id:
        raise ValueError("A dataset id is required.")

    if dataset_id.startswith(("http://", "https://")):
        return dataset_id

    path = dataset_yaml_path(dataset_id)
    if path is not None:
        return str(path)

    if not download:
        raise FileNotFoundError(f"Dataset '{dataset_id}' was not found locally.")

    # Hand it to Ultralytics verbatim; its downloader knows the asset URLs.
    if dataset_id.endswith((".yaml", ".yml")) or dataset_id in {"imagenet10", "imagenet"}:
        return dataset_id
    raise FileNotFoundError(f"Dataset '{dataset_id}' was not found.")


def collect_dataset_artifacts(names: list[str] | None) -> list[str]:
    """Class names for a dataset, used to seed the per-class metric tables."""
    return [str(name) for name in (names or [])]
