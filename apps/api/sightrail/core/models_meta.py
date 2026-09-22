"""Static metadata: export formats, trackers and optimizers.

Values are derived from the installed Ultralytics build where possible so the UI
never offers a format the engine cannot produce. The curated labels/notes are
what make the format matrix understandable to a human.
"""

from __future__ import annotations

from typing import Any

#: Human explanations for every export format Ultralytics advertises.
FORMAT_NOTES: dict[str, dict[str, str]] = {
    "torchscript": {"label": "TorchScript", "note": "Portable PyTorch graph, no Python needed."},
    "onnx": {"label": "ONNX", "note": "Universal interchange format; runs on most runtimes."},
    "openvino": {"label": "OpenVINO", "note": "Best CPU throughput on Intel hardware."},
    "engine": {"label": "TensorRT", "note": "NVIDIA GPUs, fastest fp16/int8 inference."},
    "coreml": {"label": "CoreML", "note": "Apple devices (macOS/iOS)."},
    "saved_model": {"label": "TensorFlow SavedModel", "note": "TensorFlow Serving / TF ecosystem."},
    "pb": {"label": "TensorFlow GraphDef", "note": "Frozen graph for TF 1.x style deployments."},
    "edgetpu": {"label": "TF Edge TPU", "note": "Coral accelerators (int8 only)."},
    "litert": {"label": "LiteRT / TFLite", "note": "Mobile and embedded CPUs."},
    "paddle": {"label": "PaddlePaddle", "note": "Baidu PaddlePaddle runtime."},
    "mnn": {"label": "MNN", "note": "Alibaba mobile inference engine."},
    "ncnn": {"label": "NCNN", "note": "Tencent mobile inference engine."},
    "imx": {"label": "Sony IMX", "note": "Sony IMX500 sensor deployment."},
    "rknn": {"label": "Rockchip RKNN", "note": "Rockchip NPUs (RK3588 etc.)."},
    "executorch": {"label": "ExecuTorch", "note": "PyTorch on-device runtime."},
    "axelera": {"label": "Axelera AI", "note": "Axelera Metis accelerator."},
    "deepx": {"label": "DEEPX", "note": "DEEPX NPU toolchain."},
    "qnn": {"label": "Qualcomm QNN", "note": "Snapdragon Hexagon NPU."},
    "hailo": {"label": "Hailo", "note": "Hailo-8 AI accelerators."},
    "ascend": {"label": "Huawei Ascend", "note": "Ascend NPU via CANN."},
    "coreai": {"label": "Apple Core AI", "note": "Apple's next-gen on-device runtime."},
}

#: The tracker Sightrail defaults to.
#:
#: Deliberately *not* Ultralytics' own default. The installed engine ships
#: ``tracker: tracktrack.yaml`` in its ``default.yaml``, but every Sightrail entry
#: point — ``TrackRequest``, ``StreamStartRequest``, ``VideoAnalysisRequest`` and
#: the live WebSocket config — asks for ByteTrack. Naming the choice once, and
#: deriving the "default" badge below from it, stops the UI from advertising a
#: tracker the application does not actually use.
DEFAULT_TRACKER = "bytetrack.yaml"

#: The six trackers that ship with Ultralytics, with UI metadata.
#:
#: Curated rather than discovered: the descriptions feed the tracker reference
#: panel. ``recommended`` is *derived* from :data:`DEFAULT_TRACKER` so the badge
#: cannot contradict the default the request schemas actually apply.
TRACKERS: list[dict[str, Any]] = [
    {
        "id": "tracktrack.yaml",
        "label": "TrackTrack",
        "description": "Ultralytics' own default tracker: motion plus appearance, no extra dependencies.",
        "requires": [],
    },
    {
        "id": "bytetrack.yaml",
        "label": "ByteTrack",
        "description": "High-performance association using low-confidence boxes. Sightrail's default.",
        "requires": [],
    },
    {
        "id": "botsort.yaml",
        "label": "BoT-SORT",
        "description": "ByteTrack plus camera-motion compensation and ReID.",
        "requires": [],
    },
    {
        "id": "ocsort.yaml",
        "label": "OC-SORT",
        "description": "Observation-centric SORT, robust to occlusion.",
        "requires": [],
    },
    {
        "id": "deepocsort.yaml",
        "label": "Deep OC-SORT",
        "description": "OC-SORT with a deep appearance model.",
        "requires": ["reid weights"],
    },
    {
        "id": "fasttrack.yaml",
        "label": "FastTracker",
        "description": "Lightweight tracker tuned for high frame rates.",
        "requires": [],
    },
]

