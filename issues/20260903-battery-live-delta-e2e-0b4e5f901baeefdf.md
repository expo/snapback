# complete battery red: live-delta-e2e

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-03
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:0b4e5f901baeefdff3658accab774261bc7a43d39f7bdbfe839a2cfe173874a2`
**First observed run:** `local.20260903T154459Z.afba645047a6`
**Last observed run:** `local.20260903T154459Z.afba645047a6`
**Last processed run:** `local.20260903T154459Z.afba645047a6`
**Detected at revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Last observed revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
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
