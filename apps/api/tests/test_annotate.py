"""Unit tests for ``core/annotate.py`` - the auto-annotation label encoders.

The label writers are the part of the codebase that silently corrupts a dataset
when they are wrong, so they are tested against stub result objects rather than
through a model download. The class-index behaviour in particular is pinned: the
label files store the model's class ids verbatim, so ``data.yaml`` must be
indexed the same way.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import yaml

from sightrail.core.annotate import DEFAULT_CLASSES, TASK_LABEL_HINT, DatasetBuilder

# ---------------------------------------------------------------------------
# stubs
# ---------------------------------------------------------------------------


class _Array(list):
    """Stands in for the numpy arrays Ultralytics exposes (``.tolist()`` only)."""

    def tolist(self) -> list:
        return list(self)


class _Boxes(SimpleNamespace):
    """Stand-in for ``ultralytics.engine.results.Boxes``.

    It must be sized: the payload builders short-circuit on ``len(boxes) == 0``,
    exactly as they do for the real container objects.
    """

    def __len__(self) -> int:
        return len(self.cls)


class _Masks(SimpleNamespace):
    def __len__(self) -> int:
        return len(self.xyn)


class _Keypoints(SimpleNamespace):
    def __len__(self) -> int:
        return len(self.xyn)


class _Obb(SimpleNamespace):
    def __len__(self) -> int:
        return len(self.cls)


def _boxes(rows: list[tuple[list[float], float, int]], *, normalised: bool = True) -> _Boxes:
    """Build a stand-in for ``result.boxes``."""
    xywhn = _Array([row[0] for row in rows]) if normalised else None
    xyxy = _Array([[value * 2 for value in row[0]] for row in rows])
    return _Boxes(
        xywhn=xywhn,
        xyxy=xyxy,
        conf=_Array([row[1] for row in rows]),
        cls=_Array([row[2] for row in rows]),
    )


def _detect_result(
    rows,
    task: str = "detect",
    shape: tuple[int, int] = (100, 200),
    *,
    normalised: bool = True,
) -> SimpleNamespace:
    return SimpleNamespace(
        task=task,
        boxes=_boxes(rows, normalised=normalised),
        masks=None,
        keypoints=None,
        obb=None,
        orig_shape=shape,
        names={},
    )


@pytest.fixture
def builder_factory(tmp_path, monkeypatch):
    """Build a ``DatasetBuilder`` whose dataset root lives in ``tmp_path``."""

    def factory(**kwargs) -> DatasetBuilder:
        from sightrail.config import settings

        monkeypatch.setattr(type(settings), "datasets_dir", property(lambda _self: tmp_path), raising=False)
        defaults = {"name": "unit-dataset", "images": [], "model_id": "yolo11n.pt", "task": "detect"}
        defaults.update(kwargs)
        builder = DatasetBuilder(**defaults)  # type: ignore[arg-type]
        # `_write_yaml` writes into the dataset root, so it must exist first.
        builder.root.mkdir(parents=True, exist_ok=True)
        return builder

    return factory


# ---------------------------------------------------------------------------
# detection labels
# ---------------------------------------------------------------------------


def test_detect_labels_are_class_then_normalised_box(builder_factory):
    builder = builder_factory()
    result = _detect_result([([0.5, 0.5, 0.25, 0.5], 0.9, 3)])

    lines = builder._label_lines(result)

    assert lines == ["3 0.500000 0.500000 0.250000 0.500000"]
    assert builder.stats.per_class  # the tally is recorded for the UI


def test_detect_labels_tolerate_missing_normalised_boxes(builder_factory):
    builder = builder_factory()
    result = _detect_result([([0.5, 0.5, 0.1, 0.1], 0.9, 0)], normalised=False)

    assert builder._label_lines(result) == []


def test_detect_labels_multiple_rows_keep_their_class_ids(builder_factory):
    builder = builder_factory()
    result = _detect_result(
        [
            ([0.1, 0.1, 0.1, 0.1], 0.8, 2),
            ([0.5, 0.5, 0.2, 0.2], 0.7, 7),
            ([0.9, 0.9, 0.1, 0.1], 0.6, 2),
        ]
    )

    lines = builder._label_lines(result)

    assert [line.split()[0] for line in lines] == ["2", "7", "2"]
    assert builder.stats.per_class == {"car": 2, "truck": 1}


# ---------------------------------------------------------------------------
# segmentation labels
# ---------------------------------------------------------------------------


def test_segment_labels_write_a_flat_normalised_polygon(builder_factory):
    builder = builder_factory(task="segment")
    polygon = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]
    result = SimpleNamespace(
        task="segment",
        boxes=_boxes([([0.15, 0.15, 0.1, 0.1], 0.9, 0)]),
        masks=SimpleNamespace(xyn=_Array([polygon])),
        orig_shape=(100, 100),
        names={},
    )

    lines = builder._label_lines(result)

    assert len(lines) == 1
    parts = lines[0].split()
    assert parts[0] == "0"
    assert len(parts) == 1 + 3 * 2, "three (x, y) pairs, flattened"
    assert all(0.0 <= float(value) <= 1.0 for value in parts[1:])


def test_segment_labels_skip_degenerate_polygons(builder_factory):
    builder = builder_factory(task="segment")
    result = SimpleNamespace(
        task="segment",
        boxes=_boxes([([0.5, 0.5, 0.1, 0.1], 0.9, 0)]),
        masks=SimpleNamespace(xyn=_Array([[[0.1, 0.1], [0.2, 0.2]]])),  # only 2 points
        orig_shape=(100, 100),
        names={},
    )

    assert builder._label_lines(result) == []


# ---------------------------------------------------------------------------
# pose labels
# ---------------------------------------------------------------------------


def test_pose_labels_include_visibility_flags(builder_factory):
    builder = builder_factory(task="pose")
    points = [[0.1 + 0.01 * i, 0.2] for i in range(17)]
    confidences = [0.9] * 17
    confidences[5] = 0.05  # below the visible threshold
    result = SimpleNamespace(
        task="pose",
        boxes=_boxes([([0.5, 0.5, 0.4, 0.8], 0.9, 0)]),
        keypoints=SimpleNamespace(xyn=_Array([points]), conf=_Array([confidences])),
        orig_shape=(100, 100),
        names={},
    )

    lines = builder._label_lines(result)

    assert len(lines) == 1
    parts = lines[0].split()
    # class + 4 box values + 17 * (x, y, visibility)
    assert len(parts) == 1 + 4 + 17 * 3
    visibility = [parts[5 + index * 3 + 2] for index in range(17)]
    assert visibility[5] == "0", "a low-confidence keypoint is marked invisible"
    assert visibility[0] == "2", "a confident keypoint is marked visible"


# ---------------------------------------------------------------------------
# OBB labels
# ---------------------------------------------------------------------------


def test_obb_labels_denormalise_the_rotated_box(builder_factory):
    builder = builder_factory(task="obb")
    # cx, cy, w, h, angle in *pixel* space for a 200x100 frame.
    result = SimpleNamespace(
        task="obb",
        boxes=None,
        masks=None,
        obb=SimpleNamespace(xywhr=_Array([[100.0, 50.0, 40.0, 20.0, 0.5]]), cls=_Array([4])),
        orig_shape=(100, 200),
        names={},
    )

    lines = builder._label_lines(result)

    assert len(lines) == 1
    parts = [float(value) for value in lines[0].split()]
    assert parts[0] == 4
    assert parts[1] == pytest.approx(0.5)  # 100 / 200
    assert parts[2] == pytest.approx(0.5)  # 50 / 100
    assert parts[3] == pytest.approx(0.2)  # 40 / 200
    assert parts[4] == pytest.approx(0.2)  # 20 / 100
    assert parts[5] == pytest.approx(0.5)  # angle passes through in radians


def test_classify_task_writes_no_label_files(builder_factory):
    builder = builder_factory(task="classify")
    result = _detect_result([([0.5, 0.5, 0.1, 0.1], 0.9, 0)], task="classify")

    assert builder._label_lines(result) == []


# ---------------------------------------------------------------------------
# data.yaml
# ---------------------------------------------------------------------------


def test_data_yaml_keeps_the_full_class_list_so_indices_stay_aligned(builder_factory):
    """A missing class 0 must not renumber every other class.

    Regression: the class list used to be derived from only the detected
    classes, so an unobserved class 0 shifted every id in ``data.yaml`` and the
    training set was silently mislabelled.
    """
    builder = builder_factory(task="detect")
    # Class 3 is detected and class 0 is not; index 3 must still resolve to the
    # name it had in the label file.
    path = builder._write_yaml({3: "motorcycle", 7: "truck"})

    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert config["names"][3] == DEFAULT_CLASSES[3] == "motorcycle"
    assert config["names"][7] == DEFAULT_CLASSES[7] == "truck"
    assert config["names"][0] == DEFAULT_CLASSES[0], "class 0 keeps its own name even if unseen"
    assert len(config["names"]) == len(DEFAULT_CLASSES)


def test_data_yaml_appends_ids_beyond_the_default_list(builder_factory):
    """A custom model with more classes extends the list instead of shifting it."""
    builder = builder_factory()
    beyond = len(DEFAULT_CLASSES) + 2
    path = builder._write_yaml({beyond: "custom-thing"})

    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert config["names"][beyond] == "custom-thing"
    assert config["names"][1] == DEFAULT_CLASSES[1], "existing indices are untouched"
    assert len(config["names"]) == beyond + 1


def test_data_yaml_honours_an_explicit_class_list(builder_factory):
    builder = builder_factory(class_names=["alpha", "beta"])
    config = yaml.safe_load(builder._write_yaml({}).read_text(encoding="utf-8"))

    assert config["names"] == {0: "alpha", 1: "beta"}


def test_data_yaml_records_pose_keypoint_shape(builder_factory):
    builder = builder_factory(task="pose")
    config = yaml.safe_load(builder._write_yaml({}).read_text(encoding="utf-8"))

    assert config["task"] == "pose"
    assert config["kpt_shape"] == [17, 3]


def test_data_yaml_falls_back_to_the_train_split_when_val_is_empty(builder_factory):
    builder = builder_factory()
    config = yaml.safe_load(builder._write_yaml({}).read_text(encoding="utf-8"))

    assert config["train"] == "images/train"
    assert config["val"] == "images/train", "an empty val split falls back to train"


def test_label_format_hints_cover_every_task():
    for task in ("detect", "segment", "pose", "obb", "classify"):
        assert task in TASK_LABEL_HINT
        assert TASK_LABEL_HINT[task]
