# complete battery red: expo-chat-template-typecheck

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `expo-chat-template-typecheck`
**Failure signature:** `sha256:8d9e60e4d9d2af59dab7cd9074b3fff07e16f68bc78c3f88174195c8265109f1`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last processed run:** `local.20260826T230829Z.fb14180ba761`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `expo-chat-template-typecheck` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `expo-chat-template-typecheck` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-expo-chat-template-typecheck.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
