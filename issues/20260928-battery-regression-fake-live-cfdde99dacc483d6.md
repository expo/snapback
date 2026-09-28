# complete battery red: regression-fake-live

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-28
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:cfdde99dacc483d6929415ed2ba70e8b37eaa3fa35cb41767fcf30b8badfa104`
**First observed run:** `local.20260928T042704Z.b8400c29128e`
**Last observed run:** `local.20260928T042704Z.b8400c29128e`
**Last processed run:** `local.20260928T042704Z.b8400c29128e`
**Detected at revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
**Last observed revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
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
