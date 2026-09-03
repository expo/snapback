# complete battery red: auth-coordinator-client

**Status:** Open
**Reopened by battery run:** `local.20260831T182234Z.850c161f649c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `cdca4903938ac10c386839e9f3e02bf0285f6bc0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:1c00fc05d90bd1bfe608162fdb49f968d940e9acf32c98ec3307dce904e06d3c`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260903T071655Z.08643f8b0ad3`
**Last processed run:** `local.20260903T071655Z.08643f8b0ad3`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Consecutive red runs:** `8`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `auth-coordinator-client` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `auth-coordinator-client` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/auth-coordinator-client.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
