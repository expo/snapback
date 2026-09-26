# complete battery red: provider-live-conformance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:3fea23e94dfe7fc6283bd68d3bbe856fdb5a2208187fef0e1e608a3c375f1d0f`
**First observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last observed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Last observed revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `provider-live-conformance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `provider-live-conformance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
