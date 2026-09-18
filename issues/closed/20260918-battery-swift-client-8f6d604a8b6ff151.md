# complete battery red: swift-client

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-18
**Battery gate:** `swift-client`
**Failure signature:** `sha256:8f6d604a8b6ff151582e82261d85470bec213f861334a328064f6db4b3c82879`
**First observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last processed run:** `local.20260918T181131Z.c60751e30f9f`
**Detected at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Last observed revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
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
