# complete battery red: cargo-audit

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-02
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:ad3f721e54752a6838372127fda536437d9aa994d8ee382e3000b4ad56975b87`
**First observed run:** `local.20261002T052302Z.0f516b324120`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
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
