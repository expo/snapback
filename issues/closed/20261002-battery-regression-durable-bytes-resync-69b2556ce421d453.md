# complete battery red: regression-durable-bytes-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-02
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:69b2556ce421d453d577521dc2d140460c61d3141c2b02a6bed522eccdc3ceda`
**First observed run:** `local.20261002T154654Z.1687b58af2d4`
**Last observed run:** `local.20261002T154654Z.1687b58af2d4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
**Last observed revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
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
