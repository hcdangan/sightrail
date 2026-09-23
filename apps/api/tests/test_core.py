"""Unit tests for the pure-Python core: parsing, serialisation, catalog, config."""

from __future__ import annotations

import sys
from typing import Any

import numpy as np
import pytest

from sightrail.config import Settings
from sightrail.core import catalog, jobs, models_meta, serialize
from sightrail.core.device import list_devices, resolve_device
from sightrail.schemas.base import JobKind, JobProgress, JobStatus, TaskName

# --------------------------------------------------------------------- config


def test_settings_derives_directories(tmp_path):
    settings = Settings(storage_root=tmp_path)
    settings.ensure_dirs()
    for directory in settings.all_dirs():
        assert directory.exists(), directory
    assert settings.uploads_dir == tmp_path / "uploads"
    assert settings.weights_dir == tmp_path / "weights"


def test_settings_parses_csv_origins():
    settings = Settings(cors_origins="http://a.test, http://b.test")
    assert settings.cors_origins == ["http://a.test", "http://b.test"]


# -------------------------------------------------------------------- helpers


@pytest.mark.parametrize(
    ("value", "expected"),
    [(1, 1.0), (2.5, 2.5), ("3", 3.0), (None, None), ("nope", None), (float("nan"), None), (float("inf"), None)],
)
def test_to_float(value, expected):
    assert serialize.to_float(value) == expected


def test_serialise_names_handles_dicts_and_lists():
    assert serialize.serialise_names({"1": "b", "0": "a"}) == {0: "a", 1: "b"}
    assert serialize.serialise_names(["a", "b"]) == {0: "a", 1: "b"}
    assert serialize.serialise_names(None) == {}


def test_class_histogram_counts_by_name():
    from sightrail.schemas.results import BoxPayload, DetectionPayload, ResultPayload

    result = ResultPayload(
        task=TaskName.DETECT,
        detections=DetectionPayload(
            count=3,
            items=[
                BoxPayload(index=0, class_id=0, class_name="person", xyxy=[0, 0, 1, 1]),
                BoxPayload(index=1, class_id=0, class_name="person", xyxy=[0, 0, 1, 1]),
                BoxPayload(index=2, class_id=2, class_name="car", xyxy=[0, 0, 1, 1]),
            ],
        ),
    )
    assert serialize.class_histogram(result) == {"person": 2, "car": 1}


def test_class_histogram_includes_masks():
    """A segmentation result reports its instances through ``masks``.

    Counting only boxes returned an empty breakdown for a model that had plainly
    found objects — the MJPEG session history showed `"classes": {}` on every
    frame for exactly this reason.
    """
    from sightrail.schemas.results import MaskInstance, MaskPayload, ResultPayload

    result = ResultPayload(
        task=TaskName.SEGMENT,
        masks=MaskPayload(
            count=2,
            items=[
                MaskInstance(index=0, class_id=0, class_name="person", polygon=[0, 0, 1, 0, 1, 1], point_count=3),
                MaskInstance(index=1, class_id=2, class_name="car", polygon=[0, 0, 1, 0, 1, 1], point_count=3),
            ],
        ),
    )

    assert serialize.class_histogram(result) == {"person": 1, "car": 1}


def test_frame_to_jpeg_bytes_roundtrip():
    import cv2

    frame = np.zeros((32, 48, 3), dtype=np.uint8)
    frame[:, :] = (10, 200, 10)
    payload = serialize.frame_to_jpeg_bytes(frame, quality=70)
    assert payload[:2] == b"\xff\xd8"  # JPEG SOI marker
    decoded = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == frame.shape


# -------------------------------------------------------------------- catalog


def test_catalog_entries_are_unique_and_well_formed():
    entries = catalog.list_catalog()
    ids = [entry["id"] for entry in entries]
    assert len(ids) == len(set(ids)), "duplicate catalog ids"
    for entry in entries:
        assert entry["task"] in {task.value for task in TaskName}
        assert entry["download_url"].endswith(entry["id"])
        assert entry["label"]


