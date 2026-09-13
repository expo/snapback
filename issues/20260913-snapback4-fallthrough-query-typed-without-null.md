# Snapback 4: a query that can fall off the end is typed without `null` and returns `null`

Status: Open
Priority: P2
Date: 2026-09-13
Systems: Quarry binder, interpreter, TypeScript emitter
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Result type is the join of `binder.returns` only. A trailing `if` is not an implicit return. The interpreter returns `Value::Null` when the body does not `Return`. This program typechecks as `int` and yields `null` when `x` is null:

```quarry
query q(x: int ?):
  if x != null:
    return x
```

Emitted TypeScript is `Query<…, number>`. Branch-local narrowing (closed R33) is not this: refinements no longer leak; the missing fall-through join does.

Related binder holes in the same pass:

- `from module` on `fn`/`shape`/`proc` parses and is then dropped (`Catalog::build` never reads those fields).
- Duplicate `fn`/`shape`/`proc`/`effect` names overwrite with no diagnostic.
- Maintain `readable <-` bind errors are swallowed (`.ok()`), so a typo compiles as no disclosure rule.
- Core sync-inversion issues are re-emitted as `E_SCHEMA_CONSTRAINT` with rewrite “fix the declaration named by this message” and the indexes card; `snapback4 why E_SYNC` never sees them.
- `stable_chunks` zips IR statements against AST chunks, so a hoisted `Let` before `For` skips `E_JOB_CURSOR_INDEX`.
- `enum()` emits invalid TypeScript (`label: ;`).

## Implementation locations

- [snapback4/crates/snapback4-lang/src/bind/program.rs](../snapback4/crates/snapback4-lang/src/bind/program.rs)
- [snapback4/crates/snapback4-core/src/engine/runner.rs](../snapback4/crates/snapback4-core/src/engine/runner.rs) (`run` fall-through `Ok(Value::Null)`)
- [snapback4/crates/snapback4-lang/src/bind/catalog.rs](../snapback4/crates/snapback4-lang/src/bind/catalog.rs)
- [snapback4/crates/snapback4-lang/src/bind/schema.rs](../snapback4/crates/snapback4-lang/src/bind/schema.rs)
- [snapback4/crates/snapback4-lang/src/emit.rs](../snapback4/crates/snapback4-lang/src/emit.rs)

## Suggestion

If the body’s last statement does not exit, join `Ty::Null` into the result (or refuse a query that can fall off the end). Refuse `from module` until imports exist. Diagnose duplicate helpers. Push `readable` bind errors. Map `tables.*.sync` issues to `E_SYNC`. Walk IR `For` independently of AST zip order. Require at least one enum variant.
