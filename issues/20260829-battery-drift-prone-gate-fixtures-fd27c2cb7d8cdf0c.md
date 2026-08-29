# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:fd27c2cb7d8cdf0cb20b760da7c3ea5899b4f74c58f4c247eab24789f5d51fcb`
**First observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last processed run:** `local.20260829T223616Z.81cc759a07a7`
**Detected at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Last observed revision:** `81cc759a07a706300e471f106fe41dc761c39474`
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
