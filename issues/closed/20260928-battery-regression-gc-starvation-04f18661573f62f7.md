# complete battery red: regression-gc-starvation

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-28
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:04f18661573f62f7c16a9ec47aa45819d1a40a02aff42e13f15ce79d744eeeb1`
**First observed run:** `local.20260928T042704Z.b8400c29128e`
**Last observed run:** `local.20260928T042704Z.b8400c29128e`
**Last processed run:** `local.20260928T150340Z.ea7ecc896c16`
**Detected at revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
**Last observed revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
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
