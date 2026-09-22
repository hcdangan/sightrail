# Development guide

Everything needed to work on Sightrail: environment setup, the inner loop, the
conventions this codebase follows, and how to debug each layer.

## 0. Just want to run it?

If the checkout is already set up (`.venv` and `node_modules` exist):

```bash
npm run dev          # then open http://127.0.0.1:5173
```

That is the whole loop. Everything below is for working *on* the project.
Sanity check from another shell: `curl http://127.0.0.1:8000/api/health`.

## 1. Setup

```bash
git clone <repo> && cd sightrail

# One command: creates .venv, installs Python + Node dependencies
npm run bootstrap

# …or manually
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r apps/api/requirements-dev.txt   # Windows
uv pip install --python .venv/bin/python           -r apps/api/requirements-dev.txt  # macOS/Linux
npm install
```

`bootstrap.mjs` is idempotent and uses `uv` when it is on PATH, falling back to
`python -m venv` plus `pip`. Re-running it is always safe.

### Why Python 3.12

PyTorch publishes wheels for 3.10–3.12. On 3.13+ `pip install torch` usually
fails or silently pulls nothing, which makes the API report *engine unavailable*.

### GPU and other accelerators

```bash
# NVIDIA
uv pip install --python .venv/Scripts/python.exe torch torchvision \
  --index-url https://download.pytorch.org/whl/cu124
```

