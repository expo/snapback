# complete battery red: ref-check

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `ref-check`
**Failure signature:** `sha256:536b6172ace6d49dd3b511103e7c3a51504218609ff11743d2f208cf31364ffb`
**First observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Last observed revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
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
