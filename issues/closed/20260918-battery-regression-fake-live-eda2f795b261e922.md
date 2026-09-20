# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-18
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:eda2f795b261e922e0442213a9fbd8b85e898c17014fc05a52335cedecd98c67`
**First observed run:** `local.20260918T181131Z.c60751e30f9f`
**Last observed run:** `local.20260918T181131Z.c60751e30f9f`
**Last processed run:** `local.20260919T040853Z.0168b46b0c20`
**Detected at revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Last observed revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-fake-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-fake-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-fake-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
