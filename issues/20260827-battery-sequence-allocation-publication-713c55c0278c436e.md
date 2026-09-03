# complete battery red: sequence-allocation-publication

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `sequence-allocation-publication`
**Failure signature:** `sha256:713c55c0278c436e328d25c5da5eccda35be387879be2f0bbcb909b2bd1f2217`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20260903T154459Z.afba645047a6`
**Last processed run:** `local.20260903T154459Z.afba645047a6`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Consecutive red runs:** `21`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `sequence-allocation-publication` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `sequence-allocation-publication` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/conformance/sequence-allocation-publication-v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
