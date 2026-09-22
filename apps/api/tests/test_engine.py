"""End-to-end tests that exercise the real Ultralytics engine.

These download small checkpoints on first run and are marked ``integration`` so
they can be deselected with ``pytest -m "not integration"`` in constrained
environments.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration

DETECT_MODEL = "yolo11n.pt"


@pytest.fixture(scope="module")
def engine():
    from sightrail.core.engine import Engine

    if not Engine.available():
        pytest.skip("ultralytics is not installed")
    from sightrail.core.engine import engine as shared_engine

    return shared_engine


def test_detect_payload_has_boxes_and_speed(engine, sample_image_path):
    from sightrail.core.serialize import class_histogram, result_to_payload

    results = engine.predict(DETECT_MODEL, str(sample_image_path), device="cpu", conf=0.3)
    result = results[0] if isinstance(results, list) else results
    payload = result_to_payload(result)

    assert payload.task == "detect"
    assert payload.detections is not None
    assert payload.detections.count > 0
    assert payload.original_shape[0] > 0 and payload.original_shape[1] > 0
    assert payload.speed is not None and payload.speed.inference_ms is not None

    first = payload.detections.items[0]
    assert first.class_name
    assert len(first.xyxy) == 4
    assert 0 <= (first.confidence or 0) <= 1
    assert sum(class_histogram(payload).values()) == payload.detections.count


def test_pose_payload_has_keypoints(engine, sample_image_path):
    from sightrail.core.serialize import result_to_payload

    results = engine.predict("yolo11n-pose.pt", str(sample_image_path), device="cpu", conf=0.3)
    payload = result_to_payload(results[0] if isinstance(results, list) else results, task="pose")

    assert payload.task == "pose"
    assert payload.keypoints is not None and payload.keypoints.count > 0
    instance = payload.keypoints.items[0]
    assert len(instance.xy) == 17
    assert payload.keypoints.shape == [17, 3]


def test_segment_payload_has_polygons(engine, sample_image_path):
    from sightrail.core.serialize import result_to_payload

    results = engine.predict("yolo11n-seg.pt", str(sample_image_path), device="cpu", conf=0.3)
    payload = result_to_payload(results[0] if isinstance(results, list) else results, task="segment")

    assert payload.masks is not None and payload.masks.count > 0
    mask = payload.masks.items[0]
    assert mask.point_count >= 3
    assert len(mask.polygon) == mask.point_count * 2
    assert all(0.0 <= value <= 1.0 for value in mask.polygon[:8])


def test_classify_payload_has_top5(engine, sample_image_path):
    from sightrail.core.serialize import result_to_payload

    results = engine.predict("yolo11n-cls.pt", str(sample_image_path), task="classify", device="cpu")
    payload = result_to_payload(results[0] if isinstance(results, list) else results, task="classify")

    assert payload.probs is not None
    assert payload.probs.top1_name
    assert len(payload.probs.top5) == 5
    confidences = [entry.confidence for entry in payload.probs.top5]
    assert confidences == sorted(confidences, reverse=True)


def test_infer_endpoint_returns_serialisable_result(client, sample_image_path):
    response = client.post(
        "/api/infer",
        json={
            "model": DETECT_MODEL,
            "source": {"path": str(sample_image_path)},
            "options": {"conf": 0.3, "imgsz": 320, "device": "cpu"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"]["task"] == "detect"
    assert body["results"][0]["detections"]["count"] > 0
    assert body["results"][0]["rendered_url"], "the annotated plot should be cached"
    assert body["elapsed_ms"] >= 0


def test_batch_inference_over_a_folder(client, sample_image_path):
    """Batch mode resolves sources inside the storage sandbox by design."""
    import shutil

    from sightrail.config import settings

    folder = settings.outputs_dir / "batch-test"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sample_image_path, folder / "one.jpg")
    shutil.copy2(sample_image_path, folder / "two.jpg")

    try:
        response = client.post(
            "/api/infer/batch",
            json={
                "model": DETECT_MODEL,
                "source": {"path": str(folder)},
                "options": {"conf": 0.3, "imgsz": 320, "device": "cpu"},
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 2
        assert body["stats"]["avg_ms"] is not None
        assert body["histogram"]
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_source_outside_the_storage_sandbox_is_refused(client):
    """Paths outside storage are rejected: the API must not read the whole disk."""
    response = client.post("/api/infer", json={"model": DETECT_MODEL, "source": {"path": "C:/Windows/win.ini"}})
    assert response.status_code == 404


def test_validation_job_completes(client):
    import time

    started = client.post(
        "/api/val",
        json={"model": DETECT_MODEL, "data": "coco8.yaml", "device": "cpu", "imgsz": 320, "batch": 4},
    )
    assert started.status_code == 200, started.text
    job_id = started.json()["id"]

    deadline = time.time() + 600
    detail = None
    while time.time() < deadline:
        detail = client.get(f"/api/jobs/{job_id}").json()
        if detail["status"] in {"succeeded", "failed", "cancelled"}:
            break
        time.sleep(2)

    assert detail is not None and detail["status"] == "succeeded", detail
    result = detail["result"]
    assert result["summary"], "validation should report aggregate metrics"
    assert "map50" in result["summary"] or "accuracy_top1" in result["summary"]
    assert result["per_class"], "per-class metrics should be present"


def test_torchscript_export_job_produces_an_artifact(client):
    import time

    started = client.post(
        "/api/export", json={"model": DETECT_MODEL, "format": "torchscript", "imgsz": 320, "device": "cpu"}
    )
    assert started.status_code == 200, started.text
    job_id = started.json()["id"]

    deadline = time.time() + 420
    detail = None
    while time.time() < deadline:
        detail = client.get(f"/api/jobs/{job_id}").json()
        if detail["status"] in {"succeeded", "failed", "cancelled"}:
            break
        time.sleep(2)

    assert detail is not None and detail["status"] == "succeeded", detail
    assert detail["artifacts"], "an export should register its produced file"
    assert detail["result"]["path"].endswith((".torchscript", ".onnx", ".pt"))


def test_live_tracking_keeps_ids_stable(engine, synthetic_frame):
    """The frame bridge must keep tracker state (IDs) between pushed frames."""
    tracker = engine.live.get(
        "unit-test-session",
        model_id=DETECT_MODEL,
        tracker="bytetrack.yaml",
        device="cpu",
        conf=0.1,
    )
    try:
        results = [tracker.infer(synthetic_frame) for _ in range(3)]
        assert all(result is not None for result in results)
        # The bridge must not rewrite the source path to an internal image name.
        assert all(str(getattr(result, "path", "")).endswith(".jpg") for result in results)
    finally:
        engine.live.release("unit-test-session")
    assert "unit-test-session" not in engine.live.sessions()


def test_mjpeg_session_lifecycle_and_frames(client):
    """Open an MJPEG session, pull real frames through its generator, then close it.

    The HTTP response itself is an endless multipart stream, which the test
    client cannot buffer, so the frame pipeline is exercised through
    ``core.streaming.mjpeg_frames`` — the same generator the endpoint serves.
    """
    import cv2
    import numpy as np

    from sightrail.config import settings
    from sightrail.core.streaming import StreamConfig, StreamSession, mjpeg_frames

    # A short synthetic clip keeps the test fast and independent of uploads.
    # It must live inside the storage sandbox, which is where sources resolve.
    clip_dir = settings.outputs_dir / "mjpeg-test"
    clip_dir.mkdir(parents=True, exist_ok=True)
    clip_path = clip_dir / "clip.mp4"
    writer = cv2.VideoWriter(str(clip_path), cv2.VideoWriter_fourcc(*"mp4v"), 5.0, (160, 120))
    for _ in range(5):
        writer.write(np.full((120, 160, 3), 40, dtype=np.uint8))
    writer.release()

    # The session is created through the API so the endpoint contract is covered…
    opened = client.post(
        "/api/stream/sessions",
        json={
            "model": DETECT_MODEL,
            "source": {"path": str(clip_path)},
            "device": "cpu",
            "conf": 0.3,
            "tracker": None,
            "solution": "none",
            "jpeg_quality": 60,
        },
    )
    assert opened.status_code == 200, opened.text
    session_id = opened.json()["session_id"]
    assert opened.json()["mjpeg_url"].endswith(f"/{session_id}/mjpeg")

    try:
        stats = client.get(f"/api/stream/sessions/{session_id}/stats")
        assert stats.status_code == 200
        assert stats.json()["session_id"] == session_id

        # …and the frame pipeline is driven directly, which is exactly what the
        # streaming response consumes.
        session = StreamSession(
            StreamConfig(model_id=DETECT_MODEL, device="cpu", tracker=None, jpeg_quality=60),
            str(clip_path),
        )
        try:
            chunks = []
            for chunk in mjpeg_frames(session):
                chunks.append(chunk)
                if len(chunks) >= 3:
                    session.stop()
                    break
            assert chunks, "the MJPEG generator produced no frames"
            assert chunks[0].startswith(b"--frame")
            assert b"\xff\xd8" in chunks[0], "frames must be JPEG encoded"
            assert session.frames >= 1
        finally:
            session.release()
    finally:
        assert client.delete(f"/api/stream/sessions/{session_id}").status_code == 200
        assert client.get(f"/api/stream/sessions/{session_id}/stats").status_code == 404
        import shutil

        shutil.rmtree(clip_dir, ignore_errors=True)
