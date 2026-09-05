# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:35927457f13cc0a0bbc8bd65d4f15f91755cd0d1f0b230ce127a9579490f1a71`
**First observed run:** `local.20260905T203247Z.810fbda46e64`
**Last observed run:** `local.20260905T203247Z.810fbda46e64`
**Last processed run:** `local.20260905T203247Z.810fbda46e64`
**Detected at revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Last observed revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
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
