# Architecture

Sightrail is a two-process application: a Python API that owns the
Ultralytics engine and a browser client that owns presentation. They are
deliberately independent — the API is fully usable without the UI (Swagger at
`/api/docs`), and the UI holds no domain logic beyond rendering.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser (apps/web)                                                       │
│                                                                          │
│  pages/          one module per route, composes the UI kit               │
│  components/     ui primitives · layout shell · results viewer · charts  │
│  lib/api.ts      the only place that calls fetch()                       │
│  lib/hooks/      WebSocket transports (job console, live camera)         │
│  lib/stores/     zustand: preferences (persisted) + toast queue          │
└───────────────────────────────┬──────────────────────────────────────────┘
                    HTTP /api/*  │  WS /api/ws/*
┌───────────────────────────────▼──────────────────────────────────────────┐
│ API (apps/api/sightrail)                                        │
│                                                                          │
│  api/      routers — parse, validate, delegate, serialise                │
│  core/     domain — engine, jobs, streaming, metrics, datasets, live     │
│  schemas/  pydantic contracts shared by both layers                      │
│  services/ runners (heavy modes) + upload storage                        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                    ultralytics · torch · opencv-python
```

## Layering rules

The dependency direction is strictly one-way:
`api → services → core → (ultralytics, torch, opencv)`.

| Layer | May import | Must never |
| --- | --- | --- |
| `api/` | `core`, `schemas`, `services` | `ultralytics` directly, `torch` |
| `services/` | `core`, `schemas` | FastAPI request objects (except `UploadFile`) |
| `core/` | `schemas`, stdlib, third-party ML libs | FastAPI, routing concerns |
| `schemas/` | pydantic only | anything else in the package |

Why it matters: the engine can be swapped or faked in tests by replacing
`core.engine.engine`, and every HTTP handler stays a few lines long.

`core/serialize.py`, `core/metrics.py` and `core/live.py` are the only modules
that read Ultralytics result objects. When Ultralytics changes an attribute, the
blast radius is one file.

## Request lifecycle

A synchronous prediction (`POST /api/infer`):

```
1. FastAPI validates InferRequest against schemas/requests.py      → 422 on bad input
2. api/deps.py resolves SourceSpec → numpy image or a path
     sample | upload_id | path | data-url | http(s) url | camera
3. core.engine.Engine.predict
     resolve_checkpoint()  → catalog download, storage/weights or an abs path
     ModelRegistry.load()  → LRU cache hit, or load + cache the YOLO object
     model.predict(...)    → real Ultralytics inference
4. core.engine.to_response
     result.plot()         → saved under storage/outputs, served by /api/media
     result_to_payload()   → boxes / masks / keypoints / obb / probs as JSON
5. FastAPI serialises InferResponse; the UI draws a canvas overlay
```

Everything the client needs to render is in the response. The browser does not
parse Ultralytics internals, and it never needs a second round trip to display a
result.

## The job system

Train, val, export, benchmark, auto-annotation and video rendering all exceed a
comfortable request timeout, so they run on a bounded thread pool instead of in
the request handler.

```
POST /api/train ──► service/runners.start_job(kind, title, params)
                       │
                       ├─ JobStore.create()   → Job (buffered event log)
                       └─ JobStore.submit()   → ThreadPoolExecutor (max_concurrent_jobs)
                                                 │
        job.emit(progress|metric|log|status) ◄───┤  stdout is captured and parsed
                                                 │  (core/jobs.parse_engine_line)
   GET /api/jobs/{id}      ◄── polling ──────────┤
   WS  /api/ws/jobs/{id}   ◄── replay + stream ──┘
```

* **Backpressure** — `max_concurrent_jobs` (default 1) prevents two GPU-heavy
  jobs from fighting over VRAM.
* **Live console** — Ultralytics writes progress with tqdm and ANSI escapes.
  `parse_engine_line()` strips the escapes and turns each line into a structured
  event (`progress` with a percentage and losses, `metric`, `log` with a level).
* **Replay** — subscribers receive the buffered events before the live stream, so
  opening the page mid-run still shows the full history.
* **Artifacts** — every runner collects the files it produced (plots, CSVs,
  weights, exported models) into `job.artifacts`, which the UI renders as
  downloads and inline previews.

## Live streaming

Two transports cover different needs:

**Server-side MJPEG** (`POST /api/stream/sessions` → `GET .../mjpeg`)
The API reads frames with OpenCV, runs the model (optionally through a
solution), annotates in Python and re-encodes to JPEG. Works with any video file
or webcam index and needs no client cooperation, at the cost of CPU for encoding.

**Client loop over WebSocket** (`/api/ws/live`)
The browser captures camera frames to a canvas and pushes JPEG data URLs; the API
returns detection geometry plus live counters. The client draws the overlay, so
frames never round-trip through disk and latency stays low. Back-pressure is
applied on both sides: the client skips a frame while one is in flight, and the
API keeps at most one pending frame per session.

### ID-stable tracking

`model.track()` is a *streaming* API: it expects one long-lived iterable and
keeps tracker state across iterations. A WebSocket loop pushes frames one at a
time, so `core/live.py` bridges the two:

```
WS frame ──► FrameStream (queue-backed, subclasses LoadStreams so Ultralytics
             treats it as a real stream source)
                   │
                   ▼
        background thread ──► model.track(source=FrameStream, persist=True,
                                          stream=True, tracker=…)
                   │
                   ▼
        LiveTracker.infer(frame) ──► Results for that exact frame
```

The result is genuine ByteTrack/BoT-SORT/OC-SORT state: IDs persist across
frames instead of being reset per request.

## Solutions

The Ultralytics `solutions` package provides ready-made analytics layers
(counting, heatmaps, queue and parking management, gym reps, alarms…). They are
instantiated per session, and `core/streaming.apply_solution()` normalises their
`SolutionResults` return value into:

* the annotated frame (`plot_im`), and
* a JSON-safe counters dictionary built from the fields the specific solution
  actually populated.

Solutions are optional: if one raises, it is dropped for that session and the
stream continues with plain inference — a broken analytics layer never takes
down the UI.

## Frontend structure

* **One `fetch` wrapper** (`lib/api.ts`). It builds URLs, encodes JSON, unwraps
  the FastAPI error envelope into an `ApiError` carrying the human-readable
  `detail`, and exposes one namespaced function per endpoint group. Pages never
  touch `fetch`.
* **Types mirror the backend** (`lib/api-types.ts`). Kept in lock-step with
  `schemas/*.py`; `/api/openapi.json` is the source of truth for checking.
* **Server state** lives in TanStack Query (caching, polling, invalidation);
  **client state** lives in two small zustand stores (preferences, toasts).
* **Canvas overlays, not baked images.** `ResultsViewer` draws boxes, oriented
  boxes, mask polygons and COCO-17 skeletons on a canvas sized to the source
  image, so overlays stay crisp while zooming and every layer can be toggled. The
  server-rendered `result.plot()` is available side by side for comparison.
* **Design tokens as CSS variables.** Colours are declared once in
  `styles/globals.css` under Tailwind v4's `@theme`, so utilities, charts and
  canvas drawing all read from the same palette.

## Device handling

The compute target is the one setting every deployment changes, so it gets its
own module (`core/device.py`) and its own resolution rules.

```
SIGHTRAIL_DEVICE (config) ─┐
?device= (request or UI)    ─┼─► requested_device() ──► resolve_device() ──► engine_device()
                             │    aliases:                availability         torch-safe string
                             │    gpu → cuda:0            cuda → cpu fallback   hailo → cpu
                             │    hailo8l → hailo         hailo passes through
```

Three concepts are deliberately kept distinct, because conflating them causes
bugs:

| Concept | Example | Why it exists |
| --- | --- | --- |
| **requested** | `gpu`, `hailo8l`, `0` | Users type aliases; normalise once, early |
| **resolved** | `cuda:0`, `hailo`, `cpu` | What actually runs, after the availability check |
| **engine device** | `cuda:0`, `cpu` | The string handed to Ultralytics |

The engine-device translation exists for Hailo. A Hailo accelerator is *not* a
torch device: Ultralytics loads a compiled `.hef` and drives it through HailoRT,
so `device='hailo'` is rejected as an invalid CUDA request. Passing `cpu` keeps
the torch host side happy while the NPU does the work, and the resolved value is
still reported to the UI and stored on the model record so metrics stay honest.

Hailo is also **inference-only** (no backward pass on the NPU), so
`core/hailo.py::guard_mode()` rejects Train and Val with an explanation before a
job is created, and `validate_export_request()` collects every HEF-compilation
problem (host OS, toolchain, calibration data, task support) into one message
instead of revealing them one failed run at a time.

`GET /api/system/device-config` returns the profiles with their capability lists,
the live Hailo readiness checklist and a generated `.env` snippet — that is what
the **System → Compute device** card renders.

## Storage layout

Everything the service writes lives under one configurable root
(`SIGHTRAIL_STORAGE_ROOT`, default `./storage`):

```
storage/
├── weights/     downloaded and trained checkpoints (model cache source)
├── uploads/     yyyy-mm-dd/<id>_<name> plus a JSON sidecar per file
├── outputs/     rendered predictions and annotated videos
├── runs/        train/ val/ export/ benchmark/ … — mirrors Ultralytics layout
├── datasets/    datasets built by auto-annotation (images/, labels/, data.yaml)
├── media/       remote images/videos fetched for inference
├── jobs/        reserved for job artifacts that outlive the process
└── openapi.json persisted schema for offline client development
```

`/api/media/{category}/{filename}` is the only read path into this tree; it
rejects nested paths and resolves every lookup inside the configured root.

## Extension points

| To add… | Touch |
| --- | --- |
| A new checkpoint family | `core/catalog.py` (`_family(...)` in `CATALOG`) |
| A new export format note | `core/models_meta.py` (`FORMAT_NOTES`, `FORMAT_TARGETS`) |
| A new heavy mode | `schemas/base.py` (`JobKind`), `services/runners.py` (`RUNNERS`), a router endpoint |
| A new task head | `schemas/base.py` (`TaskName`), `core/serialize.py`, `TASK_META` in the UI |
| A new solution | appears automatically from Ultralytics; add UI copy in `pages/SolutionsPage.tsx` |
| A new tracker | appears automatically from Ultralytics `TRACKER_CONFIGS` |
| A new page | `pages/`, then `App.tsx` and `lib/navigation.ts` |

## Deliberate trade-offs

* **Synchronous predict, asynchronous everything-else.** Single-image inference
  is fast enough to answer inline (even on CPU), which keeps the UI simple. Modes
  measured in minutes go through the job system.
* **Threads, not processes.** Ultralytics releases the GIL inside torch kernels,
  so a thread pool is sufficient and avoids pickling models between processes.
  Job state stays in memory as a result — restarting the API clears the history.
* **In-memory job log.** A bounded deque per job (default 2000 events). Long
  training runs are visible live and exportable to a `.log` file, but history is
  not persisted across restarts.
* **No database.** Everything derivable from the filesystem (runs, datasets,
  weights) is derived on demand. This keeps a fresh checkout working with zero
  migration steps.
