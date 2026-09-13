# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-13
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:659c7fc44e75c504115f4683b666c2b385090e5d1148eb0b638ca0d3dec4c2e8`
**First observed run:** `local.20260913T092549Z.58251b46dce8`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-register-boot` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-register-boot` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/register-boot.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
