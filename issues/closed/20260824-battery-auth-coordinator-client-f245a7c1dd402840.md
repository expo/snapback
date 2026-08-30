# complete battery red: auth-coordinator-client

**Status:** Closed
**Reopened by battery run:** `local.20260830T072833Z.94397bad48fa`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:f245a7c1dd40284085544409d9c451d1a156ec28b0a495a27dc25da801c418df`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260830T072833Z.94397bad48fa`
**Last processed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
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