def test_catalog_grouping_and_defaults():
    detect_models = catalog.catalog_by_task("detect")
    assert detect_models and all(entry["task"] == "detect" for entry in detect_models)
    assert catalog.default_model_for_task("pose") == "yolo11n-pose.pt"
    assert catalog.default_model_for_task("unknown-task") == "yolo11n.pt"
    assert catalog.is_catalog_model("yolo11n.pt")
    assert not catalog.is_catalog_model("not-a-model.pt")


# --------------------------------------------------------- export format table


def test_export_format_notes_cover_exactly_the_catalog():
    """Every selectable format must be keyed by the id the catalog reports.

    This is the regression that shipped a format with no curated copy: the notes
    dict was keyed ``tflite`` while the engine's argument — and therefore the
    catalog id — is ``litert``, so ``FORMAT_NOTES.get`` missed and the row fell
    back to the raw engine name with an empty note. Nothing raised; the label was
    just quietly wrong. A key that matches nothing is therefore a test failure,
    not dead weight.
    """
    rows = models_meta.export_format_catalog()
    if not rows:  # pragma: no cover - the engine is optional
        pytest.skip("Ultralytics is not importable, so there is no format table.")

    ids = {row["id"] for row in rows}
    assert len(ids) == len(rows), "duplicate export format ids"

    # The UI renders label and note on every format card; empty ones are visible.
    for row in rows:
        assert row["label"], f"{row['id']} has no label"
        assert row["note"], f"{row['id']} has no curated note"

    unused = frozenset(models_meta.FORMAT_NOTES) - frozenset(ids)
    assert not unused, f"FORMAT_NOTES keys match no catalog id: {sorted(unused)}"


def test_export_format_catalog_excludes_the_source_format():
    """PyTorch is the *source*, not an export target, so it must not be listed.

    The UI prints ``formats.length`` as a badge and the README states the same
    number, so an off-by-one here is user-visible documentation drift.
    """
    rows = models_meta.export_format_catalog()
    if not rows:  # pragma: no cover - the engine is optional
        pytest.skip("Ultralytics is not importable, so there is no format table.")

    assert all(row["id"] != "-" for row in rows), "the PyTorch source row leaked into the catalog"
    assert any(row["id"] == "onnx" for row in rows)
    assert len(rows) >= 20, f"the format table shrank unexpectedly: {len(rows)} entries"


# -------------------------------------------------------------------- trackers


def test_the_recommended_tracker_is_the_default_the_schemas_use():
    """The "default" badge must name the tracker the API actually defaults to.

    Ultralytics' own default is ``tracktrack.yaml`` (its ``cfg/default.yaml``),
    but Sightrail wires ByteTrack through every request schema. The badge was
    hand-written on TrackTrack, so the Studio panel advertised a tracker the
    application never selected. ``recommended`` is now derived from
    ``DEFAULT_TRACKER``; this asserts the derivation still matches the schemas.
    """
    from sightrail.core.models_meta import DEFAULT_TRACKER, tracker_catalog
    from sightrail.schemas.requests import StreamStartRequest, TrackRequest, VideoAnalysisRequest

    catalog = tracker_catalog()
    flagged = [entry["id"] for entry in catalog if entry.get("recommended")]

    assert flagged == [DEFAULT_TRACKER], f"expected exactly one recommended tracker, got {flagged}"
    assert len(catalog) == len(models_meta.TRACKERS), "tracker_catalog must not add or drop entries"

    # Every entry keeps its curated copy; the panel renders both fields.
    for entry in catalog:
        assert entry["label"], f"{entry['id']} has no label"
        assert entry["description"], f"{entry['id']} has no description"

    # The advertised default must be the one each schema applies when the field
    # is omitted. Adding a mode with a different default is a real change, not a
    # copy tweak, so it should fail here rather than in the UI.
    for schema in (TrackRequest, StreamStartRequest, VideoAnalysisRequest):
        default = schema.model_fields["tracker"].default
        assert default == DEFAULT_TRACKER, (
            f"{schema.__name__} defaults to {default!r}, but the UI badges {DEFAULT_TRACKER!r} as the default"
        )


