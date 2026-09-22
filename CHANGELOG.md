# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version comparison links: `[1.3.0]` is the current release; every manifest is
pinned to it and `npm run version:check` fails the build if they disagree.

## [Unreleased]

### Added

* **`THIRD-PARTY-NOTICES.md`** — the complete licensing position: every runtime
  and production-frontend dependency with the license its own metadata declares,
  the model weights and datasets that are *not* covered by this project's
  license, and the AGPL §13 obligations a network deployment inherits.
* **`npm run license:report`** (`scripts/license-report.mjs`). It resolves the web
  production closure from `package-lock.json` and the API runtime closure from the
  installed distributions, evaluating environment markers so platform-gated
  dependencies are not misreported. It prints the license distribution and exits
  non-zero on anything incompatible with AGPL-3.0 (GPL without the Affero clause,
  SSPL, BUSL, Elastic). LGPL/MPL components are reported as notes, because they
  are file-level copyleft and compatible. Wired into the Security workflow as a
  blocking job.
* A `license` field on `apps/web/package.json` — the one manifest that was
  missing one.
* A **Licensing** section in `docs/DEVELOPMENT.md`, and a `License` section in the
  README that states the obligations rather than only the license name.
* **A `Protect main` repository ruleset**, committed as code in
  `.github/rulesets/protect-main.json` with the reasoning in
  `.github/rulesets/README.md`. It blocks force pushes and deletion of `main`,
  requires linear history, routes every change through a pull request with
  resolved review threads, and requires `CI complete`, `License compliance` and
  `Secret scanning` to pass before a merge. It requires **no approving review**,
  since there is one maintainer, and the maintainer is a bypass actor so a hotfix
  is always possible. A **Branching** section in `docs/DEVELOPMENT.md` documents
  the resulting loop.

### Fixed

* **CI failed on every run, from the first push.** Two unrelated causes, neither
  of which reproduced locally:
  * `apps/api/requirements-dev.txt` had drifted from
    `[project.optional-dependencies].dev` in `pyproject.toml` and was missing
    `mypy`, so the *API lint & types* job died with `No module named mypy`. It was
    also missing `bandit` and `pip-audit`. The two lists are now identical, with a
    comment recording why that matters — CI installs the requirements file, so a
    tool declared only in the manifest is invisible to it.
  * `test_hailo_export_is_validated_before_the_job_starts` asserted that the Hailo
    export error always mentions the Linux x86_64 restriction. True on the
    author's Windows machine, false on the Linux CI runner, where the host
    restriction correctly does *not* apply and only the calibration-dataset and
    unsupported-task problems are reported. The test is now parametrised over four
    platforms — including a simulated Linux x86_64, the one case a Windows dev box
    cannot otherwise reach — so both branches are covered everywhere, and it
    asserts the absence of the host complaint rather than its presence on the
    platform where it is wrong.
* The license is now stated and enforced consistently as AGPL-3.0-or-later.
  `ultralytics`, `ultralytics-thop` and `ultralytics-platform` are AGPL-3.0 and
  are imported in-process by `core/`, so the combined work cannot be distributed
  under anything more permissive. This is a legal requirement, not a preference,
  and it is now declared by every manifest rather than all but one.

### Planned

* Authentication for non-localhost deployments (currently the reverse proxy is
  the intended boundary — see `SECURITY.md`).
* Persisted job history, so restarting the API does not clear the job list.

## [1.3.0] - 2026-01-09

### Changed

