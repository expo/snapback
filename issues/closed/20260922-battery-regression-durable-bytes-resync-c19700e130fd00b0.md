# complete battery red: regression-durable-bytes-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:c19700e130fd00b0d6e091b9119fb99996a3fa84ec880899dfbfef6383f58fa1`
**First observed run:** `local.20260922T201104Z.e7c955d366a5`
**Last observed run:** `local.20260922T201104Z.e7c955d366a5`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
**Last observed revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-durable-bytes-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-durable-bytes-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-durable-bytes-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
