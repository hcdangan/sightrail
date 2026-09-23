<div align="center">

# Sightrail

**A full-stack workbench that showcases every feature of [Ultralytics YOLO](https://docs.ultralytics.com/).**

Six modes , five task families , sixteen built-in solutions , twenty-one export formats — behind a modern React + FastAPI UI.

[![Python](https://img.shields.io/badge/python-3.10%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Ultralytics](https://img.shields.io/badge/ultralytics-8.3%2B-042a4b)](https://github.com/ultralytics/ultralytics)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

</div>

---

## What this is

Ultralytics YOLO is a large framework: six execution modes, five task heads, a
solutions library, a tracker zoo and two dozen export targets. **Sightrail
exposes all of it through a single, coherent web application** — not a demo
script and not a notebook.

Everything is driven by the real engine. Predictions are real inferences,
validation numbers come from `model.val()`, exports are produced by
`model.export()`, and training streams the genuine Ultralytics progress output.
Nothing is mocked.

```
+------------------------------+         +------------------------------------+
|  React 19 + Vite + TS SPA    |  HTTP   |  FastAPI                           |
|  - canvas overlays           |<------->|  - 60 endpoints + 2 WebSockets     |
|  - live charts & consoles    |   WS    |  - job pool for the heavy modes    |
|  - command palette           |<------->|  - Ultralytics engine facade       |
+------------------------------+         +-----------------+------------------+
                                                           |
                                             +-------------v------------------+
                                             |  ultralytics / torch / opencv  |
                                             +--------------------------------+
```

## Feature coverage

Every capability below is reachable from the UI. See
[`docs/FEATURES.md`](docs/FEATURES.md) for the exhaustive mapping with the file
that implements each one.

| Ultralytics capability | Where it lives in Sightrail |
| --- | --- |
| **Predict** — detect / segment / classify / pose / OBB | `/predict` — task switcher, per-task overlays, batch runner |
| **Track** — TrackTrack, ByteTrack, BoT-SORT, OC-SORT, Deep OC-SORT, FastTracker | `/studio` (Track & Stream) — ID-stable live tracking |
| **Train** — all 15 augmentations, optimizers, schedulers, AMP, resume | `/train` — grouped hyperparameter panels, live loss curves |
| **Val** — mAP50/75/50-95, per-class P/R/F1, confusion matrix, curves | `/validate` — heat-mapped tables and diagnostic plots |
| **Export** — 21 formats (ONNX, TensorRT, OpenVINO, CoreML, TFLite, RKNN, Hailo) | `/export` — format matrix with per-format options |
| **Benchmark** — size, latency and accuracy per format | `/benchmark` — comparison table, winners, CSV export |
| **Solutions** — 16 apps (counting, heatmaps, gym, parking, alarms) | `/solutions` + `/studio` — live counters over WebSocket |
| **Auto-annotation** — pre-label a folder into a YOLO dataset | `/datasets` — writes `images/`, `labels/`, `data.yaml` |
| **Model zoo** — 79 checkpoints across 10 families, LRU cache | `/models` — download, inspect architecture, flush cache |
| **Runs & artifacts** — every `results.csv`, plot and checkpoint | `/runs` — history browser with inline charts |
| **Live streaming** — MJPEG server-side and WebSocket client loop | `/studio` — two transports, one UI |
| **In-app help** — the start-up guide, page tour, device setup and fixes | `/help` — plus live diagnostics for the running process |

## Quickstart

### Already set up? One command

```bash
cd sightrail
npm run dev
```

Then open **http://127.0.0.1:5173**. That starts both processes:

| Process | URL | Notes |
| --- | --- | --- |
| Web UI (Vite) | http://127.0.0.1:5173 | hot-reloads on React edits |
| API (FastAPI) | http://127.0.0.1:8000 | auto-reloads on Python edits |
| API docs (Swagger) | http://127.0.0.1:8000/api/docs | try any endpoint interactively |

`Ctrl+C` in that terminal stops both. To check the API from a shell:

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok","version":"1.0.0","engine_available":true,...}
```

> **First time on a fresh clone?** Run `npm run bootstrap` first (below). `npm run dev`
> on its own fails if `.venv` does not exist yet.

### From a fresh clone

#### Prerequisites

* **Python 3.10–3.12** (3.12 recommended; `torch` wheels lag on 3.13+)
* **Node.js 20.19+**
* Optional: [`uv`](https://docs.astral.sh/uv/) for fast environment setup
* Optional: an NVIDIA GPU with a CUDA-capable driver for accelerated inference,
  or a Hailo accelerator (see the Hailo section below)

#### One command

```bash
npm run bootstrap     # creates .venv, installs Python + Node deps, warms yolo11n.pt
npm run dev           # API on http://127.0.0.1:8000, UI on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173** — the dashboard is the starting point, and the
first prediction downloads `yolo11n.pt` (5 MB) automatically.

#### Or step by step

```bash
# 1. Python environment
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r apps/api/requirements-dev.txt   # Windows
uv pip install --python .venv/bin/python           -r apps/api/requirements-dev.txt  # macOS / Linux

# 2. Frontend
npm install

# 3. Run
npm run dev            # both processes
npm run dev:api        # API only
npm run dev:web        # UI only
npm run verify         # typecheck + lint + build + backend tests
```

### If a port is already in use

Vite simply picks the next free port, so watch its output for the real URL. For
the API, point it elsewhere and tell the UI where to find it:

```bash
# macOS / Linux
SIGHTRAIL_PORT=8001 npm run dev:api
VITE_API_TARGET=http://127.0.0.1:8001 npm run dev:web
```

```powershell
# Windows (PowerShell)
$env:SIGHTRAIL_PORT=8001; npm run dev:api
$env:VITE_API_TARGET="http://127.0.0.1:8001"; npm run dev:web
```

To free a stuck port on Windows:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Choosing the compute device (CPU , CUDA , Hailo)

One variable decides where inference runs. Copy the example config and uncomment
the line you want:

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

```ini
# .env — uncomment exactly one
SIGHTRAIL_DEVICE=cpu       # always works, slowest
# SIGHTRAIL_DEVICE=cuda:0  # NVIDIA GPU
# SIGHTRAIL_DEVICE=hailo   # Hailo accelerator (Raspberry Pi AI HAT)
```

Restart the API (`npm run dev:api`) and the choice is live. `SIGHTRAIL_DEVICE`
accepts `auto`, `cpu`, `cuda`, `cuda:1`, `mps`, `hailo`, board names like
`hailo8l`, or a bare GPU index like `0`. `auto` picks CUDA → MPS → Hailo → CPU,
so it never fails. You can also override the device per session from the selector
in the header or on **System → Compute device** without editing any file.

| Profile | Modes it can run | Needs |
| --- | --- | --- |
| `cpu` | all six | nothing |
| `cuda:0` | all six | a CUDA build of PyTorch + NVIDIA driver |
| `mps` | all six | Apple Silicon |
| `hailo` | predict, track, export | HailoRT + a compiled `.hef` model |

#### CUDA

The default install pulls the CPU build of PyTorch. Reinstall torch from the CUDA
index that matches your GPU — **the index is not interchangeable**:

| GPU | Compute capability | Index |
| --- | --- | --- |
| RTX 50-series (Blackwell) | sm_120 | `cu130` |
| RTX 20/30/40-series, GTX 16-series (Turing → Ada) | sm_75 – sm_89 | `cu126` |
| Datacentre A100/H100 | sm_80 / sm_90 | `cu126` |
| Maxwell / Pascal / Volta (e.g. GTX 9xx, MX130) | below sm_75 | none — no current wheel supports these |

```bash
# RTX 50-series (Blackwell)
uv pip install --python .venv/Scripts/python.exe --reinstall --no-deps torch torchvision \
  --index-url https://download.pytorch.org/whl/cu130

# Everything Turing-and-newer up to Hopper
uv pip install --python .venv/Scripts/python.exe --reinstall --no-deps torch torchvision \
  --index-url https://download.pytorch.org/whl/cu126
```

Install into the project's `.venv`, because that is what the API runs
(`.venv/Scripts/python.exe`). A CUDA torch in the system Python or in some other
environment has no effect on Sightrail at all.

`--reinstall` is required rather than tidy. pip and uv both treat an installed
`torch==2.14.0+cpu` as already satisfying a bare `torch` requirement, so without it
the command exits 0, reports *"Would make no changes"*, and leaves the CPU build in
place — the classic "I already installed torch with CUDA but the error persists".
`--no-deps` stops the CUDA index from also installing its older copies of numpy,
setuptools, filelock and friends over newer ones.

Two different things can go wrong here, and they need different indexes:

* **Too old a CUDA version.** A `cu124` wheel on an RTX 50-series card installs
  cleanly and reports `torch.cuda.is_available() == True`, then dies at the first
  kernel launch with *"no kernel image is available for execution on the device"*.
* **A stale index.** `cu124` and `cu128` are still served, but are frozen at torch
  2.6.0 and 2.11.0. Advice written against them *downgrades* a working install
  instead of fixing it, so use the index above rather than any index whose CUDA
  version merely looks new enough.

Check the architecture list to confirm a build covers your card:

```bash
.venv\Scripts\python.exe -c "import torch; print(torch.cuda.get_arch_list())"
# sm_120 must appear for a Blackwell card
```

Setting `SIGHTRAIL_DEVICE=cuda:0` is **not enough on its own**. That variable
selects a GPU at run time; if the installed torch has no CUDA support compiled in,
there is no GPU to select and Sightrail falls back to CPU. If CUDA still does not
engage, open **System → Compute device**, which names the exact condition:

| Reported | What it means | Fix |
| --- | --- | --- |
| `no-cuda-hardware` | No NVIDIA GPU in this machine | None needed — CPU runs every mode. Nothing to reinstall. |
| `unsupported-gpu` | A GPU is present but older than any current CUDA build (below sm_75) | Use CPU. No published wheel will run it. |
| `cpu-only-torch` | A supported GPU is present, but this torch was built without CUDA | Reinstall from the index above for your card. |
| `gpu-not-in-torch-build` | Torch sees the GPU but has no kernels for it | Wrong or stale index — e.g. `cu124`, or `cu128` on Blackwell. Reinstall from the right one. |
| `driver-unavailable` | CUDA build present, GPU visible, driver too old | Update the NVIDIA driver, or use a wheel for an older toolkit. |

Confirm the active device and the reason at any time:

```bash
curl http://127.0.0.1:8000/api/system/device-config
```

`resolved` is what inference actually uses; `cuda_state.status` explains why, when
it is not CUDA.

#### Hailo (Raspberry Pi 5 + AI Kit / AI HAT, Hailo-8)

Hailo is an **inference** accelerator, not a training device: Ultralytics loads a
compiled `.hef` network and runs it on the NPU, so Train and Val stay on CPU or
CUDA. Sightrail enforces that and tells you why rather than failing obscurely.

```bash
# 1. On the Pi: install the Hailo runtime (matches your kernel)
sudo apt update && sudo apt install hailo-all
sudo reboot
hailortcli fw-control identify      # verify the board

# 2. Get a HEF model — either compile one on a Linux x86_64 host...
#    Export page → format "Hailo", arch "hailo8l", calibration dataset coco8.yaml
#    ...or copy an existing *_hailo_model directory into storage/weights/

# 3. Point Sightrail at it (optional — it auto-discovers storage/weights/*.hef)
```

```ini
# .env
SIGHTRAIL_DEVICE=hailo
SIGHTRAIL_HAILO_MODEL=            # empty = auto-discover the first .hef
SIGHTRAIL_HAILO_ARCH=hailo8l      # hailo8l (Pi) , hailo8 , hailo10h , hailo15h , hailo15l
```

**System → Compute device** shows a readiness checklist (runtime, board,
compiler, model) and the exact commands for whatever is missing. HEF compilation
itself requires the Hailo Dataflow Compiler on Linux x86_64 — the usual workflow
is to compile on a desktop and copy the `*_hailo_model` directory to the Pi.

### GPU acceleration (quick reference)

Verify what the process can actually see from **System → Accelerators**; the
header selector and the `.env` value both feed the same resolution logic
(`apps/api/sightrail/core/device.py`).

## A five-minute tour

1. **Dashboard** — device, memory, storage and catalog summary; every mode is
   one click away.
2. **Predict** — pick *Pose*, choose a sample image, run. Hover the canvas to
   inspect a skeleton's 17 keypoint confidences; toggle classes in the sidebar.
3. **Live Studio** — allow camera access, press *Start camera*, then *Start
   inference*. Frames are captured locally, sent over a WebSocket and annotated
   for a stable, low-latency loop. Switch the analytics layer to *Object Counter*
   or *Heatmap* for live counters.
4. **Train** — choose the *Smoke test* preset with `coco8.yaml` (8 images) and
   watch losses stream into the console and charts.
5. **Validate** — evaluate the resulting checkpoint, then read the per-class
   table and open the confusion matrix.
6. **Export** — convert to ONNX or TorchScript, then benchmark several formats
   side by side.

## Repository layout

```
sightrail/
+-- .env.example                     # copy to .env: device (CPU/CUDA/Hailo) + settings
+-- apps/
|   +-- api/                         # FastAPI service (Python 3.10+)
|   |   +-- sightrail/
|   |   |   +-- api/                 # routers: thin HTTP adapters
|   |   |   +-- core/                # domain: engine, jobs, streaming, device, hailo
|   |   |   +-- schemas/             # pydantic contracts (request + response)
|   |   |   +-- services/            # job runners, upload storage
|   |   |   +-- config.py            # env-driven settings
|   |   |   +-- main.py              # application factory
|   |   +-- tests/                   # unit + API + device + engine suites
|   +-- web/                         # React 19 + Vite + TypeScript SPA
|       +-- src/
|           +-- components/          # ui kit, layout, results viewer, charts
|           +-- lib/                 # api client, types, hooks, stores
|           +-- pages/               # one module per route
+-- docs/                            # architecture, API, features, development
+-- scripts/                         # bootstrap and dev helpers
+-- storage/                         # runtime artifacts (git-ignored)
```

Where things live:

| Path | What it is |
| --- | --- |
| `.env.example` | The device switch and every tunable setting, commented |
| `apps/api/sightrail/core/device.py` | Device profiles, resolution, availability probes |
| `apps/api/sightrail/core/hailo.py` | Hailo HEF discovery, guard rails, setup guidance |
| `apps/api/sightrail/core/engine.py` | The only module that *constructs* models (other core modules read result objects) |
| `apps/web/src/lib/api.ts` | The single fetch wrapper every page uses |
| `storage/` | Weights, uploads, runs, datasets, rendered output |

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the reasoning behind
this structure and the request lifecycle.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, data flow, job system, streaming design, extension points |
| [`docs/API.md`](docs/API.md) | Every endpoint group with request/response examples |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Capability → implementation matrix |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Setup, tooling, testing, debugging, conventions |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to propose changes |
| [`SECURITY.md`](SECURITY.md) | Deployment model, known limitations, and what is not a vulnerability |
| [`HANDOFF.md`](HANDOFF.md) | Current state, known gaps and suggested next steps |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Dependency licenses, model-weight licensing, and AGPL network obligations |
| Interactive API docs | `http://127.0.0.1:8000/api/docs` (Swagger) and `/api/redoc` |

## Configuration

Every setting is environment-driven with the `SIGHTRAIL_` prefix (see
[`apps/api/sightrail/config.py`](apps/api/sightrail/config.py)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIGHTRAIL_HOST` / `_PORT` | `127.0.0.1` / `8000` | API bind address |
| `SIGHTRAIL_DEFAULT_MODEL` | `yolo11n.pt` | Checkpoint used when none is given |
| `SIGHTRAIL_DEVICE` | `auto` | `auto`, `cpu`, `cuda:0`, `mps`, `hailo` |
| `SIGHTRAIL_HAILO_MODEL` | *(auto)* | HEF file or `*_hailo_model` directory |
| `SIGHTRAIL_HAILO_ARCH` | `hailo8l` | `hailo8l`, `hailo8`, `hailo10h`, `hailo15h`, `hailo15l` |
| `SIGHTRAIL_MODEL_CACHE_SIZE` | `6` | Models kept resident in memory |
| `SIGHTRAIL_MAX_CONCURRENT_JOBS` | `1` | Parallel heavy jobs |
| `SIGHTRAIL_MAX_UPLOAD_MB` | `512` | Upload size limit |
| `SIGHTRAIL_STORAGE_ROOT` | `./storage` | Where weights, runs and uploads live |
| `SIGHTRAIL_EXTRA_SOURCE_ROOTS` | *(empty)* | Extra directories the API may read inference sources from |
| `VITE_API_TARGET` | `http://127.0.0.1:8000` | Dev proxy target for the SPA |

## Testing

```bash
npm run test:api                    # backend: unit + API tests (fast)
npm run test:api -- -m integration  # backend: real inference, training, export
npm run test                        # backend + frontend
npm run verify                      # typecheck, lint, build, backend tests
```

The backend suite is split into tiers: unit and HTTP contract tests always run;
engine tests that download weights and train are marked `integration`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No virtual environment found` | Run `npm run bootstrap` — `npm run dev` alone needs `.venv` |
| `Engine unavailable` badge | Install the API requirements: `npm run bootstrap` |
| Port 8000 or 5173 already in use | See [If a port is already in use](#if-a-port-is-already-in-use) |
| UI loads but every request fails | The API is not running: `npm run dev:api`, then check `curl http://127.0.0.1:8000/api/health` |
| Inference on CPU is slow | Expected — a 640px nano model is ~100–200 ms/frame on a modern CPU. Use a CUDA device or lower the image size. |
| Camera never starts | Browsers only expose `getUserMedia` on `localhost`/`127.0.0.1` or HTTPS. Use the dev server URL directly. |
| `torch` install fails on Python 3.13+ | Create the venv with 3.12: `uv venv --python 3.12 .venv` |
| `SIGHTRAIL_DEVICE=cuda:0` still runs on CPU | The device switch chooses a GPU; it cannot add CUDA to a CPU-only torch. **System → Compute device** names the cause — `cpu-only-torch` (reinstall torch from the CUDA index, see [CUDA](#cuda)) or `driver-unavailable` (run `nvidia-smi`, then update the driver). |
| Export says *deps missing* | Install the backend package for that format, e.g. `uv pip install onnx onnxruntime` |
| Hailo export refused | HEF compilation needs the Dataflow Compiler on Linux x86_64; the UI lists every unmet requirement |
| First training run is slow | Ultralytics downloads the dataset archive on first use; later runs reuse the cache. |

## License

Released under the **[GNU Affero General Public License v3.0](LICENSE)**
(`AGPL-3.0-or-later`), matching [Ultralytics YOLO](https://github.com/ultralytics/ultralytics).

This is not a preference — it is a requirement. `ultralytics`,
`ultralytics-thop` and `ultralytics-platform` are AGPL-3.0, and Sightrail
imports them in-process, so the combined work must be AGPL-3.0. A permissive
license here would be inaccurate and unenforceable.

What that means in practice:

- **Self-hosting is unrestricted.** Run it internally, modify it, no obligation
  to publish anything, as long as you do not offer it to others over a network.
- **Offering it as a network service triggers AGPL §13.** If you let third
  parties interact with a modified version over a network, you must offer them
  the corresponding source of your modified version.
- **Model weights are separate.** Checkpoints downloaded through Sightrail are
  not covered by this license and carry their own terms — review them before
  commercial use.

Per-dependency license details, the frontend bundle's license inventory, and the
full AGPL §13 obligations are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Reproduce and check them
with:

```bash
npm run license:report   # fails on any AGPL-3.0-incompatible dependency
```

If AGPL-3.0 does not fit your use case, [Ultralytics Enterprise
Licensing](https://www.ultralytics.com/license) is the supported path — it
removes the copyleft obligation for the Ultralytics components and is the only
route to a permissively licensed distribution of this project.
