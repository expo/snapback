# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:fdb8238f9b9d1643d5c8697712913576139573df95d534d59a01f3a286c5ec1e`
**First observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last processed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Detected at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Last observed revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
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
