# complete battery red: expo-chat-template-typecheck

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `expo-chat-template-typecheck`
**Failure signature:** `sha256:742e4e79402318de59fb7ba6b4fa0e36899e69c10c94ccf32a859471e8e68a72`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260924T025209Z.0388900b82ae`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Consecutive red runs:** `23`
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
