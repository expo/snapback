# complete battery red: todo-v2-register-boot

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:16f51ba36b3b2708819d9e5d70c9bd5c71de8e858362e78e84d2ae02f100fa88`
**First observed run:** `local.20260831T182234Z.850c161f649c`
**Last observed run:** `local.20260831T182234Z.850c161f649c`
**Last processed run:** `local.20260901T030411Z.6435dc48103e`
**Detected at revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Last observed revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
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
