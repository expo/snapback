# main drift: path-migration-stragglers has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-02
**Drift gate:** `path-migration-stragglers`
**Outcome:** `STALE`
**Failure signature:** `sha256:67131c097974408c2b13dddf1fb5abf2b2b4594321739e0d1fe01dcd01a810ba`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `69c95613ab978630f3a6af58e35a449374161f36`
**Last observed:** `2ac97c6f1f7fc4047d4aa12b8979864c045c309e`
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
