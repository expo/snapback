# complete battery red: regression-gc-starvation

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:b55861e4e42f01b48efdbc3f10c0257f3e01cb0b9df571f59c3d85a402e91d48`
**First observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last processed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Detected at revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Last observed revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
