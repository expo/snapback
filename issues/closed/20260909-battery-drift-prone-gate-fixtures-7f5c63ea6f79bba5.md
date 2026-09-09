# complete battery red: drift-prone-gate-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-09
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:7f5c63ea6f79bba587f8ca269f9df31459074532c4936faba8f1194781d32293`
**First observed run:** `local.20260909T074306Z.2b8ec71c667f`
**Last observed run:** `local.20260909T074306Z.2b8ec71c667f`
**Last processed run:** `local.20260909T165632Z.6ffce9c07663`
**Detected at revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
**Last observed revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
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
