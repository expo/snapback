# complete battery red: exact-resolver-packages

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `exact-resolver-packages`
**Failure signature:** `sha256:ad27397375dd89ccee58a40acc5305a4edd01cf5663492ed0168ee73a235deca`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last processed run:** `local.20260922T004103Z.6841e7dc8d89`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Consecutive red runs:** `19`
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
