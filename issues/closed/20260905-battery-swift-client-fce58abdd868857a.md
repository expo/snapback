# complete battery red: swift-client

**Status:** Closed
**Reopened by battery run:** `local.20260916T051524Z.fbf2c6042249`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9d9a5cb67d30ae688a3d86ce88016056340a0b7f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `swift-client`
**Failure signature:** `sha256:fce58abdd868857a55df575bbe6627410150b15bf455ffe388ce06f3e42b2745`
**First observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last observed run:** `local.20260916T051524Z.fbf2c6042249`
**Last processed run:** `local.20260916T152410Z.9d9a5cb67d30`
**Detected at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Last observed revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
