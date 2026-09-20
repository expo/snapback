# complete battery red: regression-durable-bytes-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:833250ae2954d92ccace8740e4354fff25f89d2b949aad181ee52f177be5eb87`
**First observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Last observed revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
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
