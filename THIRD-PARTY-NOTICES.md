# Third-party notices

Sightrail is licensed under the **GNU Affero General Public License v3.0 or
later** (see [`LICENSE`](LICENSE)). That is not a preference — it is a
requirement, because this application imports **Ultralytics YOLO**, which is
AGPL-3.0, directly into its own process. See
[Why AGPL-3.0, and not something permissive](#why-agpl-30-and-not-something-permissive).

This file records the third-party components distributed with, or required by,
Sightrail, together with their licenses. The tables below were generated from the
metadata of the installed, pinned versions — not from memory. Regenerate them
after any dependency change:

```bash
npm run license:report
```

That script resolves both dependency closures, prints the same summary, and
**fails** if a component incompatible with AGPL-3.0 appears.

---

## Runtime dependencies

### License-critical components

These are the components whose terms decide the project's own license. Versions
are the ones audited; they move with `package-lock.json` and the API
requirements.

| Component | Version audited | License |
| --- | --- | --- |
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) | 8.4.157 | **AGPL-3.0-or-later** |
| [ultralytics-thop](https://github.com/ultralytics/thop) | 2.1.6 | **AGPL-3.0-or-later** |
| [ultralytics-platform](https://github.com/ultralytics/sdk) | 0.1.52 | **AGPL-3.0-only** |
| [PyTorch](https://pytorch.org/) (`torch`) | 2.14.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| [torchvision](https://github.com/pytorch/vision) | 0.29.0 | BSD-3-Clause |
| [OpenCV](https://opencv.org/) (`opencv-python`, `opencv-python-headless`) | 5.0.0.93 | Apache-2.0 |
| [NumPy](https://numpy.org/) | 2.5.3 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| [certifi](https://github.com/certifi/python-certifi) | 2026.7.22 | MPL-2.0 |

`ultralytics`, `ultralytics-thop` and `ultralytics-platform` are all published by
Ultralytics under AGPL-3.0. `ultralytics-platform` (the Platform SDK) is pulled
in unconditionally on Python ≥ 3.11 as a dependency of `ultralytics` itself.

`certifi` is the only **MPL-2.0** component anywhere in the project. MPL-2.0 is
file-level copyleft and is compatible with AGPL-3.0 — MPL-2.0 §3.3 expressly
permits distributing the covered files under a secondary license, and it is used
here unmodified as a certificate bundle with no changes of our own.

### The complete API runtime closure

All 55 distributions reachable from `apps/api/pyproject.toml`, grouped by
license. Markers are evaluated for the platform in use, so optional and
platform-gated dependencies are excluded.

| License | Components |
| --- | --- |
| **AGPL-3.0** (or-later / only) | `ultralytics`, `ultralytics-platform`, `ultralytics-thop` |
| Apache-2.0 | `aiofiles`, `opencv-python`, `opencv-python-headless`, `python-multipart`, `requests` |
| Apache-2.0 OR BSD-2-Clause | `packaging` |
| BSD-3-Clause (20) | `click`, `cloudpickle`, `contourpy`, `cycler`, `fsspec`, `httpcore`, `httpx`, `idna`, `jinja2`, `kiwisolver`, `markupsafe`, `mpmath`, `networkx`, `nvidia-ml-py`, `psutil`, `python-dotenv`, `starlette`, `sympy`, `torchvision`, `uvicorn` |
| BSD-3-Clause / Apache-2.0 | `python-dateutil` |
| BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | `numpy` |
| MIT (19) | `annotated-doc`, `annotated-types`, `anyio`, `charset-normalizer`, `fastapi`, `filelock`, `fonttools`, `h11`, `polars`, `polars-runtime-32`, `pydantic`, `pydantic-core`, `pydantic-settings`, `pyparsing`, `pyyaml`, `setuptools`, `six`, `typing-inspection`, `urllib3` |
| MIT-CMU | `pillow` |
| MPL-2.0 | `certifi` |
| PSF-2.0 | `matplotlib`, `typing-extensions` |

Everything outside the Ultralytics packages is MIT, Apache-2.0, BSD, PSF or
MPL-2.0. There is no GPL, SSPL, BUSL or Elastic-licensed component.

---

## Frontend dependencies

The web client (`apps/web`) declares ten runtime dependencies. Resolving that
declaration through `package-lock.json` gives a production closure of **54
packages, all permissively licensed**:

| License | Packages |
| --- | --- |
| MIT | 38 |
| ISC | 12 |
| BSD-3-Clause | 2 |
| Apache-2.0 | 1 |
| MIT AND ISC | 1 |

**No GPL, LGPL, AGPL or MPL package is present in the production closure.**

Principal components: [React](https://react.dev/) and
[react-dom](https://react.dev/) (MIT),
[React Router](https://reactrouter.com/) (MIT),
[TanStack Query](https://tanstack.com/query) (MIT),
[Zustand](https://github.com/pmndrs/zustand) (MIT),
[Recharts](https://recharts.org/) (MIT), [Lucide](https://lucide.dev/) (ISC),
[clsx](https://github.com/lukeed/clsx) (MIT),
[tailwind-merge](https://github.com/dcastil/tailwind-merge) (MIT) and
[class-variance-authority](https://github.com/joe-bell/cva) (Apache-2.0).

Build-time only, and therefore not part of the client's production closure:
[Vite](https://vite.dev/) (MIT),
[TypeScript](https://www.typescriptlang.org/) (Apache-2.0),
[Tailwind CSS](https://tailwindcss.com/) (MIT) and its native CSS engine
[lightningcss](https://github.com/parcel-bundler/lightningcss) (MPL-2.0) — the
only file-level copyleft package anywhere in the frontend tree. It is used as an
unmodified build tool, so it imposes no obligation on Sightrail's own source.

---

## Development-only dependencies

Not distributed with the application, listed for completeness: pytest,
pytest-cov, pytest-asyncio, httpx, ruff, mypy, bandit, pip-audit, Vitest, jsdom,
Testing Library, ESLint and Dependabot-managed tooling.

---

## Model weights are not covered

Sightrail downloads checkpoints at runtime (`yolo11n.pt` and friends) into
`storage/weights/`. **Those are separate works, distributed by Ultralytics under
their own terms, and are not relicensed by this project.** Ultralytics YOLO
weights are AGPL-3.0; weights you train yourself are yours to license, subject to
the terms of whatever you trained them on. Review the terms of any checkpoint
before commercial use — the application surfaces the checkpoint's own license
metadata where available.

Datasets behave the same way: `coco8`, `coco128`, `VOC`, ImageNet and others are
fetched from their upstream hosts and carry their own licenses (COCO's
annotations are CC BY 4.0; the images have their own terms). Sightrail does not
redistribute them.

---

## Obligations you inherit by running this

AGPL-3.0 is strong copyleft with a **network use** clause. If you run Sightrail —
or a modified version of it — as a service that other people interact with over a
network, you must offer those users the Corresponding Source of the version you
are running, including your modifications. Section 13 of the license spells this
out.

In practice:

* **Local, single-user use** (the default: bound to `127.0.0.1`) triggers no
  additional obligation beyond the usual AGPL terms.
* **Deploying it for others to use over a network** means publishing your
  modified source, or providing a written offer to do so, to every user of that
  service. Because this repository is public and unmodified deployments are
  already served by it, the usual way to satisfy §13 is to publish your fork.
* **Linking Ultralytics into your own closed-source product** is not permitted
  under AGPL-3.0. A commercial license is available from
  [Ultralytics](https://www.ultralytics.com/license) if that is what you need —
  in which case this project's own AGPL obligations still apply to its code.

None of this is legal advice. If the licensing matters to your organisation, have
a lawyer review it.

---

## Why AGPL-3.0, and not something permissive

The engine is not a subprocess or a network call — it is an import:

```
apps/api/sightrail/core/engine.py       ->  from ultralytics import YOLO
apps/api/sightrail/core/live.py         ->  from ultralytics.data.loaders import LoadStreams
apps/api/sightrail/core/streaming.py    ->  from ultralytics import solutions
apps/api/sightrail/core/models_meta.py  ->  from ultralytics.engine.exporter import export_formats
apps/api/sightrail/core/datasets.py     ->  import ultralytics   (bundled dataset configs)
apps/api/sightrail/api/deps.py          ->  import ultralytics   (bundled assets)
apps/api/sightrail/api/media.py         ->  import ultralytics   (bundled assets)
```

`ultralytics` and `ultralytics-thop` are both **AGPL-3.0**. Under that license the
combined work must be AGPL-3.0, so a permissive license on this repository would
be inaccurate and unenforceable. Every other runtime dependency is
MIT/Apache-2.0/BSD/PSF/MPL-2.0, so Ultralytics is the single component that
dictates the terms — and it dictates them decisively.

This is why the license is stated as `AGPL-3.0-or-later` in `package.json`,
`apps/web/package.json` and `apps/api/pyproject.toml`, and why the repository
carries the full AGPL-3.0 text as [`LICENSE`](LICENSE).

The alternative is not a different open-source license — it is a commercial one.
[Ultralytics Enterprise Licensing](https://www.ultralytics.com/license) removes
the copyleft obligation on the Ultralytics components. Only under such a license
could this project be redistributed permissively, and even then it would need to
be forked under different terms. As it stands, AGPL-3.0 is the correct and only
honest choice.

---

## Reporting a licensing problem

If you believe a component here is misattributed or its license is incompatible,
please open an issue (or report privately per [`SECURITY.md`](SECURITY.md)). A
license error is a real bug, and `npm run license:report` is the first thing to
run.
