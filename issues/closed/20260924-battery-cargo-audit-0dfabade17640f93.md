# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:0dfabade17640f93ce0b89e5ebc96fd10da82b03a657a3f5d32ae12391550ff4`
**First observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last observed run:** `local.20260925T100530Z.da526005226e`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Last observed revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
