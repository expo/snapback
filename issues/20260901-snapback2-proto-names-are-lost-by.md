# snapback2: __proto__ names are lost by plain-object lowering

**Status:** Open
**Systems:** snapback2, compiler, evaluator, value model
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/schema.ts:66-70

Failure scenario: declare a legal quoted column "__proto__" and write/read that field. The compiler accumulates schema and expression records with ordinary {} assignment, so assigning __proto__ changes the accumulator prototype instead of creating an own property; the emitted schema/row silently omits the column and value. ClientStore row normalization repeats the loss.

Why it happens: schema columns at lines 152-159, object expressions at snapback2/packages/compiler/src/lower/expr.ts:332-374, and evaluator row/object helpers at snapback2/packages/evaluator/src/evaluator.ts:507-510 and 1059-1062 all use prototype-bearing objects with dynamic keys. No name rule forbids __proto__, and Rust BTreeMap supports it.

Suggested fix: use Map, Object.create(null), Object.fromEntries, or defineProperty for all authored-key accumulators and canonicalizers. Add table, column, object-result, seed, and receipt cases for __proto__, constructor, and prototype.
