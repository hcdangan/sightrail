"""Train, val, export, benchmark and auto-annotation endpoints.

Heavy work is dispatched to the job pool; callers receive a job envelope and
subscribe to ``/api/ws/jobs/{id}`` (or poll ``/api/jobs/{id}``) for progress.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..core import datasets as datasets_mod
from ..core import engine, metrics, models_meta
from ..core.hailo import HailoError, guard_mode, validate_export_request
from ..schemas.base import JobKind, JobSummary
from ..schemas.requests import (
    AnnotateRequest,
    BenchmarkRequest,
    ExportRequest,
    FolderAnnotationRequest,
    TrainRequest,
    ValRequest,
)
from ..services import runners, uploads

router = APIRouter(tags=["modes"])

HEAVY_FORMATS = {"engine", "hailo", "axelera", "deepx", "imx", "rknn", "qnn", "ascend", "coreai", "edgetpu"}


def _guard_engine() -> None:
    if not engine.Engine.available():
        raise HTTPException(
            status_code=503,
            detail="The Ultralytics engine is unavailable. Install the API dependencies and try again.",
        )


def _hailo_http_error(exc: HailoError) -> HTTPException:
    """Translate a Hailo limitation into an actionable 400."""
    detail = str(exc)
    if exc.hint:
        detail = f"{detail} {exc.hint}"
    return HTTPException(status_code=400, detail=detail)


# ---------------------------------------------------------------------------
# train
# ---------------------------------------------------------------------------


@router.post("/train", response_model=JobSummary, summary="Start training (job)")
def start_training(request: TrainRequest) -> JobSummary:
    _guard_engine()
    try:
        guard_mode(request.device, "train")
    except HailoError as exc:
        raise _hailo_http_error(exc) from exc
    params = request.model_dump(mode="json")
    try:
        datasets_mod.resolve_dataset(request.data, download=settings.allow_dataset_downloads)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    job = runners.start_job(JobKind.TRAIN, f"Train {request.model} on {request.data}", params)
    return job.summary()


# ---------------------------------------------------------------------------
# val
# ---------------------------------------------------------------------------


@router.post("/val", response_model=JobSummary, summary="Start validation (job)")
def start_validation(request: ValRequest) -> JobSummary:
    _guard_engine()
    try:
        guard_mode(request.device, "val")
    except HailoError as exc:
        raise _hailo_http_error(exc) from exc
    job = runners.start_job(
        JobKind.VAL,
        f"Validate {request.model}" + (f" on {request.data}" if request.data else ""),
        request.model_dump(mode="json"),
    )
    return job.summary()


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------


@router.post("/export", response_model=JobSummary, summary="Start an export (job)")
def start_export(request: ExportRequest) -> JobSummary:
    _guard_engine()
    if request.format in HEAVY_FORMATS and not settings.allow_heavy_export:
        raise HTTPException(status_code=403, detail=f"Exporting to '{request.format}' is disabled by configuration.")
    payload = request.model_dump(mode="json")
    try:
        # Hailo export has host/toolchain/calibration requirements; checking here
        # turns a compiler traceback into an explanation.
        validate_export_request(request.format, payload)
    except HailoError as exc:
        raise _hailo_http_error(exc) from exc
    job = runners.start_job(
        JobKind.EXPORT,
        f"Export {request.model} to {request.format}",
        {**payload, "name_arg": request.name},
    )
    return job.summary()


@router.get("/export/formats", summary="Export format matrix")
def export_matrix() -> dict[str, Any]:
    return {"formats": models_meta.export_format_catalog(), "heavy": sorted(HEAVY_FORMATS)}


@router.get("/export/available", summary="Which export backends are installed")
def export_available() -> dict[str, Any]:
    from ..core.device import environment_info, hailo_compiler_available, hailo_runtime_installed

    optional = environment_info()["optional"]
    mapping = {
        "onnx": ["onnx", "onnxruntime"],
        "openvino": ["openvino"],
        "coreml": ["coremltools"],
        "saved_model": ["tensorflow"],
        "pb": ["tensorflow"],
        "tflite": ["tensorflow"],
        "ncnn": ["ncnn"],
        "paddle": ["paddle"],
        "hailo": ["hailo_sdk_client"],
    }
    backends = {
        fmt: {"ready": all(optional.get(pkg) for pkg in packages), "packages": packages}
        for fmt, packages in mapping.items()
    }
    # Hailo's runtime and compiler are separate: the compiler makes HEFs, the
    # runtime runs them (and lives on a different machine).
    backends["hailo"]["runtime_installed"] = hailo_runtime_installed()
    backends["hailo"]["compiler_installed"] = hailo_compiler_available()
    return {
        "backends": backends,
        "installed": optional,
        "hailo": {
            "runtime": hailo_runtime_installed(),
            "compiler": hailo_compiler_available(),
        },
    }


# ---------------------------------------------------------------------------
# benchmark
# ---------------------------------------------------------------------------


@router.post("/benchmark", response_model=JobSummary, summary="Benchmark export formats (job)")
def start_benchmark(request: BenchmarkRequest) -> JobSummary:
    _guard_engine()
    job = runners.start_job(
        JobKind.BENCHMARK,
        f"Benchmark {request.model} ({len(request.formats)} formats)",
        request.model_dump(mode="json"),
    )
    return job.summary()


# ---------------------------------------------------------------------------
# datasets
# ---------------------------------------------------------------------------


@router.get("/datasets", summary="Available datasets")
def list_datasets(task: str | None = None) -> dict[str, Any]:
    entries = datasets_mod.list_datasets()
    if task:
        entries = [entry for entry in entries if entry.get("task") == task]
    return {"datasets": entries, "yolo_format": datasets_mod.dataset_yaml_path("coco8.yaml") is not None}


@router.get("/datasets/{dataset_id}/preview", summary="Dataset YAML contents")
def dataset_preview(dataset_id: str) -> dict[str, Any]:
    path = datasets_mod.dataset_yaml_path(dataset_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' was not found.")
    return {"id": dataset_id, "path": str(path), "config": datasets_mod.read_dataset_yaml(path)}


@router.get("/solutions", summary="Built-in Ultralytics solutions")
def list_solutions() -> dict[str, Any]:
    from ..core.streaming import list_solutions as catalog_solutions

    return {"solutions": catalog_solutions()}


# ---------------------------------------------------------------------------
# auto-annotation
# ---------------------------------------------------------------------------


@router.post("/datasets/annotate", response_model=JobSummary, summary="Auto-annotate uploads (job)")
def start_annotation(request: AnnotateRequest) -> JobSummary:
    _guard_engine()
    paths: list[str] = []
    for upload_id in request.upload_ids:
        entry = uploads.get_upload(upload_id)
        if entry:
            candidate = Path(str(entry["path"]))
            if candidate.is_dir():
                paths.extend(str(p) for p in sorted(candidate.rglob("*")) if uploads.classify(p.name) == "image")
            else:
                paths.append(str(candidate))
    for raw in request.paths:
        candidate = Path(raw)
        if candidate.is_dir():
            paths.extend(str(p) for p in sorted(candidate.rglob("*")) if uploads.classify(p.name) == "image")
        elif candidate.is_file():
            paths.append(str(candidate))

    if not paths:
        raise HTTPException(status_code=400, detail="Select at least one image to annotate.")

    job = runners.start_job(
        JobKind.ANNOTATE,
        f"Auto-annotate {len(paths)} image(s) -> {request.name}",
        {**request.model_dump(mode="json"), "images": paths},
    )
    return job.summary()


@router.post("/datasets/annotate-folder", response_model=JobSummary, summary="Annotate a server-side folder (job)")
def annotate_folder(request: FolderAnnotationRequest) -> JobSummary:
    _guard_engine()
    folder = Path(request.folder).expanduser()
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail=f"Folder '{request.folder}' was not found.")
    images = sorted(p for p in folder.rglob("*") if uploads.classify(p.name) == "image")[: request.limit]
    if not images:
        raise HTTPException(status_code=404, detail="No images were found in that folder.")
    job = runners.start_job(
        JobKind.ANNOTATE,
        f"Auto-annotate {len(images)} image(s) -> {request.name}",
        {**request.model_dump(mode="json"), "images": [str(p) for p in images]},
    )
    return job.summary()


@router.get("/datasets/local", summary="Datasets built by Sightrail")
def local_datasets() -> dict[str, Any]:
    entries = [entry for entry in datasets_mod.list_datasets() if entry.get("source") == "local"]
    return {"datasets": entries, "root": str(settings.datasets_dir)}


@router.get("/runs", summary="Run history")
def runs() -> dict[str, Any]:
    from .system import list_runs

    return {"runs": list_runs()}


@router.get("/runs/{mode}/{name}", summary="Single run detail")
def run_detail(mode: str, name: str) -> dict[str, Any]:
    directory = settings.runs_dir / mode / name
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"Run '{mode}/{name}' was not found.")
    payload: dict[str, Any] = {
        "mode": mode,
        "name": name,
        "path": str(directory),
        "artifacts": metrics.artefact_index(directory),
    }
    results_csv = directory / "results.csv"
    if results_csv.is_file():
        payload["history"] = runners.parse_results_csv(results_csv)
    args_yaml = directory / "args.yaml"
    if args_yaml.is_file():
        payload["args"] = datasets_mod.read_dataset_yaml(args_yaml)
    return payload
