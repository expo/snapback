# complete battery red: regression-fake-live

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:ecaf39918af54e60d12abb0093cf804339487b83d3b2ce110c767be1b41a650e`
**First observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Last observed revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-fake-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-fake-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-fake-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
