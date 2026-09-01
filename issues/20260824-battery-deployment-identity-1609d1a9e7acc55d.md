# complete battery red: deployment-identity

**Status:** Open
**Reopened by battery run:** `local.20260829T140951Z.cace7b53cf00`
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
**Last observed run:** `local.20260901T030411Z.6435dc48103e`
**Last processed run:** `local.20260901T030411Z.6435dc48103e`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Consecutive red runs:** `8`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
