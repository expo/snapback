# complete battery red: published-closure-registry-canary

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `published-closure-registry-canary`
**Failure signature:** `sha256:14b0326961642a89e3832c0d67241afeb6835adcee168ea739853c05b12d9ad6`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `published-closure-registry-canary` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `published-closure-registry-canary` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-published-closure-registry.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
