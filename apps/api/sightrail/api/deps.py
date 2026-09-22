"""Source resolution: turn a :class:`SourceSpec` into something Ultralytics eats.

Supported inputs, in priority order: an inline base64 data URL, an upload id, a
path inside the storage area, a bundled sample asset, a remote URL, or a webcam
index. Media that must exist on disk (videos) is resolved to a path; images are
resolved to a numpy array so Ultralytics never has to guess at encodings.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import ipaddress
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
from fastapi import HTTPException

from ..config import settings
from ..schemas.requests import SourceSpec
from ..services import uploads


def decode_data_url(data_url: str) -> np.ndarray:
    import cv2

    encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
    try:
        raw = base64.b64decode(encoded, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The inline image is not valid base64.") from exc
    buffer: np.ndarray = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="The inline image could not be decoded.")
    return image


def _allowed_source_roots() -> tuple[Path, ...]:
    """Roots a user-supplied path may point at (storage, repo, extra config)."""
    from ..config import REPO_ROOT

    roots = {settings.storage_root, REPO_ROOT}
    for extra in settings.extra_source_roots:
        roots.add(Path(extra).expanduser())
    return tuple(roots)


def _inside_roots(path: Path) -> bool:
    resolved = path.resolve()
    for root in _allowed_source_roots():
        with contextlib.suppress(OSError, ValueError):
            resolved.relative_to(root.resolve())
            return True
    return False


def _resolve_storage_path(path: str, *, allow_directory: bool = False) -> Path | None:
    """Resolve a user-supplied path to a readable file inside the allowed roots."""
    candidate = Path(path).expanduser()
    if (
        candidate.is_absolute()
        and _inside_roots(candidate)
        and (candidate.is_file() or (allow_directory and candidate.is_dir()))
    ):
        return candidate.resolve()

    for root in (settings.storage_root, settings.uploads_dir, settings.media_dir, *(_allowed_source_roots())):
        with contextlib.suppress(OSError):
            direct = root / path
            if not _inside_roots(direct):
                continue
            if direct.is_file() or (allow_directory and direct.is_dir()):
                return direct.resolve()
    return None


def sample_asset(name: str) -> Path:
    """Locate a bundled Ultralytics sample image (bus.jpg, zidane.jpg, ...)."""
    try:
        import ultralytics

        candidate = Path(ultralytics.__file__).parent / "assets" / name
        if candidate.is_file():
            return candidate
    except Exception:
        pass
    raise HTTPException(status_code=404, detail=f"Sample asset '{name}' is not available.")


def list_sample_assets() -> list[dict[str, Any]]:
    try:
        import ultralytics

        assets_dir = Path(ultralytics.__file__).parent / "assets"
    except Exception:  # pragma: no cover
        return []
    if not assets_dir.is_dir():
        return []
    entries = []
    for path in sorted(assets_dir.iterdir()):
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
            entries.append(
                {
                    "name": path.name,
                    "label": path.stem.replace("_", " ").title(),
                    "size_bytes": path.stat().st_size,
                    "url": f"/api/media/samples/{path.name}",
                }
            )
    return entries


def _guard_remote(url: str) -> None:
    """Refuse obviously unsafe remote sources (SSRF hardening)."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only http(s) URLs are supported.")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="The URL is missing a host.")
    if host in {"localhost", "127.0.0.1", "::1"}:
        # Allow localhost only for the app's own media endpoints.
        if not parsed.path.startswith("/api/"):
            raise HTTPException(status_code=400, detail="Local addresses are not allowed as inference sources.")
        return

    try:
        addresses = [ipaddress.ip_address(sockaddr[0]) for *_, sockaddr in socket.getaddrinfo(host, None)]
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Unable to resolve host '{host}'.") from exc

    # Resolve first, then decide: raising inside the lookup's try block would be
    # indistinguishable from a resolution failure to the handler below.
    for address in addresses:
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise HTTPException(status_code=400, detail="Private network addresses are not allowed.")


