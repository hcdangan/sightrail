"""Model catalog, checkpoint management and registry introspection."""

from __future__ import annotations

import contextlib
from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..core import catalog, engine, models_meta
from ..schemas.requests import ModelDownloadRequest

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/catalog", summary="Every model Sightrail knows about")
def get_catalog(task: str | None = None, family: str | None = None) -> dict[str, Any]:
    entries = catalog.list_catalog()
    if task:
        entries = [entry for entry in entries if entry["task"] == task]
    if family:
        entries = [entry for entry in entries if entry["family"] == family]

    families = sorted({entry["family"] for entry in catalog.list_catalog()})
    local = {item["id"] for item in engine.local_checkpoints()}
    for entry in entries:
        entry["downloaded"] = entry["id"] in local

    return {
        "models": entries,
        "families": families,
        "defaults": catalog.DEFAULT_MODELS,
        "preferred": list(catalog.PREFERRED_FAMILIES),
    }


@router.get("/local", summary="Checkpoints already on disk")
def local_models() -> dict[str, Any]:
    entries = engine.local_checkpoints()
    return {"models": entries, "weights_dir": str(settings.weights_dir)}


@router.get("/registry", summary="Models currently resident in memory")
def registry() -> dict[str, Any]:
    return {"loaded": engine.engine.registry.loaded(), "capacity": settings.model_cache_size}


@router.delete("/registry", summary="Evict a model (or all models) from memory")
def evict_registry(model: str | None = None) -> dict[str, Any]:
    removed = engine.engine.registry.evict(model)
    return {"evicted": removed}


@router.get("/formats", summary="Export formats supported by this build")
def export_formats() -> dict[str, Any]:
    return {"formats": models_meta.export_format_catalog()}


@router.get("/optimizers", summary="Optimizers available for training")
def optimizers() -> dict[str, Any]:
    return {"optimizers": models_meta.OPTIMIZERS}


@router.get("/tasks", summary="Task families and their defaults")
def tasks() -> dict[str, Any]:
    return {
        "tasks": [
            {
                "id": "detect",
                "label": "Object Detection",
                "description": "Axis-aligned boxes with class labels.",
                "default_model": catalog.DEFAULT_MODELS["detect"],
                "outputs": ["boxes"],
            },
            {
                "id": "segment",
                "label": "Instance Segmentation",
                "description": "Per-instance pixel masks plus boxes.",
                "default_model": catalog.DEFAULT_MODELS["segment"],
                "outputs": ["boxes", "masks"],
            },
            {
                "id": "classify",
                "label": "Image Classification",
                "description": "Whole-image class probabilities.",
                "default_model": catalog.DEFAULT_MODELS["classify"],
                "outputs": ["probs"],
            },
            {
                "id": "pose",
                "label": "Pose Estimation",
                "description": "Person/animal skeletons with keypoint confidence.",
                "default_model": catalog.DEFAULT_MODELS["pose"],
                "outputs": ["boxes", "keypoints"],
            },
            {
                "id": "obb",
                "label": "Oriented Bounding Boxes",
                "description": "Rotated boxes for aerial and industrial imagery.",
                "default_model": catalog.DEFAULT_MODELS["obb"],
                "outputs": ["obb"],
            },
        ]
    }


@router.get("/trackers", summary="Tracking algorithms")
def trackers() -> dict[str, Any]:
    return {"trackers": models_meta.TRACKERS}


@router.get("/{model_id:path}/info", summary="Checkpoint metadata")
def model_info(model_id: str, device: str = "auto") -> dict[str, Any]:
    try:
        return engine.engine.describe(model_id, device=device)
    except engine.ModelNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except engine.EngineUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/download", summary="Download a catalog checkpoint")
def download(request: ModelDownloadRequest) -> dict[str, Any]:
    try:
        path = engine.download_checkpoint(request.model)
    except engine.ModelNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except engine.EngineUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "model": request.model,
        "path": str(path),
        "size_bytes": path.stat().st_size if path.exists() else 0,
    }


@router.delete("/cache", summary="Clear the rendered-output cache")
def clear_outputs() -> dict[str, Any]:
    import shutil

    removed = 0
    for directory in (settings.outputs_dir / "predict", settings.outputs_dir / "annotate"):
        if directory.exists():
            removed += sum(1 for _ in directory.rglob("*") if _.is_file())
            with contextlib.suppress(OSError):
                shutil.rmtree(directory, ignore_errors=True)
    return {"removed": removed}
