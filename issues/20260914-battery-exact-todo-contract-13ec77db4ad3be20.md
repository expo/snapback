# complete battery red: exact-todo-contract

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `exact-todo-contract`
**Failure signature:** `sha256:13ec77db4ad3be207fd891bbea08a62e7b0975960fb3282f88b43380dc5d32f2`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260928T042704Z.b8400c29128e`
**Last processed run:** `local.20260928T042704Z.b8400c29128e`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
**Consecutive red runs:** `33`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-todo-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-todo-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/todo/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
