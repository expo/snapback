# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:577f34aa9704be2bdc2510f14dd6ea036edc52199dde5c361684377d1b3cb551`
**First observed run:** `local.20260908T030804Z.a75c98406a26`
**Last observed run:** `local.20260908T030804Z.a75c98406a26`
**Last processed run:** `local.20260908T030804Z.a75c98406a26`
**Detected at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Last observed revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
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
