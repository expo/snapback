# complete battery red: exact-graffiti-contract

**Status:** Open
**Reopened by battery run:** `local.20260902T135224Z.0b3a42a3d94b`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:7f025602c44cd5ef01b471efbd37d5ca070b3640c91b0077295fd22e81e19c45`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last processed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-graffiti-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-graffiti-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/graffiti/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
