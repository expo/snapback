# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:51b7f68197df31ffc936728d013169b3e0d23a7f631fa36ab5f5d10eb6125dc3`
**First observed run:** `local.20260831T093441Z.cdca4903938a`
**Last observed run:** `local.20260831T093441Z.cdca4903938a`
**Last processed run:** `local.20260831T093441Z.cdca4903938a`
**Detected at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Last observed revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
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
