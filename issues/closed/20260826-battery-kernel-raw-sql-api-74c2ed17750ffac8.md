# complete battery red: kernel-raw-sql-api

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `kernel-raw-sql-api`
**Failure signature:** `sha256:74c2ed17750ffac8a762d2aa30e17a66769cd7c822712b5bcd94c2811b9e4feb`
**First observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last processed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Detected at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Last observed revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `kernel-raw-sql-api` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `kernel-raw-sql-api` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-kernel-raw-sql-api.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
