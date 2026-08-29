# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:8c31becebf2fbe6896a9c955aed31075bc545886338334f4c361d7505636f77b`
**First observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last processed run:** `local.20260829T223616Z.81cc759a07a7`
**Detected at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Last observed revision:** `81cc759a07a706300e471f106fe41dc761c39474`
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
