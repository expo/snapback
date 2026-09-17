# complete battery red: rustfmt

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `rustfmt`
**Failure signature:** `sha256:cbff075f9ab750855f067f117a4296d153741c158d591daa1f11a7438d6d86ad`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260917T013752Z.61a3a6fa6021`
**Last processed run:** `local.20260917T013752Z.61a3a6fa6021`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
**Consecutive red runs:** `7`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `rustfmt` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `rustfmt` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-rustfmt.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
