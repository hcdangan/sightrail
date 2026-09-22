# Handoff

Context for picking this project up in a fresh session.

The project was previously called "Ultralytics YOLO Studio" and lived at
`C:\code\yolo-studio`. It was renamed to **Sightrail** in 1.3.0 because the old
name embedded Ultralytics' trademarks in identifiers; the full old → new mapping
is in `CHANGELOG.md`. It is expected to live at `C:\code\sightrail`.

**Read this first, then `README.md` (how to run it) and `CHANGELOG.md` (what
changed and why).**

---

## 1. Where things stand

| | |
| --- | --- |
| Location | `C:\code\sightrail` |
| Version | `1.3.0`, consistent across all four manifests + the CHANGELOG |
| Git | branch `main`, 130 tracked files, pushed to `origin` (`https://github.com/hcdangan/sightrail`), in sync with `origin/main` |
| Quality gates | `npm run verify` green: version check → typecheck (web + API) → lint (web + API) → build → 28 web tests → 151 backend tests; `npm run license:report` green |
| Licensing | AGPL-3.0-or-later, declared in every manifest and enforced by `npm run license:report` (also a blocking job in the Security workflow). Details in `THIRD-PARTY-NOTICES.md`. |
| Compute device | `.env` sets `SIGHTRAIL_DEVICE=cpu`; `cuda:0` falls back to CPU (no CUDA torch build); `hailo` reports `runtime-missing` |

### Environment notes

* `.venv` (Python 3.12) and `node_modules` were recreated at the current location and
  both work. `.venv` is **not portable** — its absolute paths are baked in, so any
  future move needs `npm run bootstrap` again rather than a copy.
* Downloaded weights live in `storage/weights/` (`yolo11n`, `-seg`, `-pose`, `-cls`,
  and a `.torchscript` export), so offline inference works immediately.
* `storage/` is git-ignored. Treat it as cache, not data.
* `.env` uses `SIGHTRAIL_*` keys. It is git-ignored and was migrated by hand
  during the 1.3.0 rename; a stale `YOLO_STUDIO_*` key is silently ignored, so if
  a setting appears to have no effect, check the prefix first.

---

## 2. What was done in the previous session

The session built the application, then audited it. **The audit found three real
security bugs and several correctness bugs**, all now fixed with regression tests.
A short summary; `CHANGELOG.md` has the full detail.

### Security

1. **Zip Slip** — `POST /api/uploads/{id}/extract` called `extractall()` on a
   user-supplied archive with no validation, so a crafted ZIP could write anywhere
   the process could reach. Now every member is resolved and containment-checked
   (`services/uploads.py::_is_safe_member`).
2. **Inference-source sandbox** — absolute paths anywhere on the host were
   accepted. Now restricted to the storage root, the repository, or an explicit
   `SIGHTRAIL_EXTRA_SOURCE_ROOTS` entry.
3. **SSRF guard** — the host was resolved and then `urlopen` re-resolved it. Now
   every address is validated once, before any connection.

### Correctness

4. **Concurrent jobs corrupted each other's logs.** `capture_engine_stdout`
   swapped the process-global `sys.stdout`, so with `max_concurrent_jobs > 1` two
   jobs captured each other's output and the first to finish installed a *dead*
   capture as the real stdout — after which every log line silently vanished. Now
   output is routed per thread and the real streams are restored exactly once.
5. **Live tracking lagged one frame permanently.** A result for the previous frame
   could be returned as the current one. Frames now carry a sequence number and
   `LiveTracker.infer` only accepts a matching result.
6. **`data.yaml` mislabelled auto-annotated datasets** — the class list came from
   only the classes that were detected, so an unobserved class 0 shifted every id
   while the label files kept the model's ids.
7. **MJPEG stream 500'd on a failed read** (stale/`None` frame reached the model).
8. **Video jobs could "succeed" with an empty MP4** when `VideoWriter` was built
   from undetermined dimensions.
9. **A `None` class-name mapping crashed result serialisation** — five hand-rolled
   normalisations replaced by the null-safe `serialise_names`.
10. `JobStore.list` renamed `list_jobs`; it shadowed the builtin inside the class.

### Licensing

* **AGPL-3.0-or-later is a requirement, not a choice.** `ultralytics`,
  `ultralytics-thop` and `ultralytics-platform` are AGPL-3.0 and are imported
  in-process by `core/`, so the combined work cannot be relicensed. Do not
  "correct" the `license` field in any manifest, and do not add a permissively
  licensed sub-package that links Ultralytics.
