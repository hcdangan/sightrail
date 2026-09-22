"""Upload handling: accept images/videos, keep them addressable by the API.

Every upload is stored under ``storage/uploads/<yyyy-mm-dd>/`` together with a
small JSON sidecar so the UI can list and reuse previous uploads across pages
(the Predict, Batch, Stream and Train pages all read from this store).
"""

from __future__ import annotations

import json
import mimetypes
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from ..config import settings


def _media_url(path: Path) -> str:
    """URL served by the media router for a file inside the upload store."""
    return f"/api/media/uploads/{path.name}"


def _is_safe_member(name: str, root: Path) -> bool:
    """True when a zip member would be written inside ``root``.

    Rejects absolute paths, drive-qualified paths and ``..`` traversal, which is
    what makes ``ZipFile.extractall`` unsafe on untrusted input.
    """
    if not name or name.endswith("/"):
        return True  # directory entry, created by extractall inside root
    candidate = Path(name.replace("\\", "/"))
    if candidate.is_absolute() or (len(name) > 1 and name[1] == ":"):
        return False
    try:
        (root / candidate).resolve().relative_to(root)
    except ValueError:
        return False
    return True


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
VIDEO_SUFFIXES = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"}
ARCHIVE_SUFFIXES = {".zip", ".tar", ".gz"}

CHUNK_SIZE = 1024 * 1024


@dataclass
class StoredUpload:
    id: str
    name: str
    path: Path
    kind: str
    size_bytes: int
    content_type: str
    created_at: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "path": str(self.path),
            "kind": self.kind,
            "size_bytes": self.size_bytes,
            "content_type": self.content_type,
            "created_at": self.created_at,
            "url": _media_url(self.path),
        }


def classify(name: str) -> str:
    suffix = Path(name).suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return "image"
    if suffix in VIDEO_SUFFIXES:
        return "video"
    if suffix in ARCHIVE_SUFFIXES:
        return "archive"
    return "other"


def _day_dir() -> Path:
    directory = settings.uploads_dir / time.strftime("%Y-%m-%d")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _sidecar(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".json")


def save_upload(upload: UploadFile, *, expected: str | None = None) -> StoredUpload:
    """Persist an ``UploadFile`` to the upload store."""
    if not upload.filename:
        raise HTTPException(status_code=400, detail="A filename is required.")

    kind = classify(upload.filename)
    if expected and kind != expected:
        raise HTTPException(status_code=415, detail=f"Expected a {expected} file but received '{upload.filename}'.")

    identifier = uuid.uuid4().hex[:12]
    safe_name = Path(upload.filename).name.replace(" ", "_")
    target = _day_dir() / f"{identifier}_{safe_name}"

    size = 0
    limit = settings.max_upload_mb * 1024 * 1024
    with target.open("wb") as handle:
        while chunk := upload.file.read(CHUNK_SIZE):
            size += len(chunk)
            if size > limit:
                handle.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"Upload exceeds the {settings.max_upload_mb} MB limit.")
            handle.write(chunk)

    record = StoredUpload(
        id=identifier,
        name=safe_name,
        path=target,
        kind=kind,
        size_bytes=size,
        content_type=upload.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
        created_at=time.time(),
    )
    _sidecar(target).write_text(json.dumps(record.as_dict(), indent=2), encoding="utf-8")
    return record


def list_uploads(limit: int = 100, kind: str | None = None) -> list[dict[str, Any]]:
    """Every upload currently on disk, newest first."""
    settings.ensure_dirs()
    entries: list[dict[str, Any]] = []
    for path in settings.uploads_dir.rglob("*"):
        if not path.is_file() or path.suffix == ".json":
            continue
        meta_path = _sidecar(path)
        if meta_path.is_file():
            try:
                entries.append(json.loads(meta_path.read_text(encoding="utf-8")))
                continue
            except json.JSONDecodeError:  # pragma: no cover
                pass
        entries.append(
            {
                "id": path.stem.split("_")[0],
                "name": path.name,
                "path": str(path),
                "kind": classify(path.name),
                "size_bytes": path.stat().st_size,
                "content_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                "created_at": path.stat().st_mtime,
                "url": _media_url(path),
            }
        )
    entries.sort(key=lambda item: item.get("created_at", 0), reverse=True)
    if kind:
        entries = [entry for entry in entries if entry.get("kind") == kind]
    return entries[:limit]


def get_upload(upload_id: str) -> dict[str, Any] | None:
    for entry in list_uploads(limit=1000):
        if entry.get("id") == upload_id or Path(str(entry.get("path", ""))).name.startswith(upload_id):
            return entry
    return None


def delete_upload(upload_id: str) -> bool:
    entry = get_upload(upload_id)
    if not entry:
        return False
    path = Path(str(entry["path"]))
    _sidecar(path).unlink(missing_ok=True)
    path.unlink(missing_ok=True)
    return True


def clear_uploads() -> int:
    removed = 0
    for child in settings.uploads_dir.rglob("*"):
        if child.is_file():
            child.unlink(missing_ok=True)
            removed += 1
    for child in sorted(settings.uploads_dir.rglob("*"), reverse=True):
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
    return removed


def extract_archive(upload_id: str) -> list[dict[str, Any]]:
    """Expand an uploaded zip of images and register the contents.

    Every member is resolved and checked against the destination directory
    before extraction: a crafted archive containing ``../`` or absolute paths
    would otherwise write anywhere the API process can reach (Zip Slip).
    """
    import zipfile

    entry = get_upload(upload_id)
    if not entry or classify(str(entry["path"])) != "archive":
        raise HTTPException(status_code=400, detail="Only .zip archives can be expanded.")

    archive_path = Path(str(entry["path"]))
    target_dir = archive_path.parent / f"{archive_path.stem}_extracted"
    target_dir.mkdir(parents=True, exist_ok=True)
    root = target_dir.resolve()

    with zipfile.ZipFile(archive_path) as archive:
        unsafe = [name for name in archive.namelist() if not _is_safe_member(name, root)]
        if unsafe:
            raise HTTPException(
                status_code=400,
                detail=(
                    "The archive contains entries that would be written outside the upload directory "
                    f"and was rejected: {', '.join(sorted(unsafe)[:3])}"
                ),
            )
        archive.extractall(root)

    extracted: list[dict[str, Any]] = []
    for path in sorted(target_dir.rglob("*")):
        if path.is_file() and classify(path.name) == "image":
            record = StoredUpload(
                id=uuid.uuid4().hex[:12],
                name=path.name,
                path=path,
                kind="image",
                size_bytes=path.stat().st_size,
                content_type=mimetypes.guess_type(path.name)[0] or "image/jpeg",
                created_at=time.time(),
            )
            _sidecar(path).write_text(json.dumps(record.as_dict(), indent=2), encoding="utf-8")
            extracted.append(record.as_dict())
    return extracted
