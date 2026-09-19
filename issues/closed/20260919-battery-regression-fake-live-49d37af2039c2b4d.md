# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-19
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:49d37af2039c2b4da6bf8bf00ea30407e067ba27a7f3f8a8443753a97ecb9752`
**First observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last processed run:** `local.20260919T140917Z.e116b8324d19`
**Detected at revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Last observed revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
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
