# complete battery red: provider-live-conformance

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:06c660faad0603add72a640e097a30f3077a3873270bdbc79302082564239ff4`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260829T051119Z.45ebcadce605`
**Last processed run:** `local.20260829T140951Z.cace7b53cf00`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `provider-live-conformance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `provider-live-conformance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
