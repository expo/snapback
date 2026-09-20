# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `c60751e30f9f1528c5532c396c7f8d6da598e7f5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:7ae85f4bb10c2f9b5511db095f449f4e122789ae18e970d5320c0680d186b26a`
**First observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last processed run:** `local.20260918T181131Z.c60751e30f9f`
**Detected at revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Last observed revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `cargo-audit` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `cargo-audit` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
cargo audit --deny unmaintained
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
