# complete battery red: auth-handshake

**Status:** Open
**Reopened by battery run:** `local.20260911T062045Z.15c134d056d0`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `auth-handshake`
**Failure signature:** `sha256:d29dc9ef44eabd772ded8af6a7b3c1d54c47ad4d1e9a283540d2679fb83181f0`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260912T024408Z.7d09e3124e2e`
**Last processed run:** `local.20260912T024408Z.7d09e3124e2e`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `auth-handshake` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `auth-handshake` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/auth-handshake.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
