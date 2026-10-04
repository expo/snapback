# complete battery red: package-cold-install-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `package-cold-install-fixtures`
**Failure signature:** `sha256:e6b4b90bc190115fd0d5b985ff72ca5d25d243887357c1de0eddd00a6a992509`
**First observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last processed run:** `local.20261004T072114Z.4353aa735cb1`
**Detected at revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Last observed revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
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
