"""Device selection tests: the CPU/CUDA/Hailo switch and its guard rails.

These run without any accelerator present, which is the point: the profiles,
aliases, guards and guidance must all behave correctly on a machine that has
none of the hardware.
"""

from __future__ import annotations

import platform
from types import SimpleNamespace

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


# ------------------------------------------------------------- cuda readiness


class _StubCuda:
    """A stand-in for ``torch.cuda`` with a fixed availability answer."""

    def __init__(self, *, available: bool, count: int, arch_list: list[str] | None = None) -> None:
        self._available = available
        self._count = count
        self._arch_list = arch_list if arch_list is not None else ["sm_75", "sm_80", "sm_90"]

    def is_available(self) -> bool:
        return self._available

    def device_count(self) -> int:
        return self._count

    def get_arch_list(self) -> list[str]:
        return list(self._arch_list)


class _StubTorch:
    """A torch module whose *build* differs from its *runtime* state.

    This is the distinction the real host cannot show: a CPU-only wheel and a
    CUDA wheel with no driver both report ``cuda.is_available() == False``, but
    they need opposite fixes.
    """

    def __init__(
        self,
        *,
        version: str,
        cuda_build: str | None,
        available: bool,
        count: int = 0,
        arch_list: list[str] | None = None,
    ) -> None:
        self.__version__ = version
        self.version = SimpleNamespace(cuda=cuda_build)
        self.cuda = _StubCuda(available=available, count=count, arch_list=arch_list)


def _stub_torch(monkeypatch, stub):
    """Point the device probe at a stub torch, bypassing its import cache."""
    device_mod.torch_module.cache_clear()
    monkeypatch.setattr(device_mod, "torch_module", lambda: stub)
    device_mod.cuda_state.cache_clear()
    return stub


def _clear_cuda_caches() -> None:
    """Drop the memoised probes, tolerating an already-stubbed replacement.

    `_stub_hardware` may run twice (fixture default, then a test override), and by
    then `cuda_hardware` is a plain lambda with no `cache_clear`.
    """
    for name in ("cuda_state", "cuda_hardware"):
        clear = getattr(getattr(device_mod, name), "cache_clear", None)
        if callable(clear):
            clear()


def _stub_hardware(monkeypatch, *, name: str, capability: float, present: bool = True):
    """Describe a card without needing one installed.

    The checks that matter most — an RTX 50-series that a cu124 wheel cannot run,
    or a Maxwell card no current build supports — cannot be produced on a dev box.
    """
    supported = present and capability >= device_mod._MIN_CUDA_COMPUTE_CAPABILITY
    facts = {
        "present": present,
        "name": name if present else None,
        "compute_capability": capability if present else None,
        "driver": "570.00" if present else None,
        "memory_mb": 16384 if present else None,
        "supported": supported,
    }
    _clear_cuda_caches()
    monkeypatch.setattr(device_mod, "cuda_hardware", lambda: facts)
    device_mod.cuda_state.cache_clear()
    return facts


@pytest.fixture
def with_stub_torch(monkeypatch):
    """Install a fake torch for the duration of one test.

    `monkeypatch` restores `torch_module` afterwards; `cuda_state` is separately
    memoised, so its cache must be dropped on the way out or the next test would
    read this stub's answer.

    The hardware probe is stubbed too, defaulting to a supported Turing-class card:
    without it these tests would inherit whatever GPU the dev box happens to have,
    which is exactly the kind of hidden dependence that makes a suite pass on one
    machine and fail on another. A test that needs a specific card calls
    `_stub_hardware` again — the later monkeypatch wins.
    """
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 4090", capability=8.9)

    def apply(stub):
        return _stub_torch(monkeypatch, stub)

    yield apply
    device_mod.cuda_state.cache_clear()


