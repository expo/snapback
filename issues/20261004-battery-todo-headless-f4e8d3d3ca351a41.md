# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:f4e8d3d3ca351a413de7bec1ca4358c468bcb3f7cd8f3fb11376042ff442868c`
**First observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last processed run:** `local.20261004T072114Z.4353aa735cb1`
**Detected at revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Last observed revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
