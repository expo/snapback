# complete battery red: exact-todo-v2-contract

**Status:** Open
**Reopened by battery run:** `local.20260917T013752Z.61a3a6fa6021`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:f5693276ac67fd4c185f39d62af3659e4f4b08f7f5b1778bf158a534027eaff6`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last processed run:** `local.20260917T113035Z.46f47983a1ce`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
