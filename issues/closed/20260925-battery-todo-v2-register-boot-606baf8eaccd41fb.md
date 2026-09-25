# complete battery red: todo-v2-register-boot

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:606baf8eaccd41fb43ead70e62ebb33aafb2f807ef3e926f6acaea7a71c7e1b5`
**First observed run:** `local.20260925T100530Z.da526005226e`
**Last observed run:** `local.20260925T100530Z.da526005226e`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Last observed revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-register-boot` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-register-boot` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/register-boot.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
