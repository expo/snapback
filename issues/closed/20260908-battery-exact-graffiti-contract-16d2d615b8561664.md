# complete battery red: exact-graffiti-contract

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:16d2d615b8561664b891b9826ae91ce9b355125c64063ed2cb855b247cbd16ac`
**First observed run:** `local.20260908T030804Z.a75c98406a26`
**Last observed run:** `local.20260908T030804Z.a75c98406a26`
**Last processed run:** `local.20260908T125200Z.e6c89816b6d2`
**Detected at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Last observed revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-graffiti-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-graffiti-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/graffiti/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
