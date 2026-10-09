# complete battery red: security-gate-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `security-gate-fixtures`
**Failure signature:** `sha256:ceb3bafd7efd5c87f6e3430c8cce74b2cdc43f67f0797c99bdb0cd6d621b6cc7`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Consecutive red runs:** `47`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `security-gate-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `security-gate-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/security_gates_v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
