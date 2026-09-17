# complete battery red: regression-gc-starvation

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:c8a919a93ddd9c5092a352783500ad2314b4ff221e09a8092dc1ee531708759f`
**First observed run:** `local.20260917T013752Z.61a3a6fa6021`
**Last observed run:** `local.20260917T013752Z.61a3a6fa6021`
**Last processed run:** `local.20260917T113035Z.46f47983a1ce`
**Detected at revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
**Last observed revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
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
