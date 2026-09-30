# complete battery red: provider-live-conformance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-30
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:14115cb4c97dfc29ca13d94420478826291a413d18b1ba3fdf127717aaa821e4`
**First observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last processed run:** `local.20260930T043534Z.fc8deceab43c`
**Detected at revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Last observed revision:** `fc8deceab43cacacd6355534001045aa003bb806`
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
