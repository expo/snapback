# complete battery red: snapback-client-package

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-09
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:757812c3c5247648144f6101ee3c554fa2092d723f0efcd4e32f325a4087bbea`
**First observed run:** `local.20260909T165632Z.6ffce9c07663`
**Last observed run:** `local.20260909T165632Z.6ffce9c07663`
**Last processed run:** `local.20260909T165632Z.6ffce9c07663`
**Detected at revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
**Last observed revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
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
