# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260913T092549Z.58251b46dce8`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:fc8d2f4dfad1e301107e110941f4c2c3fe0291a52a2dd6cf54dc69232a630797`
**First observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-multilive-scoped` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-multilive-scoped` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-multilive-scoped.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
