# complete battery red: demo-catalog-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `demo-catalog-fixtures`
**Failure signature:** `sha256:a099faa4776b29acbf4be0003168b5724a43cf35f092d1a86bb1d6da952a71dd`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Last processed run:** `local.20260921T150959Z.9fa99a49e8cf`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Consecutive red runs:** `18`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `demo-catalog-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `demo-catalog-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/check-inventories.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
