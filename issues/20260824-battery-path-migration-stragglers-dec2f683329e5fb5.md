# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:dec2f683329e5fb5dd12df78fa9515767018f39df9b16cec68fb3d3e6aedce3b`
**First observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last processed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Detected at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Last observed revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
