# complete battery red: swift-client

**Status:** Closed
**Reopened by battery run:** `local.20260907T124933Z.1936eaddbea3`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `swift-client`
**Failure signature:** `sha256:7edbc50e4e71fbf16a40dc7d45e9c2319469812f59fed484dd2b35c525baa134`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260907T124933Z.1936eaddbea3`
**Last processed run:** `local.20260908T030804Z.a75c98406a26`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
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
