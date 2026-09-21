# complete battery red: regression-durable-bytes-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:15206bd851f6aa661a2c71432c507bc01a22d9e5a3c1b35f6efe8914f74c16b9`
**First observed run:** `local.20260921T053735Z.66fc10578f22`
**Last observed run:** `local.20260921T053735Z.66fc10578f22`
**Last processed run:** `local.20260921T053735Z.66fc10578f22`
**Detected at revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Last observed revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
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
