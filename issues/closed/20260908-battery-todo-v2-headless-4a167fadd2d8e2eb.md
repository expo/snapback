# complete battery red: todo-v2-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:4a167fadd2d8e2ebef410fe8b15459a88c1f769646fe86e3241fc72b39d5dbe5`
**First observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last processed run:** `local.20260909T074306Z.2b8ec71c667f`
**Detected at revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Last observed revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
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
