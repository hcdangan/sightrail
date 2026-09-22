"""FastAPI application factory.

Run locally with::

    uv run --project apps/api uvicorn sightrail.main:app --reload

The factory wires: CORS for the Vite dev server, structured JSON logging, a
lifespan that prepares storage and warms the default checkpoint, uniform error
envelopes, and the aggregated ``/api`` router.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import PROJECT_NAME, __version__
from .api import api_router
from .config import settings
from .core import engine, jobs
from .core.device import resolve_device

logger = logging.getLogger("sightrail")


def configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s :: %(message)s",
        datefmt="%H:%M:%S",
    )


def sanitize_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make pydantic error dicts JSON serialisable.

    Custom validators embed the original exception in ``ctx['error']``, which
    ``json.dumps`` cannot encode. Replace it with its message so the client still
    sees the reason a payload was rejected.
    """
    cleaned: list[dict[str, Any]] = []
    for error in errors:
        item = dict(error)
        item["loc"] = [str(part) for part in item.get("loc", ())]
        context = item.get("ctx")
        if isinstance(context, dict):
            item["ctx"] = {
                key: (str(value) if isinstance(value, BaseException) else value) for key, value in context.items()
            }
        cleaned.append(item)
    return cleaned


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare storage and report engine readiness on boot."""
    configure_logging()
    settings.ensure_dirs()
    logger.info("%s v%s starting", PROJECT_NAME, __version__)
    logger.info("storage root: %s", settings.storage_root)

    if engine.Engine.available():
        logger.info("ultralytics engine ready (device: %s)", resolve_device(settings.device))
    else:
        logger.warning("ultralytics engine unavailable - install apps/api/requirements.txt to enable inference")

    # Persist the OpenAPI schema so the frontend can be developed offline.
    try:
        schema_path = settings.storage_root / "openapi.json"
        import json

        schema_path.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
    except Exception as exc:  # pragma: no cover - non critical
        logger.debug("Could not persist the OpenAPI schema: %s", exc)

    yield

    engine.engine.shutdown()
    jobs.job_store.shutdown()
    logger.info("%s shutting down", PROJECT_NAME)


def create_app() -> FastAPI:
    app = FastAPI(
        title=PROJECT_NAME,
        version=__version__,
        description=(
            "REST + WebSocket API that exposes every Ultralytics YOLO mode (predict, track, "
            "train, val, export, benchmark) across all five task families (detect, segment, "
            "classify, pose, obb), plus the built-in solutions library."
        ),
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.middleware("http")
    async def add_timing_header(request: Request, call_next: Any) -> Any:
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "validation_error",
                "detail": "The request body failed validation.",
                "issues": sanitize_validation_errors(exc.errors()),
                "path": str(request.url.path),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        logger.exception("Unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "detail": f"{type(exc).__name__}: {exc}",
                "path": str(request.url.path),
            },
        )

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, Any]:
        return {
            "name": PROJECT_NAME,
            "version": __version__,
            "docs": "/api/docs",
            "api": "/api",
            "engine_available": engine.Engine.available(),
        }

    return app


app = create_app()
