# complete battery red: auth-coordinator-client

**Status:** Open
**Reopened by battery run:** `local.20261008T085745Z.82992ad634f1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:f245a7c1dd40284085544409d9c451d1a156ec28b0a495a27dc25da801c418df`
**First observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
