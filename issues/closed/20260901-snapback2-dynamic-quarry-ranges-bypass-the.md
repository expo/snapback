# snapback2: dynamic Quarry ranges bypass the compiler loop bound

**Status:** Closed
**Resolution:** Refuted on verification: Quarry emits the dynamic expression as generated TypeScript, and the packaged compiler refuses it with E_UNBOUND_LOOP before certification. The bound never reaches the certificate or IR, so the bounded runtime cannot be bypassed.
**Systems:** snapback2, quarry
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/program.ts:305-322 (contrasting snapback2/packages/compiler/src/lower/expr.ts:167-171). A Quarry operation using `range(start, end)` with runtime arguments is assigned an invented maximum of 1000 and compiles, while the equivalent TypeScript surface is rejected with E_UNBOUND_LOOP because no static bound is proved. Inputs can exceed the assumed maximum, so Quarry admits work the shared bounded-execution contract forbids. Require literal/provably bounded endpoints under the same rule as the TypeScript compiler, or emit a real checked runtime clamp whose changed semantics are explicit in the source contract.
