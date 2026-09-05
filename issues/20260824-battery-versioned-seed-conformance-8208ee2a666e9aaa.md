# complete battery red: versioned-seed-conformance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `versioned-seed-conformance`
**Failure signature:** `sha256:8208ee2a666e9aaac7af0e3643cf1e89a39377377fe360ac7b3e701d6c43f8e8`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last processed run:** `local.20260905T022830Z.0c1beadd1257`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Consecutive red runs:** `32`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `versioned-seed-conformance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `versioned-seed-conformance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_BINARY=/Users/ccheever/.snapback-local-proof-backstop/repo/target/debug/snapback node tests/conformance/run-versioned-seed-v1.mjs --receipt target/conformance/versioned-seed-v1.receipt.json --quiet
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
