# complete battery red: exact-resolver-packages

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `exact-resolver-packages`
**Failure signature:** `sha256:ad27397375dd89ccee58a40acc5305a4edd01cf5663492ed0168ee73a235deca`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Consecutive red runs:** `49`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-resolver-packages` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-resolver-packages` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/exact-resolver-packages.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
