# complete battery red: live-delta-e2e

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:7f1c7604eb9114f872b49590f6cd2b833f2d1b5094414172fbd4f0c44878782e`
**First observed run:** `local.20260912T024408Z.7d09e3124e2e`
**Last observed run:** `local.20260912T024408Z.7d09e3124e2e`
**Last processed run:** `local.20260912T024408Z.7d09e3124e2e`
**Detected at revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Last observed revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
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
