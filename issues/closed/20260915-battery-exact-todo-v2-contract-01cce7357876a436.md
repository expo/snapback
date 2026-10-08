# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Reopened by battery run:** `local.20261007T045641Z.4e0c6567f5a3`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:01cce7357876a436f3dbbf61ea56a4245a04059c94e15f81969068448586a79c`
**First observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last observed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Last observed revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
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
