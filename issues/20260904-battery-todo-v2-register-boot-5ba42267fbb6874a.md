# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:5ba42267fbb6874a7c871ae4c988f99f2e65a35ec344966b6ca8ab65e6b7ecef`
**First observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last processed run:** `local.20260904T003052Z.cc497048cd8c`
**Detected at revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
**Last observed revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
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
