# complete battery red: regression-midflight-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:3d9cdac2c0ac6198caa19ed27bd6f3bce62ecd124ccf52c65a75e6a6c8ea9dd4`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last processed run:** `local.20260829T223616Z.81cc759a07a7`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-midflight-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-midflight-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-midflight-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
