# complete battery red: regression-gc-starvation

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-08
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:2e91cc0d8fe076bdd3d091b8db059548dd92eff980bca48873c2faf95097c883`
**First observed run:** `local.20261008T085745Z.82992ad634f1`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
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
