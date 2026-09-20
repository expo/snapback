# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:77db0a97ce6106149102244adcf4e11a800ca979e4e62c2c5acdb77ef8b36f6b`
**First observed run:** `local.20260920T195819Z.92d678d5700d`
**Last observed run:** `local.20260920T195819Z.92d678d5700d`
**Last processed run:** `local.20260920T195819Z.92d678d5700d`
**Detected at revision:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
**Last observed revision:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
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
