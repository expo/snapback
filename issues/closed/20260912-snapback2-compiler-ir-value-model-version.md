# snapback2 compiler ignores valueModelVersion while evaluator enforces it

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/packages/compiler/src/ir.ts:9-14`, `snapback2/packages/evaluator/src/runner.ts:43`, `snapback2/packages/evaluator/src/evaluator.ts:73`

## What was reported

`ir.ts:9-14` imports only `systemPrincipalId` + `retentionPolicies` from
`ir-contract.json` and ignores `valueModelVersion`, while `runner.ts:43`
pins `CURRENT_VALUE_MODEL_VERSION` and `evaluator.ts:73` refuses on
mismatch. A contract bump that the compiler silently ignores produces
compiler output the evaluator rejects (or worse, misreads) — with the
failure surfacing far from the cause.

## Suggested fix

- Import and assert `valueModelVersion` in the compiler against the same
  pinned constant; fail fast at compile time on mismatch.
- Add a test pinning compiler output version to the evaluator's constant.

## Acceptance

- Version skew between compiler output and evaluator expectation fails at
  compile time with a clear error, covered by a test.

## Resolution (2026-09-12)

Compiler IR_CONTRACT now exposes valueModelVersion, pins its supported version and rejects contract skew immediately when imported. An existing compiler test checks equality with the evaluator pin and exercises a future-version refusal; corpus checks compare canonical identities for all Rust certificates.

Validation: compiler bun run check passed; focused compiler/evaluator version and deliberate future-version checks plus all293 corpus identities passed. The error names the incompatible value model and compiler-supported version.
