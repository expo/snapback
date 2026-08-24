# complete battery red: app-cli-served-journey

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `app-cli-served-journey`
**Failure signature:** `sha256:6700c2490fde3771ea75f7c5fc9e0d6e5d7ca1cbd94ed94d02732d03a90a89d3`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last processed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `app-cli-served-journey` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `app-cli-served-journey` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/acceptance/app-cli-served-journey.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
