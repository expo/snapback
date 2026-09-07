# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-07
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:eb2af85614ed4252b518cfd9d4a76a8ff7aa865e2b4d93ae672990a0cca34404`
**First observed run:** `local.20260907T021018Z.6954679b09ae`
**Last observed run:** `local.20260907T021018Z.6954679b09ae`
**Last processed run:** `local.20260907T124933Z.1936eaddbea3`
**Detected at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Last observed revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
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
