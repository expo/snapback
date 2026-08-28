# complete battery red: cargo-clippy

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `cargo-clippy`
**Failure signature:** `sha256:284eec84e84574960af56e24f40ce13a853571fb48f0306f9279fbf47dfee3e7`
**First observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last processed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Detected at revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Last observed revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
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
