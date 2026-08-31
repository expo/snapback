# complete battery red: todo-v2-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:67b9e5eb5e79fa0ba08f10016b5ef8eb8b2caac283ed7c48a46272f8326a4f92`
**First observed run:** `local.20260831T093441Z.cdca4903938a`
**Last observed run:** `local.20260831T093441Z.cdca4903938a`
**Last processed run:** `local.20260831T182234Z.850c161f649c`
**Detected at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Last observed revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
