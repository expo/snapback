# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:7218b765ed67cb83ddaaedd1917e7f3ae25496976f28cf229f45d6e7a150f4bd`
**First observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Last observed revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
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
