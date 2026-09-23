# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20260923T123621Z.d34227259c10`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:5de253e8eba4829ddc240bc847d3c1bde5887936180376d2e545b9ba2b3cb358`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
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
