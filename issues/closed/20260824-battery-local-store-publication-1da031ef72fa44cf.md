# complete battery red: local-store-publication

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `local-store-publication`
**Failure signature:** `sha256:1da031ef72fa44cf8665d2c49e56176f5968da09536dc39dee9152e78876c21f`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last processed run:** `local.20260825T115521Z.64e70df1e088`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `local-store-publication` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `local-store-publication` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/conformance/local-persistent-store-publication-v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
