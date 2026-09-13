# complete battery red: snapback-vite-bun-relay

**Status:** Open
**Reopened by battery run:** `local.20260912T024408Z.7d09e3124e2e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `snapback-vite-bun-relay`
**Failure signature:** `sha256:13e1c6c43c3a5f18df7ac30e159829c334bdc8c05488684d05ea5e760bd20169`
**First observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last observed run:** `local.20260912T231718Z.9e930482fe75`
**Last processed run:** `local.20260912T231718Z.9e930482fe75`
**Detected at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Last observed revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-vite-bun-relay` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-vite-bun-relay` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_RUNTIME_BINARY=/Users/ccheever/.snapback-local-proof-backstop/repo/target/debug/snapback bun packages/snapback-vite/bun-relay.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
