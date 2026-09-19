# complete battery red: ref-check

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-19
**Battery gate:** `ref-check`
**Failure signature:** `sha256:fd3e1e6395eee18367713f7f8032a8dafb741634ffb43bd2daffeecded48b747`
**First observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last processed run:** `local.20260919T140917Z.e116b8324d19`
**Detected at revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Last observed revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `ref-check` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `ref-check` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
./ref-check --verbose
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
