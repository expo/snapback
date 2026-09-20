# complete battery red: guide

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-16
**Battery gate:** `guide`
**Failure signature:** `sha256:aec8aa12ef2e9ac196e1c66529463f1b2c44565eb279e90a5718ceeb02695500`
**First observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last observed run:** `local.20260919T140917Z.e116b8324d19`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Last observed revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Consecutive red runs:** `9`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