* **The project is now called Sightrail.** The previous name embedded
  "Ultralytics" and "YOLO", which are Ultralytics' trademarks, in identifiers
  that a downstream fork cannot easily change. "Sightrail" was verified free on
  npm and PyPI, with no GitHub account and no product using it.

  This is a breaking rename. Update anything that referred to the old names:

  | Old | New |
  | --- | --- |
  | `Ultralytics YOLO Studio` (product name) | `Sightrail` |
  | `ultralytics_studio` (Python package) | `sightrail` |
  | `ultralytics-studio` / `ultralytics-yolo-studio` (package names) | `sightrail` |
  | `@yolo-studio/web` (npm workspace) | `@sightrail/web` |
  | `YOLO_STUDIO_*` (environment variables) | `SIGHTRAIL_*` |
  | `yolo-studio.preferences.v1` (localStorage key) | `sightrail.preferences.v1` |
  | `C:\code\yolo-studio` (checkout directory) | `C:\code\sightrail` |

* **`.env` must be updated.** `YOLO_STUDIO_*` keys are no longer read; rename
  them to `SIGHTRAIL_*`. `.env.example` has the current names, and
  `SIGHTRAIL_DEVICE` still accepts `SIGHTRAIL_DEFAULT_DEVICE` as a legacy alias.
* References to *Ultralytics YOLO* as the upstream library, and to `yolo11n.pt`
  and the other model names, are unchanged — those are the dependency's own
  names, not this project's branding.

## [1.2.0] - 2026-01-02

### Added

* **In-app Help page** (`/help`): the start-up commands, a tour of all eleven
  pages, keyboard shortcuts, the device switch explanation and the full
  troubleshooting list — reachable without leaving the interface.
* **Live session diagnostics** on the Help page: API reachability, engine
  availability, the resolved device and whether `.env` exists, read from the
  process actually serving the page rather than assumed from the docs.
* Copy buttons on every command block, and deep-linkable section anchors
  (`/help#troubleshooting`) used by the command palette.
* `How do I run this?`, `Troubleshoot a problem` and `Change the compute device`
  entries at the top of the command palette.
* Frontend test suite (`vitest`) that asserts the help content is internally
  consistent and that its start-up commands match `README.md`, so the in-app
  guide cannot drift from the repository docs.
* **Continuous integration** (`.github/workflows/ci.yml`): lint, format check,
  type check, the backend suite on Python 3.10/3.11/3.12, the frontend suite,
  and a production build.
* **Security automation** (`.github/workflows/security.yml`): gitleaks secret
  scanning over the full history, bandit SAST with SARIF upload, `pip-audit` and
  `npm audit` dependency audits, and zizmor workflow hardening. Findings land in
  the Security tab; the job fails only on a leaked secret.
* **Opt-in integration workflow** (`integration.yml`) running the real engine
  (model downloads, all five task heads, training, validation, export) on a
  schedule, on tags, and on demand, with a weights cache.
* `SECURITY.md`: the deployment model, the controls that exist, known
  limitations, and what is explicitly *not* a vulnerability.
* `apps/api/pyproject.toml` as the single source of truth for ruff, mypy, bandit
  and pytest configuration, plus `npm run lint:api` / `npm run typecheck:api`.
* `npm run version:check`, asserting the version agrees across all four
  manifests and the CHANGELOG.
* Dependabot configuration, CODEOWNERS, and issue/PR templates.
* 31 new backend tests: `test_annotate.py` (label encoders and `data.yaml`
  index alignment) and `test_regressions.py` (the security and concurrency fixes
  below).
* `.env.example` guidance and `docs/` corrections throughout.

### Security

* **Zip Slip fixed.** `POST /api/uploads/{id}/extract` validated nothing and
  called `extractall()` on a user-supplied archive, allowing a crafted ZIP to
  write anywhere the API process could reach. Every member is now resolved and
  containment-checked, and the whole archive is rejected if any member escapes
  (`services/uploads.py::_is_safe_member`).
* **Inference sources are sandboxed.** Paths must resolve inside the storage
  root, the repository, or an explicit `YOLO_STUDIO_EXTRA_SOURCE_ROOTS` entry;
  previously an absolute path anywhere on the host was accepted.
* **SSRF guard hardened.** The host is resolved once, and every address is
  checked before any connection, instead of validating a hostname that
  `urlopen` would then re-resolve.

