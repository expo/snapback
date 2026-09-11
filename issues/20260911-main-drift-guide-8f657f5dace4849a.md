# main drift: guide has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-11
**Drift gate:** `guide`
**Outcome:** `STALE`
**Failure signature:** `sha256:8f657f5dace4849a51e081ffbeff9466643a2910e38a9850d7f787fb8bb942c4`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `2561ddf6ff60f21cd024263c38410cd007e0cdc7`
**Last observed:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `guide` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `Guide manifest, whole-corpus flat, and every section flat projection`
- `diagnostics registry, Markdown projection, and public TypeScript code union`
- `symbol registry, compact reference index, and every generated module reference page`

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
