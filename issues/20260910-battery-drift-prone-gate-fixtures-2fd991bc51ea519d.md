# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-10
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:2fd991bc51ea519d730f4e3f5de02a8fd7cf9f930c3b8599384d31f5cd3bd153`
**First observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last processed run:** `local.20260910T020125Z.c971a88a5bb1`
**Detected at revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Last observed revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
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
