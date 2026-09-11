# complete battery red: todo-v2-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:5caad68b6094c6b54ec0335d7c414940c48f4d98f17263a8a3d279b62d3b2f49`
**First observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Last observed revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
