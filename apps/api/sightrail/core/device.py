"""Device discovery and environment probing.

Three families of compute target are supported and they are *not* equivalent:

``cpu`` / ``cuda`` / ``mps``
    Classic PyTorch devices. Any Ultralytics mode works (predict, track, train,
    val, export, benchmark).

``hailo``
    A Hailo accelerator reached through HailoRT. It is an *inference* target
    only: Ultralytics loads a compiled ``.hef`` network and runs it on the NPU,
    so training and validation are not possible. ``device='hailo'`` is therefore
    translated to ``cpu`` before it reaches Ultralytics (which would otherwise
    reject the string as an invalid CUDA request) while the choice is preserved
    for reporting, metrics and the UI.

The UI surfaces all of this through ``/api/system/devices``,
``/api/system/device-config`` and ``/api/system/env``.
"""

from __future__ import annotations

import contextlib
import importlib
import os
import platform
import shutil
import sys
from functools import lru_cache
from typing import Any

from .. import __version__

#: Optional packages worth reporting in the "Environment" panel.
_OPTIONAL_PACKAGES = (
    "onnx",
    "onnxruntime",
    "onnxruntime-gpu",
    "openvino",
    "coremltools",
    "tensorflow",
    "ncnn",
    "paddle",
    "triton",
    "nvidia-ml-py",
    "hailo_platform",
    "hailo_sdk_client",
)

#: Device kinds, ordered by how the UI presents them.
DEVICE_KINDS = ("auto", "cuda", "cpu", "mps", "hailo")

#: Modes every device kind can execute.
ALL_MODES = ("predict", "track", "train", "val", "export", "benchmark")
#: Hailo runs compiled networks; there is no backpropagation on the NPU.
INFERENCE_MODES = ("predict", "track", "export")

#: Hailo architectures accepted by the Ultralytics exporter.
HAILO_ARCHITECTURES: dict[str, dict[str, str]] = {
    "hailo8l": {
        "label": "Hailo-8L (13 TOPS)",
        "target": "Raspberry Pi 5 + AI Kit / AI HAT+, M.2 B+M key",
        "note": "The Raspberry Pi default: lower power, smaller models.",
    },
    "hailo8": {
        "label": "Hailo-8 (26 TOPS)",
        "target": "M.2 / PCIe cards and mini-PCs",
        "note": "Twice the throughput of the 8L with the same toolchain.",
    },
    "hailo10h": {
        "label": "Hailo-10H",
        "target": "Hailo-10 accelerators",
        "note": "DFC 5.x; multi-class heads bake ArgMax on chip.",
    },
    "hailo15h": {
        "label": "Hailo-15H",
        "target": "Hailo-15 smart cameras",
        "note": "High-end vision SoC.",
    },
    "hailo15l": {
        "label": "Hailo-15L",
        "target": "Hailo-15 smart cameras",
        "note": "Entry Hailo-15 vision SoC.",
    },
}


# ---------------------------------------------------------------------------
# availability probes
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def torch_module() -> Any | None:
    """Import torch lazily; ``None`` when the engine is not installed."""
    try:
        return importlib.import_module("torch")
    except Exception:  # pragma: no cover - depends on install
        return None


def cuda_available() -> bool:
    torch = torch_module()
    try:
        return bool(torch and torch.cuda.is_available() and torch.cuda.device_count() > 0)
    except Exception:  # pragma: no cover
        return False


