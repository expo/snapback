# complete battery red: client-errors

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `client-errors`
**Failure signature:** `sha256:dde959e3e332c1844e8629d971c0bf3ec4a486c7b622b09e2576fb3dd538a28f`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260825T115521Z.64e70df1e088`
**Last processed run:** `local.20260825T115521Z.64e70df1e088`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Consecutive red runs:** `4`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `client-errors` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `client-errors` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/client-errors.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
