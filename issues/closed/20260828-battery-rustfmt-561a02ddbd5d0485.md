# complete battery red: rustfmt

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `rustfmt`
**Failure signature:** `sha256:561a02ddbd5d04856a63d2c4d01691079d474dcfe27261ee11dd51246adab97a`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260828T203031Z.1b23bca7239e`
**Last processed run:** `local.20260829T051119Z.45ebcadce605`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `rustfmt` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `agent_safe_derived_deployment_fork_v1` — `crates/snapback-activation/src/local-agent-safe-derived-deployment-fork-publication.anchor.json`
- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `rustfmt` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-rustfmt.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
