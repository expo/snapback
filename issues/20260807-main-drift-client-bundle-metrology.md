# main drift: client-bundle-metrology has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-07
**Drift gate:** `client-bundle-metrology`
**Causal landing:** `5fb86ebd754c058e6755ae682c6b9819b01354ae` (feat(client,guide): route retention by workload shape; name the failed rqs-eligibility rule)
**Detected at:** `fb505c1c5e974ef01668615a4b3995534af228d2`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `client-bundle-metrology` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/fixtures/client-bundle-metrology/current.v1.json and its active profile/baseline ledgers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/client-bundle-metrology.mjs --check
```

Regenerate/reconcile:

```sh
node scripts/client-bundle-metrology.mjs --write-current
```

For an explicitly reviewed bundle rollover:

```sh
node scripts/client-bundle-metrology.mjs --write-rollover-baseline
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
