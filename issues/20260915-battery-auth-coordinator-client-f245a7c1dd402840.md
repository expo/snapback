# complete battery red: auth-coordinator-client

**Status:** Open
**Reopened by battery run:** `local.20261002T052302Z.0f516b324120`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:f245a7c1dd40284085544409d9c451d1a156ec28b0a495a27dc25da801c418df`
**First observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
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
