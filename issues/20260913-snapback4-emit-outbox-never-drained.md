# Snapback 4: `effect` / `emit` persist `_outbox` rows that nothing drains

Status: Open
Priority: P2
Date: 2026-09-13
Systems: Quarry `effect`/`emit`, engine mutation/job commit
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: package README “Not in this release” (effects)

## Problem and reproduction

`effect name from module` compiles. `emit` in a mutation or job is allowed. On commit the engine `INSERT`s into `_outbox`. Nothing in the host, `doctor`, jobs loop, or CLI ever `SELECT`s that table.

Word-prefix indexes are refused at bind with “not in this slice”. Effects are not: a copied Snapback 2 schema with `emit mail {…}` typechecks, the mutation returns `sent`, and the side effect never runs.

The README already says effects are not in this release. The binder should say so too.

## Implementation locations

- [snapback4/crates/snapback4-lang/src/bind/program/control.rs](../snapback4/crates/snapback4-lang/src/bind/program/control.rs) (`Emit`)
- [snapback4/crates/snapback4-core/src/engine/runner.rs](../snapback4/crates/snapback4-core/src/engine/runner.rs)
- [snapback4/crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs) (`INSERT INTO _outbox`)
- [snapback4/crates/snapback4-core/src/store.rs](../snapback4/crates/snapback4-core/src/store.rs)

## Suggestion

Until a worker exists, refuse `effect` / `emit` with `E_QUARRY_UNSUPPORTED` and the README rewrite (write a fact, let a job act). Or drain `_outbox` and document the module contract.
