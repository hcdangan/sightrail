"""Domain layer: everything that touches Ultralytics, storage or the GPU.

Routers must not import ``ultralytics`` directly - they go through this package
so that the engine stays swappable and testable.
"""

from __future__ import annotations

from . import catalog, datasets, device, engine, jobs, metrics, models_meta, serialize, streaming

__all__ = [
    "catalog",
    "datasets",
    "device",
    "engine",
    "jobs",
    "metrics",
    "models_meta",
    "serialize",
    "streaming",
]
