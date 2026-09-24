# complete battery red: exact-todo-v2-contract

**Status:** Open
**Reopened by battery run:** `local.20260924T233800Z.4619cf3fc2e4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:72adbbdb7ba4f32a50e5f9e56a9bde81defa50bbe23c5eec10812f726505c1d6`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last processed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
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
