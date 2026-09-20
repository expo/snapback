# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:6d8d1838021f52ce1bc57f7a8aa15fff1af31a86a48e02a1ca6289567b305aa0`
**First observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last observed run:** `local.20260920T102449Z.dac4e3fed707`
**Last processed run:** `local.20260920T102449Z.dac4e3fed707`
**Detected at revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Last observed revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
