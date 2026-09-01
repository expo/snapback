# snapback2: compiler admits builtin arities that truncate results or panic Rust

**Status:** Open
**Systems:** snapback2, compiler, core engine, evaluator
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:464-488

Failure scenario: max(1,2,100) typechecks and lowers but both twins inspect only the first two values and return 2. "hello".slice(1), max(), concat(), and other missing-argument forms also typecheck/lower; Rust then calls Vec::remove on a missing slot at snapback2/crates/snapback2-core/src/engine/runner.rs:417-465 and panics.

Why it happens: public declarations advertise variadic min/max/concat and optional slice endpoints, lowering forwards arbitrary argument counts, and certification only traverses arguments without validating builtin signatures. The evaluator indexes or ignores extras while Rust removes fixed positions.

Suggested fix: define one shared builtin signature table, make declarations/lowering enforce the supported arities or implement the advertised variadic/default semantics, validate arity during certification, and defensively return typed errors at runtime. Add zero/one/two/three-argument parity cases.
