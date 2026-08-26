# complete battery red: client-bundle-metrology

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `client-bundle-metrology`
**Failure signature:** `sha256:dbe25d3b183e1533f4cb2c31bb01a76d72a5a54479102d52f290f90a3f6af485`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last processed run:** `local.20260826T010040Z.278837ddbcaf`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `client-bundle-metrology` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `client-bundle-metrology` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/client-bundle-metrology.mjs --check
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
