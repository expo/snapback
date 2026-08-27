# complete battery red: security-boundaries

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `security-boundaries`
**Failure signature:** `sha256:7dbd64ac41bd1c0cddf46985ade9f0e243be9b5e02d287b58e1e31a5a6edf5f5`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last processed run:** `local.20260827T104322Z.04da2f52bd6f`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `security-boundaries` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `security-boundaries` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-security-boundaries.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
