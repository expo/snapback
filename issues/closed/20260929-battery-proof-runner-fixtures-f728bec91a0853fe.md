# complete battery red: proof-runner-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-29
**Battery gate:** `proof-runner-fixtures`
**Failure signature:** `sha256:f728bec91a0853fe723c44b2b44ae4cd4b13344bdf43e881341cbac8a71e40ed`
**First observed run:** `local.20260929T091155Z.f56e8048aa9f`
**Last observed run:** `local.20260929T091155Z.f56e8048aa9f`
**Last processed run:** `local.20260929T185743Z.aee02735615b`
**Detected at revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Last observed revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `proof-runner-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `proof-runner-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/proof_runner_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
