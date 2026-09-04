# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:74128ffd3b7b181e13abafbbf0fce2edbfd1277e4b8f0255b8bae9f2bdc75671`
**First observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last processed run:** `local.20260904T003052Z.cc497048cd8c`
**Detected at revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
**Last observed revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
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
