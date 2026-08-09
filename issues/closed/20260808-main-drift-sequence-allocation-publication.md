# main drift: sequence-allocation-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `sequence-allocation-publication`
**Causal landing:** `172a9a3afb791b575b3d7be91af063e843358363` (fix(migration): P0 rollback-after-reopen data integrity + cleanup/digest/checkpoint)
**Detected at:** `b07445b66d5d904ef16778c6775fa999c00e9505`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `sequence-allocation-publication` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `src/local-sequence-allocation-publication.v1.json and its pinned readers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/sequence-allocation-publication-v1.mjs
```

Regenerate/reconcile:

```sh
node scripts/refresh-publication-carrier.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution (2026-08-09)

Reconciled via `node scripts/refresh-publication-carrier.mjs` after the LLP
0204 S0 landing (eaed8e784) rotated pinned readers
(src/local/auth_room_kick_acceptance.rs, src/storage/tests.rs,
packages/snapback-codegen/index.mjs). The refresh also re-minted the
local-persistent-store and relation-activity carriers plus the inline sha
pins in src/manifest.rs. All three conformance checks pass at the reconciled
tree:
sequence-allocation-publication-v1, local-persistent-store-publication-v1,
relation-activity-publication-v1.
