# complete battery red: regression-ephemeral-wiring

**Status:** Open
**Reopened by battery run:** `local.20260927T175940Z.8112f4ef6400`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:bdd0265e42bdbac7bb7ef5fe9ebdddac04c6e4e45727fa4c656d23ae95da2ce1`
**First observed run:** `local.20260831T093441Z.cdca4903938a`
**Last observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last processed run:** `local.20260927T175940Z.8112f4ef6400`
**Detected at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Last observed revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-ephemeral-wiring` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-ephemeral-wiring` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-ephemeral-wiring.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
