# complete battery red: app-cli-settlement-goldens

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `app-cli-settlement-goldens`
**Failure signature:** `sha256:74e619e403b53b4c7157d007f42b2d978caa74b0cefd63b4438982ac5075d90e`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260921T053735Z.66fc10578f22`
**Last processed run:** `local.20260921T053735Z.66fc10578f22`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Consecutive red runs:** `17`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `app-cli-settlement-goldens` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `app-cli-settlement-goldens` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/acceptance/app-cli-settlement-goldens.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
