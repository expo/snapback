# complete battery red: cargo-audit

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:b05f484bcb50e660ce8e21a48446d916ed6d7a14f6d7820f76fe65a2694f97bc`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Last processed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
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
