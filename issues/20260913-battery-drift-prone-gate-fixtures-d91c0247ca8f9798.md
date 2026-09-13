# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-13
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:d91c0247ca8f97989480021416c9a5524893ad42903c6cae7c721c4912ef5ff3`
**First observed run:** `local.20260913T092549Z.58251b46dce8`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
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
