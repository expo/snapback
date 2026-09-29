# complete battery red: kernel-raw-sql-api

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `kernel-raw-sql-api`
**Failure signature:** `sha256:15d4d55487c6cea0914240eb59c399aca5e22d066372d4e7c52e9816c0cd31a9`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260929T091155Z.f56e8048aa9f`
**Last processed run:** `local.20260929T091155Z.f56e8048aa9f`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Consecutive red runs:** `35`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `kernel-raw-sql-api` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `kernel-raw-sql-api` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-kernel-raw-sql-api.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
