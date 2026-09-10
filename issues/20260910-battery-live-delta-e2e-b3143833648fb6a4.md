# complete battery red: live-delta-e2e

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-10
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:b3143833648fb6a4a60197d483251c4c0d84510a299ec4bcc83edd1bf563a3b0`
**First observed run:** `local.20260910T205152Z.322275c2ec2c`
**Last observed run:** `local.20260910T205152Z.322275c2ec2c`
**Last processed run:** `local.20260910T205152Z.322275c2ec2c`
**Detected at revision:** `322275c2ec2c8bd4ce73c4a5ff0b1ee0506ad31f`
**Last observed revision:** `322275c2ec2c8bd4ce73c4a5ff0b1ee0506ad31f`
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
