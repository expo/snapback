# complete battery red: snapback-vite-real-server

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `snapback-vite-real-server`
**Failure signature:** `sha256:c6b8ec104b46321c5144cd7bf05eca10823adc5fdb99ff69d737c85500fbdbcc`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last processed run:** `local.20260918T081626Z.dc1abf6b7394`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Consecutive red runs:** `10`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-vite-real-server` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-vite-real-server` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_RUNTIME_BINARY=/Users/ccheever/.snapback-local-proof-backstop/repo/target/debug/snapback npm --prefix packages/snapback-vite test
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
