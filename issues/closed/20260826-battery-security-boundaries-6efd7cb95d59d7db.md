# complete battery red: security-boundaries

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `security-boundaries`
**Failure signature:** `sha256:6efd7cb95d59d7dbaad1e31ae8b021f4bc064a4e7145de422cfe2104e4d4235f`
**First observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last processed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Detected at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Last observed revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `security-boundaries` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `security-boundaries` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-security-boundaries.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
