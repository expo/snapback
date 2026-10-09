# complete battery red: agent-safe-publication-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-09
**Battery gate:** `agent-safe-publication-fixtures`
**Failure signature:** `sha256:a1cddcb3b76f47a735227d15c6f02d3306666ed1bbc68a92d7331ab375324049`
**First observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `agent-safe-publication-fixtures` as a root
failure (exit 124). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `agent-safe-publication-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/agent_safe_publication_checker_v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
