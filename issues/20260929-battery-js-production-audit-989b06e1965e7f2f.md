# complete battery red: js-production-audit

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-29
**Battery gate:** `js-production-audit`
**Failure signature:** `sha256:989b06e1965e7f2f49bf2652e461687973361efffeaf9df0b4886d192110aaf1`
**First observed run:** `local.20260929T091155Z.f56e8048aa9f`
**Last observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last processed run:** `local.20260930T043534Z.fc8deceab43c`
**Detected at revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Last observed revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `js-production-audit` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `js-production-audit` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-js-production-audit.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
