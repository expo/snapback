# complete battery red: expo-chat-template-typecheck

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `expo-chat-template-typecheck`
**Failure signature:** `sha256:742e4e79402318de59fb7ba6b4fa0e36899e69c10c94ccf32a859471e8e68a72`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260904T174537Z.37281c059a09`
**Last processed run:** `local.20260904T174537Z.37281c059a09`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `37281c059a09e560ab1cae613ed5a4a96487ce7c`
**Consecutive red runs:** `18`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
