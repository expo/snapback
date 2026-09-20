# complete battery red: workspace-graph-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `workspace-graph-fixtures`
**Failure signature:** `sha256:b15afaa5129366e268cb2c7878b1123f577c7e8fb2576174dc419b376d174341`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Consecutive red runs:** `14`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `workspace-graph-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `workspace-graph-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/workspace_graph_v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
