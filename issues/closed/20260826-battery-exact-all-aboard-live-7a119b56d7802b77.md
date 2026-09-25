# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260924T233800Z.4619cf3fc2e4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:7a119b56d7802b7711fbadbc5f2863511a0c26eda5a5317bc7fc69c6a7eccf02`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last processed run:** `local.20260925T100530Z.da526005226e`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
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
