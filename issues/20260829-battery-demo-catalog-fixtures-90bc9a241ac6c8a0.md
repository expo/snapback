# complete battery red: demo-catalog-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `demo-catalog-fixtures`
**Failure signature:** `sha256:90bc9a241ac6c8a04ef5692e4cf3919712c1ada424339fa6c02b954fd47d6b7c`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last processed run:** `local.20260829T140951Z.cace7b53cf00`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `demo-catalog-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `demo-catalog-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/check-inventories.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
