"""Runtime configuration for Sightrail.

All configuration is environment driven (12-factor style) and validated by
pydantic-settings. Defaults are chosen so that a fresh checkout works with a
single ``npm run dev`` and no ``.env`` file.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# apps/api/sightrail/config.py -> repository root is parents[3]
PACKAGE_DIR = Path(__file__).resolve().parent
API_DIR = PACKAGE_DIR.parent
REPO_ROOT = API_DIR.parent.parent


class Settings(BaseSettings):
    """Application settings, overridable via environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="SIGHTRAIL_",
        env_file=(REPO_ROOT / ".env", API_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Server -----------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = False
    log_level: str = "info"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ]
    )

    # --- Storage ----------------------------------------------------------
    storage_root: Path = Field(default=REPO_ROOT / "storage")

    # --- Inference --------------------------------------------------------
    default_model: str = "yolo11n.pt"
    #: Compute device. This is the one setting most deployments change.
    #:
    #:   ``auto``    CUDA -> MPS -> Hailo -> CPU (first available)
    #:   ``cpu``     always works, slowest
    #:   ``cuda:0``  NVIDIA GPU (needs a CUDA build of PyTorch)
    #:   ``mps``     Apple Silicon GPU
    #:   ``hailo``   Hailo-8/8L/10H/15H accelerator through HailoRT
    #:
    #: Set it with ``SIGHTRAIL_DEVICE`` in ``.env`` (see ``.env.example``);
    #: ``SIGHTRAIL_DEFAULT_DEVICE`` is accepted as a legacy alias.
    device: str = Field(
        default="auto",
        validation_alias=AliasChoices("SIGHTRAIL_DEVICE", "SIGHTRAIL_DEFAULT_DEVICE", "device"),
    )
    default_confidence: float = 0.25
    default_iou: float = 0.7
    default_imgsz: int = 640
    max_upload_mb: int = 512
    max_batch_size: int = 32
    #: Cap on how many models stay resident in the in-process cache.
    model_cache_size: int = 6

    # --- Hailo accelerator ------------------------------------------------
    #: Path to a HEF file or a ``*_hailo_model`` directory. Empty means
    #: "auto-discover the first HEF under storage/weights".
    hailo_model: str | None = None
    #: Target architecture when exporting to HEF.
    hailo_arch: str = "hailo8l"
    #: Interpreter that has the Hailo Dataflow Compiler installed, used for
    #: ``format=hailo`` exports. Empty means "use the current interpreter".
    hailo_dfc_python: str | None = None

    # --- Jobs -------------------------------------------------------------
    #: Maximum number of heavy jobs (train/val/export/benchmark) running at once.
    max_concurrent_jobs: int = 1
    #: Number of log lines retained per job for the live console.
    job_log_buffer: int = 2000
    #: Finished jobs are retained for this many seconds before eviction.
    job_retention_seconds: int = 3600

    # --- Webcam / streaming ----------------------------------------------
    webcam_scan_indexes: int = 4
    stream_jpeg_quality: int = 80
    stream_target_fps: int = 30

    # --- Feature flags ----------------------------------------------------
    #: Allow the UI to trigger `pip install` style dataset auto-downloads.
    allow_dataset_downloads: bool = True
    #: Allow the export of heavyweight formats (engine/tflite/...).
    allow_heavy_export: bool = True
    #: Extra directories the API may read inference sources from, in addition to
    #: the storage root and the repository root. Comma-separated when set via env.
    extra_source_roots: list[str] = Field(default_factory=list)

    # ------------------------------------------------------------------
    # Validators / derived values
    # ------------------------------------------------------------------
    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("extra_source_roots", mode="before")
    @classmethod
    def _split_roots(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("device", mode="before")
    @classmethod
    def _normalise_device(cls, value: object) -> object:
        """Treat empty/whitespace device values as ``auto``."""
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or "auto"
        return value

    @field_validator("hailo_model", "hailo_dfc_python", mode="before")
    @classmethod
    def _empty_to_none(cls, value: object) -> object:
        """``.env`` cannot express ``null``; an empty string means unset."""
        if isinstance(value, str):
            cleaned = value.strip()
            return cleaned or None
        return value

    @field_validator("storage_root", mode="before")
    @classmethod
    def _expand(cls, value: object) -> object:
        if isinstance(value, str):
            return Path(os.path.expandvars(value)).expanduser()
        return value

    # Derived directories ---------------------------------------------------
    @property
    def uploads_dir(self) -> Path:
        return self.storage_root / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.storage_root / "outputs"

    @property
    def weights_dir(self) -> Path:
        return self.storage_root / "weights"

    @property
    def runs_dir(self) -> Path:
        return self.storage_root / "runs"

    @property
    def datasets_dir(self) -> Path:
        return self.storage_root / "datasets"

    @property
    def jobs_dir(self) -> Path:
        return self.storage_root / "jobs"

    @property
    def media_dir(self) -> Path:
        return self.storage_root / "media"

    def all_dirs(self) -> list[Path]:
        """Every directory the service may write to."""
        return [
            self.storage_root,
            self.uploads_dir,
            self.outputs_dir,
            self.weights_dir,
            self.runs_dir,
            self.datasets_dir,
            self.jobs_dir,
            self.media_dir,
        ]

    def ensure_dirs(self) -> None:
        for directory in self.all_dirs():
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor (safe to call from request handlers)."""
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
