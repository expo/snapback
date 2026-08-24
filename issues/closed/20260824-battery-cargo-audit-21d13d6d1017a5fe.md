# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:21d13d6d1017a5fe2fdd37898e0e5a001c3210d87ac1e47ee13e0e82f84f8af6`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last processed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `cargo-audit` as a root
failure (exit 101). This ticket is keyed by gate plus the normalized
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
