"""Sightrail - backend service package.

The package is organised in four layers:

``sightrail.core``
    Pure-Python domain layer: settings, device selection, model registry,
    inference engine, job orchestration, video/webcam pipelines.
``sightrail.schemas``
    Pydantic contracts shared by the HTTP layer and the domain layer.
``sightrail.api``
    FastAPI routers - thin adapters that translate HTTP into core calls.
``sightrail.main``
    Application factory, middleware, lifespan wiring and exception handlers.
"""

from __future__ import annotations

__all__ = ["PROJECT_NAME", "__version__"]

__version__ = "1.3.0"
PROJECT_NAME = "Sightrail"
