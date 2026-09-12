# complete battery red: relation-activity-publication

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `relation-activity-publication`
**Failure signature:** `sha256:28481316e7f1aa3d7115aa7085d7a556b05f179758534d2cc03c510379e742c7`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last processed run:** `local.20260912T132006Z.195ccc9b90d5`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Consecutive red runs:** `47`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `relation-activity-publication` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `relation-activity-publication` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/conformance/relation-activity-publication-v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
