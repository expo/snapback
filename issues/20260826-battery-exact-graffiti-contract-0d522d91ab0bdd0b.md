# complete battery red: exact-graffiti-contract

**Status:** Open
**Reopened by battery run:** `local.20260908T125200Z.e6c89816b6d2`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-graffiti-contract`
**Failure signature:** `sha256:0d522d91ab0bdd0bd768122b72f24eaedefc1cc8dfe6f6556bd4a465ea02bc2b`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last processed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
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