### Fixed

* **Concurrent jobs corrupted each other's logs.** `capture_engine_stdout`
  swapped the process-global `sys.stdout`/`sys.stderr` per job, so with
  `max_concurrent_jobs > 1` two jobs captured each other's output and the first
  to finish installed a *dead* capture as the real stdout — after which every log
  line silently vanished. Output is now routed per thread, and the real streams
  are restored exactly once, by the last capture to exit.
* **Live tracking lagged one frame permanently.** Clearing the result event
  before pushing a frame left a window in which the *previous* frame's result
  could be returned as the new one. Frames now carry a sequence number and
  `LiveTracker.infer` only accepts a result tagged with the frame it pushed.
* **`data.yaml` mislabelled auto-annotated datasets.** The class list was derived
  from only the classes that happened to be detected, so an unobserved class 0
  shifted every other id in `data.yaml` while the label files kept the model's
  ids. The list is now dense and index-aligned.
* **A failed video read killed the MJPEG stream.** `capture.read()`'s return
  value was ignored, so a stale or `None` frame reached the model and the stream
  returned 500. Reads are now retried a bounded number of times.
* **A video job could "succeed" with an empty file.** `cv2.VideoWriter` built
  from undetermined capture dimensions silently discards every frame; the job now
  fails loudly with the reported dimensions.
* **A `None` class-name mapping crashed result serialisation.** All five
  hand-rolled `names` normalisations were replaced by the null-safe
  `serialise_names`.
* `JobStore.list` renamed to `list_jobs` — it shadowed the builtin `list` inside
  the class body, which confused readers and type checkers alike.
* Documented API-contract corrections: the `TrainRequest` defaults, the default
  tracker (ByteTrack), the export format count (21), the checkpoint count (79
  across 10 families), the endpoint count (60 + 2 WebSockets), and the
  `YOLO_STUDIO_DEFAULT_DEVICE` → `YOLO_STUDIO_DEVICE` rename.

### Changed

* `npm run test` now runs the frontend tests too (previously they exited with
  "no test files found", so `verify` skipped them).
* `npm run verify` now also runs `version:check`, the API linter and the API type
  checker, so one command covers every gate CI enforces.
* The API dev server enables auto-reload by default, matching what the docs
  always claimed. Set `YOLO_STUDIO_RELOAD=0` to disable it.
* `pytest.ini` was merged into `apps/api/pyproject.toml`; there is now one
  configuration file for the Python toolchain.
* Relative imports within the API package are explicitly allowed (`TID252`
  ignored) and documented, rather than being an accident of style.
* Broad `except` at hardware and third-party boundaries is now a documented
  per-file policy in `pyproject.toml` instead of scattered inline suppressions
  that drift as soon as the formatter runs.

## [1.1.0] - 2026-01-02

### Added

* **One-variable compute device switch.** `YOLO_STUDIO_DEVICE` in `.env` selects
  CPU, CUDA, MPS or Hailo; the repo ships a documented `.env.example` with the
  three options ready to uncomment. `auto` resolves CUDA → MPS → Hailo → CPU and
  never fails. `YOLO_STUDIO_DEFAULT_DEVICE` is still accepted as an alias.
* **Hailo accelerator support** (`core/hailo.py`): HEF discovery under
  `storage/weights`, a readiness checklist (runtime, board, compiler, model) with
  copy-paste setup steps for Raspberry Pi OS, architecture selection
  (`hailo8l`/`hailo8`/`hailo10h`/`hailo15h`/`hailo15l`), and a `hailo` export
  option on the Export page.
* **Capability-aware device profiles.** `GET /api/system/devices` reports what
  each device can actually run; Hailo is flagged inference-only and Train/Val are
  refused with an explanation instead of failing obscurely.
* **Device configuration endpoint** (`GET /api/system/device-config`) returning
  the profiles, the Hailo state and a generated `.env` snippet.
