# main drift: local-store-publication has a stale committed record

**Status:** Open
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
