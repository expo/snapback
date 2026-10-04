# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-03
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:a0d03831eb867fd7339ce7f5f143df4f384af4aab5a3670afd4f2b3ea3d0e7fd`
**First observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Last observed revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-register-boot` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-register-boot` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/register-boot.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
