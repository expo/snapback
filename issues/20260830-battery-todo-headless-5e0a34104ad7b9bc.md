# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:5e0a34104ad7b9bc042189e2fe9e41ae6e4c234e639a3804d0207b4963c239d3`
**First observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last processed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Detected at revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Last observed revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