* `THIRD-PARTY-NOTICES.md` records every runtime and production-frontend
  dependency, the weights/datasets that are *not* covered, and the AGPL §13
  network obligations.
* `npm run license:report` regenerates those numbers from the lockfile and the
  installed distributions and fails on GPL/SSPL/BUSL/Elastic. It is a blocking
  job in `security.yml`.
* The one non-permissive-looking component that is fine: `certifi` is MPL-2.0
  (file-level copyleft, compatible with AGPL-3.0). `lightningcss` in the frontend
  is MPL-2.0 too and is build-time only.

### Tooling

* `apps/api/pyproject.toml` is the single source of truth for ruff, mypy, bandit
  and pytest (`pytest.ini` was removed). Lint findings went **73 → 0**.
* Broad `except` at hardware/third-party boundaries is a **documented per-file
  policy** in that config, not scattered inline `noqa`s — those drift as soon as
  the formatter runs. Adding a file to that list needs a reason in the same commit.
* GitHub Actions: `ci.yml` (lint/typecheck/test matrix/build), `security.yml`
  (gitleaks, bandit→SARIF, pip-audit, npm audit, license report, zizmor),
  `integration.yml` (opt-in real-engine tests).
* `SECURITY.md`, `CODEOWNERS`, Dependabot, issue/PR templates, `.gitleaks.toml`.
* `npm run version:check` asserts the version agrees everywhere; CI enforces it.

---

## 3. Known gaps — start here

Ordered by value, not difficulty.

1. **WebSocket handlers have no automated tests.** `api/realtime.py` (the job
   console and the live camera channel) is covered only by manual use. This is the
   largest coverage gap. Testing it needs a real event loop plus a stubbed engine;
   `TestClient.websocket_connect` is the obvious starting point.
2. **`services/runners.py` is covered only end-to-end** through the integration
   suite. Unit tests would mean stubbing `engine` per mode.
3. **Nothing is committed.** The working tree holds the entire project as
   untracked files. Commit before making changes, so the audit fix history is
   legible.
4. **No authentication.** By design — the reverse proxy is the intended boundary,
   documented in `SECURITY.md`. Do not expose this to an untrusted network.
5. **Job history is in-memory** and cleared on restart
   (`SIGHTRAIL_JOB_RETENTION_SECONDS=3600`). Run artifacts on disk are the
   durable record.
6. **Single-worker jobs by default** (`SIGHTRAIL_MAX_CONCURRENT_JOBS=1`). The
   stdout fix makes >1 safe, but it is untested under real concurrent training.
7. **Hailo is verified only up to the runtime boundary.** Every guard, message and
   discovery path is exercised, but no HEF has ever been run on real hardware
   (none was available). See `docs/ARCHITECTURE.md` → *Device handling*.
8. **Never rendered in a browser.** The UI is verified by compilation, types and
   tests — not visually. `/help` and the System device panel are the most likely
   places to need polish.

---

## 4. Suggested next steps

```powershell
cd C:\code\sightrail
git add -A
git commit -m "chore: import project as transferred"

npm run verify     # confirm the baseline is green before changing anything
npm run dev        # then open http://127.0.0.1:5173
```

Then, in order:

1. Open the app and click through every page once. Note anything that looks wrong —
   that is the fastest way to close gap 8.
2. Write WebSocket tests (gap 1). Start with the job channel: it needs no model,
   only a stub job emitting events.
3. Pick an item from `docs/FEATURES.md` and extend it, if the goal is still
   breadth rather than depth.

---

## 5. Orientation for a new reader

| Question | Answer |
| --- | --- |
| How do I run it? | `npm run dev`, then <http://127.0.0.1:5173> — or the in-app **Help** page |
| Where is the architecture? | `docs/ARCHITECTURE.md` (layering, request lifecycle, job system, streaming) |
| Where is the API documented? | `docs/API.md`, and live at `/api/docs` |
| What is implemented? | `docs/FEATURES.md` (capability → file matrix) |
| How do I work on it? | `docs/DEVELOPMENT.md` (inner loop, conventions, debugging) |
| Where does the engine live? | `apps/api/sightrail/core/engine.py` is the only module that *constructs* models |
| Where is the only `fetch` call? | `apps/web/src/lib/api.ts` |
| How do I change the compute device? | `SIGHTRAIL_DEVICE` in `.env` — see `.env.example` |

### Layering rules (enforced by review)

```
api/  ->  services/  ->  core/  ->  (ultralytics, torch, opencv)
```

* `api/` never imports `ultralytics`.
* `core/` never imports FastAPI.
* `api/deps.py` and `api/media.py` are the deliberate exceptions that read
  Ultralytics' bundled sample assets.
