# main drift: path-migration-stragglers has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-11
**Drift gate:** `path-migration-stragglers`
**Outcome:** `STALE`
**Failure signature:** `sha256:1b27f3a0cb3015605cb778603f4889d045d29e8cc0c8320c77ff119daeee6d6f`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `84bba5acaeeed27e1bc75f755404b164f0a8857b`
**Last observed:** `84bba5acaeeed27e1bc75f755404b164f0a8857b`
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
