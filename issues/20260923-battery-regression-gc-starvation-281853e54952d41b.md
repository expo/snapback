# complete battery red: regression-gc-starvation

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:281853e54952d41bf39901bd8d75c0b9ca91fe80e8eff090963d21405c233a81`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
