# complete battery red: regression-ephemeral-wiring

**Status:** Closed
**Reopened by battery run:** `local.20260920T003721Z.7ef61e81a1bf`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:5de253e8eba4829ddc240bc847d3c1bde5887936180376d2e545b9ba2b3cb358`
**First observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Last observed revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-ephemeral-wiring` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-ephemeral-wiring` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-ephemeral-wiring.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
