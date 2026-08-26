# complete battery red: deployment-identity

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `deployment-identity`
**Failure signature:** `sha256:1609d1a9e7acc55d6f260f6303aa8b5e12658f578164ac593341e4085889658e`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last processed run:** `local.20260826T010040Z.278837ddbcaf`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Consecutive red runs:** `0`
**Escalation:** `pending (0/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `deployment-identity` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `deployment-identity` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node targets/cloudflare/scripts/generate-deployment-identity.mjs --check
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
