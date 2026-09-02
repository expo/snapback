# complete battery red: regression-fake-live

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:010678812b04748c706f17bdb4bc69a298c774fb1516b1332835ec8a39ec401d`
**First observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last processed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Detected at revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Last observed revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
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
