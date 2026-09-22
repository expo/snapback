# complete battery red: fork-parallel-dispositions

**Status:** Open
**Reopened by battery run:** `local.20260921T150959Z.9fa99a49e8cf`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `fork-parallel-dispositions`
**Failure signature:** `sha256:f750918cf0acc2ddcbed199f44dc251a8edb0648c8bbc9c1abfe1c91cec43eca`
**First observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last observed run:** `local.20260922T102119Z.50782b08ec43`
**Last processed run:** `local.20260922T102119Z.50782b08ec43`
**Detected at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Last observed revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `fork-parallel-dispositions` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `fork-parallel-dispositions` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/fork-parallel-dispositions.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
