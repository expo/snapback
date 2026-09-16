# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-16
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:54f34c08da4062901f057e3ab28435c48496c3613a6a3106456bc8d5cd9e111e`
**First observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last processed run:** `local.20260916T051524Z.fbf2c6042249`
**Detected at revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Last observed revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
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
