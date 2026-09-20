# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20260920T003721Z.7ef61e81a1bf`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:4a9c58b1c841f11dc1c4308cfa1aacd686bb299cf08129c73fe5ea0d562c9162`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-all-aboard-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-all-aboard-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/all-aboard/tests/acceptance/contract-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
