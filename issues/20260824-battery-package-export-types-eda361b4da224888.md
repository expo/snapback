# complete battery red: package-export-types

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `package-export-types`
**Failure signature:** `sha256:eda361b4da22488874d24e914df0df880921dc59c0ecb57dd490cb1cd41ecf19`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T022619Z.88476b032428`
**Last processed run:** `local.20260824T022619Z.88476b032428`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `package-export-types` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `package-export-types` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-package-export-types.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
