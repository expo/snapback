# complete battery red: guide-authoring-profile-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `guide-authoring-profile-fixtures`
**Failure signature:** `sha256:4c29cc6363cbfb3940c5c1c84920c89e34a691b695b1b256bc52873e080d33ee`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20260930T133254Z.763535814fd9`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
**Consecutive red runs:** `38`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide-authoring-profile-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide-authoring-profile-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/guide-authoring-profiles.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
