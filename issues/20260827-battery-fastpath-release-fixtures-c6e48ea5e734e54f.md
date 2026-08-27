# complete battery red: fastpath-release-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `fastpath-release-fixtures`
**Failure signature:** `sha256:c6e48ea5e734e54f41d21c709ec4728084f930d9fd18474da2864d6e8065ccc9`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260827T191659Z.cf68cae13934`
**Last processed run:** `local.20260827T191659Z.cf68cae13934`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `fastpath-release-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `fastpath-release-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/snapback-fastpath-release.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