* **Compute device panel** on the System page: profile cards with readiness
  badges, a session device selector, the configuration snippet, and a Hailo
  setup walkthrough.
* Device selector in the application header, aware of the current mode.
* `GET /api/system/hailo` for Hailo-only readiness polling.
* 55 device tests covering aliases, fallbacks, capability metadata, guard rails
  and the API surface.

### Changed

* Device resolution is now split into *requested* → *resolved* → *engine device*
  (`core/device.py`). Hailo resolves to itself but drives the engine as `cpu`,
  because a HEF runs on the NPU rather than through torch.
* `validate_export_request` reports every unmet Hailo requirement at once rather
  than one per attempt.
* The model registry cache key includes the device and task, so the same
  checkpoint can be resident for CPU and CUDA simultaneously.

## [1.0.0] - 2026-01-01

First release: a complete workbench over the Ultralytics YOLO framework.

### Added

**Backend (`apps/api`)**

* FastAPI service with 53 endpoints across system, models, inference, modes,
  streaming, jobs, uploads, media, datasets and realtime routers.
* A single engine facade (`core/engine.py`) owning a thread-safe LRU model
  registry, checkpoint resolution (catalog download, local weights, absolute
  paths) and wrappers for predict, track, train, val, export and benchmark.
* Result serialisation for all five task heads: boxes, oriented boxes, mask
  polygons, 17-point keypoints and classification probabilities, in both pixel
  and normalised coordinates.
* Background job system on a bounded thread pool with a parsed, structured event
  stream (progress, metrics, logs, status), cancellation, artifact collection and
  `results.csv` history parsing.
* Validation metrics normalisation: mAP50/75/50-95, per-class precision, recall
  and F1, the mAP-vs-IoU curve matrix, confusion matrices and speed timings.
* Export and benchmark runners covering all 21 runtime formats advertised by the
  installed build, with per-format accuracy validation and per-row failure
  reporting.
* Streaming: server-side MJPEG sessions and a client-driven WebSocket camera
  loop, both able to run any of the sixteen built-in solutions with live
  counters and region-of-interest support.
* A frame bridge (`core/live.py`) that gives genuine tracker ID persistence for
  per-frame inference by presenting queued camera frames to Ultralytics as a real
  video stream.
* Dataset auto-annotation: pre-label an image folder with any checkpoint and emit
  standard YOLO labels plus a `data.yaml` for detect, segment, pose and OBB.
* Upload store with per-file metadata sidecars, ZIP extraction and a sandboxed
  media router that rejects nested paths and traversal.
* Test suite in three tiers: unit, HTTP contract, and engine integration tests.

**Frontend (`apps/web`)**

* React 19 + Vite + TypeScript SPA with a dark-first design system built on
  Tailwind v4 `@theme` tokens.
* Pages for every mode and dataset: dashboard, model zoo, datasets, predict,
  track & stream studio, solutions gallery, train, validate, export, benchmark,
  runs, jobs and system.
* Canvas-based result viewer with per-class toggling, zoom, hover/click
  inspection, oriented boxes, mask polygons and COCO-17 skeletons, plus a
  side-by-side comparison with the server-rendered plot.
* Live WebSocket camera studio with back-pressure, a latency chart and live
  solution counters.
* Command palette (⌘/Ctrl-K), background job dock with a streaming console,
  toast notifications and persisted preferences.
* Charts for training history, validation metrics, tracking populations,
  benchmark comparisons and latency.
* Reusable UI kit: buttons, cards, badges, sliders, switches, segmented controls,
  tables, modals, tooltips, progress bars, empty states and a log console.

**Tooling and documentation**

* Cross-platform bootstrap and dev scripts driven from `npm` (`bootstrap`,
  `dev`, `verify`, `test`).
* Documentation set: README, architecture, API reference, feature matrix,
  development guide, contributing guide and this changelog.
* OpenAPI schema persisted to `storage/openapi.json` on boot for offline client
  development.
