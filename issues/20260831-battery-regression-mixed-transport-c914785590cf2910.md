# complete battery red: regression-mixed-transport

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:c914785590cf2910e0a79b33df11db3d4a26339d32f4e4e11b56bb97b7a88fc4`
**First observed run:** `local.20260831T182234Z.850c161f649c`
**Last observed run:** `local.20260831T182234Z.850c161f649c`
**Last processed run:** `local.20260831T182234Z.850c161f649c`
**Detected at revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Last observed revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-mixed-transport` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-mixed-transport` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-mixed-transport.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
