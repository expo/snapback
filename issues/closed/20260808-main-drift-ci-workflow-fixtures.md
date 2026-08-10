# main drift: ci-workflow-fixtures has a stale committed record

**Status:** Resolved 2026-08-10
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `ci-workflow-fixtures`
**Causal landing:** `49b4541b6a9d65008d9e1498744d0b94973d0fb5` (fix(staging): move the assemble ledger check to a script file)
**Detected at:** `145fc2b6ad965cd715414aac45f5930db8e9969f`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `ci-workflow-fixtures` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/ci_workflows_v0.mjs (reviewed workflow, action, toolchain, and package-engine invariants)`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/ci_workflows_v0.mjs
```

Regenerate/reconcile:

```sh
node tests/ci_workflows_v0.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution — 2026-08-10

Gate re-run green on a clean checkout of `ec96f04e5`:
`node tests/ci_workflows_v0.mjs` → PASS (10 workflows, 46 immutable action
pins), exit 0. The committed record was reconciled by intervening landings;
nothing further to regenerate. Closing per the idempotent-while-open rule.
