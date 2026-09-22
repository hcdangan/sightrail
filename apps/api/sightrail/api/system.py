"""System information endpoints: environment, devices, memory, overview."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import PROJECT_NAME, __version__
from ..config import settings
from ..core import catalog, datasets, device, engine, jobs
from ..schemas.base import APIModel
from ..services.uploads import list_uploads

router = APIRouter(tags=["system"])


class HealthResponse(APIModel):
    status: str
    version: str
    engine_available: bool
    storage_root: str


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        engine_available=engine.Engine.available(),
        storage_root=str(settings.storage_root),
    )


@router.get("/system/env", summary="Environment snapshot")
def environment() -> dict[str, Any]:
    return {
        "app": {"name": PROJECT_NAME, "version": __version__},
        **device.environment_info(),
        "storage": {
            "root": str(settings.storage_root),
            "uploads_mb": _dir_size_mb(settings.uploads_dir),
            "outputs_mb": _dir_size_mb(settings.outputs_dir),
            "weights_mb": _dir_size_mb(settings.weights_dir),
            "runs_mb": _dir_size_mb(settings.runs_dir),
            "datasets_mb": _dir_size_mb(settings.datasets_dir),
        },
        "features": {
            "allow_dataset_downloads": settings.allow_dataset_downloads,
            "allow_heavy_export": settings.allow_heavy_export,
            "max_concurrent_jobs": settings.max_concurrent_jobs,
        },
    }


@router.get("/system/devices", summary="Selectable compute devices")
def devices() -> dict[str, Any]:
    return {"devices": device.list_devices()}


@router.get("/system/device-config", summary="Device switch configuration")
def device_config() -> dict[str, Any]:
    """Everything needed to render the device switch: the profiles, the live
    Hailo state, and a copy-pasteable ``.env`` snippet."""
    from ..core.hailo import describe_hailo_state

    return {**device.device_config(), "hailo_state": describe_hailo_state()}


@router.get("/system/hailo", summary="Hailo accelerator readiness")
def hailo_status() -> dict[str, Any]:
    from ..core.hailo import describe_hailo_state

    return describe_hailo_state()


@router.get("/system/memory", summary="Live memory usage")
def memory() -> dict[str, Any]:
    return device.memory_snapshot()


@router.get("/system/overview", summary="Dashboard aggregate")
def overview() -> dict[str, Any]:
    """Everything the dashboard needs, in one round trip."""
    uploads = list_uploads(limit=200)
    all_jobs = jobs.job_store.list_jobs(limit=40)
    local = engine.local_checkpoints()
    runs = list_runs()
    env = device.environment_info()

    task_counts: dict[str, int] = {}
    for entry in catalog.list_catalog():
        task_counts[entry["task"]] = task_counts.get(entry["task"], 0) + 1

    return {
        "version": __version__,
        "engine_available": engine.Engine.available(),
        "device": device.resolve_device(settings.device),
        "device_configured": settings.device,
        "devices": device.list_devices(),
        "hailo": env["hailo"],
        "torch": env["torch"],
        "ultralytics": env["ultralytics"],
        "catalog": {
            "models": len(catalog.list_catalog()),
            "by_task": task_counts,
            "defaults": catalog.DEFAULT_MODELS,
        },
        "datasets": len(datasets.list_datasets()),
        "uploads": {"count": len(uploads), "recent": uploads[:6]},
        "checkpoints": {"count": len(local), "recent": local[:6]},
        "jobs": {
            "active": [job.summary().model_dump() for job in jobs.job_store.active()],
            "recent": [job.summary().model_dump(mode="json") for job in all_jobs[:8]],
        },
        "runs": runs[:6],
        "memory": device.memory_snapshot(),
        "storage": {
            "root": str(settings.storage_root),
            "uploads_mb": _dir_size_mb(settings.uploads_dir),
            "outputs_mb": _dir_size_mb(settings.outputs_dir),
            "weights_mb": _dir_size_mb(settings.weights_dir),
            "runs_mb": _dir_size_mb(settings.runs_dir),
            "datasets_mb": _dir_size_mb(settings.datasets_dir),
        },
        "loaded_models": engine.engine.registry.loaded(),
    }


@router.get("/system/runs", summary="Training/validation/export run history")
def list_runs() -> list[dict[str, Any]]:
    """Enumerate run directories produced by every mode."""
    runs: list[dict[str, Any]] = []
    for kind in ("train", "val", "export", "benchmark", "predict", "track", "video"):
        base = settings.runs_dir / kind
        if not base.exists():
            continue
        for directory in sorted(base.iterdir(), reverse=True):
            if not directory.is_dir():
                continue
            weights = sorted(directory.rglob("*.pt"))
            runs.append(
                {
                    "id": f"{kind}/{directory.name}",
                    "mode": kind,
                    "name": directory.name,
                    "path": str(directory),
                    "created_at": directory.stat().st_mtime,
                    "has_weights": bool(weights),
                    "best_weight": str(directory / "weights" / "best.pt")
                    if (directory / "weights" / "best.pt").is_file()
                    else None,
                    "images": [f"/api/media/runs/{p.name}" for p in sorted(directory.glob("*.png"))[:8] if p.is_file()],
                }
            )
    runs.sort(key=lambda item: item["created_at"], reverse=True)
    return runs


def _dir_size_mb(directory: Any) -> float:
    from pathlib import Path

    root = Path(directory)
    if not root.exists():
        return 0.0
    total = sum(path.stat().st_size for path in root.rglob("*") if path.is_file())
    return round(total / (1024 * 1024), 2)
