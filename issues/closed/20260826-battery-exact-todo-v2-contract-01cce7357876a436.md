# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Reopened by battery run:** `local.20260829T140951Z.cace7b53cf00`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:01cce7357876a436f3dbbf61ea56a4245a04059c94e15f81969068448586a79c`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last processed run:** `local.20260830T072833Z.94397bad48fa`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-todo-v2-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-todo-v2-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/todo-v2/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
