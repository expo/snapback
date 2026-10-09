# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-09
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:b42926e77659330743c0449e6914db735630df6450c366a7a4f7da97a4f87b47`
**First observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
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
