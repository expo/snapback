# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:72adbbdb7ba4f32a50e5f9e56a9bde81defa50bbe23c5eec10812f726505c1d6`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260826T230829Z.fb14180ba761`
**Last processed run:** `local.20260827T104322Z.04da2f52bd6f`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-todo-v2-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-todo-v2-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/todo-v2/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
