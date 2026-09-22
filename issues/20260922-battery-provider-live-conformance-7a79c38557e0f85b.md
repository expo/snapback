# complete battery red: provider-live-conformance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:7a79c38557e0f85b2784986e18a0ade7120ade94f253df96c884b7aa59f5a95f`
**First observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last processed run:** `local.20260922T004103Z.6841e7dc8d89`
**Detected at revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Last observed revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
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
