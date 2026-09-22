"""Static media delivery for uploads, rendered outputs, run artifacts, samples.

Only files inside the configured storage root (plus the bundled Ultralytics
sample assets) are reachable, and every path is resolved before it is served so
``..`` traversal cannot escape the sandbox.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import settings

router = APIRouter(prefix="/media", tags=["media"])

#: category -> directories that may serve it, searched in order.
CATEGORY_ROOTS: dict[str, list[Path]] = {
    "uploads": [settings.uploads_dir],
    "outputs": [settings.outputs_dir],
    "runs": [settings.runs_dir],
    "weights": [settings.weights_dir],
    "datasets": [settings.datasets_dir],
    "media": [settings.media_dir],
    "jobs": [settings.jobs_dir],
}


def _samples_dir() -> Path | None:
    try:
        import ultralytics

        candidate = Path(ultralytics.__file__).parent / "assets"
        return candidate if candidate.is_dir() else None
    except Exception:  # pragma: no cover - engine optional
        return None


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _locate(category: str, filename: str) -> Path:
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Nested media paths are not supported.")

    roots = list(CATEGORY_ROOTS.get(category, []))
    if category == "samples" and (samples := _samples_dir()) is not None:
        roots = [samples]

    for root in roots:
        if not root.exists():
            continue
        direct = root / filename
        if direct.is_file() and _is_within(direct, root):
            return direct
        # Run directories nest their plots; search one level down as a convenience.
        for nested in root.rglob(filename):
            if nested.is_file() and _is_within(nested, root):
                return nested
    raise HTTPException(status_code=404, detail=f"Media '{filename}' was not found in '{category}'.")


@router.get("/samples", summary="Bundled sample images")
def samples() -> dict[str, object]:
    from .deps import list_sample_assets

    return {"samples": list_sample_assets()}


@router.get("/{category}/{filename}", summary="Serve a stored media file")
def serve(category: str, filename: str) -> FileResponse:
    if category not in CATEGORY_ROOTS and category != "samples":
        raise HTTPException(status_code=404, detail=f"Unknown media category '{category}'.")
    path = _locate(category, filename)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=3600"})
