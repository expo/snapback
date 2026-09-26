# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:78e052fcb862c9ab4c5440c63ec20e917e533f3595764cc1a05d0e830e0923ae`
**First observed run:** `local.20260926T132126Z.a371edf7769a`
**Last observed run:** `local.20260926T132126Z.a371edf7769a`
**Last processed run:** `local.20260926T132126Z.a371edf7769a`
**Detected at revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
**Last observed revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
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
