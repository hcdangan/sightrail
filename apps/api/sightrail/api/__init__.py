"""HTTP API package: routers plus the aggregating ``api_router``."""

from __future__ import annotations

from fastapi import APIRouter

from . import inference, jobs, media, models, modes, realtime, streams, system, uploads_api

api_router = APIRouter(prefix="/api")
api_router.include_router(system.router)
api_router.include_router(models.router)
api_router.include_router(inference.router)
api_router.include_router(modes.router)
api_router.include_router(streams.router)
api_router.include_router(jobs.router)
api_router.include_router(uploads_api.router)
api_router.include_router(media.router)
api_router.include_router(realtime.router)

__all__ = ["api_router"]
