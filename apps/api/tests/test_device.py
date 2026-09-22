"""Device selection tests: the CPU/CUDA/Hailo switch and its guard rails.

These run without any accelerator present, which is the point: the profiles,
aliases, guards and guidance must all behave correctly on a machine that has
none of the hardware.
"""

from __future__ import annotations

import platform

import pytest

from sightrail.core import device as device_mod
from sightrail.core import hailo
from sightrail.core.device import (
    engine_device,
    is_hailo,
    list_devices,
    requested_device,
    resolve_device,
)
from sightrail.core.hailo import HailoError

# --------------------------------------------------------------------- aliases


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("cpu", "cpu"),
        ("CPU", "cpu"),
        (" cpu ", "cpu"),
        ("", "auto"),
        ("auto", "auto"),
        ("default", "auto"),
        ("gpu", "cuda:0"),
        ("cuda", "cuda:0"),
        ("cuda:0", "cuda:0"),
        ("cuda:1", "cuda:1"),
        ("0", "cuda:0"),
        ("1", "cuda:1"),
        ("mps", "mps"),
        ("metal", "mps"),
        ("hailo", "hailo"),
        ("hailo8l", "hailo"),
        ("hailo15h", "hailo"),
        ("npu", "hailo"),
        ("npu:0", "npu:0"),
        # Anything unrecognised must degrade to something that works.
        ("quantum", "cpu"),
    ],
)
def test_requested_device_aliases(raw, expected):
    assert requested_device(raw) == expected


def test_requested_device_falls_back_to_configuration(monkeypatch):
    """With no explicit request, the configured value decides.

    ``settings`` is a process-wide singleton, so the test patches it directly
    rather than relying on ``.env`` contents (which vary per developer).
    """
    from sightrail import config as config_mod

    monkeypatch.setattr(config_mod.settings, "device", "cuda:0")
    assert requested_device(None) == "cuda:0"

    monkeypatch.setattr(config_mod.settings, "device", "hailo")
    assert requested_device(None) == "hailo"

    # An explicit argument always wins over the configured default.
    assert requested_device("cpu") == "cpu"


def test_configured_device_parsing(monkeypatch):
    from sightrail.config import Settings

    monkeypatch.setenv("SIGHTRAIL_DEVICE", "auto")
    assert Settings().device == "auto"

    # An empty value in .env means "auto" rather than "no device".
    monkeypatch.setenv("SIGHTRAIL_DEVICE", "")
    assert Settings().device == "auto"

    monkeypatch.setenv("SIGHTRAIL_DEVICE", " cuda:1 ")
    assert Settings().device == "cuda:1"


def test_legacy_env_var_still_works(monkeypatch):
    """`SIGHTRAIL_DEFAULT_DEVICE` is accepted for backwards compatibility."""
    from sightrail.config import Settings

    monkeypatch.delenv("SIGHTRAIL_DEVICE", raising=False)
    monkeypatch.setenv("SIGHTRAIL_DEFAULT_DEVICE", "cpu")
    assert Settings().device == "cpu"

    monkeypatch.setenv("SIGHTRAIL_DEVICE", "cuda:0")
    assert Settings().device == "cuda:0"  # the modern name wins


# ------------------------------------------------------------------- resolution


def test_cpu_is_always_resolvable():
    assert resolve_device("cpu") == "cpu"
    assert engine_device("cpu") == "cpu"


def test_hailo_resolves_to_hailo_but_drives_the_engine_as_cpu():
    """Hailo is not a torch device: the host side runs on CPU."""
    assert resolve_device("hailo") == "hailo"
    assert engine_device("hailo") == "cpu"
    assert is_hailo("hailo") is True
    assert is_hailo("Hailo8L") is True
    assert is_hailo("cpu") is False


def test_cuda_falls_back_to_cpu_without_a_gpu():
    """The important safety property: no CUDA hardware must not break the app."""
    if device_mod.cuda_available():  # pragma: no cover - GPU machine
        pytest.skip("this host has CUDA, so the fallback path is not exercised")
    assert resolve_device("cuda:0") == "cpu"
    assert engine_device("cuda:0") == "cpu"


def test_auto_never_fails():
    assert resolve_device("auto") in {"cpu", "cuda:0", "mps", "hailo"}


# --------------------------------------------------------------------- profiles


def test_list_devices_always_includes_cpu_cuda_and_hailo():
    """All three documented profiles are visible even when unavailable."""
    ids = {entry["id"] for entry in list_devices()}
    assert {"auto", "cpu", "hailo"} <= ids
    assert any(entry.startswith("cuda") for entry in ids)


