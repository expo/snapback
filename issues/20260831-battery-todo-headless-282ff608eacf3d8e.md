# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:282ff608eacf3d8e73d6d6ed3642916c14e03d52e4bb492ac7f528239d8d77a5`
**First observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last processed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Detected at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Last observed revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
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
