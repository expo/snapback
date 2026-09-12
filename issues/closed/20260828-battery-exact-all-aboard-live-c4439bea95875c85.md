# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260912T024408Z.7d09e3124e2e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:c4439bea95875c859480fa4e09069233d5ec81a3f542104509213bf8625d5247`
**First observed run:** `local.20260828T203031Z.1b23bca7239e`
**Last observed run:** `local.20260912T024408Z.7d09e3124e2e`
**Last processed run:** `local.20260912T132006Z.195ccc9b90d5`
**Detected at revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Last observed revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-all-aboard-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-all-aboard-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/all-aboard/tests/acceptance/contract-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
