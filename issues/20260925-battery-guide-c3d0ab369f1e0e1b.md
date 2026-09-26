# complete battery red: guide

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `guide`
**Failure signature:** `sha256:c3d0ab369f1e0e1b625caaf6d0499f5af6ca5b046848228a88f7fa2e76ff0584`
**First observed run:** `local.20260925T100530Z.da526005226e`
**Last observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Last observed revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
