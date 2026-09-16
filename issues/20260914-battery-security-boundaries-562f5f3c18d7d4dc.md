# complete battery red: security-boundaries

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `security-boundaries`
**Failure signature:** `sha256:562f5f3c18d7d4dcffd6c1f37427807ec89ee628628a9734cf63d9e3a7b2998e`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last processed run:** `local.20260916T051524Z.fbf2c6042249`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Consecutive red runs:** `5`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `security-boundaries` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `security-boundaries` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-security-boundaries.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
