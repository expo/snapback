# complete battery red: app-cli-settlement-goldens

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `app-cli-settlement-goldens`
**Failure signature:** `sha256:74e619e403b53b4c7157d007f42b2d978caa74b0cefd63b4438982ac5075d90e`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last processed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Consecutive red runs:** `4`
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
