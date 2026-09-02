# complete battery red: regression-durable-bytes-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:25ea4243c01528ad50c29c90aaa014cb0e3e9f16d26358041933200bff6322d1`
**First observed run:** `local.20260901T030411Z.6435dc48103e`
**Last observed run:** `local.20260901T030411Z.6435dc48103e`
**Last processed run:** `local.20260901T114752Z.293de46f68b1`
**Detected at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Last observed revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
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
