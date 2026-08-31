# complete battery red: live-delta-e2e

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:b6ced5885e7b2f1fb9e0506f9a5257dc3cdd0a36c674261a963edb47d3a3f789`
**First observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last processed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Detected at revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Last observed revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
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
