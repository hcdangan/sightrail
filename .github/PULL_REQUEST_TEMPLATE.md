## What changed

<!-- One or two sentences. What does this PR do, and why? -->

## Related issue

<!-- "Closes #123" or "Refs #123" -->

## How it was tested

<!--
Be specific. "Tests pass" is not enough; say what you actually ran and observed.
-->

- [ ] `npm run verify` passes locally
- [ ] Added or updated tests for the change
- [ ] Exercised it manually in the running app

Commands / steps:

```bash

```

## Checklist

- [ ] **Layering respected** — no `ultralytics` import outside `apps/api/sightrail/core/`, and no `fetch` outside `apps/web/src/lib/api.ts`
- [ ] **Docs updated** — `docs/API.md` for new endpoints, `docs/FEATURES.md` for new capabilities, `docs/ARCHITECTURE.md` for structural changes
- [ ] **CHANGELOG.md** updated under `## [Unreleased]`
- [ ] **No secrets, credentials or personal data** committed (`.env` is git-ignored; use `.env.example` for defaults)
- [ ] **Breaking change?** Called out below, with a migration note

## Breaking change

<!--
Delete this section if not applicable. Changing a request/response schema, a
config variable name, or a default value is a breaking change: the UI ships with
the API, but users have saved URLs, scripts and .env files.
-->

- What breaks:
- Migration:

## Screenshots

<!-- For UI changes: before and after. Delete if not applicable. -->
