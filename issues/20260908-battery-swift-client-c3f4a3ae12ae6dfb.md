# complete battery red: swift-client

**Status:** Open
**Reopened by battery run:** `local.20261003T130924Z.f0c7d7a038c4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `swift-client`
**Failure signature:** `sha256:c3f4a3ae12ae6dfbbb3c336e192879984ecd528de16956c197e4aa0ca88f1d95`
**First observed run:** `local.20260908T030804Z.a75c98406a26`
**Last observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Last observed revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
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
