# complete battery red: regression-gc-starvation

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:b275a2bf5f7181b8ec3c7c0b4929d9ce9aae6b02b8de01ed3bcf8e522cdfc55e`
**First observed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Last observed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Last processed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Detected at revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Last observed revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
