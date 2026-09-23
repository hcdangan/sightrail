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
import subprocess
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


#: PyTorch wheel indexes, by GPU generation.
#:
#: Blackwell needs CUDA 12.8+; Turing..Hopper are served by cu124. Verified against
#: https://download.pytorch.org/whl/cu128/torch/ (2.14.0 ships a cp312 win_amd64
#: wheel). Getting this wrong installs a wheel that succeeds and then fails at the
#: first kernel launch, so the index is derived from the detected card.
_CUDA_TORCH_INDEX_DEFAULT = "https://download.pytorch.org/whl/cu124"
_CUDA_TORCH_INDEX_BLACKWELL = "https://download.pytorch.org/whl/cu128"


def cuda_torch_index() -> str:
    """The PyTorch wheel index that actually supports the installed GPU.

    A single hardcoded index is wrong for most machines: Blackwell (RTX 50-series,
    sm_120) needs CUDA 12.8 or newer, and a cu124 wheel installs cleanly and then
    fails at the first kernel launch with "no kernel image is available". Turing
    through Hopper are covered by cu124. Cards below sm_75 have no current wheel
    at all.
    """
    capability = cuda_hardware()["compute_capability"]
    if capability is None:
        return _CUDA_TORCH_INDEX_DEFAULT
    if capability >= 10.0:  # Blackwell
        return _CUDA_TORCH_INDEX_BLACKWELL
    return _CUDA_TORCH_INDEX_DEFAULT


def _pip_cuda_install(index_url: str) -> str:
    """The reinstall command for this platform, as copy-pasteable text."""
    return (
        "uv pip install --python .venv/Scripts/python.exe torch torchvision "
        f"--index-url {index_url}\n"
        "# macOS / Linux:\n"
        f"uv pip install --python .venv/bin/python torch torchvision --index-url {index_url}"
    )


#: Lowest compute capability current CUDA toolkits (13.x) compile for.
#:
#: Maxwell (sm_50), Pascal (sm_60) and Volta (sm_70) were dropped: CUDA 13.x
#: covers Turing (sm_75) and newer. A card below this cannot run a current CUDA
#: build at all, so "reinstall torch from the CUDA index" is advice that fails.
#: https://dev-discuss.pytorch.org/t/notice-cuda-12-6-wheels-will-no-longer-be-published-from-pytorch-2-15-drops-maxwell-pascal-volta/3432
_MIN_CUDA_COMPUTE_CAPABILITY = 7.5

_NVIDIA_QUERY = "name,compute_cap,driver_version,memory.total"


def _run_nvidia_smi(args: list[str]) -> subprocess.CompletedProcess[str] | None:
    """Run ``nvidia-smi`` with fixed argv; ``None`` when it is unusable."""
    executable = shutil.which("nvidia-smi")
    if not executable:
        return None
    try:
        return subprocess.run(  # noqa: S603 - fixed argv, no shell
            [executable, *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):  # pragma: no cover - driver quirks
        return None


def _parse_compute_capability(value: str) -> float | None:
    """``"5.0"`` → ``5.0``; tolerant of the ``N/A`` an old driver may report."""
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=1)
def cuda_hardware() -> dict[str, Any]:
    """What NVIDIA hardware and driver are actually present.

    Describes the *card*, independently of torch. This is the question that has to
    be answered before recommending a torch reinstall: a CPU-only torch build
    reports ``device_count() == 0`` whether or not a card exists, and a card can be
    present yet too old for any current CUDA build.
    """
    facts: dict[str, Any] = {
        "present": False,
        "name": None,
        "compute_capability": None,
        "driver": None,
        "memory_mb": None,
        "supported": False,
    }

    # torch's own view is authoritative when it can see devices.
    torch = torch_module()
    if torch is not None and cuda_available():
        facts["present"] = True
        facts["supported"] = True
        with contextlib.suppress(Exception):
            facts["name"] = torch.cuda.get_device_name(0)
        with contextlib.suppress(Exception):
            major, minor = torch.cuda.get_device_capability(0)
            facts["compute_capability"] = float(f"{major}.{minor}")
        with contextlib.suppress(Exception):
            facts["memory_mb"] = int(torch.cuda.get_device_properties(0).total_memory / (1024**2))
        return facts

    completed = _run_nvidia_smi([f"--query-gpu={_NVIDIA_QUERY}", "--format=csv,noheader"])
    if completed is None or completed.returncode != 0:
        return facts

    rows = [row for row in completed.stdout.strip().splitlines() if row.strip()]
    if not rows:
        return facts

    # The first GPU decides: the UI offers a single CUDA profile by default.
    fields = [part.strip() for part in rows[0].split(",")]
    facts["present"] = True
    facts["name"] = fields[0] or None
    if len(fields) > 1:
        facts["compute_capability"] = _parse_compute_capability(fields[1])
    if len(fields) > 2 and fields[2] and fields[2].upper() != "N/A":
        facts["driver"] = fields[2]
    if len(fields) > 3:
        with contextlib.suppress(ValueError):
            facts["memory_mb"] = int("".join(ch for ch in fields[3] if ch.isdigit()) or 0)

    capability = facts["compute_capability"]
    # Unknown capability is treated as supported: better to let the user try than
    # to declare a card unusable on the strength of an absent number.
    facts["supported"] = capability is None or capability >= _MIN_CUDA_COMPUTE_CAPABILITY
    return facts


