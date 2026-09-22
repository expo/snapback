# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260922T102119Z.50782b08ec43`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:8d553212cbb26bf7d018175953c4fd24559e92fd7f770e03f829e2b93f92541a`
**First observed run:** `local.20260921T053735Z.66fc10578f22`
**Last observed run:** `local.20260922T102119Z.50782b08ec43`
**Last processed run:** `local.20260922T201104Z.e7c955d366a5`
**Detected at revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Last observed revision:** `50782b08ec432f5829644b2376245e937485fb7a`
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
