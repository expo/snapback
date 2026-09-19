# complete battery red: regression-gc-starvation

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-19
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:92092200f694696b115d4fc0f75c23e8bdd5476af30cb0f05367cbcaee82c0dc`
**First observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last processed run:** `local.20260919T040853Z.0168b46b0c20`
**Detected at revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Last observed revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
