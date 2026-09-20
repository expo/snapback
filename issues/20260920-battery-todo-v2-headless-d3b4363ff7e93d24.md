# complete battery red: todo-v2-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:d3b4363ff7e93d24f990f8701cb748d3076626cd5b22b6ad171458e97bcbcde7`
**First observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Last observed revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
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
