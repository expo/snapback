# complete battery red: regression-mixed-transport

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-19
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:0b63b397b221c8658b7142d3d500981c58ffe28de3e0c77645b9c6856dfa1b4d`
**First observed run:** `local.20260919T140917Z.e116b8324d19`
**Last observed run:** `local.20260919T140917Z.e116b8324d19`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Last observed revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
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
