# complete battery red: regression-mixed-transport

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:2bd8e5e1f00085c1e1568accd889c4e385caa93f6109dad65140ce7be48516f0`
**First observed run:** `local.20260830T072833Z.94397bad48fa`
**Last observed run:** `local.20260830T072833Z.94397bad48fa`
**Last processed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Detected at revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Last observed revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-mixed-transport` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-mixed-transport` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-mixed-transport.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
