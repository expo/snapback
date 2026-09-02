# main drift: path-migration-stragglers has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-31
**Drift gate:** `path-migration-stragglers`
**Outcome:** `STALE`
**Failure signature:** `sha256:e42954e63dda90f5ddd96222c12c12cbc9806cd049883b18f715479aba0b666a`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `7a26ee45a98664fa15a0ea509ef58f066bd3cbb7`
**Last observed:** `7a26ee45a98664fa15a0ea509ef58f066bd3cbb7`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `path-migration-stragglers` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `scripts/path-migration-manifest.v1.json (LLP 0276 path-sensitive consumer plan and epoch-aware search contract)`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/check-path-migration-stragglers.mjs
```

Regenerate/reconcile:

```sh
node scripts/check-path-migration-stragglers.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