def fetch_remote(url: str) -> Path:
    """Download a remote image/video into the media cache."""
    import urllib.request

    _guard_remote(url)
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    name = Path(urlparse(url).path).name or "remote"
    target = settings.media_dir / name
    if not target.is_file():
        try:
            with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 - scheme checked above
                target.write_bytes(response.read())
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to download '{url}': {exc}") from exc
    return target


def _local_api_url(spec_url: str) -> Path:
    """Map a self-referential /api/media or /api/uploads URL to a local path."""
    suffix = spec_url.split("/api/", 1)[-1]
    relative = suffix.split("/", 1)[-1]
    resolved = _resolve_storage_path(relative)
    if resolved is None:
        raise HTTPException(status_code=404, detail=f"Media '{relative}' was not found.")
    return resolved


def resolve_to_path(spec: SourceSpec, *, allow_directory: bool = False) -> Path | int:
    """Resolve a spec to a filesystem path or a webcam index."""
    if spec.camera is not None:
        return int(spec.camera)
    if spec.sample:
        return sample_asset(spec.sample)
    if spec.path:
        resolved = _resolve_storage_path(spec.path, allow_directory=allow_directory)
        if resolved is None:
            raise HTTPException(status_code=404, detail=f"Source path '{spec.path}' was not found.")
        return resolved
    if spec.upload_id:
        entry = uploads.get_upload(spec.upload_id)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Upload '{spec.upload_id}' was not found.")
        return Path(str(entry["path"]))
    if spec.url:
        if spec.url.startswith("/api/"):
            return _local_api_url(spec.url)
        return fetch_remote(spec.url)
    if spec.data_url:
        raise HTTPException(status_code=400, detail="Inline image data cannot be used where a path is required.")
    raise HTTPException(status_code=400, detail="No inference source was provided.")


def resolve_to_image(spec: SourceSpec) -> np.ndarray:
    """Resolve a spec to a BGR numpy image."""
    return resolve_image(spec).array


@dataclass
class ResolvedImage:
    """An image plus a stable name for the rendered artefact."""

    array: np.ndarray
    name: str


def resolve_image(spec: SourceSpec) -> ResolvedImage:
    """Resolve a spec into an in-memory image and a descriptive name.

    Ultralytics labels array sources ``image0.jpg``; carrying the real filename
    through means rendered outputs keep a recognisable name.
    """
    import cv2

    if spec.data_url:
        return ResolvedImage(array=decode_data_url(spec.data_url), name="inline")

    path = resolve_to_path(spec)
    if isinstance(path, int):
        raise HTTPException(status_code=400, detail="A webcam cannot be used as a single-image source.")
    image = cv2.imread(str(path))
    if image is None:
        raise HTTPException(status_code=415, detail=f"'{path.name}' is not a readable image.")
    return ResolvedImage(array=image, name=path.stem or "image")


def resolve_many(spec: SourceSpec, limit: int | None = None) -> list[Path]:
    """Resolve a spec into a list of image paths (for batch inference)."""
    cap = limit or settings.max_batch_size
    if spec.data_url:
        raise HTTPException(status_code=400, detail="Batch inference does not accept inline image data.")
    if spec.upload_id:
        entry = uploads.get_upload(spec.upload_id)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Upload '{spec.upload_id}' was not found.")
        path = Path(str(entry["path"]))
        if path.is_dir():
            return sorted(p for p in path.rglob("*") if p.suffix.lower() in uploads.IMAGE_SUFFIXES)[:cap]
        return [path]

    resolved = resolve_to_path(spec, allow_directory=True)
    if isinstance(resolved, int):
        raise HTTPException(status_code=400, detail="A webcam cannot be used for batch inference.")
    path = resolved

    if path.is_dir():
        files = sorted(p for p in path.rglob("*") if p.suffix.lower() in uploads.IMAGE_SUFFIXES)
        if not files:
            raise HTTPException(status_code=404, detail=f"No images found in '{path}'.")
        return files[:cap]
    if path.suffix.lower() == ".txt":
        # A manifest of paths, one per line.
        listed = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        from_manifest = [item for item in (_resolve_storage_path(line) for line in listed) if item is not None]
        if not from_manifest:
            raise HTTPException(status_code=404, detail="The manifest contained no readable images.")
        return from_manifest[:cap]

    return [path]
