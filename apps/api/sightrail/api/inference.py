"""Predict mode: single-image and batch inference over every task family."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..core import engine
from ..core.hailo import HailoError
from ..schemas.requests import BatchInferRequest, InferRequest
from ..services import uploads

router = APIRouter(tags=["inference"])


def _engine_error(exc: Exception) -> HTTPException:
    """Map a domain error onto an HTTP status with a readable message.

    Hailo errors carry their own actionable hint and are reported without the
    exception class name, since they are configuration guidance rather than bugs.
    """
    if isinstance(exc, engine.ModelNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, engine.EngineUnavailable):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, HailoError):
        detail = f"Hailo: {exc}" if not str(exc).lower().startswith("hailo") else str(exc)
        if exc.hint:
            detail = f"{detail} {exc.hint}"
        return HTTPException(status_code=400, detail=detail)
    return HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}")


@router.post("/infer", summary="Run predict mode on a single image")
def infer(request: InferRequest) -> dict[str, Any]:
    from .deps import resolve_image

    options = request.options
    started = time.perf_counter()
    try:
        resolved = resolve_image(request.source)
        image = resolved.array
        results = engine.engine.predict(
            request.model,
            image,
            task=request.task.value if request.task else None,
            device=options.device,
            conf=options.conf,
            iou=options.iou,
            imgsz=options.imgsz,
            max_det=options.max_det,
            classes=options.classes,
            augment=options.augment,
            agnostic_nms=options.agnostic_nms,
            retina_masks=options.retina_masks,
            half=options.half,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _engine_error(exc) from exc

    result = results[0] if isinstance(results, list) else results
    if result is None:
        raise HTTPException(status_code=500, detail="The engine returned no result for this source.")

    rendered_dir = settings.outputs_dir / "predict"
    try:
        response = engine.engine.to_response(
            result,
            model_id=request.model,
            device=options.device,
            rendered_dir=rendered_dir,
            save_rendered=options.save_rendered,
            mask_limit=options.mask_limit,
            name_hint=resolved.name,
        )
    except Exception as exc:
        raise _engine_error(exc) from exc

    payload = response.model_dump(mode="json")
    payload["stats"]["total_ms"] = round((time.perf_counter() - started) * 1000, 2)
    payload["stats"]["image_shape"] = list(getattr(image, "shape", [])[:2])
    return payload


@router.post("/infer/batch", summary="Run predict mode over many images")
def infer_batch(request: BatchInferRequest) -> dict[str, Any]:
    from .deps import resolve_many

    options = request.options
    started = time.perf_counter()
    paths = resolve_many(request.source, limit=settings.max_batch_size)

    items: list[dict[str, Any]] = []
    histogram: dict[str, int] = {}
    latencies: list[float] = []
    failures = 0

    for path in paths:
        item_started = time.perf_counter()
        try:
            results = engine.engine.predict(
                request.model,
                str(path),
                task=request.task.value if request.task else None,
                device=options.device,
                conf=options.conf,
                iou=options.iou,
                imgsz=options.imgsz,
                max_det=options.max_det,
                classes=options.classes,
                augment=options.augment,
                agnostic_nms=options.agnostic_nms,
                retina_masks=options.retina_masks,
            )
            result = results[0] if isinstance(results, list) else results
            if result is None:
                raise RuntimeError("the engine returned no result for this file")
            response = engine.engine.to_response(
                result,
                model_id=request.model,
                device=options.device,
                rendered_dir=settings.outputs_dir / "predict",
                save_rendered=options.save_rendered,
                mask_limit=options.mask_limit,
            )
            payload = response.results[0].model_dump(mode="json")
            from ..core.serialize import class_histogram
            from ..schemas.results import ResultPayload

            for name, count in class_histogram(ResultPayload(**payload)).items():
                histogram[name] = histogram.get(name, 0) + count
            elapsed = round((time.perf_counter() - item_started) * 1000, 2)
            latencies.append(elapsed)
            items.append({"path": str(path), "name": path.name, "elapsed_ms": elapsed, "result": payload})
        except Exception as exc:
            failures += 1
            items.append({"path": str(path), "name": path.name, "error": f"{type(exc).__name__}: {exc}"})

    total_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "model": request.model,
        "count": len(items),
        "failures": failures,
        "items": items,
        "histogram": dict(sorted(histogram.items(), key=lambda kv: -kv[1])),
        "stats": {
            "total_ms": total_ms,
            "avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
            "min_ms": round(min(latencies), 2) if latencies else None,
            "max_ms": round(max(latencies), 2) if latencies else None,
            "throughput_fps": round(1000 * len(latencies) / total_ms, 2) if total_ms and latencies else None,
            "device": options.device,
        },
    }


@router.get("/infer/defaults", summary="Default inference options")
def defaults() -> dict[str, Any]:
    return {
        "model": settings.default_model,
        "conf": settings.default_confidence,
        "iou": settings.default_iou,
        "imgsz": settings.default_imgsz,
        "max_det": 300,
        "device": settings.device,
        "max_batch_size": settings.max_batch_size,
    }


@router.get("/infer/uploads", summary="Images available for batch inference")
def batch_sources() -> dict[str, Any]:
    return {"images": uploads.list_uploads(limit=200, kind="image")}
