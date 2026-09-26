# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:f06324930cec0de56129ab1adeaa1bcecff42fe40b9acda73860a78a6c88e4ec`
**First observed run:** `local.20260926T040309Z.024d180ac262`
**Last observed run:** `local.20260926T040309Z.024d180ac262`
**Last processed run:** `local.20260926T040309Z.024d180ac262`
**Detected at revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Last observed revision:** `024d180ac262670966806aa6bd050daf38f99f03`
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
