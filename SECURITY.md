# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's
[Security Advisories](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
**Security** tab → **Report a vulnerability**. If you cannot use that, contact the
maintainer listed in [`CODEOWNERS`](.github/CODEOWNERS).

Please include:

* what you did, and the exact request or UI path,
* what happened, with the error text or a proof of concept,
* the **System** page contents from the running app (versions, platform, device),
* your assessment of impact.

You can expect an acknowledgement within a few days. This is a community project
without a paid security team, so please allow reasonable time for a fix before
disclosing publicly.

## Supported versions

The latest release on the default branch receives fixes. Older releases are not
maintained.

## Deployment model — please read before deploying

**Sightrail is designed for a trusted, single-user environment. It has no
authentication and no authorisation.** Anyone who can reach the HTTP port can:

* run inference, training and export jobs (consuming CPU/GPU and disk),
* read any media the service has stored,
* upload files, and expand uploaded ZIP archives.

Therefore:

* **Bind it to `127.0.0.1`** (the default: `SIGHTRAIL_HOST`).
* Do **not** expose it to the public internet or an untrusted network as-is.
* If you must share it, put it behind a reverse proxy that enforces
  authentication and TLS, and restrict who can reach it. Adding auth is out of
  scope for this project; the proxy is the intended boundary.

## Security controls that do exist

The API is written to be safe on a *trusted* host, and the following controls are
implemented and tested:

| Threat | Control | Where |
| --- | --- | --- |
| **Path traversal** in media requests | Category-scoped roots, resolved and containment-checked; nested paths rejected | `api/media.py`, `api/deps.py` |
| **Zip Slip** (malicious archive writing outside the upload store) | Every archive member is validated before extraction; the whole archive is rejected if any member escapes | `services/uploads.py::_is_safe_member` |
| **SSRF** (using the API to reach internal services) | Only `http(s)`; private, loopback, link-local and reserved addresses refused; localhost allowed only for the app's own `/api/` media | `api/deps.py::_guard_remote` |
| **Unbounded uploads** | Configurable maximum size, streamed and aborted past the limit | `services/uploads.py`, `SIGHTRAIL_MAX_UPLOAD_MB` |
| **Arbitrary filesystem reads as an inference source** | Sources must resolve inside the storage root, the repository, or an explicit `SIGHTRAIL_EXTRA_SOURCE_ROOTS` entry | `api/deps.py::_allowed_source_roots` |
| **Command injection** | No shell invocation anywhere in the service | — |
| **Dependency vulnerabilities** | `pip-audit` and `npm audit` on every push and weekly | `.github/workflows/security.yml` |
| **Secret leakage** | gitleaks over the full history on every push | `.github/workflows/security.yml` |
| **Unsafe code patterns** | bandit (medium+) and ruff's `S` rules | `.github/workflows/security.yml`, `apps/api/pyproject.toml` |
| **Non-compliant dependency licenses** | `npm run license:report` exits non-zero on any AGPL-3.0-incompatible component | `.github/workflows/security.yml`, `scripts/license-report.mjs` |
| **Force-push or deletion of `main`, or unreviewed pushes to it** | Repository ruleset: no force pushes, no deletion, linear history, pull request with resolved threads, and three required checks before merge | `.github/rulesets/protect-main.json` |

### Known limitations

* **Local file access is intentional.** The service can read images and videos
  inside its storage root and the repository, because that is what a local
  inference tool does. It is not a sandbox.
* **Job execution is in-process.** A job runs arbitrary Ultralytics code paths
  with the API's privileges — the usual trust model for a local tool.
* **`torch.load` is used by PyTorch** when loading `.pt` checkpoints. Only load
  checkpoints you trust; this includes any downloaded from the model zoo.
* **No rate limiting.** Not needed on a single-user localhost service; add it at
  the proxy if you deploy behind one.

## What is not a vulnerability

* The API being reachable on localhost without credentials (by design).
* Reading files inside the storage root or repository (by design).
* A malicious dataset or checkpoint causing a crash or resource exhaustion on a
  host you control, unless it escapes the storage root or the process.
* Findings that require an attacker to already have local shell access.
