# complete battery red: drift-prone-gate-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-03
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:ad47d130468b56a3677f4dd99fba5a436b15cd37b33aa08c4348e2ed00a66943`
**First observed run:** `local.20260903T071655Z.08643f8b0ad3`
**Last observed run:** `local.20260903T071655Z.08643f8b0ad3`
**Last processed run:** `local.20260903T154459Z.afba645047a6`
**Detected at revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Last observed revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
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
