# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:3e85f25cafd0e401303226243340ca8698f43865b678d86819654c9cee7bd1db`
**First observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last processed run:** `local.20260922T004103Z.6841e7dc8d89`
**Detected at revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Last observed revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
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
