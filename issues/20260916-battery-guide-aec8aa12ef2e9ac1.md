# complete battery red: guide

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-16
**Battery gate:** `guide`
**Failure signature:** `sha256:aec8aa12ef2e9ac196e1c66529463f1b2c44565eb279e90a5718ceeb02695500`
**First observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last processed run:** `local.20260916T051524Z.fbf2c6042249`
**Detected at revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Last observed revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
