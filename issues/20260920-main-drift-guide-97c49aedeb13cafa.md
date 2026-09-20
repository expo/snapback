# main drift: guide is nondeterministic

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-20
**Drift gate:** `guide`
**Outcome:** `NONDETERMINISTIC`
**Failure signature:** `sha256:97c49aedeb13cafa71e017bb9692ae996871548cd8fec067670a1c8443fe1cc6`
**Causal landing:** `none — contradictory same-closure executions`
**Detected at:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
**Last observed:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
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
