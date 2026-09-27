# complete battery red: workout-apps

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `workout-apps`
**Failure signature:** `sha256:cc4e3b5c64d17f4295d2828123b7df7e1f6b3ed3ccea5b8fff7c6162958a19ce`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260926T223620Z.3b21178b41db`
**Last processed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Consecutive red runs:** `30`
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
