# complete battery red: graffiti-widget-read

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `graffiti-widget-read`
**Failure signature:** `sha256:bb2c89a2eb2a83633f297ec51dc1ac700fca5ebb956ad4084c2651f4ad1cec51`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Consecutive red runs:** `15`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `graffiti-widget-read` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `graffiti-widget-read` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/graffiti/tests/acceptance/widget-read-mode.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
