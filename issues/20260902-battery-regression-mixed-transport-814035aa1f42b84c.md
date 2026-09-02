# complete battery red: regression-mixed-transport

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:814035aa1f42b84c6aa1a6fad9499a921231989c6c3d919b0ec917d17dcb851b`
**First observed run:** `local.20260902T222959Z.21867fec6d93`
**Last observed run:** `local.20260902T222959Z.21867fec6d93`
**Last processed run:** `local.20260902T222959Z.21867fec6d93`
**Detected at revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Last observed revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
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
