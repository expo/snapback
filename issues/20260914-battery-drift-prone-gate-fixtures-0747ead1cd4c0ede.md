# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260924T233800Z.4619cf3fc2e4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:0747ead1cd4c0edebe7a8401b5dcab943438a697e489a07c76cc9d64b726800a`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
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
