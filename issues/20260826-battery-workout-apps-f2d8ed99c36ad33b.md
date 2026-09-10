# complete battery red: workout-apps

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `workout-apps`
**Failure signature:** `sha256:f2d8ed99c36ad33b8dd2657a7915988050dda5b788e8e723fc47f99240ba52cf`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260910T205152Z.322275c2ec2c`
**Last processed run:** `local.20260910T205152Z.322275c2ec2c`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `322275c2ec2c8bd4ce73c4a5ff0b1ee0506ad31f`
**Consecutive red runs:** `40`
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
