# main drift: generated-artifacts has a stale committed record

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-09
**Drift gate:** `generated-artifacts`
**Causal landing:** `3065fea64215618ae112e4d07c80a1a18e5d6592` (docs(guide),fix-forward(0199): regenerate diagnostics/reference/carriers over the rebased slice-4 tree)
**Detected at:** `3065fea64215618ae112e4d07c80a1a18e5d6592`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `generated-artifacts` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `committed review manifests and projections selected by scripts/generated-artifact-policy.mjs`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
scripts/check-generated-artifacts
```

Regenerate/reconcile:

```sh
scripts/check-generated-artifacts
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution

Resolved on 2026-08-09 against `origin/main` revision
`fc75acf24290725f78bf31a32cc88f7dd144901b`. Repository-wide regeneration
identified four stale composition-backed projections: Triage Graph, Fleet
Observatory, Latency Kanban, and Contention Calendar. Their trusted activations
were re-minted with the exact qualified Snapback binary and their committed
review surfaces were regenerated; the Contention Calendar content-addressed
descriptor and binding rotated as required. No other committed generated root
changed.

After committing those deterministic outputs, `scripts/check-generated-artifacts`
passes over every job in `scripts/generated-artifact-policy.mjs`.
