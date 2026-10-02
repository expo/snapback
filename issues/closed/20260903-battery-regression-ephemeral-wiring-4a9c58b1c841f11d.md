# complete battery red: regression-ephemeral-wiring

**Status:** Closed
**Reopened by battery run:** `local.20260930T133254Z.763535814fd9`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-03
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:4a9c58b1c841f11dc1c4308cfa1aacd686bb299cf08129c73fe5ea0d562c9162`
**First observed run:** `local.20260903T071655Z.08643f8b0ad3`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
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
