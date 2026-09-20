# complete battery red: chrome-process-lifecycle-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260920T003721Z.7ef61e81a1bf`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `chrome-process-lifecycle-fixtures`
**Failure signature:** `sha256:1fa7e62eced4240468d6dd5d9784ca48bfe8ebc1cad91ea3d07c8db3bcc78870`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `chrome-process-lifecycle-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `chrome-process-lifecycle-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/chrome-process-lifecycle.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
