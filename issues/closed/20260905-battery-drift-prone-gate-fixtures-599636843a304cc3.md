# complete battery red: drift-prone-gate-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:599636843a304cc354033c0c62cf372075c37b9b8164c8ab5bfb8cc55b065a41`
**First observed run:** `local.20260905T203247Z.810fbda46e64`
**Last observed run:** `local.20260905T203247Z.810fbda46e64`
**Last processed run:** `local.20260906T052615Z.c519d102c963`
**Detected at revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Last observed revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `drift-prone-gate-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `drift-prone-gate-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/drift_prone_gates_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
