# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20261008T085745Z.82992ad634f1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:9f3266709640d39b0f806984513781603dfcf842405b65a0c7d29068a41cfa7a`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-multilive-scoped` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-multilive-scoped` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-multilive-scoped.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
