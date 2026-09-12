# complete battery red: regression-gc-starvation

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:069ed05eda3122ea8ac264850b501a0516406104e7da2904444e1e293b4baa67`
**First observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last processed run:** `local.20260912T024408Z.7d09e3124e2e`
**Detected at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Last observed revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
