"""Shared schema primitives: tasks, devices, jobs, pagination."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TaskName(str, Enum):
    """The five Ultralytics task families."""

    DETECT = "detect"
    SEGMENT = "segment"
    CLASSIFY = "classify"
    POSE = "pose"
    OBB = "obb"


class ModeName(str, Enum):
    """The six Ultralytics execution modes."""

    PREDICT = "predict"
    TRACK = "track"
    TRAIN = "train"
    VAL = "val"
    EXPORT = "export"
    BENCHMARK = "benchmark"


class DeviceName(str, Enum):
    AUTO = "auto"
    CPU = "cpu"
    CUDA = "cuda"
    MPS = "mps"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobKind(str, Enum):
    TRAIN = "train"
    VAL = "val"
    EXPORT = "export"
    BENCHMARK = "benchmark"
    ANNOTATE = "annotate"
    VIDEO = "video"
    PREPARE_DATASET = "prepare_dataset"


class APIModel(BaseModel):
    """Base model: immutable-ish, strict on extra fields, JSON friendly."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, protected_namespaces=())


class Message(APIModel):
    message: str
    detail: str | None = None


class JobProgress(APIModel):
    """A single progress/log event streamed over WebSocket or polled."""

    seq: int = 0
    kind: Literal["log", "progress", "metric", "result", "status"] = "log"
    message: str = ""
    percent: float | None = None
    level: Literal["debug", "info", "warning", "error"] = "info"
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Artifact(APIModel):
    """A file produced by a job and downloadable from the UI."""

    name: str
    path: str
    url: str
    kind: Literal["image", "video", "model", "csv", "yaml", "json", "text", "other"] = "other"
    size_bytes: int = 0


class JobSummary(APIModel):
    id: str
    kind: JobKind
    status: JobStatus
    title: str
    params: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_s: float | None = None
    percent: float = 0.0
    message: str = ""
    error: str | None = None
    result: dict[str, Any] | None = None
    artifacts: list[Artifact] = Field(default_factory=list)
    metrics: dict[str, list[Any]] = Field(default_factory=dict)


class JobDetail(JobSummary):
    log: list[JobProgress] = Field(default_factory=list)
