# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:b4b085bd4e862d977050f3280fe0b4c7f57760f169213f72ac91626c1d0df00d`
**First observed run:** `local.20260831T093441Z.cdca4903938a`
**Last observed run:** `local.20260831T093441Z.cdca4903938a`
**Last processed run:** `local.20260831T093441Z.cdca4903938a`
**Detected at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Last observed revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
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
