# complete battery red: todo-v2-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-05
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:d85511ba4477b6ae246d62946cc4fb88b0af9fd23894ccb8e785561b807a1d77`
**First observed run:** `local.20261005T101501Z.ce196270d2a4`
**Last observed run:** `local.20261005T101501Z.ce196270d2a4`
**Last processed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Detected at revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
**Last observed revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
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
