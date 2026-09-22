# Repository rulesets

Branch rules are GitHub *repository settings*, not files — nothing here is applied
automatically. They are committed anyway so the protection on `main` is
reviewable, diffable and re-appliable instead of living only in the web UI.

| File | Ruleset | Applies to |
| --- | --- | --- |
| `protect-main.json` | `Protect main` | the default branch (`main`) |

## What `Protect main` enforces

| Rule | Effect |
| --- | --- |
| `deletion` | `main` cannot be deleted |
| `non_fast_forward` | `main` cannot be force-pushed, so history is never rewritten |
| `required_linear_history` | merges must be squash or rebase; no merge commits |
| `pull_request` | changes land through a PR. **0 required approvals**, so the sole maintainer can self-merge — the value here is the review *record* and the gate, not a second human. Unresolved review threads block the merge |
| `required_status_checks` | `CI complete`, `License compliance` and `Secret scanning` must pass, and the branch must be up to date with `main` first |

`CI complete` is the single aggregate job in `ci.yml`; it already fails if any of
lint, types, the three-version test matrix or the web build fails, so requiring
the individual matrix jobs as well would just be noise.

### Bypass

`hcdangan` (user `17623934`) is a bypass actor with `bypass_mode: always`. As the
only maintainer, being able to push a hotfix directly is worth more than the
theoretical strictness of locking yourself out. Every bypass is recorded in the
ruleset's audit log, so it is visible after the fact.

Remove the `bypass_actors` block entirely if that trade-off ever stops being the
right one — for example once there is a second maintainer.

## Applying it

Creating (first time):

```bash
gh api --method POST /repos/hcdangan/sightrail/rulesets \
  --input .github/rulesets/protect-main.json
```

Updating (subsequent changes) needs the ruleset id, which `POST` will not reuse:

```bash
ID=$(gh api /repos/hcdangan/sightrail/rulesets --jq '.[] | select(.name=="Protect main") | .id')
gh api --method PUT "/repos/hcdangan/sightrail/rulesets/$ID" \
  --input .github/rulesets/protect-main.json
```

Both need a token with admin rights on the repository — `gh auth login` with the
`repo` scope is sufficient for a public repo.

## Verifying it

Ask GitHub which rules actually apply to `main`, rather than trusting that the
request was accepted:

```bash
gh api /repos/hcdangan/sightrail/rules/branches/main \
  --jq '.[] | "\(.type) \(.parameters // "")"'
```

## A note on required checks

A required check that never runs blocks every merge forever. Before adding one to
`required_status_checks`, confirm it has reported at least once:

```bash
gh api "/repos/hcdangan/sightrail/commits/main/check-runs" --jq '.check_runs[].name'
```

This is not hypothetical: CI failed on every run from the project's first push
(missing `mypy` in `requirements-dev.txt`, plus a test that asserted a
Linux-x86_64-only error message on a Windows host), so requiring `CI complete`
before that was fixed would have frozen `main` completely.
