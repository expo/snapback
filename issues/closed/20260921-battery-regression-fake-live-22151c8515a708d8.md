# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:22151c8515a708d85b52897588a47cabb0d1713256ae049daccc7aa1187c0a66`
**First observed run:** `local.20260921T053735Z.66fc10578f22`
**Last observed run:** `local.20260921T053735Z.66fc10578f22`
**Last processed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Detected at revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Last observed revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
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
