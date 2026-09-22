"""Job management: submit long-running modes, poll them, cancel them."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..core.jobs import job_store
from ..schemas.base import JobDetail, JobKind, JobSummary
from ..services import runners

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[JobSummary], summary="List jobs")
def list_jobs(
    kind: JobKind | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[JobSummary]:
    return [job.summary() for job in job_store.list_jobs(kind=kind, limit=limit)]


@router.get("/active", response_model=list[JobSummary], summary="Currently queued or running jobs")
def active_jobs() -> list[JobSummary]:
    return [job.summary() for job in job_store.active()]


@router.get("/{job_id}", response_model=JobDetail, summary="Full job detail with log buffer")
def get_job(job_id: str) -> JobDetail:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' was not found.")
    return job.detail()


@router.post("/{job_id}/cancel", response_model=JobSummary, summary="Request cancellation")
def cancel_job(job_id: str) -> JobSummary:
    job = runners.cancel_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' was not found.")
    return job.summary()


@router.delete("/finished", summary="Drop finished jobs from the store")
def clear_finished() -> dict[str, Any]:
    return {"removed": job_store.clear_finished()}
