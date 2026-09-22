"""Job runners for the heavyweight Ultralytics modes.

Each runner takes a :class:`~sightrail.core.jobs.Job`, reports progress
through the job's event stream, and returns a JSON-serialisable result dict.
The routers only validate input and hand off to these functions, which keeps the
HTTP layer free of long-running work.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from ..config import settings
from ..core import datasets as datasets_mod
from ..core import hailo
from ..core import metrics as metrics_mod
from ..core.annotate import DatasetBuilder
from ..core.device import engine_device
from ..core.engine import ModelNotFound, engine, resolve_checkpoint
from ..core.jobs import Job, capture_engine_stdout, job_store, progress_artifacts
from ..core.serialize import serialise_names
from ..schemas.base import JobKind

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _run_dir(kind: str, name: str | None) -> Path:
    base = settings.runs_dir / kind
    stamp = name or time.strftime("%Y%m%d-%H%M%S")
    directory = base / stamp
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _resolve_run_dir(result: Any, fallback: Path | None) -> Path | None:
    """Find the directory a Trainer/Validator actually wrote to."""
    for attribute in ("save_dir", "wdir"):
        candidate = getattr(result, attribute, None)
        if candidate:
            return Path(str(candidate))
    trainer = getattr(result, "trainer", None)
    if trainer is not None and getattr(trainer, "save_dir", None):
        return Path(str(trainer.save_dir))
    validator = getattr(result, "validator", None)
    if validator is not None and getattr(validator, "save_dir", None):
        return Path(str(validator.save_dir))
    return fallback


def _collect(directory: Path | None, extra_patterns: tuple[str, ...] = ()) -> list[Any]:
    if directory is None:
        return []
    patterns = metrics_mod.PLOT_PATTERNS + extra_patterns
    return progress_artifacts(None, directory, patterns)


def _store_weights(model_result: Any) -> dict[str, str | None]:
    """Copy a freshly-trained checkpoint into the shared weights directory."""
    paths: dict[str, str | None] = {"best": None, "last": None}
    for key, attribute in (("best", "best"), ("last", "last")):
        source = getattr(model_result, attribute, None)
        if not source:
            continue
        source_path = Path(str(source))
        if not source_path.is_file():
            continue
        target = settings.weights_dir / f"{source_path.stem}_{int(time.time())}{source_path.suffix}"
        try:
            target.write_bytes(source_path.read_bytes())
            paths[key] = str(target)
        except OSError:  # pragma: no cover
            paths[key] = str(source_path)
    return paths


# ---------------------------------------------------------------------------
# train
# ---------------------------------------------------------------------------


def run_training(job: Job) -> dict[str, Any]:
    """Train mode: fine-tune a checkpoint on a dataset."""
    params = job.params
    model_id = str(params["model"])
    dataset = str(params["data"])
    task = params.get("task")
    run_name = params.get("name") or f"train-{job.id}"
    save_dir = _run_dir("train", run_name)

    requested = params.get("device", "auto")
    # Hailo is an inference target; fail early with the reason rather than
    # letting the trainer pick a torch device it cannot use.
    hailo.guard_mode(requested, "train")

    job.log_line(f"Resolving dataset '{dataset}'")
    data_arg = datasets_mod.resolve_dataset(dataset, download=settings.allow_dataset_downloads)
    job.log_line(f"Dataset resolved to {data_arg}")

    train_kwargs: dict[str, Any] = {
        "data": data_arg,
        "epochs": int(params.get("epochs", 50)),
        "batch": params.get("batch", -1),
        "imgsz": int(params.get("imgsz", 640)),
        "device": engine_device(requested),
        "workers": int(params.get("workers", 0)),
        "project": str(settings.runs_dir / "train"),
        "name": run_name,
        "exist_ok": True,
        "pretrained": bool(params.get("pretrained", True)),
        "optimizer": params.get("optimizer", "auto"),
        "lr0": float(params.get("lr0", 0.01)),
        "lrf": float(params.get("lrf", 0.01)),
        "momentum": float(params.get("momentum", 0.937)),
        "weight_decay": float(params.get("weight_decay", 0.0005)),
        "warmup_epochs": float(params.get("warmup_epochs", 3.0)),
        "cos_lr": bool(params.get("cos_lr", False)),
        "patience": int(params.get("patience", 50)),
        "seed": int(params.get("seed", 0)),
        "deterministic": bool(params.get("deterministic", True)),
        "val": bool(params.get("val", True)),
        "plots": True,
        "save": True,
        "verbose": True,
        "resume": bool(params.get("resume", False)),
        "cache": params.get("cache", False),
        "rect": bool(params.get("rect", False)),
        "amp": bool(params.get("amp", True)),
        "fraction": float(params.get("fraction", 1.0)),
        "freeze": params.get("freeze"),
        "single_cls": bool(params.get("single_cls", False)),
        "dropout": float(params.get("dropout", 0.0)),
        "overlap_mask": bool(params.get("overlap_mask", True)),
        "mask_ratio": int(params.get("mask_ratio", 4)),
        "close_mosaic": int(params.get("close_mosaic", 10)),
        "hsv_h": float(params.get("hsv_h", 0.015)),
        "hsv_s": float(params.get("hsv_s", 0.7)),
        "hsv_v": float(params.get("hsv_v", 0.4)),
        "degrees": float(params.get("degrees", 0.0)),
        "translate": float(params.get("translate", 0.1)),
        "scale": float(params.get("scale", 0.5)),
        "shear": float(params.get("shear", 0.0)),
        "perspective": float(params.get("perspective", 0.0)),
        "flipud": float(params.get("flipud", 0.0)),
        "fliplr": float(params.get("fliplr", 0.5)),
        "mosaic": float(params.get("mosaic", 1.0)),
        "mixup": float(params.get("mixup", 0.0)),
        "copy_paste": float(params.get("copy_paste", 0.0)),
        "erasing": float(params.get("erasing", 0.4)),
        "auto_augment": params.get("auto_augment", "randaugment"),
        "project_name": None,
    }
    train_kwargs = {key: value for key, value in train_kwargs.items() if value is not None and key != "project_name"}

    job.log_line(f"Training {model_id} for {train_kwargs['epochs']} epochs on {dataset}")
    with capture_engine_stdout(job):
        model_result = engine.train(model_id, **train_kwargs)

    resolved_dir = _resolve_run_dir(model_result, save_dir)
    job.log_line(f"Run directory: {resolved_dir}")

    weights = _store_weights(model_result)
    artifacts = _collect(resolved_dir)
    job.artifacts = artifacts

    results_csv = resolved_dir / "results.csv" if resolved_dir else None
    history: dict[str, Any] = {}
    if results_csv and results_csv.is_file():
        history = _parse_results_csv(results_csv)

    best = weights.get("best")
    final_metrics: dict[str, Any] = {}
    if best:
        try:
            job.log_line(f"Validating the best checkpoint: {Path(best).name}")
            val_result = engine.validate(
                best, data=data_arg, plots=False, verbose=False, device=engine_device(requested)
            )
            names = serialise_names(getattr(val_result, "names", {}))
            final_metrics = metrics_mod.describe_validation(
                val_result,
                names=names,
                task=str(task or "detect"),
                save_dir=None,
            )
        except Exception as exc:
            job.log_line(f"Post-training validation skipped: {exc}", level="warning")

    job.set_progress(100.0, "Training complete")
    return {
        "run_dir": str(resolved_dir) if resolved_dir else None,
        "weights": weights,
        "best_model": best,
        "history": history,
        "final_metrics": final_metrics,
        "artifacts": [artifact.model_dump() for artifact in artifacts],
    }


def _parse_results_csv(path: Path) -> dict[str, Any]:
    """Read ``results.csv`` into a column-oriented history for the charts."""
    import csv

    columns: dict[str, list[Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            for key, value in row.items():
                if key is None:
                    continue
                clean_key = key.strip()
                clean_value = (value or "").strip()
                try:
                    parsed: Any = float(clean_value)
                except ValueError:
                    parsed = clean_value
                columns.setdefault(clean_key, []).append(parsed)
    return columns


#: Public alias used by the routers.
parse_results_csv = _parse_results_csv


# ---------------------------------------------------------------------------
# val
# ---------------------------------------------------------------------------


def run_validation(job: Job) -> dict[str, Any]:
    """Val mode: evaluate a checkpoint and gather every diagnostic plot."""
    params = job.params
    model_id = str(params["model"])
    dataset = params.get("data")
    run_name = params.get("name") or f"val-{job.id}"
    save_dir = _run_dir("val", run_name)

    requested = params.get("device", "auto")
    hailo.guard_mode(requested, "val")

    val_kwargs: dict[str, Any] = {
        "split": params.get("split", "val"),
        "imgsz": int(params.get("imgsz", 640)),
        "batch": int(params.get("batch", 16)),
        "device": engine_device(requested),
        "conf": float(params.get("conf", 0.001)),
        "iou": float(params.get("iou", 0.6)),
        "max_det": int(params.get("max_det", 300)),
        "half": bool(params.get("half", False)),
        "plots": True,
        "verbose": True,
        "project": str(settings.runs_dir / "val"),
        "name": run_name,
        "exist_ok": True,
    }
    if dataset:
        val_kwargs["data"] = datasets_mod.resolve_dataset(str(dataset), download=settings.allow_dataset_downloads)

    job.log_line(f"Validating {model_id}" + (f" on {dataset}" if dataset else ""))
    with capture_engine_stdout(job):
        result = engine.validate(model_id, **val_kwargs)

    resolved_dir = _resolve_run_dir(result, save_dir)
    artifacts = _collect(resolved_dir)
    job.artifacts = artifacts

    names = serialise_names(getattr(result, "names", {}))
    task = str(getattr(result, "task", params.get("task", "detect")))
    described = metrics_mod.describe_validation(
        result,
        names=names,
        task=task,
        save_dir=resolved_dir,
        speed=getattr(result, "speed", None),
    )
    described["run_dir"] = str(resolved_dir) if resolved_dir else None
    described["artifacts"] = [artifact.model_dump() for artifact in artifacts]
    described["model"] = model_id
    described["dataset"] = dataset
    job.set_progress(100.0, "Validation complete")
    return described


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------


def run_export(job: Job) -> dict[str, Any]:
    """Export mode: convert a checkpoint into a deployment format."""
    params = job.params
    model_id = str(params["model"])
    fmt = str(params.get("format", "onnx"))
    run_name = params.get("name") or f"export-{fmt}-{job.id}"
    save_dir = _run_dir("export", run_name)

    # Hailo export has host, toolchain, calibration and task requirements that
    # are worth checking up front - a compiler traceback helps nobody.
    hailo.validate_export_request(fmt, params)

    export_kwargs: dict[str, Any] = {
        "imgsz": int(params.get("imgsz", 640)),
        "half": bool(params.get("half", False)),
        "int8": bool(params.get("int8", False)),
        "dynamic": bool(params.get("dynamic", False)),
        "simplify": bool(params.get("simplify", True)),
        "opset": params.get("opset"),
        "workspace": params.get("workspace"),
        "nms": bool(params.get("nms", False)),
        "batch": int(params.get("batch", 1)),
        "device": engine_device(params.get("device", "auto")),
        "optimize": bool(params.get("optimize", False)),
        "keras": bool(params.get("keras", False)),
    }
    if params.get("data"):
        export_kwargs["data"] = datasets_mod.resolve_dataset(str(params["data"]), download=True)
    if params.get("name_arg"):
        export_kwargs["name"] = params["name_arg"]
    elif fmt == "hailo":
        # The Ultralytics exporter reads the Hailo architecture from `name`.
        export_kwargs["name"] = str(params.get("hailo_arch") or settings.hailo_arch or "hailo8l").lower()
        job.log_line(f"Hailo target architecture: {export_kwargs['name']}")
    export_kwargs = {key: value for key, value in export_kwargs.items() if value is not None}

    job.log_line(f"Exporting {model_id} to {fmt}")
    with capture_engine_stdout(job):
        exported = engine.export(model_id, fmt=fmt, **export_kwargs)

    exported_path = Path(str(exported))
    size = exported_path.stat().st_size if exported_path.exists() else 0
    if exported_path.is_dir():  # e.g. OpenVINO produces a directory
        size = sum(item.stat().st_size for item in exported_path.rglob("*") if item.is_file())

    from ..core.jobs import artifact_for_path

    artifact = artifact_for_path(exported_path if exported_path.exists() else save_dir)
    job.artifacts = [artifact]
    job.set_progress(100.0, "Export complete")
    return {
        "format": fmt,
        "path": str(exported_path),
        "size_bytes": size,
        "artifact": artifact.model_dump(),
        "args": {key: str(value) for key, value in export_kwargs.items()},
    }


# ---------------------------------------------------------------------------
# benchmark
# ---------------------------------------------------------------------------


def run_benchmark(job: Job) -> dict[str, Any]:
    """Benchmark mode: compare speed/accuracy across export formats."""
    params = job.params
    model_id = str(params["model"])
    formats = params.get("formats") or ["onnx"]
    dataset = params.get("data")
    # Ultralytics' benchmark helper re-validates on the dataset's official split
    # (COCO full by default), which is far too heavy for an interactive UI, so we
    # time each export format on the same small dataset and report both.
    job.log_line(f"Benchmarking {model_id} across {', '.join(formats)}")
    rows: list[dict[str, Any]] = []
    data_arg = (
        datasets_mod.resolve_dataset(str(dataset), download=settings.allow_dataset_downloads) if dataset else None
    )

    total = max(1, len(formats))
    benchmark_device = engine_device(params.get("device", "auto"))
    for index, fmt in enumerate(formats, start=1):
        job.log_line(f"--- {fmt} ---")
        started = time.perf_counter()
        try:
            # Skip formats this host cannot produce instead of failing the row.
            hailo.validate_export_request(fmt, {**params, "data": data_arg})
            with capture_engine_stdout(job):
                exported = engine.export(
                    model_id, fmt=fmt, imgsz=int(params.get("imgsz", 640)), device=benchmark_device
                )
            export_s = round(time.perf_counter() - started, 2)
            path = Path(str(exported))
            size_mb = (
                sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
                if path.is_dir()
                else (path.stat().st_size if path.exists() else 0)
            ) / (1024 * 1024)

            accuracy: dict[str, Any] = {}
            latency = None
            if data_arg and fmt in {"onnx", "openvino", "torchscript", "engine", "pb", "saved_model"}:
                try:
                    with capture_engine_stdout(job):
                        val_metrics = engine.validate(
                            str(path), data=data_arg, plots=False, verbose=False, device=benchmark_device
                        )
                    names = serialise_names(getattr(val_metrics, "names", {}))
                    described = metrics_mod.describe_validation(
                        val_metrics, names=names, task=str(params.get("task", "detect")), save_dir=None
                    )
                    accuracy = described.get("summary", {})
                    speed = described.get("speed") or {}
                    latency = {
                        "preprocess_ms": speed.get("preprocess"),
                        "inference_ms": speed.get("inference"),
                        "postprocess_ms": speed.get("postprocess"),
                    }
                except Exception as exc:
                    job.log_line(f"Accuracy check for {fmt} skipped: {exc}", level="warning")

            rows.append(
                {
                    "format": fmt,
                    "path": str(path),
                    "size_mb": round(size_mb, 2),
                    "export_seconds": export_s,
                    "metrics": accuracy,
                    "latency": latency,
                    "status": "ok",
                }
            )
        except Exception as exc:
            job.log_line(f"{fmt} failed: {exc}", level="error")
            rows.append({"format": fmt, "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
        job.set_progress(100.0 * index / total, f"Benchmarked {index}/{total} formats")

    job.set_progress(100.0, "Benchmark complete")
    return {"model": model_id, "dataset": dataset, "formats": rows}


# ---------------------------------------------------------------------------
# dataset auto-annotation
# ---------------------------------------------------------------------------


def run_annotation(job: Job) -> dict[str, Any]:
    """Pre-label an image folder with a checkpoint and emit a YOLO dataset."""
    params = job.params
    image_paths = [Path(str(p)) for p in params.get("images", [])]
    missing = [str(path) for path in image_paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"{len(missing)} uploaded image(s) are no longer available: {missing[:3]}")

    builder = DatasetBuilder(
        name=str(params["name"]),
        images=image_paths,
        model_id=str(params["model"]),
        task=params.get("task"),
        conf=float(params.get("conf", 0.25)),
        iou=float(params.get("iou", 0.7)),
        imgsz=int(params.get("imgsz", 640)),
        device=engine_device(params.get("device", "auto")),
        classes=params.get("classes"),
        val_split=float(params.get("val_split", 0.15)),
    )

    job.log_line(f"Auto-annotating {len(image_paths)} image(s) with {params['model']}")

    def progress(done: int, total: int, name: str) -> None:
        job.set_progress(100.0 * done / max(1, total), f"Annotated {done}/{total}: {name}")

    report = builder.build(progress=progress)
    artifact_dir = Path(report["root"])
    job.artifacts = progress_artifacts(None, artifact_dir, ("*.yaml", "*.txt", "*.jpg", "*.png"))
    job.set_progress(100.0, "Dataset ready")
    return report


# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

RUNNERS = {
    JobKind.TRAIN: run_training,
    JobKind.VAL: run_validation,
    JobKind.EXPORT: run_export,
    JobKind.BENCHMARK: run_benchmark,
    JobKind.ANNOTATE: run_annotation,
}


def start_job(kind: JobKind, title: str, params: dict[str, Any]) -> Job:
    """Create and immediately schedule a job of the given kind."""
    runner = RUNNERS.get(kind)
    if runner is None:
        raise ValueError(f"No runner registered for job kind '{kind}'.")
    job = job_store.create(kind, title, params)
    job_store.submit(job, runner)
    return job


# Re-exported for routers that need to validate a checkpoint up-front.
__all__ = [
    "ModelNotFound",
    "cancel_job",
    "engine",
    "resolve_checkpoint",
    "start_job",
]


def cancel_job(job_id: str) -> Job | None:
    return job_store.cancel(job_id)
