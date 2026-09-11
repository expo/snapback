# complete battery red: todo-v2-register-boot

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:3200127ea00eb546d4dbaead3fbd67295481342a487c7689588f4e73914c50ed`
**First observed run:** `local.20260911T062045Z.15c134d056d0`
**Last observed run:** `local.20260911T062045Z.15c134d056d0`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
**Last observed revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
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
