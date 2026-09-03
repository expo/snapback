# complete battery red: todo-v2-register-boot

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:d0669d34f8b2cc0e1fff0f30333bdc081b9e8b375642e35f8689afb2a3e3a9e2`
**First observed run:** `local.20260902T222959Z.21867fec6d93`
**Last observed run:** `local.20260902T222959Z.21867fec6d93`
**Last processed run:** `local.20260903T071655Z.08643f8b0ad3`
**Detected at revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Last observed revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-register-boot` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-register-boot` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/register-boot.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
