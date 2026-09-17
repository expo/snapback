# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:b05f484bcb50e660ce8e21a48446d916ed6d7a14f6d7820f76fe65a2694f97bc`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260917T013752Z.61a3a6fa6021`
**Last processed run:** `local.20260917T113035Z.46f47983a1ce`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
**Consecutive red runs:** `6`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
