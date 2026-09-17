# complete battery red: provider-live-conformance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:e5035cdae0a6d4b4bca7974d62a775ffc470c880199b32c24a5050645d90ab43`
**First observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last processed run:** `local.20260917T113035Z.46f47983a1ce`
**Detected at revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Last observed revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `provider-live-conformance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `provider-live-conformance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
