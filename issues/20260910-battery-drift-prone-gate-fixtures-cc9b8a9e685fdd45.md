# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-10
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:cc9b8a9e685fdd4586dfd1f7671c758e6b5d3adf3cf7c8847075773bb43e15bb`
**First observed run:** `local.20260910T111530Z.4b2b32e6865b`
**Last observed run:** `local.20260910T111530Z.4b2b32e6865b`
**Last processed run:** `local.20260910T111530Z.4b2b32e6865b`
**Detected at revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
**Last observed revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
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
