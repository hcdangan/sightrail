# Contributing

Thanks for considering a contribution. This project exists to make the whole
Ultralytics surface explorable, so the most valuable contributions are the ones
that widen or deepen that coverage — a missing capability, a clearer explanation,
or a bug that made something harder to use than it should be.

## Before you start

* Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the layering rules are
  enforced in review, and knowing them saves a rewrite.
* Skim [`docs/FEATURES.md`](docs/FEATURES.md) to see what is already covered.
* For anything larger than a bug fix, open an issue first describing the change
  and the Ultralytics capability it exposes.

## Setting up

```bash
npm run bootstrap     # or follow docs/DEVELOPMENT.md
npm run dev
```

## The bar for a pull request

1. **It runs.** `npm run verify` passes (typecheck, lint, build, backend tests).
2. **It is tested.** New endpoints get a contract test in
   `apps/api/tests/test_api.py`; anything touching result serialisation or
   metrics gets an engine test in `tests/test_engine.py`.
3. **It is documented.** New endpoints appear in `docs/API.md`; new capabilities
   appear in the `docs/FEATURES.md` matrix; the README feature table is updated
   if the headline set changed.
4. **It respects the layers.** No `ultralytics` import outside `core/`, no
   `fetch` outside `lib/api.ts`.
5. **It explains itself.** Docstrings state *why* a module exists; comments
   explain constraints, not mechanics.

## Commit style

Conventional Commits, imperative mood, scope where it helps:

```
feat(api): expose benchmark accuracy per export format
fix(web): keep track colours stable when IDs are recycled
docs: document the live tracking bridge
test(api): cover upload path-traversal rejection
```

## What makes a good contribution here

| Kind | Examples |
| --- | --- |
| **Coverage** | A mode argument that is not exposed yet; a solution without UI copy; a metric Ultralytics reports that the UI drops |
| **Clarity** | A confusing label, a missing unit, a chart without axes, an error message that does not say what to do |
| **Robustness** | A missing edge case (empty dataset, missing weights, CPU-only host), a clearer failure mode |
| **Performance** | Avoiding a redundant inference, batching a round trip, tightening a payload |
| **Docs** | A worked example, a troubleshooting entry, a diagram |

## Reporting bugs

Include:

* what you did (the exact request or UI path),
* what you expected,
* what happened, with the error text or a screenshot,
* the **System** page contents (Python, torch, CUDA, Ultralytics version, device),
* whether it reproduces with a sample asset (`bus.jpg`) and the default model.

The System page is designed to capture everything needed in one screenshot.

## Security

* Do not open a public issue for a vulnerability — report it privately to the
  maintainers.
* Note that the API intentionally executes local inference and can read files
  under its storage root. It is designed for a trusted, single-user environment;
  do not expose it to the public internet without adding authentication and a
  strict source allow-list (see `api/deps.py::_guard_remote` for the existing
  SSRF guards).

## License

By contributing you agree that your work is released under the
**AGPL-3.0** license, matching the project and upstream Ultralytics.
