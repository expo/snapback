# complete battery red: agent-safe-publication-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-07
**Battery gate:** `agent-safe-publication-fixtures`
**Failure signature:** `sha256:030b93292010227d98fa8929d9bcd4359aebef48415b0544f0328dfd67be804c`
**First observed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Last observed run:** `local.20261007T045641Z.4e0c6567f5a3`
**Last processed run:** `local.20261008T085745Z.82992ad634f1`
**Detected at revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Last observed revision:** `4e0c6567f5a3dbd2d65326db080f59f8c1394fab`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `agent-safe-publication-fixtures` as a root
failure (exit 124). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `agent-safe-publication-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/agent_safe_publication_checker_v1.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