Device selection lives in one variable — `SIGHTRAIL_DEVICE` in `.env` (copy
`.env.example`). See [README → Choosing the compute device](../README.md#choosing-the-compute-device-cpu--cuda--hailo)
for the CPU/CUDA/Hailo matrix, and use **System → Compute device** in the UI to
see what the running process actually resolves to.

## 2. The inner loop

```bash
npm run dev          # API (:8000, reload) + Vite (:5173) together
npm run dev:api      # backend only
npm run dev:web      # frontend only
```

* The SPA talks to the API through the Vite proxy, so the browser sees a single
  origin and WebSocket upgrades work unchanged. Point it elsewhere with
  `VITE_API_TARGET=http://127.0.0.1:9000`.
* Vite is bound to `127.0.0.1` (not `localhost`) on purpose: it keeps the origin
  identical to the URL in the API's CORS list and to the HMR client.
* Backend edits: uvicorn reloads automatically. Frontend edits: HMR, no refresh.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run verify` | everything below, in CI order — run this before pushing |
| `npm run version:check` | assert the version agrees across all manifests and the CHANGELOG |
| `npm run license:report` | resolve both dependency closures and fail on an AGPL-3.0-incompatible license |
| `npm run typecheck` | `tsc --noEmit` over the SPA |
| `npm run typecheck:api` | `mypy` over the API package |
| `npm run lint` | ESLint (flat config, React hooks rules) |
| `npm run lint:api` | `ruff format --check`, `ruff check` and `mypy` |
| `npm run build` | production bundle into `apps/web/dist` |
| `npm run test:api` | backend unit + contract + device tests |
| `npm run test:api -- -m integration` | real inference, tracking, validation, export |
| `npm run test` | frontend + backend |
| `npm run test:web` | frontend only (help-content consistency + licensing invariants) |

## 3. Testing strategy

Four tiers, because the cost of the tests differs by two orders of magnitude.

| Tier | Location | Runtime | Runs by default |
| --- | --- | --- | --- |
| Unit | `tests/test_core.py` | < 1 s | yes |
| HTTP contract | `tests/test_api.py` | ~10 s | yes |
| Device / Hailo | `tests/test_device.py` | ~5 s | yes |
| Regression | `tests/test_regressions.py` | ~5 s | yes |
| Annotation | `tests/test_annotate.py` | < 1 s | yes |
| Engine integration | `tests/test_engine.py` | ~20 s after first download | no (`-m integration`) |

* **Contract tests** assert the shape of every router: status codes, error
  envelopes, OpenAPI coverage, upload round-trips and path-traversal rejection.
  They do not need weights.
* **Regression tests** pin the bugs that were found and fixed — concurrent stdout
  isolation, Zip Slip refusal, and live-tracker frame matching. If you touch
  `capture_engine_stdout`, `extract_archive` or `LiveTracker.infer`, these are the
  tests that protect you.
* **Engine tests** exercise the real thing: all five task heads produce the
  expected payloads, live tracking keeps IDs stable, a validation job completes
  with per-class metrics, an export produces an artifact, batch inference works
  over a folder, and an MJPEG session emits JPEG frames. (The MJPEG test drives
  the frame generator directly because a test client cannot buffer an infinite
  HTTP response.)

When adding an endpoint: add a contract test. When touching `core/serialize.py`
or `core/metrics.py`: add an engine test. When fixing a bug: add a test that fails
before the fix.

### What is not tested, and why

* **WebSocket endpoints** (`api/realtime.py`) have no automated coverage. The job
  and live channels are exercised manually through the running UI; a test client
  would need a real event loop plus a stubbed engine to be meaningful. This is the
  largest known coverage gap — see the `## Test coverage` note in
  `CONTRIBUTING.md` before refactoring that module.
* **`services/runners.py`** is covered only end-to-end, through the integration
  suite. Unit-testing it would mean stubbing `engine` for every mode.

## 4. Conventions

### Python

* **Layering is enforced by review, not tooling.** `api/` never imports
  `ultralytics`; `core/` never imports FastAPI. See `docs/ARCHITECTURE.md`.
* **Broad `except` is a per-file decision, not a per-line one.** Optional
  hardware and third-party objects are guarded in `core/device.py`,
  `core/hailo.py`, `core/metrics.py`, `core/serialize.py`,
  `core/streaming.py`, `api/deps.py`, `api/media.py`, `api/realtime.py` and
  `services/runners.py`; ruff's `BLE001`/`S110`/`S112` are disabled for exactly
  those files, with the rationale recorded in `apps/api/pyproject.toml`. Adding a
  new file to that list needs a reason in the same commit.
* **Type checking is pragmatic.** `mypy` runs with `follow_imports = "skip"`, so
  it checks *our* code without parsing torch/Ultralytics annotations, which are
  absent or version-dependent. `Any` at that boundary is deliberate.
* **Type everything public.** Functions that return engine objects use `Any`
  deliberately — Ultralytics types are not stable across versions — but the
  boundary into `schemas/` is strict.
* **Docstrings explain *why*.** The module docstring states the module's role in
  the system; non-obvious lines get a comment about the constraint that forced
  them (e.g. why the live tracker subclasses `LoadStreams`).
* **Errors are translated at the edge.** `core` raises domain errors
  (`ModelNotFound`, `EngineUnavailable`); routers map them onto HTTP statuses.
* Long lines are tolerated when an alternative would hurt readability; `ruff`
  config lives in `apps/api/pyproject.toml`.

### TypeScript / React

* **`lib/api.ts` is the only place that calls `fetch`.** Pages compose hooks.
* **Types mirror the backend** in `lib/api-types.ts`. Keep them in lock-step and
  cross-check against `/api/openapi.json`.
* **Server state → TanStack Query; client state → zustand.** No global stores for
  server data.
* **Components are small and typed.** UI primitives live in
  `components/ui/primitives.tsx`; anything reusable across pages goes to
  `components/`.
* **Design tokens, not literals.** Colours come from the `@theme` block in
  `styles/globals.css` so utilities, charts and canvas drawing stay consistent.
* **Canvas over baked images** for anything interactive (`ResultsViewer`,
  `CanvasOverlay`).
* **Accessibility basics**: every icon-only button has an `aria-label`, dialogs
  are `role="dialog"` with `aria-modal`, toggles use `role="switch"`.

### Licensing

* **The project is AGPL-3.0-or-later, and that is not negotiable.** `ultralytics`
  and `ultralytics-thop` are AGPL-3.0 and are imported in-process, so the
  combined work cannot be distributed under anything more permissive. Do not
  "fix" the `license` field in any manifest.
* **Before adding a dependency, run `npm run license:report`.** It resolves the
  web production closure and the API runtime closure and fails on anything
  incompatible with AGPL-3.0 (GPL without the Affero clause, SSPL, BUSL, Elastic).
  LGPL and MPL components are compatible and reported as notes.
* **Record what you add.** Update `THIRD-PARTY-NOTICES.md` in the same commit as
  the dependency; the report prints the exact table to paste in.
* **Never add a permissive-only sub-package** that links Ultralytics and is
  published separately — that is the one pattern the AGPL does not permit.

## 5. Debugging playbook

| Layer | Technique |
| --- | --- |
| API contract | `/api/docs` (Swagger) — try any endpoint with a live body |
| Request bodies | Set `SIGHTRAIL_LOG_LEVEL=debug` to log validation detail |
| Engine | Call the facade directly: `python -c "from sightrail.core.engine import engine; print(engine.describe('yolo11n.pt'))"` from `apps/api` |
| Job progress | The parsed events are visible in `/jobs`; when a parser misses a row, extend `core/jobs.py::parse_engine_line` and add a case to `test_core.py` |
| Live tracking | The bridge is timing-sensitive; log inside `core/live.py::LiveTracker.infer` and watch `latency_ms` in the Live Studio panel |
| Frontend data | TanStack Query devtools are not bundled; inspect the network tab, or `JSON.stringify` the payload in the page |
| Canvas overlays | `ResultsViewer` draws in pixel space; if geometry looks off, compare `result.original_shape` with the loaded image's `naturalWidth/Height` |
| Slow inference | Compare `speed.preprocess/inference/postprocess_ms` in the run metrics card; the first request includes model load and CUDA warm-up |

## 6. Adding features

### A new page

1. `src/pages/YourPage.tsx` — use `PageHeader` and the UI primitives.
2. Register it in `src/App.tsx`.
3. Add an entry to `NAV_GROUPS` in `src/lib/navigation.ts` (this also feeds the
   command palette and the sidebar).
4. Add a stop to `TOUR` in `src/lib/help-content.ts` — a test fails if a
   navigable page has no Help entry, so the in-app guide stays complete.

### Keeping the in-app help honest

`src/lib/help-content.ts` holds the user-facing copy for `/help`. It is plain
data so it can be asserted:

* `src/lib/help.test.ts` checks every route it links to exists in `NAV_ITEMS`,
  that every page is covered, that referenced doc files exist on disk, that the
  documented shortcuts match `useCommandPalette.ts`, and that the start-up
  commands appear in `README.md`.

Change a command in the docs and the test will tell you to update the other
side. Run just that suite with `npm run test:web`.

### A new backend endpoint

1. Add request/response models in `apps/api/sightrail/schemas/`.
2. Implement the logic in `core/` (pure) or `services/runners.py` (long-running).
3. Add the route to the relevant module in `api/`.
4. Extend `lib/api.ts` and `lib/api-types.ts`.
5. Add a contract test in `tests/test_api.py`.

### A new solution, tracker or export format

These are discovered from the installed Ultralytics build — most require no code:

* solutions come from `SOLUTION_CATALOG` in `core/streaming.py` (add UI copy in
  `pages/SolutionsPage.tsx` for a nicer card);
* trackers appear automatically from `GET /api/models/trackers`;
* export formats come from `ultralytics.engine.exporter.export_formats()`,
  enriched by `core/models_meta.py`.

## 7. Release checklist

```bash
npm run verify                 # typecheck, lint, build, backend tests
npm run test:api -- -m integration
```

Then sanity-check the running app: predict on a sample, open a Live Studio session,
run a 3-epoch COCO8 training, validate it, export to ONNX.

### Branching

`main` is protected by a repository ruleset (`.github/rulesets/protect-main.json`,
explained in `.github/rulesets/README.md`): no force pushes, no deletion, linear
history, and a pull request whose required checks pass before it can merge.

So the loop is: branch → push → open a PR → let CI run → squash-merge.

```bash
git switch -c fix/short-description
# ... commit ...
git push -u origin fix/short-description
gh pr create --fill
```

The ruleset does **not** require an approving review, because there is currently
one maintainer — the PR exists so the checks and the discussion are attached to
the change. The three required checks are `CI complete` (the aggregate job from
`ci.yml`), `License compliance` and `Secret scanning`.

## 8. Troubleshooting the dev environment

| Symptom | Cause / fix |
| --- | --- |
| `No virtual environment found` | Run `npm run bootstrap` |
| `npm.ps1 cannot be loaded` (Windows) | Execution policy blocks the PS wrapper; use `npm.cmd` or `Set-ExecutionPolicy -Scope Process Bypass` |
| `Engine unavailable` in the UI | The Python deps are missing or the API is pointed at a different interpreter |
| Port already in use | Vite picks the next free port; for the API set `SIGHTRAIL_PORT` |
| CORS errors | The SPA must be served from a `localhost`/`127.0.0.1` origin on the ports listed in `settings.cors_origins` |
| Camera blocked | `getUserMedia` needs a secure context: use `http://127.0.0.1:5173` or `http://localhost:5173`, not a LAN IP |
| First inference is slow | The checkpoint downloads (≈5 MB) and the model warms up on first use |
