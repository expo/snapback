# complete battery red: kernel-raw-sql-api

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `kernel-raw-sql-api`
**Failure signature:** `sha256:4831e6046a3c5b5a38b92464560cb46e764deae313a2b08d545aecb80225af91`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last processed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `kernel-raw-sql-api` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `kernel-raw-sql-api` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-kernel-raw-sql-api.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Expected-red cross-reference (2026-08-26)

This gate is **deliberately RED until LLP 0283 F-1 closes** — see
`issues/20260819-security-gates-expected-red-until-f1.md`. Reproduced on
`origin/main` at `45f52cfc8`: `SNAPBACK_PRIVILEGE_SURFACE: 100 violation(s)`,
down from the 102 recorded in that ticket after the f244 lock-ordering landing.
The findings are the four open F-1 escalation families, not a new regression.

This is the fifth ticket filed for this gate (four already in `issues/closed/`).
Each battery run whose residual set shifts produces a new normalized signature,
so the D-1 automation files a fresh ticket and auto-closes the prior one. That
churn will continue every scheduled run until F-1 lands; it is not new
information. Do not fix-forward against this ticket — the work is F-1 itself.
