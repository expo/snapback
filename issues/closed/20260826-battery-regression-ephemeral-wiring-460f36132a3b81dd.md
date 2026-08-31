# complete battery red: regression-ephemeral-wiring

**Status:** Closed
**Reopened by battery run:** `local.20260831T005527Z.2ab5c5c6641e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:460f36132a3b81ddc59c99df451a946ceb46d7633966db82fddf364337de9624`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last processed run:** `local.20260831T093441Z.cdca4903938a`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
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
