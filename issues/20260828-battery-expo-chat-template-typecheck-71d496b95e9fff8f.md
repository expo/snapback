# complete battery red: expo-chat-template-typecheck

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `expo-chat-template-typecheck`
**Failure signature:** `sha256:71d496b95e9fff8f69caba2d96e7a47f2771dee5fb9413e09da2cd72c025b3c9`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260828T114709Z.095880f16775`
**Last processed run:** `local.20260828T114709Z.095880f16775`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `095880f167755431165137247bd51844b8c29e09`
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
