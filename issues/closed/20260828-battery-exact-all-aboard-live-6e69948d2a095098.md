# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260902T051222Z.69c95613ab97`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:6e69948d2a0950986353de078cfa87b6ff89e81b04e6d9781c7e3ae14c386af3`
**First observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last observed run:** `local.20260902T051222Z.69c95613ab97`
**Last processed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Detected at revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Last observed revision:** `69c95613ab978630f3a6af58e35a449374161f36`
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