# ----------------------------------------------------------------- ROI regions


def test_normalised_region_is_scaled_to_source_pixels():
    """A 0..1 ROI must land on the real frame, not in its top-left corner.

    Ultralytics solutions take pixel geometry. The UI only knows fractions, so
    without this conversion a line at (0.15, 0.40) would be read as pixel 0.15 on
    a 1280-wide frame — invisible at the corner rather than across the middle.
    """
    from sightrail.core.streaming import _region_to_pixels

    region = [[0.0, 0.5], [1.0, 0.5]]
    scaled, resolved = _region_to_pixels(region, (720, 1280))

    assert resolved is True
    assert scaled == [(0.0, 360.0), (1280.0, 360.0)]


def test_multi_polygon_region_scales_every_polygon():
    from sightrail.core.streaming import _region_to_pixels

    region = [[[0.0, 0.0], [0.5, 0.0], [0.5, 0.5]], [[0.5, 0.5], [1.0, 1.0]]]
    scaled, resolved = _region_to_pixels(region, (480, 640))

    assert resolved is True
    assert scaled[0] == [(0.0, 0.0), (320.0, 0.0), (320.0, 240.0)]
    assert scaled[1] == [(320.0, 240.0), (640.0, 480.0)]


def test_region_without_a_frame_size_is_not_treated_as_pixels():
    """No frame size must mean "no ROI", never "ROI in the wrong place".

    The caller drops the region on a False result and the sessions endpoint
    reports that it was ignored, so the user is told rather than shown a line
    hugging the top-left corner.
    """
    from sightrail.core.streaming import _region_to_pixels

    for shape in (None, (0, 0), (0, 1280)):
        _region, resolved = _region_to_pixels([[0.5, 0.5], [0.9, 0.9]], shape)
        assert resolved is False, f"shape {shape} should not resolve"


def test_pixel_space_region_is_left_alone():
    """A caller already working in pixels keeps its geometry untouched."""
    from sightrail.core.streaming import _region_to_pixels

    region = [[100, 300], [900, 300]]
    scaled, resolved = _region_to_pixels(region, (480, 640))

    assert resolved is False
    assert scaled is None, "pixel-space geometry is not normalised, so it is not converted here"


def test_region_to_pixels_tolerates_junk():
    """A malformed polygon must not raise: the WebSocket path would 500.

    `[[1]]` is the interesting case — a "point" with no y coordinate used to pass
    the normalised-range check and then blow up while scaling.
    """
    from sightrail.core.streaming import _region_to_pixels

    for junk in ([], None, "not-a-region", [[]], [[1]], [[[0.5]]]):
        _region, resolved = _region_to_pixels(junk, (480, 640))
        assert resolved is False, f"{junk!r} should not resolve"


def test_region_reaches_a_kwargs_style_solution(monkeypatch):
    """A solution declared as ``__init__(self, **kwargs)`` must still get the ROI.

    ``ObjectCounter`` and friends take ``**kwargs`` and forward ``region`` to the
    base class, so `region` never appears in ``inspect.signature``. The handler
    that drops undeclared arguments therefore dropped the region too: every live
    analytics mode silently ignored the ROI while the sessions endpoint reported
    ``region_applied: true``. A stubbed class pins the behaviour without loading a
    model.
    """
    from types import SimpleNamespace

    from sightrail.core import streaming

    captured: dict[str, Any] = {}

    class StubSolution:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(streaming, "SOLUTION_BY_ID", {"object_counter": streaming.SOLUTION_BY_ID["object_counter"]})
    fake_module = SimpleNamespace(ObjectCounter=StubSolution)
    monkeypatch.setitem(sys.modules, "ultralytics.solutions", fake_module)
    monkeypatch.setattr("ultralytics.solutions", fake_module, raising=False)

    built = streaming._build_solution(
        "object_counter",
        model_id="yolo11n.pt",
        region=[[0.1, 0.4], [0.9, 0.4]],
        region_kind="line",
        overrides={},
        frame_shape=(480, 640),
        region_normalised=True,
    )

    assert built is not None
    assert captured.get("region") == [(64.0, 192.0), (576.0, 192.0)], "the ROI was dropped before reaching the solution"


