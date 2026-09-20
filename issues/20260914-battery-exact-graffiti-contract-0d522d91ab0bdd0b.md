# complete battery red: exact-graffiti-contract

**Status:** Open
**Reopened by battery run:** `local.20260920T102449Z.dac4e3fed707`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:0d522d91ab0bdd0bd768122b72f24eaedefc1cc8dfe6f6556bd4a465ea02bc2b`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260920T195819Z.92d678d5700d`
**Last processed run:** `local.20260920T195819Z.92d678d5700d`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-graffiti-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-graffiti-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/graffiti/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
