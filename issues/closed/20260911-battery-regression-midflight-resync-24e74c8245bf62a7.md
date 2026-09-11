# complete battery red: regression-midflight-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:24e74c8245bf62a7733194bbeb58d6731e7121ae5cd5a37f1a3db56a4d916f48`
**First observed run:** `local.20260911T062045Z.15c134d056d0`
**Last observed run:** `local.20260911T062045Z.15c134d056d0`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
**Last observed revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-midflight-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-midflight-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-midflight-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
