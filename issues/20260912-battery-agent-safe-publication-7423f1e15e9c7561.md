# complete battery red: agent-safe-publication

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `agent-safe-publication`
**Failure signature:** `sha256:7423f1e15e9c7561ebbb14cb6121956372d091fe48f8c4d7d1a3f7a8f86aab1d`
**First observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last processed run:** `local.20260912T132006Z.195ccc9b90d5`
**Detected at revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Last observed revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `agent-safe-publication` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `agent-safe-publication` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-agent-safe-publication.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
