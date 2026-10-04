# complete battery red: live-delta-e2e

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-03
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:ea7224224e9cba446fc5fb8201018dc5168f691143b58cdbb4e999b1376b5493`
**First observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Last observed revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `live-delta-e2e` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `live-delta-e2e` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/live-delta-e2e.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
