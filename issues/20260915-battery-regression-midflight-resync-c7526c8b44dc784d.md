# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:c7526c8b44dc784d2b4b7eb5344c1bd8f6e5c8c9f58352a1a007e60f682713ca`
**First observed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Last observed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Last processed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Detected at revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
**Last observed revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
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