def test_region_is_absent_when_the_frame_size_is_unknown(monkeypatch):
    """Unknown source size must not fall back to something plausible-looking."""
    from types import SimpleNamespace

    from sightrail.core import streaming

    captured: dict[str, Any] = {}

    class StubSolution:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    monkeypatch.setitem(sys.modules, "ultralytics.solutions", SimpleNamespace(ObjectCounter=StubSolution))

    streaming._build_solution(
        "object_counter",
        model_id="yolo11n.pt",
        region=[[0.5, 0.5], [0.9, 0.9]],
        region_kind="line",
        overrides={},
        frame_shape=None,
        region_normalised=True,
    )

    assert "region" not in captured, "an unresolvable ROI must be omitted, not passed through as pixels"


# ----------------------------------------------------------------- engine util


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("yolo11n-seg.pt", "segment"),
        ("yolo11n-pose.pt", "pose"),
        ("yolo11n-cls.pt", "classify"),
        ("yolo11n-obb.pt", "obb"),
        ("yolo11n.pt", None),
    ],
)
def test_infer_task_from_name(name, expected):
    from sightrail.core.engine import infer_task_from_name

    assert infer_task_from_name(name) == expected


def test_resolve_device_falls_back_to_cpu():
    assert resolve_device("cpu") == "cpu"
    assert resolve_device("nonsense") == "cpu"
    assert resolve_device(None) in {"cpu", "cuda:0", "mps"}


def test_list_devices_always_offers_cpu_and_auto():
    ids = {device["id"] for device in list_devices()}
    assert {"auto", "cpu"} <= ids


# ------------------------------------------------------------- stdout parsing


@pytest.mark.parametrize(
    "line",
    [
        "      1/100      1.42G      0.031      0.045      0.012         8        640: 100%|██████████| 1/1",
        "      2/100      1.42G      0.028      0.041      0.011        12        640:  50%|█████     | 1/2",
        # The exact format Ultralytics 8.4 emits (ANSI prefix, tqdm bar, rate suffix).
        # Verbatim Ultralytics 8.4 output; the bar glyphs and ANSI prefix matter.
        "\x1b[K        1/1         0G      1.328       4.28      1.413         13"
        "        160: 100% ━━━━━━━━━━━━ 1/1 2.5it/s 0.4s",
        "\x1b[K        3/50      0.42G      0.912      1.204      1.011         64"
        "        640:  40% ━━━╸────── 2/5 4.1it/s",
    ],
)
def test_parse_engine_line_reads_training_progress(line):
    event = jobs.parse_engine_line(line)
    assert event is not None
    assert event.kind == "progress", event
    assert event.percent is not None
    assert event.data["epochs"] in {100, 1, 50}
    assert "box_loss" in event.data
    assert "\x1b" not in event.message


def test_parse_engine_line_reads_classification_progress():
    event = jobs.parse_engine_line("\x1b[K      3/50      0.98G     0.4321     0.8765        640:  60% ━━━╸──── 3/5")
    assert event is not None and event.kind == "progress"
    assert event.data["loss"] == pytest.approx(0.4321)
    assert event.data["accuracy"] == pytest.approx(0.8765)


def test_parse_engine_line_reads_validation_bar():
    event = jobs.parse_engine_line(
        "                 Class     Images  Instances      Box(P          R      mAP50  mAP50-95): 100% ━━━ 1/1"
    )
    assert event is not None and event.kind == "progress"
    assert event.percent == pytest.approx(100.0)


