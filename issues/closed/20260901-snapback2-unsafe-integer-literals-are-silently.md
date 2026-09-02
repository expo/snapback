# snapback2: unsafe integer literals are silently rounded during compilation

**Status:** Closed
**Resolution:** Rejected out-of-i53 authored tokens and recursively invalid IR literals in compiler/Rust certification; added TypeScript and Rust regressions.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:276-290 (consumed by snapback2/crates/snapback2-core/src/value.rs:7-20). A source literal `9007199254740993` is already rounded by JavaScript parsing to `9007199254740992`, and the compiler accepts that out-of-range value into integer IR, producing the wrong constant rather than a diagnostic. Literal lowering converts through Number without enforcing the signed safe-integer contract, and certification also accepts the resulting integer, so no later layer can recover the authored digits. Inspect the literal token before numeric conversion, require the supported i53 range and exact integer representation, and independently validate integer literals at the IR/certification boundary.
