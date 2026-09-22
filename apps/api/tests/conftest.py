"""Shared pytest fixtures.

The suite is split into two tiers:

* **unit / API tests** - always run, no model weights required;
* **engine tests** - marked ``@pytest.mark.integration`` and skipped when
  ``ultralytics`` is not importable (see ``pyproject.toml``).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


@pytest.fixture(scope="session")
def engine_available() -> bool:
    from sightrail.core.engine import Engine

    return Engine.available()


@pytest.fixture
def client():
    """A FastAPI test client bound to the real application."""
    from fastapi.testclient import TestClient

    from sightrail.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_image_path() -> Path:
    """Path to a bundled Ultralytics sample image (bus.jpg)."""
    import ultralytics

    candidate = Path(ultralytics.__file__).parent / "assets" / "bus.jpg"
    if not candidate.is_file():  # pragma: no cover - depends on install
        pytest.skip("Ultralytics sample assets are unavailable.")
    return candidate


@pytest.fixture
def synthetic_frame():
    """A deterministic BGR frame with a bright rectangle the detector may find."""
    import numpy as np

    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    frame[:] = (32, 32, 48)
    frame[80:180, 100:220] = (200, 220, 240)
    return frame
