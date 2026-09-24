# complete battery red: package-cold-install-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `package-cold-install-fixtures`
**Failure signature:** `sha256:a40e0505063445bcce26c1fc3289a8cf44dc9fb78a14181033c0187bf81af726`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `package-cold-install-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `package-cold-install-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/snapback-package-cold-install.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
