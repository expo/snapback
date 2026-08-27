# complete battery red: proof-runner-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `proof-runner-fixtures`
**Failure signature:** `sha256:2fa3043d398c093bf91e72fff0c0e71c6beb16b57ed95823c3436918d877c2e6`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260826T230829Z.fb14180ba761`
**Last processed run:** `local.20260827T104322Z.04da2f52bd6f`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `proof-runner-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `proof-runner-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/proof_runner_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
