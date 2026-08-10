# main drift: local-store-publication has a stale committed record

**Status:** Resolved 2026-08-10
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `local-store-publication`
**Causal landing:** `172a9a3afb791b575b3d7be91af063e843358363` (fix(migration): P0 rollback-after-reopen data integrity + cleanup/digest/checkpoint)
**Detected at:** `b07445b66d5d904ef16778c6775fa999c00e9505`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `local-store-publication` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `src/local-persistent-store-publication.v1.json and src/local-persistent-store-publication.anchor.v1.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/local-persistent-store-publication-v1.mjs
```

Regenerate/reconcile:

```sh
scripts/finalize-local-persistent-store-publication
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution — 2026-08-10

`src/local.rs` had drifted from the carrier pin
(`sha256:91efdfbb…` → `sha256:ab484d69…`). Reconciled in this landing via
`node scripts/refresh-publication-carrier.mjs` (carrier
`b04dc7bd759a` → `74d83e1cddc5`), then
`node tests/conformance/local-persistent-store-publication-v1.mjs` → exit 0,
status `published`, carrier exit `17 PASS / 0 GAP`, triage/fleet Move-1
`8/8 PASS`. Custody checker (`tests/agent_safe_publication_checker_v1.mjs`)
reports fail 0.
