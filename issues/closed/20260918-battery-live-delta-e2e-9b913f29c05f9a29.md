# complete battery red: live-delta-e2e

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-18
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:9b913f29c05f9a291f232c3e459753eb72bd7653b070f47693cbf5ff01692c5a`
**First observed run:** `local.20260918T181131Z.c60751e30f9f`
**Last observed run:** `local.20260918T181131Z.c60751e30f9f`
**Last processed run:** `local.20260919T040853Z.0168b46b0c20`
**Detected at revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Last observed revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `live-delta-e2e` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `live-delta-e2e` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/live-delta-e2e.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