def mps_available() -> bool:
    torch = torch_module()
    try:
        return bool(torch and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:  # pragma: no cover
        return False


def hailo_platform_module() -> Any | None:
    """The HailoRT Python bindings, if the runtime is installed."""
    try:
        return importlib.import_module("hailo_platform")
    except Exception:
        return None


def hailo_runtime_installed() -> bool:
    """True when the HailoRT wheel is importable, regardless of hardware."""
    return hailo_platform_module() is not None


def hailo_available() -> bool:
    """True when HailoRT is importable *and* reports at least one device.

    A runtime without a board is reported as unavailable so the UI never offers
    a device that would fail at request time.
    """
    module = hailo_platform_module()
    if module is None:
        return False

    device = None
    try:
        device = module.Device()  # type: ignore[attr-defined]
    except Exception:
        return False

    try:
        scan = getattr(device, "scan", None)
        if callable(scan):
            scan()
    except Exception:
        return False
    finally:
        close = getattr(device, "close", None)
        if callable(close):
            # Best effort: the probe result is what matters, not the cleanup.
            with contextlib.suppress(Exception):
                close()
    return True


def hailo_compiler_available() -> bool:
    """True when the Hailo Dataflow Compiler is importable (HEF export)."""
    try:
        importlib.import_module("hailo_sdk_client")
    except Exception:
        return False
    return True


def hailo_arch_supported(arch: str) -> bool:
    return arch.lower() in HAILO_ARCHITECTURES


# ---------------------------------------------------------------------------
# device resolution
# ---------------------------------------------------------------------------

#: Aliases users reasonably type, mapped onto a canonical device string.
_DEVICE_ALIASES: dict[str, str] = {
    "": "auto",
    "auto": "auto",
    "none": "auto",
    "default": "auto",
    "automatic": "auto",
    "gpu": "cuda:0",
    "cuda": "cuda:0",
    "nvidia": "cuda:0",
    "torch": "cuda:0",
    "cpu": "cpu",
    "mps": "mps",
    "apple": "mps",
    "metal": "mps",
    "hailo": "hailo",
    "hailo8": "hailo",
    "hailo8l": "hailo",
    "hailo10h": "hailo",
    "hailo15h": "hailo",
    "hailo15l": "hailo",
    "npu": "hailo",
    "edge": "hailo",
}


def requested_device(requested: str | None = None) -> str:
    """Normalise a device request (config, request body or UI) to canonical form.

    Returns ``auto``, ``cpu``, ``cuda:N``, ``mps``, ``hailo``, or an accelerator
    string Ultralytics understands natively (``npu:N``, ``xpu:N``, …).
    """
    from ..config import settings

    raw = requested if requested is not None else settings.device
    value = str(raw or "auto").strip().lower()

    if value in _DEVICE_ALIASES:
        return _DEVICE_ALIASES[value]

    # Board names ("hailo8l") and indexed forms ("hailo:0") mean the accelerator.
    if value.startswith("hailo"):
        return "hailo"

    if value.startswith(("npu", "xpu", "tpu", "intel", "vulkan")):
        return value

    if value.startswith("cuda"):
        return value
    if value.isdigit():  # a bare index means "that CUDA device"
        return f"cuda:{value}"

    return "cpu"


def is_hailo(device: str | None = None) -> bool:
    return requested_device(device) == "hailo"


def resolve_device(requested: str | None = None) -> str:
    """Map a device choice onto a concrete, available device string."""
    value = requested_device(requested)

    if value == "auto":
        if cuda_available():
            return "cuda:0"
        if mps_available():
            return "mps"
        if hailo_available():
            return "hailo"
        return "cpu"

    if value.startswith("cuda"):
        return value if cuda_available() else "cpu"
    if value == "mps":
        return "mps" if mps_available() else "cpu"
    if value == "hailo":
        return "hailo"
    return value


def engine_device(requested: str | None = None) -> str:
    """The device string handed to Ultralytics.

    Hailo is not a torch device: HEF models run on the NPU while Ultralytics
    drives them from the host, so the engine receives ``cpu``. Everything else
    passes through unchanged.
    """
    resolved = resolve_device(requested)
    return "cpu" if resolved == "hailo" else resolved


# ---------------------------------------------------------------------------
# device catalog
# ---------------------------------------------------------------------------


def device_profile(device_id: str | None = None) -> dict[str, Any]:
    """Rich metadata for one device choice: availability, capability, notes."""
    from ..config import settings

    value = requested_device(device_id)

    if value == "hailo":
        from .hailo import describe_hailo_state

        runtime = hailo_runtime_installed()
        usable = hailo_available()
        compiler = hailo_compiler_available()
        state = describe_hailo_state()

        if usable:
            detail = f"HailoRT ready · arch {settings.hailo_arch}"
        elif runtime:
            detail = "HailoRT installed, but no board detected"
        else:
            detail = "HailoRT (hailo_platform) not installed"

        return {
            "id": "hailo",
            "label": "Hailo accelerator (NPU)",
            "kind": "hailo",
            "available": usable,
            "detail": detail,
            "capabilities": list(INFERENCE_MODES),
            "supports_training": False,
            "requires": ["hailo_platform (HailoRT)", "a compiled .hef model"],
            "notes": (
                "Inference only: Hailo executes compiled HEF networks through HailoRT. "
                "Train or fine-tune elsewhere, export with format=hailo, then switch to this profile."
            ),
            "model_hint": state.get("model"),
            "requirements": {
                "runtime": runtime,
                "device": usable,
                "compiler": compiler,
                "model": bool(state.get("model")),
            },
            "arch": settings.hailo_arch,
        }

    if value == "cpu":
        return {
            "id": "cpu",
            "label": f"CPU ({platform.machine()})",
            "kind": "cpu",
            "available": True,
            "detail": f"{os.cpu_count() or 1} logical cores",
            "capabilities": list(ALL_MODES),
            "supports_training": True,
            "requires": [],
            "notes": "Always available, and the reference for accuracy comparisons.",
        }

    if value == "mps":
        return {
            "id": "mps",
            "label": "Apple MPS",
            "kind": "mps",
            "available": mps_available(),
            "detail": "Metal Performance Shaders" if mps_available() else "no Apple GPU detected",
            "capabilities": list(ALL_MODES),
            "supports_training": True,
            "requires": ["Apple Silicon on macOS"],
            "notes": "Unified memory; most ops run in fp32.",
        }

    if value == "auto":
        resolved = resolve_device("auto")
        return {
            "id": "auto",
            "label": "Auto (best available)",
            "kind": "auto",
            "available": True,
            "detail": f"CUDA → MPS → Hailo → CPU · currently {resolved}",
            "capabilities": list(ALL_MODES),
            "supports_training": True,
            "requires": [],
            "notes": "Follows whatever hardware is present; never fails to resolve.",
            "resolves_to": resolved,
        }

    # CUDA (or another torch accelerator such as npu/xpu).
    torch = torch_module()
    if value.startswith("cuda"):
        available = cuda_available()
        detail = "no CUDA device visible"
        if available and torch is not None:
            index = int(value.split(":", 1)[1]) if ":" in value else 0
            try:
                props = torch.cuda.get_device_properties(index)
                detail = (
                    f"{props.name} · compute {props.major}.{props.minor} · {props.total_memory / (1024**3):.1f} GB VRAM"
                )
            except Exception:  # pragma: no cover - driver quirks
                detail = "CUDA device"
        return {
            "id": value,
            "label": value.upper().replace("CUDA:", "CUDA "),
            "kind": "cuda",
            "available": available,
            "detail": detail,
            "capabilities": list(ALL_MODES),
            "supports_training": True,
            "requires": ["a CUDA build of PyTorch", "a compatible NVIDIA driver"],
            "notes": "Full-precision training and inference; enable AMP for the biggest speed-up.",
        }

    return {
        "id": value,
        "label": value.upper(),
        "kind": value.split(":", 1)[0],
        "available": True,
        "detail": f"{value} accelerator",
        "capabilities": list(ALL_MODES),
        "supports_training": True,
        "requires": [],
        "notes": "Passed through to Ultralytics unchanged.",
    }


def list_devices() -> list[dict[str, Any]]:
    """Every selectable device, in presentation order, with capability metadata."""
    devices: list[dict[str, Any]] = [device_profile("auto")]

    torch = torch_module()
    if cuda_available() and torch is not None:
        for index in range(torch.cuda.device_count()):
            devices.append(device_profile(f"cuda:{index}"))
    else:
        # Advertise CUDA anyway so the UI can explain what it would need.
        devices.append(device_profile("cuda:0"))

    devices.append(device_profile("cpu"))

    if mps_available():
        devices.append(device_profile("mps"))

    # Hailo is always listed: on a Raspberry Pi, seeing the requirements is the point.
    devices.append(device_profile("hailo"))

    return devices


def device_is_usable(device_id: str | None = None) -> bool:
    return bool(device_profile(device_id).get("available"))


def capability_supported(device_id: str | None, capability: str) -> bool:
    return capability in (device_profile(device_id).get("capabilities") or [])


def device_config() -> dict[str, Any]:
    """Everything the UI needs to render and explain the device switch."""
    from ..config import REPO_ROOT, settings

    return {
        "env_var": "SIGHTRAIL_DEVICE",
        "configured": settings.device,
        "requested": requested_device(settings.device),
        "resolved": resolve_device(settings.device),
        "engine_device": engine_device(settings.device),
        "devices": list_devices(),
        "hailo": {
            "architecture": settings.hailo_arch,
            "architectures": [{"id": arch, **meta} for arch, meta in HAILO_ARCHITECTURES.items()],
            "model": settings.hailo_model,
            "dfc_python": settings.hailo_dfc_python,
            "runtime_installed": hailo_runtime_installed(),
            "device_present": hailo_available(),
            "compiler_installed": hailo_compiler_available(),
            "cli": shutil.which("hailortcli"),
            "python": sys.executable,
        },
        "env_file": str(REPO_ROOT / ".env"),
        "env_example": str(REPO_ROOT / ".env.example"),
        "env_file_exists": (REPO_ROOT / ".env").is_file(),
        "snippet": env_snippet(settings.device),
    }


def env_snippet(current: str | None = None) -> str:
    """A copy-pasteable ``.env`` block for switching device.

    Rendered from the live configuration so the values always match the running
    build (including the Hailo architecture and model path).
    """
    from ..config import settings

    active = requested_device(current if current is not None else settings.device)
    hailo_model = settings.hailo_model or "<path to a .hef or *_hailo_model dir>"

    lines = [
        "# ---- Compute device (uncomment exactly one) ----",
        f"{'#' if active != 'cpu' else ''}SIGHTRAIL_DEVICE=cpu",
        f"{'#' if active != 'cuda:0' else ''}SIGHTRAIL_DEVICE=cuda:0",
        f"{'#' if active != 'hailo' else ''}SIGHTRAIL_DEVICE=hailo",
    ]
    if active not in {"cpu", "cuda:0", "hailo"}:
        lines.append(f"SIGHTRAIL_DEVICE={active}")

    lines += [
        "",
        "# ---- Hailo accelerator (Raspberry Pi AI HAT / Hailo-8) ----",
        f"SIGHTRAIL_HAILO_MODEL={hailo_model}",
        f"SIGHTRAIL_HAILO_ARCH={settings.hailo_arch}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# environment snapshot
# ---------------------------------------------------------------------------


def _package_version(name: str) -> str | None:
    try:
        module = importlib.import_module(name.replace("-", "_"))
    except Exception:
        return None
    return getattr(module, "__version__", "installed")


def environment_info() -> dict[str, Any]:
    """Environment snapshot: versions, devices and Hailo readiness."""
    from ..config import settings

    torch = torch_module()
    ultralytics_version = _package_version("ultralytics")
    hailo_module = hailo_platform_module()
    machine = platform.machine()

    return {
        "app_version": __version__,
        "python": {
            "version": sys.version.split()[0],
            "implementation": platform.python_implementation(),
            "executable": sys.executable,
            "is_venv": sys.prefix != getattr(sys, "base_prefix", sys.prefix),
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": machine,
            "is_arm": machine.lower() in {"aarch64", "arm64", "armv7l", "armv8l"},
        },
        "torch": {
            "installed": torch is not None,
            "version": getattr(torch, "__version__", None),
            # `torch.version` is a module in a normal install but absent on some
            # minimal builds, so both hops are guarded.
            "cuda_build": getattr(getattr(torch, "version", None), "cuda", None),
            "cudnn": getattr(getattr(torch, "version", None), "cudnn", None),
            "cuda_available": cuda_available(),
            "mps_available": mps_available(),
        },
        "ultralytics": {
            "installed": ultralytics_version is not None,
            "version": ultralytics_version,
        },
        "device": {
            "configured": settings.device,
            "requested": requested_device(settings.device),
            "resolved": resolve_device(settings.device),
            "engine": engine_device(settings.device),
        },
        "hailo": {
            "runtime": hailo_runtime_installed(),
            "runtime_version": getattr(hailo_module, "__version__", None) if hailo_module else None,
            "device": hailo_available(),
            "compiler": hailo_compiler_available(),
            "arch": settings.hailo_arch,
            "model": settings.hailo_model,
        },
        "optional": {name: _package_version(name) for name in _OPTIONAL_PACKAGES},
        "cpu_count": os.cpu_count(),
    }


def memory_snapshot() -> dict[str, Any]:
    """Live memory usage - CPU RAM plus CUDA when available."""
    snapshot: dict[str, Any] = {"cpu": {}, "cuda": [], "hailo": None}
    try:
        import psutil

        vm = psutil.virtual_memory()
        snapshot["cpu"] = {
            "total_gb": round(vm.total / (1024**3), 2),
            "used_gb": round((vm.total - vm.available) / (1024**3), 2),
            "percent": vm.percent,
        }
    except Exception:  # pragma: no cover - psutil is a hard dep but be safe
        pass

    torch = torch_module()
    if cuda_available() and torch is not None:
        for index in range(torch.cuda.device_count()):
            try:
                free, total = torch.cuda.mem_get_info(index)
                snapshot["cuda"].append(
                    {
                        "index": index,
                        "name": torch.cuda.get_device_name(index),
                        "total_gb": round(total / (1024**3), 2),
                        "free_gb": round(free / (1024**3), 2),
                        "used_gb": round((total - free) / (1024**3), 2),
                        "allocated_gb": round(torch.cuda.memory_allocated(index) / (1024**3), 2),
                    }
                )
            except Exception:  # pragma: no cover
                continue

    if hailo_available():
        snapshot["hailo"] = {"state": "ready", "note": "Hailo NPU memory is managed by HailoRT"}

    return snapshot
