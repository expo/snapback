# complete battery red: swift-client

**Status:** Closed
**Reopened by battery run:** `local.20260906T145321Z.2fd1b33c02f7`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `swift-client`
**Failure signature:** `sha256:fce58abdd868857a55df575bbe6627410150b15bf455ffe388ce06f3e42b2745`
**First observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last observed run:** `local.20260907T021018Z.6954679b09ae`
**Last processed run:** `local.20260907T124933Z.1936eaddbea3`
**Detected at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Last observed revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `swift-client` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `swift-client` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
swift test --package-path clients/swift/SnapbackClient
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
