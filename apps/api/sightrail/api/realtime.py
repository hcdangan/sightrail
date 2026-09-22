"""WebSocket endpoints: live job consoles and client-driven camera inference.

Two channels are exposed:

``/api/ws/jobs/{job_id}``
    Replays the buffered log then streams every new job event (progress, metrics,
    warnings, status changes) until the job settles.

``/api/ws/live``
    The browser pushes camera frames and receives detection geometry plus live
    solution counters. The first message must be a ``config`` frame.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core import jobs as jobs_core
from ..core.serialize import serialise_names
from ..core.streaming import LiveSession, StreamConfig, decode_base64_frame

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/jobs/{job_id}")
async def job_socket(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    job = jobs_core.job_store.get(job_id)
    if job is None:
        await websocket.send_json({"type": "error", "message": f"Job '{job_id}' was not found."})
        await websocket.close(code=4404)
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)

    def on_event(event: Any) -> None:
        payload = event.model_dump(mode="json")
        with contextlib.suppress(asyncio.QueueFull, RuntimeError):
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "event", "event": payload})

    # Replay the buffer first so a late subscriber sees the whole run.
    for buffered in list(job.log):
        await websocket.send_json({"type": "event", "event": buffered.model_dump(mode="json"), "replay": True})
    await websocket.send_json({"type": "snapshot", "job": job.detail().model_dump(mode="json")})

    job.subscribe(on_event)
    try:
        while True:
            if job.status in {"succeeded", "failed", "cancelled"} and queue.empty():
                await websocket.send_json({"type": "done", "job": job.detail().model_dump(mode="json")})
                break
            try:
                message = await asyncio.wait_for(queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                # Keepalive doubles as a terminal-status check.
                await websocket.send_json({"type": "ping", "status": job.status.value, "percent": job.percent})
                continue
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        job.unsubscribe(on_event)
        with contextlib.suppress(RuntimeError):
            await websocket.close()


@router.websocket("/ws/live")
async def live_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    session: LiveSession | None = None
    lock = threading.Lock()

    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")

            if kind == "config":
                if session is not None:
                    session.release()
                config_payload = message.get("config") or {}
                try:
                    config = StreamConfig(
                        model_id=str(config_payload.get("model", "yolo11n.pt")),
                        task=config_payload.get("task"),
                        device=config_payload.get("device", "auto"),
                        tracker=config_payload.get("tracker", "bytetrack.yaml"),
                        conf=config_payload.get("conf"),
                        iou=config_payload.get("iou"),
                        imgsz=config_payload.get("imgsz"),
                        classes=config_payload.get("classes"),
                        solution=str(config_payload.get("solution", "none")),
                        solution_kwargs=config_payload.get("solution_kwargs") or {},
                        region=config_payload.get("region"),
                        region_kind=config_payload.get("region_kind"),
                        show_boxes=bool(config_payload.get("show_boxes", True)),
                        jpeg_quality=int(config_payload.get("jpeg_quality", 80)),
                    )
                    session = LiveSession(config)
                except Exception as exc:
                    session = None
                    await websocket.send_json({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
                    continue
                await websocket.send_json(
                    {
                        "type": "ready",
                        "session": session.id,
                        "model": str(getattr(session.model, "path", config.model_id)),
                        "names": serialise_names(getattr(session.model, "names", None)),
                    }
                )
                continue

            if kind == "frame":
                if session is None:
                    await websocket.send_json({"type": "error", "message": "Send a config frame first."})
                    continue
                data = message.get("data") or ""
                try:
                    frame = decode_base64_frame(data)
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)})
                    continue
                loop = asyncio.get_running_loop()
                # Bind the frame and session explicitly so the worker closure
                # cannot observe a later loop iteration's values.
                active, current = session, frame

                def _run(handler: LiveSession = active, image: Any = current) -> dict[str, Any]:
                    with lock:
                        return handler.handle(image)

                try:
                    result = await loop.run_in_executor(None, _run)
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
                    continue
                result["type"] = "result"
                await websocket.send_json(result)
                continue

            if kind == "reset":
                if session is not None:
                    from ..core.engine import engine

                    engine.release_session(session.id)
                await websocket.send_json({"type": "reset"})
                continue

            if kind == "stop":
                break

            await websocket.send_json({"type": "error", "message": f"Unknown message type '{kind}'."})
    except WebSocketDisconnect:
        pass
    finally:
        if session is not None:
            session.release()
        with contextlib.suppress(RuntimeError):
            await websocket.close()
