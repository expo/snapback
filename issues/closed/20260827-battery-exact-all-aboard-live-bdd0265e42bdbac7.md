# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260829T140951Z.cace7b53cf00`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:bdd0265e42bdbac7bb7ef5fe9ebdddac04c6e4e45727fa4c656d23ae95da2ce1`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last processed run:** `local.20260829T223616Z.81cc759a07a7`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-all-aboard-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-all-aboard-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/all-aboard/tests/acceptance/contract-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
