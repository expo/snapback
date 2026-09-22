# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:e50440143fd3600bc786a947fa29bdcae448dab5181ad0bda91cd33700d2c01d`
**First observed run:** `local.20260922T102119Z.50782b08ec43`
**Last observed run:** `local.20260922T102119Z.50782b08ec43`
**Last processed run:** `local.20260922T102119Z.50782b08ec43`
**Detected at revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Last observed revision:** `50782b08ec432f5829644b2376245e937485fb7a`
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
