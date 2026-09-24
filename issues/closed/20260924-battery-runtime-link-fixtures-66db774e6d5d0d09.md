# complete battery red: runtime-link-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `runtime-link-fixtures`
**Failure signature:** `sha256:66db774e6d5d0d09895ef15aeff3de1817f43f32ca1932b057d6b88ba79c261b`
**First observed run:** `local.20260924T025209Z.0388900b82ae`
**Last observed run:** `local.20260924T025209Z.0388900b82ae`
**Last processed run:** `local.20260924T130725Z.942753a689cd`
**Detected at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Last observed revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `runtime-link-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `runtime-link-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/runtime_link_smoke_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
