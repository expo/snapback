# complete battery red: diagnostics-registry-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `diagnostics-registry-fixtures`
**Failure signature:** `sha256:1346d59a3f4d91f53a4666f97606c8a58cc85ae0d032a61720d039018f8d53fc`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `diagnostics-registry-fixtures` as a root
failure (exit 124). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `diagnostics-registry-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/generate-diagnostics-registry.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
