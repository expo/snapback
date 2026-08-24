# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:6ac36e011dc798b52b6f2b5e3caa8dce97ea2a023962bd6c1b03995ed6ed36ff`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last processed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
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
