# complete battery red: regression-ephemeral-wiring

**Status:** Open
**Reopened by battery run:** `local.20260927T084919Z.3a1f8b55d22c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:30128006f9ff136a6ccbcf695061643fdd3d38e130ade7b83c6f5af4ca744162`
**First observed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Last observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last processed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Detected at revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Last observed revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-ephemeral-wiring` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-ephemeral-wiring` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-ephemeral-wiring.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
