# main drift: guide has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-05
**Drift gate:** `guide`
**Outcome:** `STALE`
**Failure signature:** `sha256:2c1b06d03cf77ab1cb706bb30d870600e00707f4db61f37564f1f54b505a4c9d`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `926d62ad71ba41c06bf3bcb82d4f64bc1b426bc1`
**Last observed:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
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
