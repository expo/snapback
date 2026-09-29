# complete battery red: workout-apps

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `workout-apps`
**Failure signature:** `sha256:a8bbcf108e8993e46dd9522ada5f49a6ed2da9cf6068f7c5e95461bf43125c48`
**First observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last observed run:** `local.20260929T091155Z.f56e8048aa9f`
**Last processed run:** `local.20260929T091155Z.f56e8048aa9f`
**Detected at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Last observed revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Consecutive red runs:** `5`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `workout-apps` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `workout-apps` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/run-workout-apps.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
