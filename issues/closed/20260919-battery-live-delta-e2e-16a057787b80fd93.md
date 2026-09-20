# complete battery red: live-delta-e2e

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-19
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:16a057787b80fd93ace5326bdbdc4a97fd65484dd60189f1bcc71a3d1dcb4e98`
**First observed run:** `local.20260919T140917Z.e116b8324d19`
**Last observed run:** `local.20260919T140917Z.e116b8324d19`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Last observed revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `live-delta-e2e` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `live-delta-e2e` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/live-delta-e2e.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
