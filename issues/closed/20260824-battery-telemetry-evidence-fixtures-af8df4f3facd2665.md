# complete battery red: telemetry-evidence-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `telemetry-evidence-fixtures`
**Failure signature:** `sha256:af8df4f3facd26650971fb90c8a6003f38d278d46d26f731d7269ec6165308d2`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T022619Z.88476b032428`
**Last processed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `telemetry-evidence-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `telemetry-evidence-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/telemetry-phase1-evidence.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
