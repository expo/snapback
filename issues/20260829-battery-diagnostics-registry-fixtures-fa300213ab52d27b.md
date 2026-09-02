# complete battery red: diagnostics-registry-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `diagnostics-registry-fixtures`
**Failure signature:** `sha256:fa300213ab52d27b5a3f69c33f947a44f111e5216ad02585d1e358fbcf0759c0`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260902T222959Z.21867fec6d93`
**Last processed run:** `local.20260902T222959Z.21867fec6d93`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Consecutive red runs:** `14`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `diagnostics-registry-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `diagnostics-registry-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/generate-diagnostics-registry.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
