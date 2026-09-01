# complete battery red: template-portfolio-qualification-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260828T114709Z.095880f16775`
**Closure:** `determinate PASS`
**Closed at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `template-portfolio-qualification-fixtures`
**Failure signature:** `sha256:76c9f086e4c1cdef310fbde2f273d04e2b450741b2aac1730968da9d8554694b`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Consecutive red runs:** `13`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `template-portfolio-qualification-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `template-portfolio-qualification-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/template-portfolio-qualification-lib.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
