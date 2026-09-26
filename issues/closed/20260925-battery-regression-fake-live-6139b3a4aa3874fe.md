# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:6139b3a4aa3874fe3b1085a549514206068830d525b1a1461a565c3082750b1c`
**First observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last processed run:** `local.20260926T040309Z.024d180ac262`
**Detected at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Last observed revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
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
