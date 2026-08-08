# main drift: guide has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `guide`
**Causal landing:** `2857a3abce306be46606f985f5ab78877a03ce0e` (fix(react,client): StrictMode-safe owned providers + live-recovery divergence)
**Detected at:** `b07445b66d5d904ef16778c6775fa999c00e9505`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `guide` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `guide/guide-manifest.generated.json`
- `guide/guide-flat.generated.md`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/check-guide.mjs
```

Regenerate/reconcile:

```sh
node scripts/generate-guide-manifest.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
