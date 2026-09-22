"""Metric extraction for validation and benchmark runs.

Ultralytics returns metric containers (``ultralytics.utils.metrics.DetMetrics``,
``SegmentMetrics``, ``PoseMetrics``, ``ClassifyMetrics``, ``OBBMetrics``) whose
shape differs per task. This module normalises them into JSON the UI can plot,
and discovers the diagnostic plots Ultralytics writes next to the run.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

PLOT_PATTERNS: tuple[str, ...] = (
    "*.png",
    "*.jpg",
    "*.csv",
    "*.yaml",
    "*.txt",
    "*.pt",
    "*.onnx",
    "*.torchscript",
)

#: Friendly labels for the per-class metric keys we surface.
METRIC_LABELS: dict[str, str] = {
    "precision": "Precision",
    "recall": "Recall",
    "f1": "F1",
    "map50": "mAP@50",
    "map": "mAP@50-95",
    "map75": "mAP@75",
    "accuracy_top1": "Top-1 accuracy",
    "accuracy_top5": "Top-5 accuracy",
    "fitness": "Fitness",
}


def _jsonify(value: Any) -> Any:
    """Recursively convert numpy/pandas containers into JSON-safe values."""
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return None if (np.isnan(value) or np.isinf(value)) else round(value, 6)
    if isinstance(value, np.generic):
        return _jsonify(value.item())
    if isinstance(value, np.ndarray):
        return [_jsonify(item) for item in value.tolist()]
    if hasattr(value, "tolist"):
        try:
            return _jsonify(value.tolist())
        except Exception:  # pragma: no cover
            return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonify(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonify(item) for item in value]
    if hasattr(value, "to_dict"):
        try:
            return {str(key): _jsonify(item) for key, item in value.to_dict().items()}
        except Exception:  # pragma: no cover
            pass
    return str(value)


def _curves_payload(curves_result: Any) -> dict[str, Any]:
    """Extract precision/recall/F1 curves (``*_curves.png`` source data)."""
    payload: dict[str, Any] = {}
    if curves_result is None:
        return payload
    curves = getattr(curves_result, "curves", None)
    if curves is None:
        return payload
    for key in ("precision", "recall", "f1", "x", "ap"):
        values = getattr(curves, key, None)
        if values is not None:
            payload[key] = _jsonify(values)
    names = getattr(curves_result, "names", None)
    if names:
        payload["names"] = _jsonify(names)
    return payload


def _per_class(metrics: Any, names: dict[int, str], metric_keys: tuple[str, ...]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, name in sorted(names.items()):
        row: dict[str, Any] = {"class_id": index, "class_name": name}
        has_any = False
        for key in metric_keys:
            values = getattr(metrics, key, None)
            if values is None:
                continue
            try:
                value = values[index]
            except (IndexError, KeyError, TypeError):
                continue
            row[key] = _jsonify(value)
            has_any = True
        if has_any:
            rows.append(row)
    return rows


def _curve_matrix(metrics: Any, names: dict[int, str]) -> list[dict[str, Any]]:
    """The mAP@50-95 curve matrix (classes x IoU thresholds)."""
    curves = getattr(metrics, "curves", None)
    if curves is None:
        return []
    values = getattr(curves, "results", None)
    if values is None:
        return []
    matrix = _jsonify(values)
    return [
        {"class_id": index, "class_name": names.get(index, str(index)), "values": row}
        for index, row in enumerate(matrix or [])
        if index in names
    ]


def describe_validation(
    metrics: Any,
    *,
    names: dict[int, str],
    task: str,
    save_dir: Path | None,
    speed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalise a ``model.val()`` result into the UI's validation payload."""
    from .serialize import to_float

    summary: dict[str, Any] = {}
    per_class: list[dict[str, Any]] = []
    extra: dict[str, Any] = {}

    box = getattr(metrics, "box", None) or getattr(metrics, "obb", None) or getattr(metrics, "seg", None)
    if box is not None:
        for key in ("map", "map50", "map75", "mp", "mr"):
            value = to_float(getattr(box, key, None))
            if value is not None:
                summary[key] = round(value, 5)
        if "map" in summary and "map50" in summary:
            precision, recall = summary.get("mp", 0.0), summary.get("mr", 0.0)
            summary["f1"] = round(2 * precision * recall / (precision + recall), 5) if (precision + recall) else 0.0

        per_class = _per_class(box, names, ("p", "r", "ap50", "ap", "f1"))
        for row in per_class:
            if "p" in row or "r" in row:
                precision, recall = row.get("p") or 0.0, row.get("r") or 0.0
                row["f1"] = round(2 * precision * recall / (precision + recall), 5) if (precision + recall) else 0.0
            row["map50"] = row.pop("ap50", None)
            row["map"] = row.pop("ap", None)
            row["precision"] = row.pop("p", None)
            row["recall"] = row.pop("r", None)

        extra["curves"] = _curve_matrix(box, names)

    seg = getattr(metrics, "seg", None)
    if seg is not None:
        extra["segmentation"] = {
            key: to_float(getattr(seg, key, None))
            for key in ("map", "map50", "map75")
            if to_float(getattr(seg, key, None)) is not None
        }
        extra["segmentation_per_class"] = _per_class(seg, names, ("p", "r", "ap50", "ap"))

    pose = getattr(metrics, "pose", None)
    if pose is not None:
        extra["pose"] = {
            key: to_float(getattr(pose, key, None))
            for key in ("map", "map50", "map75")
            if to_float(getattr(pose, key, None)) is not None
        }

    for key in ("top1", "top5"):
        value = to_float(getattr(metrics, key, None))
        if value is not None:
            summary[f"accuracy_{key}"] = round(value, 5)

    fitness = to_float(getattr(metrics, "fitness", None))
    if fitness is not None:
        summary["fitness"] = round(fitness, 5)

    speed_payload = _jsonify(getattr(metrics, "speed", None) or speed or {})

    confusion = None
    if save_dir:
        candidate = Path(save_dir) / "confusion_matrix.png"
        if candidate.is_file():
            from .serialize import media_url

            confusion = media_url(candidate, "runs")
        normalized = Path(save_dir) / "confusion_matrix_normalized.png"
        extra["confusion_matrix_normalized"] = media_url(normalized, "runs") if normalized.is_file() else None

    results_dict = _jsonify(getattr(metrics, "results_dict", None))

    return {
        "task": task,
        "summary": summary,
        "per_class": per_class,
        "curves": extra.get("curves", []),
        "segmentation": extra.get("segmentation"),
        "segmentation_per_class": extra.get("segmentation_per_class", []),
        "pose": extra.get("pose"),
        "speed": speed_payload,
        "confusion_matrix_url": confusion,
        "results_dict": results_dict,
        "save_dir": str(save_dir) if save_dir else None,
    }


def describe_benchmark(raw: Any) -> dict[str, Any]:
    """Normalise custom ``model.benchmark()`` output into a table."""
    payload = _jsonify(raw)
    if isinstance(payload, dict):
        rows = payload.get("results") or payload.get("benchmarks")
        if isinstance(rows, list):
            return {"formats": rows, "raw": payload}
    if isinstance(payload, list):
        return {"formats": payload, "raw": None}
    return {"formats": [], "raw": payload}


def artefact_index(directory: Path | None) -> list[dict[str, Any]]:
    """List plottable/consumable files produced by a run."""
    if directory is None or not directory.exists():
        return []
    from .jobs import artifact_for_path

    return [artifact_for_path(path).model_dump() for path in _iter_artifacts(directory)]


def _iter_artifacts(directory: Path):
    seen: set[Path] = set()
    for pattern in PLOT_PATTERNS:
        for path in sorted(directory.rglob(pattern)):
            if path.is_file() and path not in seen:
                seen.add(path)
                yield path
