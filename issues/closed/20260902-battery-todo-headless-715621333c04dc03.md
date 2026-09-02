# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:715621333c04dc037f8878aaef539fa4554db372a42eed9162961e144599f2da`
**First observed run:** `local.20260902T051222Z.69c95613ab97`
**Last observed run:** `local.20260902T051222Z.69c95613ab97`
**Last processed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Detected at revision:** `69c95613ab978630f3a6af58e35a449374161f36`
**Last observed revision:** `69c95613ab978630f3a6af58e35a449374161f36`
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