def nvidia_driver_version() -> str | None:
    """The installed NVIDIA driver version, or ``None`` when there is no GPU."""
    return cuda_hardware()["driver"]


def nvidia_hardware_present() -> bool:
    """True when an NVIDIA GPU is visible to this machine."""
    return bool(cuda_hardware()["present"])


@lru_cache(maxsize=1)
def cuda_state() -> dict[str, Any]:
    """Why CUDA is (or is not) usable, in the user's terms.

    ``cuda_available()`` returning False is not one condition but several, and
    they need *opposite* fixes:

    * **no NVIDIA card at all** — nothing to fix. Reinstalling torch for CUDA
      would install a build that still finds no device, so the honest answer is
      "this machine has no CUDA GPU; use CPU, or MPS on Apple silicon";
    * the installed torch is a **CPU-only wheel** — a card *is* present, but this
      build has no CUDA compiled in, so torch must be reinstalled;
    * torch **is** a CUDA build but sees no usable device — the driver is missing
      or older than the toolkit torch was built against.

    Hardware presence is deliberately checked *first*. A CPU-only torch reports
    ``device_count() == 0`` regardless of whether a card exists, so testing the
    wheel before the hardware makes every CUDA-less machine look like a
    reinstall-the-wheel problem — advice that can never succeed on it.
    """
    torch = torch_module()
    cuda_build = getattr(getattr(torch, "version", None), "cuda", None)
    hardware = cuda_hardware()
    driver = hardware["driver"]
    capability = hardware["compute_capability"]

    if torch is None:
        return {
            "status": "torch-missing",
            "summary": "PyTorch is not installed in the API environment.",
            "torch_version": None,
            "torch_cuda": None,
            "hardware": hardware,
            "driver": driver,
            "compute_capability": capability,
            "device_count": 0,
            "verify": [],
            "steps": [
                {
                    "title": "Install the API requirements",
                    "detail": "npm run bootstrap",
                }
            ],
        }

    version = getattr(torch, "__version__", None)
    cuda_build = getattr(getattr(torch, "version", None), "cuda", None)
    count = 0
    with contextlib.suppress(Exception):
        count = int(torch.cuda.device_count())

    # A CUDA build can see a GPU it has no kernels for. `is_available()` returns
    # True (the driver handshake succeeds) and inference then dies with "no kernel
    # image is available". Checking the compiled architecture list is the only way
    # to tell that apart from a working setup — the exact case of a cu124 wheel on
    # a Blackwell card.
    if cuda_available():
        arch_list: list[str] = []
        with contextlib.suppress(Exception):
            arch_list = [str(arch) for arch in torch.cuda.get_arch_list()]
        if arch_list and capability is not None:
            wanted = f"sm_{int(capability * 10)}"
            if wanted not in arch_list:
                index_url = cuda_torch_index()
                return {
                    "status": "gpu-not-in-torch-build",
                    "summary": (
                        f"PyTorch can see the GPU ({hardware['name']}) but this build has no kernels for it: "
                        f"it was compiled for {', '.join(arch_list)} and the card needs {wanted}. Inference "
                        "fails at the first kernel launch. Reinstall torch from a CUDA index that covers this "
                        "card — Blackwell (RTX 50-series) needs cu128 or newer."
                    ),
                    "torch_version": version,
                    "torch_cuda": cuda_build,
                    "hardware": hardware,
                    "driver": driver,
                    "compute_capability": capability,
                    "arch_list": arch_list,
                    "torch_index": index_url,
                    "device_count": count,
                    "verify": [
                        'python -c "import torch; print(torch.cuda.get_arch_list())"',
                        f"# {wanted} must appear in that list",
                    ],
                    "steps": [
                        {
                            "title": "Install a torch built for this GPU",
                            "detail": _pip_cuda_install(index_url),
                        },
                        {
                            "title": "Restart the API",
                            "detail": "The new build is only picked up by a fresh process.",
                        },
                    ],
                }

    if cuda_available():
        return {
            "status": "ready",
            "summary": f"CUDA is available ({count} device{'s' if count != 1 else ''}).",
            "torch_version": version,
            "torch_cuda": cuda_build,
            "hardware": hardware,
            "driver": driver,
            "compute_capability": capability,
            "device_count": count,
            "verify": ['python -c "import torch; print(torch.cuda.get_device_name(0))"'],
            "steps": [],
        }

    # No card at all: a fact about the machine, not a misconfiguration. Saying
    # "reinstall torch" here would be advice that cannot succeed.
    if not hardware["present"]:
        return {
            "status": "no-cuda-hardware",
            "summary": (
                "This machine has no NVIDIA GPU, so CUDA is not an option here. "
                "CPU runs every mode; on Apple silicon use MPS."
            ),
            "torch_version": version,
            "torch_cuda": cuda_build,
            "hardware": hardware,
            "driver": None,
            "compute_capability": None,
            "device_count": 0,
            "verify": [
                "nvidia-smi",
                "# 'command not found' or 'No devices were found' confirms there is no NVIDIA GPU",
            ],
            "steps": [],
        }

    # A card that is present but older than any current CUDA build supports. This
    # is the case that makes a plain "reinstall torch" wrong: the card is visible,
    # so hardware detection alone would clear it, yet no published wheel runs it.
    if not hardware["supported"]:
        return {
            "status": "unsupported-gpu",
            "summary": (
                f"The installed GPU ({hardware['name']}) is compute capability {capability}, and current CUDA "
                f"toolkits compile for {_MIN_CUDA_COMPUTE_CAPABILITY} and above, so no published CUDA build of "
                "PyTorch will run on it. Use CPU here."
            ),
            "torch_version": version,
            "torch_cuda": cuda_build,
            "hardware": hardware,
            "driver": driver,
            "compute_capability": capability,
            "device_count": 0,
            "verify": [
                f"nvidia-smi --query-gpu=name,compute_cap --format=csv   # reports {capability}",
                "# Anything below 7.5 (Turing) is outside current CUDA builds",
            ],
            "steps": [
                {
                    "title": "Use CPU (recommended)",
                    "detail": (
                        "Leave SIGHTRAIL_DEVICE=cpu. Every mode works; inference on a small model is "
                        "roughly 100-200 ms/frame, and training is slower but functional."
                    ),
                },
                {
                    "title": "If you need GPU inference, run it elsewhere",
                    "detail": (
                        "Any machine with a Turing-or-newer NVIDIA GPU (or an Apple silicon Mac via MPS) "
                        "will run this unchanged: the same repository, the same .env, SIGHTRAIL_DEVICE=cuda:0. "
                        "You can also offload just the heavy jobs by exporting a model and running it on "
                        "another host."
                    ),
                },
                {
                    "title": "Building an old PyTorch from source is not worth it",
                    "detail": (
                        "Prebuilt Maxwell/Pascal/Volta CUDA wheels ended at PyTorch 2.14 with CUDA 12.6, and "
                        "Ultralytics requires a recent torch. Supporting this card would mean compiling "
                        "PyTorch yourself and pinning the whole stack back, with no guarantee Ultralytics "
                        "still accepts it."
                    ),
                },
            ],
        }

    if not cuda_build:
        index_url = cuda_torch_index()
        return {
            "status": "cpu-only-torch",
            "summary": (
                f"An NVIDIA GPU ({hardware['name']}, compute {capability}) is present and supported, but the "
                f"installed PyTorch ({version}) is a CPU-only build — it was compiled without CUDA, so the GPU "
                "cannot be used. Reinstall torch from the CUDA index below."
            ),
            "torch_version": version,
            "torch_cuda": None,
            "hardware": hardware,
            "driver": driver,
            "compute_capability": capability,
            "torch_index": index_url,
            "device_count": 0,
            "verify": [
                'python -c "import torch; print(torch.__version__, torch.version.cuda)"',
                "# torch.version.cuda must not be None",
            ],
            "steps": [
                {
                    "title": "Reinstall PyTorch with CUDA support",
                    "detail": _pip_cuda_install(index_url),
                },
                {
                    "title": "Confirm the build now reports CUDA",
                    "detail": 'python -c "import torch; print(torch.version.cuda, torch.cuda.is_available())"',
                },
                {
                    "title": "Restart the API and switch the device",
                    "detail": (
                        "Set SIGHTRAIL_DEVICE=cuda:0 in .env (or pick CUDA in the UI), then restart "
                        "so the new torch is loaded."
                    ),
                },
            ],
        }

    return {
        "status": "driver-unavailable",
        "summary": (
            f"An NVIDIA GPU is visible to the system, and PyTorch is a CUDA build (cu{cuda_build}), but torch "
            "cannot use it. The driver is usually older than the toolkit torch was built against."
        ),
        "torch_version": version,
        "torch_cuda": cuda_build,
        "hardware": True,
        "driver": driver,
        "device_count": 0,
        "verify": [
            "nvidia-smi",
            '# then: python -c "import torch; print(torch.cuda.is_available())"',
        ],
        "steps": [
            {
                "title": "Check the driver sees the GPU",
                "detail": (
                    "nvidia-smi\n# Should list the card and the driver version. If this fails, install "
                    "or update the NVIDIA driver."
                ),
            },
            {
                "title": "Check the driver is new enough",
                "detail": (
                    f"The installed torch was built against CUDA {cuda_build}. NVIDIA drivers are backward "
                    "compatible, so the driver must be at least as new as that toolkit. Check the requirement "
                    "at https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/"
                ),
            },
            {
                "title": "Or install a torch built for an older toolkit",
                "detail": (
                    "If the driver cannot be upgraded, install a matching wheel, e.g. cu121:\n"
                    "uv pip install --python .venv/Scripts/python.exe torch torchvision "
                    "--index-url https://download.pytorch.org/whl/cu121"
                ),
            },
        ],
    }


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
        state = cuda_state()
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
        elif not available:
            # Say which of the several CUDA failure modes this is, rather than a
            # generic requirements list the user cannot act on.
            detail = state["summary"]
        # With no card installed, "a CUDA build of PyTorch" is not the missing
        # piece — the GPU is. Naming the requirements in that order invites a
        # reinstall that cannot help.
        requires = (
            ["an NVIDIA GPU in this machine"]
            if state["status"] == "no-cuda-hardware"
            else ["a CUDA build of PyTorch", "a compatible NVIDIA driver"]
        )
        return {
            "id": value,
            "label": value.upper().replace("CUDA:", "CUDA "),
            "kind": "cuda",
            "available": available,
            "detail": detail,
            "capabilities": list(ALL_MODES),
            "supports_training": True,
            "requires": requires,
            "notes": "Full-precision training and inference; enable AMP for the biggest speed-up.",
            "state": state["status"],
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
        #: CUDA readiness, the counterpart to ``hailo`` below. ``None``-safe to
        #: render: the UI shows it only when CUDA cannot be used.
        "cuda_state": cuda_state(),
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
