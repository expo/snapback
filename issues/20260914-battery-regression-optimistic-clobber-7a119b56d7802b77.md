# complete battery red: regression-optimistic-clobber

**Status:** Open
**Reopened by battery run:** `local.20261008T085745Z.82992ad634f1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:7a119b56d7802b7711fbadbc5f2863511a0c26eda5a5317bc7fc69c6a7eccf02`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-optimistic-clobber` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-optimistic-clobber` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-optimistic-clobber.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
