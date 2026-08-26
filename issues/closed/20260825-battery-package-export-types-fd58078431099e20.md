# complete battery red: package-export-types

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `package-export-types`
**Failure signature:** `sha256:fd58078431099e20106cb1f67811c78db3753abbc3fb695a7b84e3230c34c470`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260825T115521Z.64e70df1e088`
**Last processed run:** `local.20260826T010040Z.278837ddbcaf`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `package-export-types` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `package-export-types` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-package-export-types.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
