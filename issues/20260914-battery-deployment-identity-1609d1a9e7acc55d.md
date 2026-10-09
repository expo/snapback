# complete battery red: deployment-identity

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `deployment-identity`
**Failure signature:** `sha256:1609d1a9e7acc55d6f260f6303aa8b5e12658f578164ac593341e4085889658e`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
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
