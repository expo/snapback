# complete battery red: todo-headless

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:97ff4de452323201da6ad47c2d440d27382c5fc4668a490b498e5be22f450cfb`
**First observed run:** `local.20261004T210738Z.f2ec49837937`
**Last observed run:** `local.20261004T210738Z.f2ec49837937`
**Last processed run:** `local.20261004T210738Z.f2ec49837937`
**Detected at revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Last observed revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
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
