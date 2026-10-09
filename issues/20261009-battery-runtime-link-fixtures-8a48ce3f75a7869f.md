# complete battery red: runtime-link-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-09
**Battery gate:** `runtime-link-fixtures`
**Failure signature:** `sha256:8a48ce3f75a7869f03be8c8257692a98a6f9a330db84fc2409e64fe7c4ecbafe`
**First observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `runtime-link-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `runtime-link-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/runtime_link_smoke_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
