# main drift: guide has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-26
**Drift gate:** `guide`
**Outcome:** `STALE`
**Failure signature:** `sha256:29f9b9cb2b3651f0a97f98bd8cb93e1d519632bf5a49e4425728e869e951868b`
**Causal landing:** `75961ea9b87777f3749c0600a8d56627a417c363` (fix(auth): derive OAuth token entropy from provider)
**Detected at:** `ad53ab3d97c07bee4446f03187164167c2c0d034`
**Last observed:** `ad53ab3d97c07bee4446f03187164167c2c0d034`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `guide` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
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
