# complete battery red: snapback-vite-bun-relay

**Status:** Open
**Reopened by battery run:** `local.20260930T043534Z.fc8deceab43c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `snapback-vite-bun-relay`
**Failure signature:** `sha256:74d3012319bb443d375c64852e178bc6b2cf3985233798ec9e91ebbe04548faa`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
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
