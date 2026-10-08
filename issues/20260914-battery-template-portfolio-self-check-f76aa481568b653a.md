# complete battery red: template-portfolio-self-check

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `template-portfolio-self-check`
**Failure signature:** `sha256:f76aa481568b653aeb8d1409df7be24ea2cca73e2c44421b6beac13c84cd811e`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Consecutive red runs:** `46`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `template-portfolio-self-check` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `template-portfolio-self-check` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/template-registry-canary.mjs --self-check
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
