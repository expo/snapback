# complete battery red: todo-v2-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:80cd70b172f3c676e90d928c7cecd581535fb144b33414a608aafbbc2dc2dcc1`
**First observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last processed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Detected at revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Last observed revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
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
