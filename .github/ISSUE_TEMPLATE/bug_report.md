---
name: Bug report
about: Something is broken or behaves unexpectedly
title: "[bug] "
labels: ["bug", "triage"]
---

<!--
Before filing: please search existing issues, and include the System page
contents if the problem happens in the UI - it captures the environment in one
screenshot and saves a round trip.
-->

## What happened

<!-- A clear description of the actual behaviour. -->

## What you expected

<!-- What should have happened instead. -->

## How to reproduce

1.
2.
3.

**Does it reproduce with the default setup?** (a bundled sample image and
`yolo11n.pt`) — yes / no

## Environment

Paste the output of `curl http://127.0.0.1:8000/api/system/env`, or a screenshot
of **System** in the UI.

```json

```

Relevant details:

- Install method: `npm run bootstrap` / manual
- Device: `cpu` / `cuda:0` / `mps` / `hailo`
- Python version:
- Node version:
- OS:

## Error output

<!--
Full traceback or console output. Where does it come from?
- Browser console
- The API terminal
- A job console (Jobs page)
-->

```

```

## Additional context

<!-- Screenshots, the job id, the run directory, anything else that helps. -->
