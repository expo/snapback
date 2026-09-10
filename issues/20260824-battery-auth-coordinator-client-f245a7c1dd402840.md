# complete battery red: auth-coordinator-client

**Status:** Open
**Reopened by battery run:** `local.20260910T111530Z.4b2b32e6865b`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:f245a7c1dd40284085544409d9c451d1a156ec28b0a495a27dc25da801c418df`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260910T205152Z.322275c2ec2c`
**Last processed run:** `local.20260910T205152Z.322275c2ec2c`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `322275c2ec2c8bd4ce73c4a5ff0b1ee0506ad31f`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
