# complete battery red: regression-midflight-resync

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:4fb88d338f3d61e34896bd09cc562faa4be8899dbd02e233f975ee459808d761`
**First observed run:** `local.20260906T052615Z.c519d102c963`
**Last observed run:** `local.20260906T052615Z.c519d102c963`
**Last processed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Detected at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Last observed revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
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
