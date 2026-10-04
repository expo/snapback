# complete battery red: regression-ephemeral-wiring

**Status:** Open
**Reopened by battery run:** `local.20261004T072114Z.4353aa735cb1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:5de253e8eba4829ddc240bc847d3c1bde5887936180376d2e545b9ba2b3cb358`
**First observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last processed run:** `local.20261004T072114Z.4353aa735cb1`
**Detected at revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Last observed revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
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
