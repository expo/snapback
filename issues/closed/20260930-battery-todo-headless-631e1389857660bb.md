# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-30
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:631e1389857660bb3c9f519b996faa424b3be298607a884b76fa0a4b823cd350`
**First observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last processed run:** `local.20260930T133254Z.763535814fd9`
**Detected at revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Last observed revision:** `fc8deceab43cacacd6355534001045aa003bb806`
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
