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
**Failure signature:** `sha256:fc0d8201cfaa78d9d30233905eb4bf5a8e4710e7b39141048341339bc304dff5`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `585701d70f9333d1eb5c3f0468fe5af6d2348642`
**Last observed:** `585701d70f9333d1eb5c3f0468fe5af6d2348642`
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
