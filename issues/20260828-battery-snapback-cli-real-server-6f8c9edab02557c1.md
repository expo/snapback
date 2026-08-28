# complete battery red: snapback-cli-real-server

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `snapback-cli-real-server`
**Failure signature:** `sha256:6f8c9edab02557c149551a3fadb2bc621228d19e8367a713dbaa4308eec54d33`
**First observed run:** `local.20260828T203031Z.1b23bca7239e`
**Last observed run:** `local.20260828T203031Z.1b23bca7239e`
**Last processed run:** `local.20260828T203031Z.1b23bca7239e`
**Detected at revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Last observed revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-cli-real-server` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-cli-real-server` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_RUNTIME_BINARY=/Users/ccheever/.snapback-local-proof-backstop/repo/target/debug/snapback npm --prefix packages/snapback-cli test
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
