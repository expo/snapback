# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20261007T045641Z.4e0c6567f5a3`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:30128006f9ff136a6ccbcf695061643fdd3d38e130ade7b83c6f5af4ca744162`
**First observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
