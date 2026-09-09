# complete battery red: exact-todo-v2-contract

**Status:** Open
**Reopened by battery run:** `local.20260909T165632Z.6ffce9c07663`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:dc9e4348945772500b0271e9eaf999a85ce34d0eef3e2a41fa6e0d6447887793`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260909T165632Z.6ffce9c07663`
**Last processed run:** `local.20260909T165632Z.6ffce9c07663`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
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
