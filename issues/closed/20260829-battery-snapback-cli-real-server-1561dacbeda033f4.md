# complete battery red: snapback-cli-real-server

**Status:** Closed
**Reopened by battery run:** `local.20260905T022830Z.0c1beadd1257`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `snapback-cli-real-server`
**Failure signature:** `sha256:1561dacbeda033f49ef0cf0fa8e95d8bd95ed60da0f92147f8ace25d71101ee6`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last processed run:** `local.20260912T024408Z.7d09e3124e2e`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Consecutive red runs:** `17`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
