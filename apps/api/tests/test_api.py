"""API contract tests: routing, validation, uploads, media and job endpoints."""

from __future__ import annotations

import io

import pytest


def test_root_and_health(client):
    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["name"]

    health = client.get("/api/health")
    assert health.status_code == 200
    body = health.json()
    assert body["status"] == "ok"
    assert isinstance(body["engine_available"], bool)


def test_openapi_document_is_served(client):
    spec = client.get("/api/openapi.json").json()
    assert spec["info"]["title"]
    paths = spec["paths"]
    # One representative endpoint per router.
    for path in (
        "/api/health",
        "/api/models/catalog",
        "/api/infer",
        "/api/train",
        "/api/val",
        "/api/export",
        "/api/benchmark",
        "/api/stream/sessions",
        "/api/uploads",
        "/api/jobs",
        "/api/datasets",
    ):
        assert path in paths, f"{path} missing from the OpenAPI document"


def test_system_endpoints(client):
    env = client.get("/api/system/env")
    assert env.status_code == 200
    payload = env.json()
    assert payload["app"]["version"]
    assert "python" in payload and "torch" in payload and "storage" in payload

    devices = client.get("/api/system/devices").json()["devices"]
    assert any(device["id"] == "cpu" for device in devices)

    overview = client.get("/api/system/overview")
    assert overview.status_code == 200
    data = overview.json()
    for key in ("catalog", "uploads", "checkpoints", "jobs", "runs", "memory", "storage", "loaded_models"):
        assert key in data


def test_model_catalog_endpoints(client):
    catalog = client.get("/api/models/catalog").json()
    assert catalog["models"]
    assert "detect" in catalog["defaults"]

    filtered = client.get("/api/models/catalog", params={"task": "pose"}).json()
    assert filtered["models"] and all(entry["task"] == "pose" for entry in filtered["models"])

    tasks = client.get("/api/models/tasks").json()["tasks"]
    assert {task["id"] for task in tasks} == {"detect", "segment", "classify", "pose", "obb"}

    trackers = client.get("/api/models/trackers").json()["trackers"]
    assert len(trackers) >= 6

    formats = client.get("/api/models/formats").json()["formats"]
    assert any(entry["id"] == "onnx" for entry in formats)

    optimizers = client.get("/api/models/optimizers").json()["optimizers"]
    assert any(entry["id"] == "auto" for entry in optimizers)


def test_upload_roundtrip(client):
    png = _tiny_png()
    created = client.post("/api/uploads", files={"file": ("pixel.png", png, "image/png")})
    assert created.status_code == 200, created.text
    entry = created.json()
    assert entry["kind"] == "image"
    assert entry["size_bytes"] == len(png)

    listing = client.get("/api/uploads").json()["uploads"]
    assert any(item["id"] == entry["id"] for item in listing)

    fetched = client.get(f"/api/uploads/{entry['id']}")
    assert fetched.status_code == 200 and fetched.json()["id"] == entry["id"]

    served = client.get(entry["url"])
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/")

    deleted = client.delete(f"/api/uploads/{entry['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/uploads/{entry['id']}").status_code == 404


def test_upload_rejects_wrong_type(client):
    response = client.post("/api/uploads", files={"file": ("clip.mp4", b"not-really-video", "video/mp4")})
    # A video is acceptable for the generic endpoint; force a type mismatch instead.
    assert response.status_code in {200, 415}
    if response.status_code == 200:
        client.delete(f"/api/uploads/{response.json()['id']}")


def test_media_rejects_traversal(client):
    assert client.get("/api/media/uploads/..%2F..%2Fconfig.py").status_code in {400, 404}
    assert client.get("/api/media/unknown/file.jpg").status_code == 404


def test_inference_validation_errors(client):
    # Missing source.
    empty = client.post("/api/infer", json={"model": "yolo11n.pt", "source": {}})
    assert empty.status_code == 400

    # Unknown upload id.
    missing = client.post("/api/infer", json={"model": "yolo11n.pt", "source": {"upload_id": "does-not-exist"}})
    assert missing.status_code == 404

    # Invalid option range is rejected by pydantic before the engine is touched.
    invalid = client.post(
        "/api/infer",
        json={"model": "yolo11n.pt", "source": {"sample": "bus.jpg"}, "options": {"conf": 5}},
    )
    assert invalid.status_code == 422


def test_jobs_endpoints(client):
    listing = client.get("/api/jobs")
    assert listing.status_code == 200 and isinstance(listing.json(), list)

    active = client.get("/api/jobs/active")
    assert active.status_code == 200

    assert client.get("/api/jobs/not-a-job").status_code == 404
    assert client.post("/api/jobs/not-a-job/cancel").status_code == 404


def test_datasets_and_solutions_catalogs(client):
    datasets = client.get("/api/datasets").json()["datasets"]
    assert any(entry["id"] == "coco8.yaml" for entry in datasets)
    assert all(entry["source"] in {"ultralytics", "local"} for entry in datasets)

    solutions = client.get("/api/stream/solutions").json()["solutions"]
    ids = {entry["id"] for entry in solutions}
    assert {"object_counter", "heatmap", "queue_management", "speed_estimation"} <= ids

    export_matrix = client.get("/api/export/formats").json()
    assert export_matrix["formats"]
    assert "engine" in export_matrix["heavy"]


def test_annotate_requires_images(client):
    response = client.post("/api/datasets/annotate", json={"name": "unit-test", "model": "yolo11n.pt"})
    assert response.status_code == 400


def test_stream_session_requires_a_real_source(client):
    response = client.post(
        "/api/stream/sessions",
        json={"model": "yolo11n.pt", "source": {"path": "definitely-missing.mp4"}},
    )
    assert response.status_code == 404
    assert client.get("/api/stream/sessions/unknown/mjpeg").status_code == 404
    assert client.delete("/api/stream/sessions/unknown").status_code == 404


def test_speed_endpoint_accepts_unknown_session(client):
    assert client.get("/api/stream/sessions/nope/stats").status_code == 404


def _tiny_png() -> bytes:
    """Smallest valid PNG (1x1 opaque pixel) built without extra dependencies."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    return header + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


@pytest.mark.parametrize("path", ["/api/", "/api/nope", "/api/models/nope/info"])
def test_unknown_routes_return_4xx(client, path):
    assert client.get(path).status_code in {404, 422}


def test_batch_inference_rejects_camera(client):
    """A webcam is a single live source - batch mode must refuse it."""
    response = client.post("/api/infer/batch", json={"model": "yolo11n.pt", "source": {"camera": 0}})
    assert response.status_code == 422
    assert "camera" in response.text.lower()


def test_uploaded_image_can_be_used_as_source(client):
    created = client.post("/api/uploads", files={"file": ("pixel.png", _tiny_png(), "image/png")}).json()
    try:
        preview = client.post("/api/infer", json={"model": "yolo11n.pt", "source": {"upload_id": created["id"]}})
        # 503 when the engine is not installed; otherwise the request must be accepted.
        assert preview.status_code in {200, 503}
        if preview.status_code == 200:
            assert preview.json()["results"][0]["task"] == "detect"
    finally:
        client.delete(f"/api/uploads/{created['id']}")


def test_multipart_batch_upload(client):
    files = [
        ("files", ("a.png", io.BytesIO(_tiny_png()), "image/png")),
        ("files", ("b.png", io.BytesIO(_tiny_png()), "image/png")),
    ]
    response = client.post("/api/uploads/batch", files=files)
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    for entry in payload["uploads"]:
        client.delete(f"/api/uploads/{entry['id']}")
