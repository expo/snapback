# complete battery red: todo-v2-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-28
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:283dfda305bdfceea0799b8d60b2b533cc9de8a8f026ee1e9f930c79f15cf36b`
**First observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last processed run:** `local.20260929T091155Z.f56e8048aa9f`
**Detected at revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Last observed revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
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
