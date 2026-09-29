# main drift: guide is nondeterministic

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-28
**Drift gate:** `guide`
**Outcome:** `NONDETERMINISTIC`
**Failure signature:** `sha256:8cc36cd883b89d08e654ac387ee31d998eda3d095b0258f2cd224a3fd08b185b`
**Causal landing:** `none — contradictory same-closure executions`
**Detected at:** `ddf317b139a9fa97a1dd61b21afd021a62ec1054`
**Last observed:** `ddf317b139a9fa97a1dd61b21afd021a62ec1054`
**Attribution:** `none-nondeterministic`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `guide` independently of path selection on
`main` and observed contradictory determinate executions over the same clean revision closure. No repair attribution is made for nondeterminism. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Affected frozen-record surface

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

Inspect the contradiction, then regenerate/reconcile only after restoring deterministic execution:

```sh
node scripts/generate-guide-manifest.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