def test_parse_engine_line_detects_metrics_and_levels():
    metric = jobs.parse_engine_line("all  0.512 0.733 0.498 0.301 mAP50: 0.688")
    assert metric is not None and metric.kind == "metric"
    assert "map50" in metric.data

    warning = jobs.parse_engine_line("WARNING something odd happened")
    assert warning is not None and warning.level == "warning"

    error = jobs.parse_engine_line("Error: dataset missing")
    assert error is not None and error.level == "error"


def test_parse_engine_line_ignores_blank_input():
    assert jobs.parse_engine_line("   ") is None


# ------------------------------------------------------------------- job model


def test_job_collects_events_metrics_and_detail():
    job = jobs.Job(
        id="test",
        kind=JobKind.TRAIN,
        title="unit test job",
        params={},
        created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
    job.log_line("hello")
    job.set_progress(42.0, "working")
    job.emit(JobProgress(kind="metric", data={"map50": 0.9}))

    assert job.percent == pytest.approx(42.0)
    assert job.metrics["map50"] == [0.9]
    detail = job.detail()
    assert len(detail.log) == 3
    assert [event.seq for event in detail.log] == [1, 2, 3]

    job.status = JobStatus.RUNNING
    job.started_at = job.created_at
    job.finished_at = job.created_at
    assert job.summary().duration_s == 0.0


def test_job_subscribers_receive_events():
    import datetime

    job = jobs.Job(
        id="test",
        kind=JobKind.VAL,
        title="t",
        params={},
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    received: list[JobProgress] = []
    job.subscribe(received.append)
    job.log_line("one")
    job.unsubscribe(received.append)
    job.log_line("two")
    assert len(received) == 1


def test_job_store_create_and_cancel():
    store = jobs.JobStore()
    job = store.create(JobKind.EXPORT, "export test", {"model": "yolo11n.pt"})
    assert store.get(job.id) is job
    assert job in store.list_jobs()
    store.cancel(job.id)
    assert job.cancel_requested is True
    assert store.clear_finished() >= 0
    store.shutdown()


# --------------------------------------------------------------------- engine


def test_training_loads_its_pretrained_source_on_cpu(monkeypatch):
    """The pretrained source must be CPU-resident, whatever device trains.

    Ultralytics' trainer builds a *fresh* model and copies these weights into it,
    and that copy runs ``BaseModel._remap_cls_by_names``, which assigns with
    ``v_src[idx[valid]].to(v_tgt.dtype)`` — dtype only, never device. A CUDA-resident
    source into the trainer's CPU-built model therefore raises *"Expected all tensors
    to be on the same device, but found at least two devices, cuda:0 and cpu!"*.

    It fires exactly when every training class name matches the checkpoint's while the
    class sets differ (fine-tuning a COCO checkpoint on a COCO subset), because an
    all-true boolean mask takes PyTorch's device-checked assignment path — a partially
    true mask happens to tolerate the cross-device copy and hides the bug. The trainer
    moves the finished model to the requested device itself, so loading the source on
    CPU does not cost GPU training.
    """
    from sightrail.core import engine as engine_mod

    calls: dict[str, Any] = {}

    class StubModel:
        def train(self, **kwargs: Any) -> str:
            calls["train_kwargs"] = kwargs
            return "trained"

    class StubRecord:
        model = StubModel()

    class StubRegistry:
        def load(self, model_id: str, device: str | None = None, task: str | None = None) -> StubRecord:
            calls["load_device"] = device
            calls["model_id"] = model_id
            return StubRecord()

    monkeypatch.setattr(engine_mod.engine, "registry", StubRegistry())
    result = engine_mod.engine.train("yolo11n.pt", data="data.yaml", device="cuda:0")

    assert result == "trained"
    assert calls["model_id"] == "yolo11n.pt"
    # The source the trainer copies from must be on CPU...
    assert calls["load_device"] == "cpu"
    # ...while the run itself still goes to the requested accelerator.
    assert calls["train_kwargs"]["device"] == "cuda:0"
