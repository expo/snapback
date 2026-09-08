# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Reopened by battery run:** `local.20260908T125200Z.e6c89816b6d2`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:f5693276ac67fd4c185f39d62af3659e4f4b08f7f5b1778bf158a534027eaff6`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last processed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
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
