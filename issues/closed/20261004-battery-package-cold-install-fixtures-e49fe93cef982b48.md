# complete battery red: package-cold-install-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `package-cold-install-fixtures`
**Failure signature:** `sha256:e49fe93cef982b4811502fdd91fdc162e97e40ae80d1e38cc1a29a3e162424eb`
**First observed run:** `local.20261004T210738Z.f2ec49837937`
**Last observed run:** `local.20261004T210738Z.f2ec49837937`
**Last processed run:** `local.20261005T101501Z.ce196270d2a4`
**Detected at revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Last observed revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `package-cold-install-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `package-cold-install-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/snapback-package-cold-install.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