#: Optimizer choices (mirrors ``ultralytics.cfg``).
OPTIMIZERS: list[dict[str, str]] = [
    {"id": "auto", "label": "Auto", "note": "Ultralytics picks based on dataset size."},
    {"id": "SGD", "label": "SGD", "note": "Classic stochastic gradient descent."},
    {"id": "Adam", "label": "Adam", "note": "Adaptive moment estimation."},
    {"id": "AdamW", "label": "AdamW", "note": "Adam with decoupled weight decay."},
    {"id": "NAdam", "label": "NAdam", "note": "Adam with Nesterov momentum."},
    {"id": "RAdam", "label": "RAdam", "note": "Rectified Adam, stable warmup."},
    {"id": "RMSProp", "label": "RMSProp", "note": "Root mean square propagation."},
]

#: Deployment hints keyed by format argument, used for the "where to run this" chips.
FORMAT_TARGETS: dict[str, list[str]] = {
    "onnx": ["server", "edge", "browser"],
    "openvino": ["intel-cpu", "server", "edge"],
    "engine": ["nvidia-gpu"],
    "torchscript": ["server", "python"],
    "coreml": ["apple"],
    "tflite": ["android", "ios", "embedded"],
    "litert": ["android", "embedded"],
    "ncnn": ["android", "embedded"],
    "mnn": ["android", "embedded"],
    "rknn": ["rockchip-npu"],
    "hailo": ["hailo-8"],
    "qnn": ["snapdragon"],
    "imx": ["sony-imx500"],
    "saved_model": ["tensorflow-serving"],
    "pb": ["tensorflow"],
    "edgetpu": ["coral"],
    "paddle": ["paddlepaddle"],
    "executorch": ["on-device"],
    "axelera": ["axelera-metis"],
    "deepx": ["deepx-npu"],
    "ascend": ["huawei-ascend"],
    "coreai": ["apple"],
}


def tracker_catalog() -> list[dict[str, Any]]:
    """The tracker list with ``recommended`` derived from :data:`DEFAULT_TRACKER`.

    The flag drives a literal "default" badge in the Studio tracker panel, so it
    is computed rather than written down. Marking a tracker by hand is exactly how
    the badge came to sit next to a tracker the application never selected.
    """
    return [{**entry, "recommended": entry["id"] == DEFAULT_TRACKER} for entry in TRACKERS]


def export_format_catalog() -> list[dict[str, Any]]:
    """Merge the installed engine's format table with our explanatory metadata."""
    try:
        from ultralytics.engine.exporter import export_formats

        raw = export_formats()
    except Exception:  # pragma: no cover - engine optional
        return []

    names = list(raw.get("Format", []))
    args = list(raw.get("Argument", []))
    suffixes = list(raw.get("Suffix", []))
    cpu = list(raw.get("CPU", []))
    gpu = list(raw.get("GPU", []))
    options = list(raw.get("Arguments", []))
    envs = list(raw.get("Env", []))

    catalog: list[dict[str, Any]] = []
    for index, argument in enumerate(args):
        fmt = str(argument)
        if fmt == "-":
            continue
        notes = FORMAT_NOTES.get(fmt, {})
        catalog.append(
            {
                "id": fmt,
                "label": notes.get("label") or (names[index] if index < len(names) else fmt),
                "engine_name": names[index] if index < len(names) else fmt,
                "suffix": suffixes[index] if index < len(suffixes) else "",
                "note": notes.get("note", ""),
                "cpu": bool(cpu[index]) if index < len(cpu) else False,
                "gpu": bool(gpu[index]) if index < len(gpu) else False,
                "options": list(options[index]) if index < len(options) else [],
                "environment": envs[index] if index < len(envs) else "base",
                "targets": FORMAT_TARGETS.get(fmt, []),
            }
        )
    return catalog
