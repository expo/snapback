# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:c9548cc29e15a386bf95b3e1a9896c67775185eb8b2adae5bab7b5494eb9d8f7`
**First observed run:** `local.20260906T052615Z.c519d102c963`
**Last observed run:** `local.20260906T052615Z.c519d102c963`
**Last processed run:** `local.20260906T052615Z.c519d102c963`
**Detected at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Last observed revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
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
