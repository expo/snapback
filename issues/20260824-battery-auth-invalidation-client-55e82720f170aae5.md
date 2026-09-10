# complete battery red: auth-invalidation-client

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `auth-invalidation-client`
**Failure signature:** `sha256:55e82720f170aae5772d5d813efd49dbe11271da14cee2cb5f042ec8c24da8f0`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260910T111530Z.4b2b32e6865b`
**Last processed run:** `local.20260910T111530Z.4b2b32e6865b`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
**Consecutive red runs:** `45`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `auth-invalidation-client` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `auth-invalidation-client` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/auth-invalidation-client.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
