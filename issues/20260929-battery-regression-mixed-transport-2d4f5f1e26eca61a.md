# complete battery red: regression-mixed-transport

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-29
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:2d4f5f1e26eca61ad4a5dbf2adc2bda0f084bb9c83529a132dddff9d69bc0a39`
**First observed run:** `local.20260929T185743Z.aee02735615b`
**Last observed run:** `local.20260929T185743Z.aee02735615b`
**Last processed run:** `local.20260929T185743Z.aee02735615b`
**Detected at revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
**Last observed revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
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
