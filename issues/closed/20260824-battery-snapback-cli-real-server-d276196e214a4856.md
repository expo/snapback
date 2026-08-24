# complete battery red: snapback-cli-real-server

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `snapback-cli-real-server`
**Failure signature:** `sha256:d276196e214a485653a66c45bf676e2e3822794ec54ecb29abb117d69d743784`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last processed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
