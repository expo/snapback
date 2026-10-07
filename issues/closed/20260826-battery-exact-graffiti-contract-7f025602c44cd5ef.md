# complete battery red: exact-graffiti-contract

**Status:** Closed
**Reopened by battery run:** `local.20261005T101501Z.ce196270d2a4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:7f025602c44cd5ef01b471efbd37d5ca070b3640c91b0077295fd22e81e19c45`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20261005T101501Z.ce196270d2a4`
**Last processed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
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
