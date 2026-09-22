"""Track mode and live streaming: MJPEG, webcam discovery, video analysis."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..core import engine, streaming
from ..core.serialize import serialise_names
from ..schemas.base import JobKind, JobSummary
from ..schemas.requests import StreamStartRequest, TrackRequest, VideoAnalysisRequest

router = APIRouter(prefix="/stream", tags=["streaming"])

#: Live sessions keyed by their id (process-wide; cleared on stop).
_sessions: dict[str, streaming.StreamSession] = {}


@router.get("/solutions", summary="Built-in solutions and their options")
def solutions() -> dict[str, Any]:
    return {"solutions": streaming.list_solutions()}


@router.get("/cameras", summary="Webcams detected on this machine")
def cameras(scan: bool = Query(default=True, description="Probe the first few capture indexes")) -> dict[str, Any]:
    if not scan:
        return {"cameras": [], "scanned": False}
    try:
        return {"cameras": streaming.available_cameras(), "scanned": True}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Camera probe failed: {exc}") from exc


@router.post("/sessions", summary="Open a live inference session")
def open_session(request: StreamStartRequest) -> dict[str, Any]:
    from .deps import resolve_to_path

    if not engine.Engine.available():
        raise HTTPException(status_code=503, detail="The Ultralytics engine is unavailable.")

    source = resolve_to_path(request.source)
    # A webcam index is a valid source for a live session (unlike batch mode).
    session_source: str | int = source if isinstance(source, int) else str(source)

    config = streaming.StreamConfig(
        model_id=request.model,
        task=request.task.value if request.task else None,
        device=request.device,
        tracker=request.tracker,
        conf=request.conf,
        iou=request.iou,
        imgsz=request.imgsz,
        classes=request.classes,
        solution=request.solution,
        solution_kwargs=request.solution_kwargs,
        region=request.region,
        region_kind=request.region_kind,
        show_boxes=request.show_boxes,
        jpeg_quality=request.jpeg_quality,
    )
    try:
        session = streaming.StreamSession(config, session_source)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc

    _sessions[session.id] = session
    spec = streaming.SOLUTION_BY_ID.get(request.solution, {})
    return {
        "session_id": session.id,
        "mjpeg_url": f"/api/stream/sessions/{session.id}/mjpeg",
        "stats_url": f"/api/stream/sessions/{session.id}/stats",
        "source": str(session_source),
        "solution": request.solution,
        "solution_meta": spec,
        "model": str(getattr(session.model, "path", request.model)),
        "names": serialise_names(getattr(session.model, "names", None)),
    }


@router.get("/sessions", summary="Open sessions")
def list_sessions() -> dict[str, Any]:
    return {"sessions": [session.stats() for session in _sessions.values()]}


@router.get("/sessions/{session_id}/mjpeg", summary="MJPEG stream for a session")
def session_mjpeg(session_id: str) -> StreamingResponse:
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' was not found.")
    return StreamingResponse(
        streaming.mjpeg_frames(session),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store", "Connection": "close"},
    )


@router.get("/sessions/{session_id}/stats", summary="Live session statistics")
def session_stats(session_id: str) -> dict[str, Any]:
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' was not found.")
    return {**session.stats(), "history": list(session.history)}


@router.delete("/sessions/{session_id}", summary="Close a session")
def close_session(session_id: str) -> dict[str, Any]:
    session = _sessions.pop(session_id, None)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' was not found.")
    session.stop()
    session.release()
    return {"closed": session_id}


@router.post("/track", summary="Track mode over a video or image sequence")
def track(request: TrackRequest) -> dict[str, Any]:
    """Run Ultralytics track mode and return the per-frame track history."""
    from .deps import resolve_to_path

    if not engine.Engine.available():
        raise HTTPException(status_code=503, detail="The Ultralytics engine is unavailable.")

    source = resolve_to_path(request.source)

    if request.reset and request.session:
        engine.engine.release_session(request.session)

    session_id = request.session or f"track-{Path(str(source)).stem}"

    frames: list[dict[str, Any]] = []
    histogram: dict[str, int] = {}
    unique_ids: set[int] = set()

    if isinstance(source, int):
        raise HTTPException(status_code=400, detail="Use /api/stream/sessions for webcam tracking.")

    is_video = Path(source).suffix.lower() in {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
    iterator_source: Any = (
        str(source) if is_video else [str(p) for p in sorted(Path(source).parent.glob(f"{Path(source).stem}*"))][:1]
    )

    try:
        generator = engine.engine.track(
            request.model,
            iterator_source,
            tracker=request.tracker,
            device=request.device,
            conf=request.conf,
            iou=request.iou,
            imgsz=request.imgsz,
            classes=request.classes,
            persist=True,
            stream=True,
            session=session_id if is_video else None,
        )
        from ..core.serialize import result_to_payload, serialise_names

        for index, result in enumerate(generator, start=1):
            if index > request.max_frames:
                break
            names = serialise_names(getattr(result, "names", {}))
            payload = result_to_payload(result, names=names, mask_limit=24)
            frame_entry: dict[str, Any] = {
                "frame": index,
                "detections": [
                    {
                        "track_id": item.track_id,
                        "class_id": item.class_id,
                        "class_name": item.class_name,
                        "confidence": item.confidence,
                        "xyxy": [round(v, 1) for v in item.xyxy[:4]],
                    }
                    for source_payload in (payload.detections, payload.obb)
                    if source_payload is not None
                    for item in source_payload.items
                ],
                "speed": payload.speed.model_dump() if payload.speed else None,
            }
            frames.append(frame_entry)
            for detection in frame_entry["detections"]:
                histogram[detection["class_name"]] = histogram.get(detection["class_name"], 0) + 1
                if detection["track_id"] is not None:
                    unique_ids.add(int(detection["track_id"]))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc

    return {
        "session": session_id,
        "model": request.model,
        "tracker": request.tracker,
        "frames": frames,
        "count": len(frames),
        "unique_ids": len(unique_ids),
        "histogram": dict(sorted(histogram.items(), key=lambda kv: -kv[1])),
        "video_rendered": None,
    }


@router.post("/video", response_model=JobSummary, summary="Analyse a whole video into an annotated MP4 (job)")
def analyse_video(request: VideoAnalysisRequest) -> JobSummary:
    """Render every frame of a video through the engine, streaming progress."""
    from .deps import resolve_to_path

    if not engine.Engine.available():
        raise HTTPException(status_code=503, detail="The Ultralytics engine is unavailable.")
    source = resolve_to_path(request.source)
    if isinstance(source, int):
        raise HTTPException(status_code=400, detail="Live video analysis does not accept a camera source.")

    path = Path(source)
    if path.suffix.lower() not in {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}:
        raise HTTPException(status_code=415, detail="Only video files can be analysed frame-by-frame.")

    config = streaming.StreamConfig(
        model_id=request.model,
        task=request.task.value if request.task else None,
        device=request.device,
        tracker=request.tracker,
        conf=request.conf,
        iou=request.iou,
        imgsz=request.imgsz,
        classes=request.classes,
        solution=request.solution,
        solution_kwargs=request.solution_kwargs,
        region=request.region,
        region_kind=request.region_kind,
    )

    def run(job: Any) -> dict[str, Any]:
        session = streaming.StreamSession(config, str(path))
        job.log_line(f"Analysing {path.name} with {request.model}")
        report = streaming.video_jobs_frames(session, path, job)
        from ..core.jobs import artifact_for_path

        output = Path(report["video"])
        artifact = artifact_for_path(output) if output.exists() else None
        if artifact is not None:
            job.artifacts = [artifact]
            report["artifact"] = artifact.model_dump()
        return report

    from ..core.jobs import job_store

    job = job_store.create(JobKind.VIDEO, f"Video analysis {path.name}", request.model_dump(mode="json"))
    job_store.submit(job, run)
    return job.summary()
