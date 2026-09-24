# complete battery red: regression-handshake-loss

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:f5b3c8f36025a175cb75e479cbb990315bfe428a7e1d0d6f2f91c661506396e4`
**First observed run:** `local.20260924T130725Z.942753a689cd`
**Last observed run:** `local.20260924T130725Z.942753a689cd`
**Last processed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Detected at revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Last observed revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-handshake-loss` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-handshake-loss` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-handshake-loss.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
