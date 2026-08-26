# complete battery red: proof-runner-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `proof-runner-fixtures`
**Failure signature:** `sha256:164a2c515d0759e541578670ecfaf768eb8477bfbb35fae75557c4d28c3df4d0`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last processed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `proof-runner-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `proof-runner-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/proof_runner_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
