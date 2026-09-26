# complete battery red: js-production-audit

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `js-production-audit`
**Failure signature:** `sha256:aa8eadf03c46638ba39562e9fbe993dd7cad3452c113a322675b41ce582101aa`
**First observed run:** `local.20260925T100530Z.da526005226e`
**Last observed run:** `local.20260926T040309Z.024d180ac262`
**Last processed run:** `local.20260926T040309Z.024d180ac262`
**Detected at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Last observed revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `js-production-audit` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `js-production-audit` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-js-production-audit.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
