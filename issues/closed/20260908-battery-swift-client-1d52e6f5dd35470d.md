# complete battery red: swift-client

**Status:** Closed
**Reopened by battery run:** `local.20260910T111530Z.4b2b32e6865b`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `322275c2ec2c8bd4ce73c4a5ff0b1ee0506ad31f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `swift-client`
**Failure signature:** `sha256:1d52e6f5dd35470d76ca1a508d6f8b32babb6e7b0decb5d40b6d47eeffce87e5`
**First observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last observed run:** `local.20260910T111530Z.4b2b32e6865b`
**Last processed run:** `local.20260910T205152Z.322275c2ec2c`
**Detected at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Last observed revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
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
