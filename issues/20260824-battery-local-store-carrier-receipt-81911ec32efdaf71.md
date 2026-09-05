# complete battery red: local-store-carrier-receipt

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `local-store-carrier-receipt`
**Failure signature:** `sha256:81911ec32efdaf71a39ca910d73fe718ffaefa335a301eec6b7f30fffbdf2c60`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last processed run:** `local.20260905T022830Z.0c1beadd1257`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Consecutive red runs:** `32`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `local-store-carrier-receipt` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `local-store-carrier-receipt` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/acceptance/local-store-carrier-exit-v1.mjs --check
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
