# complete battery red: exact-graffiti-contract

**Status:** Open
**Reopened by battery run:** `local.20260901T030411Z.6435dc48103e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:0d522d91ab0bdd0bd768122b72f24eaedefc1cc8dfe6f6556bd4a465ea02bc2b`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
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
