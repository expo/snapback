# complete battery red: template-portfolio-qualification-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `template-portfolio-qualification-fixtures`
**Failure signature:** `sha256:76c9f086e4c1cdef310fbde2f273d04e2b450741b2aac1730968da9d8554694b`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260919T040853Z.0168b46b0c20`
**Last processed run:** `local.20260919T040853Z.0168b46b0c20`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `0168b46b0c205a32b607ecda053fc041dfda900f`
**Consecutive red runs:** `12`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `template-portfolio-qualification-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `template-portfolio-qualification-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/template-portfolio-qualification-lib.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
