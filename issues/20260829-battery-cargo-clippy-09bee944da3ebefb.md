# complete battery red: cargo-clippy

**Status:** Open
**Reopened by battery run:** `local.20260830T072833Z.94397bad48fa`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `cargo-clippy`
**Failure signature:** `sha256:09bee944da3ebefbbea5010a2fe4d62cbad7616976fc5300a1abb07f9dba2cd5`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Last processed run:** `local.20260830T160622Z.0fdfadbe8e67`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `cargo-clippy` as a root
failure (exit 101). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `cargo-clippy` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
cargo clippy --all-targets -- -D warnings
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
