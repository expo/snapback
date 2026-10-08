# complete battery red: telemetry-smoke

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-08
**Battery gate:** `telemetry-smoke`
**Failure signature:** `sha256:27d95d16e0113d8912ba7a19dba2161f79e54d59341b5e122045a72437b295f6`
**First observed run:** `local.20261008T085745Z.82992ad634f1`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `telemetry-smoke` as a root
failure (exit 101). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `telemetry-smoke` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
scripts/verify-telemetry-phase1-proof --smoke
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
