# complete battery red: live-delta-e2e

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-09
**Battery gate:** `live-delta-e2e`
**Failure signature:** `sha256:4dfc747e2c6ceea40468c474cc4449b01227580988e6f83f69c8fe0ea5885bbf`
**First observed run:** `local.20260909T074306Z.2b8ec71c667f`
**Last observed run:** `local.20260909T074306Z.2b8ec71c667f`
**Last processed run:** `local.20260909T165632Z.6ffce9c07663`
**Detected at revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
**Last observed revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `live-delta-e2e` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `live-delta-e2e` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/live-delta-e2e.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
