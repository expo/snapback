# complete battery red: regression-durable-bytes-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `regression-durable-bytes-resync`
**Failure signature:** `sha256:fa9e720449cb5b5ebe3d1c45df75658b90840f7173678c156f488b1f58c91942`
**First observed run:** `local.20260906T052615Z.c519d102c963`
**Last observed run:** `local.20260906T052615Z.c519d102c963`
**Last processed run:** `local.20260906T052615Z.c519d102c963`
**Detected at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Last observed revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
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
