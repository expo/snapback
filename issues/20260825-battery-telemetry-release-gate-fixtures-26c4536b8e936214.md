# complete battery red: telemetry-release-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `telemetry-release-gate-fixtures`
**Failure signature:** `sha256:26c4536b8e9362145c50a7b85938fa0fb9cd22bb77683e1265cb8b114c951adf`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260825T115521Z.64e70df1e088`
**Last processed run:** `local.20260825T115521Z.64e70df1e088`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `telemetry-release-gate-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `telemetry-release-gate-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/telemetry-release-gate.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
