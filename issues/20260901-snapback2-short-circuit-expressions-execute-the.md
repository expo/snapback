# snapback2: short-circuit expressions execute the skipped operand

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/compiler.ts:683-694 (with lowering in snapback2/packages/compiler/src/lower/expr.ts:86-128 and the corresponding branch-emission pattern in snapback2/packages/quarry/src/program.ts:258-272). Given a mutation containing `args.go && db.insert(logs, { id: ctx.newId() })` with `go: false`, the compiler hoists the right-hand-side prelude and the insert still runs; similarly, `existing ?? ctx.newId()` consumes an ID even when `existing` is non-null. Binary/logical lowering returns RHS statements outside the conditional expression, so JavaScript short-circuit evaluation is lost before IR execution, and no later runtime stage can reconstruct which operand should have been skipped. Lower `&&`, `||`, and `??` as explicit conditional control flow that evaluates and executes the RHS statements only in the selected branch, preserving single evaluation and the authored result value.
