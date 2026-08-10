# main drift: guide has a stale committed record

**Status:** Resolved 2026-08-10
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `guide`
**Causal landing:** `2857a3abce306be46606f985f5ab78877a03ce0e` (fix(react,client): StrictMode-safe owned providers + live-recovery divergence)
**Detected at:** `b07445b66d5d904ef16778c6775fa999c00e9505`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `guide` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `guide/guide-manifest.generated.json`
- `guide/guide-flat.generated.md`

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

## Resolution — 2026-08-10

Reconciled in this landing: `node scripts/generate-guide-manifest.mjs`
regenerated `guide/guide-manifest.generated.json` and the flat projections,
after materializing the generated snippet sources a fresh checkout lacks
(`SNAPBACK_OUTBOUND_ACTIONS=1` competitive-checkpoint codegen, todo-v2
codegen + the exact-todo-v2 contract job for `runtime-links.ts`).
`node scripts/check-guide.mjs` → ok — 115 pages, 1198 snippets, 161 routes
+ 50 host-ops joined (69 warnings are the pre-existing freshness-saturation
program, tracked separately).
