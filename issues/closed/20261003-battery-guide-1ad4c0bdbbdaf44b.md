# complete battery red: guide

**Status:** Closed
**Reopened by battery run:** `local.20261007T045641Z.4e0c6567f5a3`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-03
**Battery gate:** `guide`
**Failure signature:** `sha256:1ad4c0bdbbdaf44b2970ddbf10157d4f85c552de511def37b524f0a68b433e1e`
**First observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last observed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Last observed revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
