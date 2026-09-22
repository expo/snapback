# complete battery red: regression-fake-live

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:1e66861b7ab68feff2ef3bb4a00152255e7c33aaedcb2c8a545d003aaa95a09b`
**First observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last processed run:** `local.20260922T004103Z.6841e7dc8d89`
**Detected at revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Last observed revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
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
