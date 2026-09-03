# complete battery red: guide

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `guide`
**Failure signature:** `sha256:fc79d731ab767efec40df1ef95ac80b581689a1968eb3009440935837ebc5048`
**First observed run:** `local.20260901T030411Z.6435dc48103e`
**Last observed run:** `local.20260902T222959Z.21867fec6d93`
**Last processed run:** `local.20260903T071655Z.08643f8b0ad3`
**Detected at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Last observed revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Consecutive red runs:** `6`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