def test_hailo_profile_is_flagged_inference_only():
    profile = device_mod.device_profile("hailo")
    assert profile["kind"] == "hailo"
    assert profile["supports_training"] is False
    assert "train" not in profile["capabilities"]
    assert {"predict", "track", "export"} <= set(profile["capabilities"])
    assert profile["requires"], "the UI needs to explain what Hailo needs"
    assert set(profile["requirements"]) == {"runtime", "device", "compiler", "model"}


def test_cpu_and_cuda_profiles_support_every_mode():
    for device_id in ("cpu", "cuda:0"):
        profile = device_mod.device_profile(device_id)
        assert profile["supports_training"] is True
        assert set(profile["capabilities"]) == {"predict", "track", "train", "val", "export", "benchmark"}


def test_auto_profile_reports_what_it_resolves_to():
    profile = device_mod.device_profile("auto")
    assert profile["resolves_to"] == resolve_device("auto")


def test_capability_helper():
    assert device_mod.capability_supported("hailo", "predict") is True
    assert device_mod.capability_supported("hailo", "train") is False
    assert device_mod.capability_supported("cpu", "train") is True


# ------------------------------------------------------------------ config view


def test_device_config_payload_shape():
    from sightrail.core.device import device_config

    payload = device_config()
    for key in ("env_var", "configured", "resolved", "engine_device", "devices", "hailo", "snippet"):
        assert key in payload
    assert payload["env_var"] == "SIGHTRAIL_DEVICE"
    assert "SIGHTRAIL_DEVICE=cpu" in payload["snippet"]
    assert "SIGHTRAIL_HAILO_ARCH" in payload["snippet"]
    assert {entry["id"] for entry in payload["hailo"]["architectures"]} >= {"hailo8l", "hailo8"}


def test_env_snippet_marks_the_active_choice():
    from sightrail.core.device import env_snippet

    cpu_snippet = env_snippet("cpu")
    assert "\nSIGHTRAIL_DEVICE=cpu" in cpu_snippet
    assert "#SIGHTRAIL_DEVICE=hailo" in cpu_snippet

    hailo_snippet = env_snippet("hailo")
    assert "\nSIGHTRAIL_DEVICE=hailo" in hailo_snippet
    assert "#SIGHTRAIL_DEVICE=cpu" in hailo_snippet


# ------------------------------------------------------------------ hailo guards


@pytest.mark.parametrize("mode", ["train", "val"])
def test_hailo_refuses_training_modes(mode):
    with pytest.raises(HailoError) as excinfo:
        hailo.guard_mode("hailo", mode)
    message = str(excinfo.value)
    assert "cannot run" in message
    assert excinfo.value.hint, "the error must say what to do instead"
    assert "export" in excinfo.value.hint.lower()


@pytest.mark.parametrize("mode", ["predict", "track", "export"])
def test_hailo_allows_inference_modes(mode):
    assert hailo.guard_mode("hailo", mode) is None


def test_guards_do_not_apply_to_other_devices():
    for device_id in ("cpu", "cuda:0", "auto"):
        assert hailo.guard_mode(device_id, "train") is None


def test_hailo_checkpoint_requires_the_runtime_first():
    if device_mod.hailo_runtime_installed():  # pragma: no cover - Pi only
        pytest.skip("HailoRT is installed on this host")
    with pytest.raises(HailoError) as excinfo:
        hailo.resolve_hailo_checkpoint()
    assert "HailoRT" in str(excinfo.value)
    assert "hailo-all" in (excinfo.value.hint or "")


@pytest.mark.parametrize(
    ("system", "machine", "host_restriction_applies"),
    [
        ("Linux", "x86_64", False),
        ("Linux", "aarch64", True),
        ("Windows", "AMD64", True),
        ("Darwin", "arm64", True),
    ],
)
def test_hailo_export_reports_every_applicable_problem(monkeypatch, system, machine, host_restriction_applies):
    """Every applicable problem is reported in one pass, not one at a time.

    The host restriction is the subtle case: HEF compilation needs Linux x86_64,
    so the problem is *absent* on the CI runner and *present* on a developer's
    Windows box. Asserting it unconditionally - as this test first did - passes
    locally and fails in CI. The platform is simulated for all four cases, so
    both branches are covered no matter which host runs the suite.
    """
    monkeypatch.setattr(platform, "system", lambda: system)
    monkeypatch.setattr(platform, "machine", lambda: machine)

    with pytest.raises(HailoError) as excinfo:
        hailo.validate_export_request("hailo", {"task": "segment"})
    message = str(excinfo.value)

    # Unconditional: no calibration dataset was supplied, and a 'segment'
    # checkpoint has no HEF exporter. Both apply on every platform.
    assert "calibration" in message  # missing dataset
    assert "segment" in message  # unsupported task

    if host_restriction_applies:
        assert "x86_64" in message  # host restriction
    else:
        # On Linux x86_64 the host is fine, so claiming otherwise would be a
        # false blocker - which is exactly what the old assertion demanded.
        assert "x86_64" not in message


