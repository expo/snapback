# complete battery red: snapback-client-package

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:64cd8f4eb55cd46093e19879b4dc3a109e2e04565072b8c37757ab1ed7d513e2`
**First observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last processed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Detected at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Last observed revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-client-package` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-client-package` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun run --cwd packages/snapback-client test
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
