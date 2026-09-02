# snapback2: single-interpolation templates return non-strings

**Status:** Closed
**Resolution:** Coerced singleton interpolations through string Concat in compiler/evaluator/Rust runtime and updated the S1 corpus; added value regression.
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/lower/expr.ts:402-411 and snapback2/packages/compiler/src/project.ts:714-716. An operation returning `${args.n}` with `n = 42` is typed by the generated API as a string, but the compiler returns the integer expression directly and runtime produces numeric `42`. The template lowering special-cases one interpolation by omitting concatenation/string conversion, while multi-part templates pass through string concatenation. Always apply the supported string conversion for interpolations, including the singleton case, or concatenate with an empty string through the same checked path.
