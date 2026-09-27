# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:ea555fa791a2fcd1e9cdf8a214bbe80883715aed60f98c95132caa7f1514676f`
**First observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last processed run:** `local.20260927T175940Z.8112f4ef6400`
**Detected at revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Last observed revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
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