def test_cuda_state_flags_a_cpu_only_torch_build(with_stub_torch):
    """A CPU-only wheel can never run CUDA, however good the driver is.

    The advice has to be "reinstall torch", not "check your driver" — the device
    panel previously showed a static requirements list that could not tell the
    two apart and sent users to the wrong fix.
    """
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))

    state = device_mod.cuda_state()

    assert state["status"] == "cpu-only-torch"
    assert state["torch_cuda"] is None
    assert "CPU-only build" in state["summary"]
    # The fix must name the CUDA index, since that is the actual remediation.
    assert any("download.pytorch.org" in step["detail"] for step in state["steps"])
    assert any("torch" in step["title"].lower() for step in state["steps"])


def test_cuda_state_distinguishes_a_missing_driver(with_stub_torch):
    """A CUDA build that sees no device is a driver/toolkit problem, not a build one."""
    with_stub_torch(_StubTorch(version="2.14.0+cu124", cuda_build="12.4", available=False))

    state = device_mod.cuda_state()

    assert state["status"] == "driver-unavailable"
    assert state["torch_cuda"] == "12.4"
    assert "driver" in state["summary"].lower()
    assert any("nvidia-smi" in step["detail"] for step in state["steps"])
    # Reinstalling torch is the wrong advice here, so it must not be offered as
    # the primary fix (a fallback to an older toolkit is legitimate).
    assert "CPU-only" not in state["summary"]


def test_cuda_state_reports_ready_when_a_device_is_present(with_stub_torch, monkeypatch):
    # Pin the card and a matching arch list together: the architecture check
    # compares the two, so a mismatch here would (correctly) not be "ready".
    with_stub_torch(
        _StubTorch(
            version="2.14.0+cu124",
            cuda_build="12.4",
            available=True,
            count=2,
            arch_list=["sm_75", "sm_80", "sm_86", "sm_90"],
        )
    )
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 4090", capability=9.0)

    state = device_mod.cuda_state()

    assert state["status"] == "ready"
    assert state["device_count"] == 2
    assert state["steps"] == []


def test_cuda_state_handles_a_missing_torch(monkeypatch):
    monkeypatch.setattr(device_mod, "torch_module", lambda: None)
    device_mod.cuda_state.cache_clear()

    state = device_mod.cuda_state()

    assert state["status"] == "torch-missing"
    assert state["torch_version"] is None
    device_mod.cuda_state.cache_clear()


def test_cuda_profile_reports_why_it_is_unavailable(with_stub_torch):
    """The profile shown in the device list must carry the specific cause."""
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))

    profile = device_mod.device_profile("cuda:0")

    assert profile["available"] is False
    assert profile["state"] == "cpu-only-torch"
    # `detail` is what the device selector renders, so it must name the cause.
    assert "CPU-only build" in profile["detail"]


def test_device_config_exposes_cuda_state(with_stub_torch):
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))

    state = device_mod.device_config()["cuda_state"]

    assert state["status"] == "cpu-only-torch"
    assert state["steps"], "a blocked CUDA profile must ship remediation steps"


# ------------------------------------------------ GPU generations and indexes


def test_blackwell_gets_the_cu130_index(with_stub_torch, monkeypatch):
    """An RTX 50-series card must be sent to cu130, not cu124 or cu128.

    cu124 installs cleanly on Blackwell and then fails at the first kernel launch
    with "no kernel image is available", so the wrong index is a real trap. The
    repository previously hardcoded cu124 in the advice for every card.

    cu128 covers sm_120 but its newest torch is 2.11.0, so it is stale rather than
    wrong: advising it downgrades a 2.14.0 install instead of fixing it.
    """
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 5070 Ti", capability=12.0)

    assert device_mod.cuda_torch_index().endswith("/cu130")
    state = device_mod.cuda_state()

    assert state["status"] == "cpu-only-torch"
    assert state["torch_index"].endswith("/cu130")
    assert any("cu130" in step["detail"] for step in state["steps"])
    assert "5070 Ti" in state["summary"], "naming the card makes the advice verifiable"


