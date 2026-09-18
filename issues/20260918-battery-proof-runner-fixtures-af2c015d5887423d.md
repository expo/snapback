# complete battery red: proof-runner-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-18
**Battery gate:** `proof-runner-fixtures`
**Failure signature:** `sha256:af2c015d5887423d5ad832e37681d32d4a1f145d652e804575624be3d2488b75`
**First observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last processed run:** `local.20260918T081626Z.dc1abf6b7394`
**Detected at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Last observed revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
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
