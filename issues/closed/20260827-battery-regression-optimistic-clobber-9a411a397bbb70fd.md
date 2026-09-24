# complete battery red: regression-optimistic-clobber

**Status:** Closed
**Reopened by battery run:** `local.20260924T130725Z.942753a689cd`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:9a411a397bbb70fd9735ed127f0e0c685c48dc6e9928e8c34e1e370ef20c3ef0`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260924T130725Z.942753a689cd`
**Last processed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
