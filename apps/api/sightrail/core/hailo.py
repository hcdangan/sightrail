"""Hailo accelerator support.

Hailo is unlike the other compute targets this app supports:

* Ultralytics runs a *compiled* network (``.hef``) through HailoRT, not a ``.pt``
  checkpoint. There is no torch device involved.
* Training and validation are impossible - the NPU has no backward pass. The
  workflow is: train/export elsewhere, then *infer* on Hailo.
* Exporting to HEF needs the Hailo Dataflow Compiler (Linux x86_64 only) plus a
  calibration dataset.

This module owns everything specific to that story: locating a usable HEF,
explaining precisely what is missing when one is not, and validating export
requests before they reach the engine.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import settings
from .device import (
    HAILO_ARCHITECTURES,
    engine_device,
    hailo_arch_supported,
    hailo_available,
    hailo_compiler_available,
    hailo_runtime_installed,
    is_hailo,
)

#: Suffix that Ultralytics gives a Hailo export directory.
HAILO_EXPORT_SUFFIX = "_hailo_model"


class HailoError(RuntimeError):
    """Raised when a Hailo request cannot be satisfied, with a fix suggestion."""

    def __init__(self, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.hint = hint


# ---------------------------------------------------------------------------
# discovery
# ---------------------------------------------------------------------------


def _is_hef_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() == ".hef"


def _hef_in(directory: Path) -> Path | None:
    if not directory.is_dir():
        return None
    return next((candidate for candidate in sorted(directory.rglob("*.hef")) if _is_hef_file(candidate)), None)


def find_hef(explicit: str | None = None) -> Path | None:
    """Locate a HEF model.

    Resolution order: the given path (file or export directory), then
    ``SIGHTRAIL_HAILO_MODEL``, then the newest HEF under ``storage/weights``.
    """
    candidates: list[Path] = []

    raw = explicit or settings.hailo_model
    if raw:
        candidates.append(Path(raw).expanduser())

    weights = settings.weights_dir
    if weights.exists():
        # Newest first so a fresh export wins over an older one.
        hefs = [path for path in weights.rglob("*.hef") if _is_hef_file(path)]
        hefs.sort(key=lambda path: path.stat().st_mtime, reverse=True)
        candidates.extend(hefs)

    for candidate in candidates:
        if _is_hef_file(candidate):
            return candidate.resolve()
        nested = _hef_in(candidate)
        if nested is not None:
            return nested.resolve()
    return None


def hailo_model_dir() -> Path | None:
    """The export directory containing the active HEF, when it has one."""
    hef = find_hef()
    if hef is None:
        return None
    # ``model_hailo_model/model.hef`` -> return the export directory.
    parent = hef.parent
    return parent if parent.name.endswith(HAILO_EXPORT_SUFFIX) or (parent / "metadata.yaml").is_file() else None


def describe_hailo_state() -> dict[str, Any]:
    """A complete, user-facing picture of Hailo readiness on this host."""
    hef = find_hef()
    runtime = hailo_runtime_installed()
    device = hailo_available()
    compiler = hailo_compiler_available()
    arch = (settings.hailo_arch or "hailo8l").lower()

    if not runtime:
        status = "runtime-missing"
        summary = "HailoRT is not installed: pip install hailo_platform"
    elif not device:
        status = "device-missing"
        summary = "HailoRT is installed but no Hailo board was detected"
    elif hef is None:
        status = "model-missing"
        summary = "Board ready, but no .hef model found"
    else:
        status = "ready"
        summary = f"Ready · {hef.name}"

    return {
        "status": status,
        "summary": summary,
        "runtime": runtime,
        "device": device,
        "compiler": compiler,
        "arch": arch,
        "arch_label": HAILO_ARCHITECTURES.get(arch, {}).get("label", arch),
        "arch_supported": hailo_arch_supported(arch),
        "model": str(hef) if hef else None,
        "model_name": hef.name if hef else None,
        "model_dir": str(hailo_model_dir()) if hailo_model_dir() else None,
        "configured_model": settings.hailo_model,
        "searched": [
            str(settings.weights_dir),
            str(Path(settings.hailo_model).expanduser()) if settings.hailo_model else None,
        ],
        "steps": hailo_setup_steps(),
    }


def hailo_setup_steps() -> list[dict[str, str]]:
    """Ordered, copy-pasteable setup instructions for the current state."""
    arch = (settings.hailo_arch or "hailo8l").lower()
    steps: list[dict[str, str]] = []

    if not hailo_runtime_installed():
        steps.append(
            {
                "title": "Install HailoRT",
                "detail": (
                    "On Raspberry Pi OS install the Hailo runtime that matches your kernel:\n"
                    "  sudo apt update && sudo apt install hailo-all\n"
                    "  # or: pip install hailo_platform==<matching version>\n"
                    "Reboot, then verify with: hailortcli fw-control identify"
                ),
            }
        )

    if not hailo_available():
        steps.append(
            {
                "title": "Attach and detect the board",
                "detail": (
                    "Confirm the accelerator is visible:\n"
                    "  hailortcli scan\n"
                    "On a Raspberry Pi AI Kit/HAT+ also enable PCIe Gen 3 for full bandwidth:\n"
                    "  add 'dtparam=pciex1_gen=3' to /boot/firmware/config.txt and reboot"
                ),
            }
        )

    if find_hef() is None:
        steps.append(
            {
                "title": "Compile or copy a HEF model",
                "detail": (
                    "Train a small model (e.g. yolo11n) first, then either:\n"
                    f"  * Export from this app with format=hailo and arch={arch} "
                    "(needs the Dataflow Compiler on Linux x86_64, plus data= for calibration), or\n"
                    "  * copy an existing *_hailo_model directory / .hef into storage/weights\n"
                    "Then set SIGHTRAIL_HAILO_MODEL to that path if auto-discovery misses it."
                ),
            }
        )

    steps.append(
        {
            "title": "Switch the device",
            "detail": "Set SIGHTRAIL_DEVICE=hailo in .env and restart the API, or pick the Hailo profile in the UI.",
        }
    )
    return steps


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


def resolve_hailo_checkpoint(explicit: str | None = None) -> Path:
    """Return the HEF to load, or raise :class:`HailoError` explaining why not.

    Also accepts a directory produced by Export mode so users can point at the
    ``*_hailo_model`` folder rather than the file inside it.
    """
    if not hailo_runtime_installed():
        raise HailoError(
            "Hailo inference requires the HailoRT runtime, which is not installed in this environment.",
            hint="On Raspberry Pi OS run: sudo apt install hailo-all  |  or: pip install hailo_platform",
        )

    if not hailo_available():
        raise HailoError(
            "HailoRT is installed but no Hailo accelerator was detected.",
            hint=(
                "Check the board with `hailortcli scan`; on a Pi AI Kit enable PCIe Gen 3 in /boot/firmware/config.txt."
            ),
        )

    source = explicit or settings.hailo_model
    if source:
        candidate = Path(source).expanduser()
        if candidate.is_dir() and not _hef_in(candidate):
            raise HailoError(
                f"No .hef file was found inside '{candidate}'.",
                hint="Point SIGHTRAIL_HAILO_MODEL at the .hef file or at the *_hailo_model export directory.",
            )
        if candidate.is_file() and candidate.suffix.lower() != ".hef":
            raise HailoError(
                f"'{candidate.name}' is not a HEF model. Hailo runs compiled .hef networks, not .pt checkpoints.",
                hint="Switch to CPU or CUDA to run this checkpoint, or export it with format=hailo first.",
            )

    hef = find_hef(explicit)
    if hef is None:
        raise HailoError(
            "No compiled HEF model is available for Hailo inference.",
            hint=(
                "Export one with format=hailo (Export page) or copy a *_hailo_model directory into "
                "storage/weights, then set SIGHTRAIL_HAILO_MODEL."
            ),
        )
    return hef


def validate_export_request(fmt: str, params: dict[str, Any]) -> None:
    """Reject a Hailo export early, with every reason and its fix.

    All applicable problems are collected so the user learns everything that
    needs changing in one pass, rather than discovering them one compile at a
    time across a multi-minute feedback loop.
    """
    if fmt != "hailo":
        return

    import platform

    problems: list[str] = []
    hints: list[str] = []

    system = platform.system().lower()
    machine = platform.machine().lower()
    if system != "linux" or machine not in {"x86_64", "amd64"}:
        problems.append("Hailo HEF compilation is only supported on Linux x86_64.")
        hints.append(
            "Compile on a Linux x86_64 host (or the Hailo AI Software Suite container), then copy the "
            "resulting *_hailo_model directory to the Raspberry Pi. Inference on the Pi works either way."
        )

    if not hailo_compiler_available():
        problems.append("The Hailo Dataflow Compiler (hailo_sdk_client) is not installed.")
        hints.append(
            "Install the Hailo AI Software Suite and run this API inside its container, or set "
            "SIGHTRAIL_HAILO_DFC_PYTHON to an interpreter that has hailo_sdk_client."
        )

    arch = str(params.get("name") or params.get("hailo_arch") or settings.hailo_arch or "hailo8l").lower()
    if not hailo_arch_supported(arch):
        problems.append(f"'{arch}' is not a supported Hailo architecture.")
        hints.append(f"Choose one of: {', '.join(HAILO_ARCHITECTURES)}.")

    if not params.get("data"):
        problems.append("A calibration dataset is required for Hailo INT8 quantisation.")
        hints.append("Set 'Calibration dataset' on the Export page (e.g. coco8.yaml); Hailo recommends 1024+ images.")

    task = str(params.get("task") or "").lower()
    if task and task not in {"detect", "classify"}:
        problems.append(f"Hailo export supports detection and classification models, not task='{task}'.")
        hints.append("Export a detect or classify checkpoint, or keep using CPU/CUDA for this task.")

    if problems:
        raise HailoError(" ".join(problems), hint=" ".join(hints))


def guard_mode(device_id: str | None, mode: str, *, job_label: str | None = None) -> None:
    """Raise when a mode is impossible on the selected device (e.g. Hailo train)."""
    if not is_hailo(device_id):
        return
    if mode in {"train", "val"}:
        label = job_label or mode
        raise HailoError(
            f"Hailo accelerators cannot run {label}: compiled HEF networks have no backward pass.",
            hint=(
                "Train and validate on cpu/cuda, then export with format=hailo and switch "
                "SIGHTRAIL_DEVICE=hailo for inference."
            ),
        )


def engine_device_for(device_id: str | None) -> str:
    """Public alias so routers do not need to import ``device`` directly."""
    return engine_device(device_id)


__all__ = [
    "HAILO_ARCHITECTURES",
    "HAILO_EXPORT_SUFFIX",
    "HailoError",
    "describe_hailo_state",
    "engine_device_for",
    "find_hef",
    "guard_mode",
    "hailo_model_dir",
    "hailo_setup_steps",
    "resolve_hailo_checkpoint",
    "validate_export_request",
]
