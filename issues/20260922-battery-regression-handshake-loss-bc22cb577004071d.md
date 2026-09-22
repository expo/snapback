# complete battery red: regression-handshake-loss

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:bc22cb577004071d3992c267eadfb54d8f720df32d054ebf939cb84e04f844be`
**First observed run:** `local.20260922T102119Z.50782b08ec43`
**Last observed run:** `local.20260922T102119Z.50782b08ec43`
**Last processed run:** `local.20260922T102119Z.50782b08ec43`
**Detected at revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Last observed revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-handshake-loss` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-handshake-loss` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-handshake-loss.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