def test_turing_and_hopper_keep_the_cu126_index(with_stub_torch, monkeypatch):
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 4090", capability=8.9)

    assert device_mod.cuda_torch_index().endswith("/cu126")


def test_the_reinstall_advice_cannot_be_a_silent_noop(with_stub_torch, monkeypatch):
    """The advice must force the wheel swap, not just name an index.

    pip and uv both treat an installed `torch==2.14.0+cpu` as satisfying a bare
    `torch` requirement. A plain `uv pip install torch --index-url .../cu130`
    therefore exits 0, prints "Would make no changes", and leaves the CPU build in
    place -- which is precisely how a user ends up reporting "I already installed
    torch with CUDA but the error still happens".
    """
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 5070 Ti", capability=12.0)

    advice = " ".join(step["detail"] for step in device_mod.cuda_state()["steps"])

    assert "--reinstall" in advice, "without this the command changes nothing"
    assert "--no-deps" in advice, "the CUDA indexes carry stale numpy/setuptools"
    assert advice.count("--reinstall") == 2, "both the Windows and POSIX variants"


def test_a_card_no_current_build_supports_is_reported_as_unusable(with_stub_torch, monkeypatch):
    """Maxwell (sm_50) is outside every current CUDA build.

    The card is *visible*, so a presence-only check passes it and then tells the
    user to reinstall torch forever. This must instead be reported as a fact about
    the hardware, with no reinstall advice.
    """
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))
    _stub_hardware(monkeypatch, name="NVIDIA GeForce MX130", capability=5.0)

    state = device_mod.cuda_state()

    assert state["status"] == "unsupported-gpu"
    assert "5.0" in state["summary"]
    assert "MX130" in state["summary"]
    joined = " ".join(step["detail"] for step in state["steps"])
    assert "download.pytorch.org" not in joined, "no wheel will work, so do not recommend one"


def test_a_cuda_build_can_see_a_gpu_it_has_no_kernels_for(with_stub_torch, monkeypatch):
    """The trap that `is_available()` cannot catch.

    A cu124 wheel on a Blackwell card reports CUDA as available, because the driver
    handshake succeeds, and then dies at the first kernel launch. Only the compiled
    architecture list reveals it.
    """
    with_stub_torch(
        _StubTorch(
            version="2.14.0+cu124",
            cuda_build="12.4",
            available=True,
            count=1,
            arch_list=["sm_75", "sm_80", "sm_86", "sm_90"],
        )
    )
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 5070 Ti", capability=12.0)

    state = device_mod.cuda_state()

    assert state["status"] == "gpu-not-in-torch-build"
    assert "sm_120" in state["summary"]
    assert state["torch_index"].endswith("/cu130")
    assert any("cu130" in step["detail"] for step in state["steps"])


def test_a_matching_arch_list_is_reported_ready(with_stub_torch, monkeypatch):
    """The same card with a build that lists sm_120 is fine."""
    with_stub_torch(
        _StubTorch(
            version="2.14.0+cu128",
            cuda_build="12.8",
            available=True,
            count=1,
            arch_list=["sm_75", "sm_90", "sm_100", "sm_120"],
        )
    )
    _stub_hardware(monkeypatch, name="NVIDIA GeForce RTX 5070 Ti", capability=12.0)

    assert device_mod.cuda_state()["status"] == "ready"


def test_no_card_is_still_reported_without_a_reinstall(with_stub_torch, monkeypatch):
    with_stub_torch(_StubTorch(version="2.14.0+cpu", cuda_build=None, available=False))
    _stub_hardware(monkeypatch, name="none", capability=0.0, present=False)

    state = device_mod.cuda_state()

    assert state["status"] == "no-cuda-hardware"
    assert state["steps"] == []
    joined = " ".join(step["detail"] for step in state["steps"])
    assert "download.pytorch.org" not in joined


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
