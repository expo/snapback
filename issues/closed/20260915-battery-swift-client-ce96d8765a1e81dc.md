# complete battery red: swift-client

**Status:** Closed
**Reopened by battery run:** `local.20261002T154654Z.1687b58af2d4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `swift-client`
**Failure signature:** `sha256:ce96d8765a1e81dcfaa8b899f01e59e53d02b67bb6aabe1afb1d430f9bf6234a`
**First observed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Last observed run:** `local.20261002T154654Z.1687b58af2d4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
**Last observed revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
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
