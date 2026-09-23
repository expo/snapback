# complete battery red: snapback-client-package

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:638c94d4f6826bc0b2469dfce6006a419ad75935c4de3debdcd94315f2589b7a`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
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
