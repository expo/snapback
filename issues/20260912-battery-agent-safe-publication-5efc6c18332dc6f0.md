# complete battery red: agent-safe-publication

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `agent-safe-publication`
**Failure signature:** `sha256:5efc6c18332dc6f04460b0395177beebb15708f48d4abfb27566efe59f40e882`
**First observed run:** `local.20260912T231718Z.9e930482fe75`
**Last observed run:** `local.20260912T231718Z.9e930482fe75`
**Last processed run:** `local.20260912T231718Z.9e930482fe75`
**Detected at revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Last observed revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
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
