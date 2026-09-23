# complete battery red: exact-graffiti-contract

**Status:** Closed
**Reopened by battery run:** `local.20260922T201104Z.e7c955d366a5`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:16d2d615b8561664b891b9826ae91ce9b355125c64063ed2cb855b247cbd16ac`
**First observed run:** `local.20260908T030804Z.a75c98406a26`
**Last observed run:** `local.20260922T201104Z.e7c955d366a5`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Last observed revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
