"""Upload store endpoints: drop images/videos in, list them, reuse them."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..services import uploads

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.get("", summary="List stored uploads")
def list_uploads(kind: str | None = None, limit: int = 200) -> dict[str, Any]:
    return {"uploads": uploads.list_uploads(limit=limit, kind=kind)}


@router.post("", summary="Upload a single file")
async def create_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    record = uploads.save_upload(file)
    return record.as_dict()


@router.post("/batch", summary="Upload many files at once")
async def create_uploads(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="No files were submitted.")
    saved = [uploads.save_upload(item).as_dict() for item in files]
    return {"uploads": saved, "count": len(saved)}


@router.get("/{upload_id}", summary="Upload metadata")
def get_upload(upload_id: str) -> dict[str, Any]:
    entry = uploads.get_upload(upload_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Upload '{upload_id}' was not found.")
    return entry


@router.delete("/{upload_id}", summary="Delete an upload")
def delete_upload(upload_id: str) -> dict[str, Any]:
    if not uploads.delete_upload(upload_id):
        raise HTTPException(status_code=404, detail=f"Upload '{upload_id}' was not found.")
    return {"deleted": upload_id}


@router.post("/{upload_id}/extract", summary="Expand a ZIP of images into the store")
def extract(upload_id: str) -> dict[str, Any]:
    extracted = uploads.extract_archive(upload_id)
    return {"extracted": extracted, "count": len(extracted)}


@router.delete("", summary="Delete every upload")
def clear() -> dict[str, Any]:
    return {"removed": uploads.clear_uploads()}
