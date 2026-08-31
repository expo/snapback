# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Reopened by battery run:** `local.20260830T072833Z.94397bad48fa`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:7442a35d1c2c4f3c0aa76a6c3580bd07a0e18ecec57f9cf233beb7bbba92b953`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last processed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-todo-v2-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-todo-v2-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/todo-v2/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
