# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20260921T150959Z.9fa99a49e8cf`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `69c95613ab978630f3a6af58e35a449374161f36`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:9f3266709640d39b0f806984513781603dfcf842405b65a0c7d29068a41cfa7a`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Last processed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
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
