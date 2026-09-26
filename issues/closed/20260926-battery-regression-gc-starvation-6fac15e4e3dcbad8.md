# complete battery red: regression-gc-starvation

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:6fac15e4e3dcbad8711769c995c94de228f8962a040f3e1b8306725e83c8eef7`
**First observed run:** `local.20260926T132126Z.a371edf7769a`
**Last observed run:** `local.20260926T132126Z.a371edf7769a`
**Last processed run:** `local.20260926T223620Z.3b21178b41db`
**Detected at revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
**Last observed revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
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
