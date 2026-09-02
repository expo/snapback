# complete battery red: drift-prone-gate-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:5ea2d790565b32f1d68b711733d95eb4e4a2649d6fa19b429028b0c78ea84603`
**First observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last processed run:** `local.20260831T093441Z.cdca4903938a`
**Detected at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Last observed revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
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
