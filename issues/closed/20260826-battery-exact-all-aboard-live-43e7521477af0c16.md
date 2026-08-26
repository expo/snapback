# complete battery red: exact-all-aboard-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:43e7521477af0c16a1a32c8644b8ac8b0cea3c6e42afbb33d84e269a1d2446b0`
**First observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last processed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Detected at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Last observed revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
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
