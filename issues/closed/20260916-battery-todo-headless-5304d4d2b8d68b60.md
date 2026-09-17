# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-16
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:5304d4d2b8d68b606240cc33a481de3ec073ae9913e9c18a7ccaebebc160c8a6`
**First observed run:** `local.20260916T152410Z.9d9a5cb67d30`
**Last observed run:** `local.20260916T152410Z.9d9a5cb67d30`
**Last processed run:** `local.20260917T013752Z.61a3a6fa6021`
**Detected at revision:** `9d9a5cb67d30ae688a3d86ce88016056340a0b7f`
**Last observed revision:** `9d9a5cb67d30ae688a3d86ce88016056340a0b7f`
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
