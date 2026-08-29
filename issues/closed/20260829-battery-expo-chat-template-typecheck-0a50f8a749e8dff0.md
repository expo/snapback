# complete battery red: expo-chat-template-typecheck

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `expo-chat-template-typecheck`
**Failure signature:** `sha256:0a50f8a749e8dff0e3b0f7c17fe0f2fd24d44b7ad5007422e2228ca829ac2800`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260829T051119Z.45ebcadce605`
**Last processed run:** `local.20260829T140951Z.cace7b53cf00`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
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
