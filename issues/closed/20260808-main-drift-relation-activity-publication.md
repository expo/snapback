# main drift: relation-activity-publication has a stale committed record

**Status:** Resolved 2026-08-10
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `relation-activity-publication`
**Causal landing:** `172a9a3afb791b575b3d7be91af063e843358363` (fix(migration): P0 rollback-after-reopen data integrity + cleanup/digest/checkpoint)
**Detected at:** `b07445b66d5d904ef16778c6775fa999c00e9505`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `relation-activity-publication` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `src/local-relation-activity-publication.v1.json and its pinned readers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/relation-activity-publication-v1.mjs
```

Regenerate/reconcile:

```sh
node scripts/refresh-publication-carrier.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution — 2026-08-10

Reconciled in this landing by the same
`scripts/refresh-publication-carrier.mjs` run as the local-store record
(the refresh also updated the sequence-allocation carrier and the pinned
readers under `tests/conformance/`).
`node tests/conformance/relation-activity-publication-v1.mjs` → exit 0,
status `passed` (sbbc1 passed, canonical boundary ordering passed).