def test_non_hailo_export_formats_are_untouched():
    for fmt in ("onnx", "engine", "tflite", "torchscript"):
        assert hailo.validate_export_request(fmt, {}) is None


def test_hailo_arch_catalogue():
    assert device_mod.hailo_arch_supported("hailo8l")
    assert device_mod.hailo_arch_supported("HAILO8")
    assert not device_mod.hailo_arch_supported("hailo99")
    assert "hailo8l" in device_mod.HAILO_ARCHITECTURES


def test_hef_discovery_returns_none_when_there_is_no_model():
    """Discovery must never raise - the UI calls it on every page load."""
    found = hailo.find_hef()
    assert found is None or found.suffix.lower() == ".hef"


def test_hailo_state_reports_a_status_and_next_steps():
    state = hailo.describe_hailo_state()
    assert state["status"] in {"ready", "runtime-missing", "device-missing", "model-missing"}
    assert state["summary"]
    assert state["steps"], "setup guidance should always be available"
    assert all({"title", "detail"} <= set(step) for step in state["steps"])


# --------------------------------------------------------------------- API view


def test_device_config_endpoint(client):
    payload = client.get("/api/system/device-config").json()
    assert payload["env_var"] == "SIGHTRAIL_DEVICE"
    ids = {entry["id"] for entry in payload["devices"]}
    assert {"auto", "cpu", "hailo"} <= ids
    assert payload["hailo_state"]["status"]
    assert payload["snippet"]


def test_hailo_endpoint(client):
    payload = client.get("/api/system/hailo").json()
    assert "status" in payload and "steps" in payload


def test_devices_endpoint_exposes_capabilities(client):
    devices = client.get("/api/system/devices").json()["devices"]
    by_id = {entry["id"]: entry for entry in devices}
    assert by_id["hailo"]["supports_training"] is False
    assert by_id["cpu"]["supports_training"] is True


def test_environment_reports_the_device_resolution(client):
    env = client.get("/api/system/env").json()
    assert set(env["device"]) == {"configured", "requested", "resolved", "engine"}
    assert "hailo" in env
    assert isinstance(env["hailo"]["runtime"], bool)
    assert isinstance(env["hailo"]["device"], bool)


def test_training_on_hailo_is_rejected_with_guidance(client):
    response = client.post(
        "/api/train",
        json={"model": "yolo11n.pt", "data": "coco8.yaml", "device": "hailo", "epochs": 1},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Hailo" in detail and "export" in detail


def test_validation_on_hailo_is_rejected(client):
    response = client.post("/api/val", json={"model": "yolo11n.pt", "data": "coco8.yaml", "device": "hailo"})
    assert response.status_code == 400


def test_hailo_export_on_this_host_is_rejected_with_reasons(client):
    response = client.post(
        "/api/export",
        json={"model": "yolo11n.pt", "format": "hailo", "data": "coco8.yaml", "hailo_arch": "hailo8l"},
    )
    # 400 when the host cannot compile HEFs; 200 if this really is Linux x86_64
    # with the Dataflow Compiler installed.
    assert response.status_code in {200, 400}
    if response.status_code == 400:
        detail = response.json()["detail"]
        assert "Hailo" in detail or "x86_64" in detail


def test_export_available_reports_hailo_separately(client):
    payload = client.get("/api/export/available").json()
    assert "hailo" in payload["backends"]
    assert {"runtime", "compiler"} <= set(payload["hailo"])
    # The compiler and the runtime are different installs and must not be conflated.
    assert "runtime_installed" in payload["backends"]["hailo"]
    assert "compiler_installed" in payload["backends"]["hailo"]


def test_overview_includes_device_and_hailo_state(client):
    payload = client.get("/api/system/overview").json()
    assert payload["device"]
    assert "device_configured" in payload
    assert "hailo" in payload
