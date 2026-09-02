# snapback2 compiler: object literals do not carry Decimal field types into local selections

**Status:** Open
**Systems:** snapback2, compiler, type analysis
**Severity:** P3
**Author:** Codex, split from the provenance-tails ticket
**Date:** 2026-08-31
**Related:** LLP 1002 §2, `issues/20260831-snapback2-provenance-tails-false-refusals-and-rewrites.md`, `snapback2/packages/compiler/src/type-analysis.ts`

A local object literal does not retain per-field Decimal type facts through a later member selection. For example, with `amount: t.decimal(2)`, `const packed = { amount: args.amount }; db.insert(items, { amount: packed.amount + 2 })` cannot recover `packed.amount` as `Decimal<2>` and refuses rather than borrowing the operation argument's scale. The refusal is safe; the missing capability is typed immutable object members.

Resolve by carrying field types on immutable object-literal bindings (including aliases and ordered spreads) and selecting the bind-time field type lexically. Pin both Decimal arithmetic through `packed.amount` and a shadowing case so an unrelated use-time `packed` or `args` binding cannot supply the scale.
