# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-02
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:aaf598ef454c98e9c96f540af09422939f7e5b2c56ec63e32c302a821a488c5d`
**First observed run:** `local.20261002T154654Z.1687b58af2d4`
**Last observed run:** `local.20261002T154654Z.1687b58af2d4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
**Last observed revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
