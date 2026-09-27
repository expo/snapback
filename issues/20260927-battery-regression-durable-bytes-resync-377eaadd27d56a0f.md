# complete battery red: regression-durable-bytes-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:377eaadd27d56a0f681ef0eccf3d0ad570d56bfa07ebd1fea8d7a4700bb62b1f`
**First observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last processed run:** `local.20260927T175940Z.8112f4ef6400`
**Detected at revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Last observed revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-durable-bytes-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-durable-bytes-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-durable-bytes-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
