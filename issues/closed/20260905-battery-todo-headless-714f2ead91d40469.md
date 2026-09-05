# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:714f2ead91d40469adf7bc1923c5214fbe4734c205bc46acf91823603f1249fd`
**First observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last processed run:** `local.20260905T203247Z.810fbda46e64`
**Detected at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Last observed revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
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
