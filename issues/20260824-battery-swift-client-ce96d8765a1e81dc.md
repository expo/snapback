# complete battery red: swift-client

**Status:** Open
**Reopened by battery run:** `local.20260903T154459Z.afba645047a6`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `swift-client`
**Failure signature:** `sha256:ce96d8765a1e81dcfaa8b899f01e59e53d02b67bb6aabe1afb1d430f9bf6234a`
**First observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Last observed revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
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
