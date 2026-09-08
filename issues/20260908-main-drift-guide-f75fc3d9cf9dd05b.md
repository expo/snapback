# main drift: guide has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-08
**Drift gate:** `guide`
**Outcome:** `STALE`
**Failure signature:** `sha256:f75fc3d9cf9dd05b652a4a0639f83d099eb856c4347b07f1229065ff66418bad`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `309bc6e30d97ea24c98d67be53b35a0a0b8ae47e`
**Last observed:** `8844f168539e940fe87cdeea99bb17b9dcd88c15`
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
