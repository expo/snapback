# snapback2: evaluator accepts inputs and rows that violate declared types and bounds

**Status:** Open
**Systems:** snapback2, evaluator, validation
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:1212-1235

Failure scenario: declare a program argument and row column as List<Int, max 1>, pass two integers, and insert the argument. The evaluator returns predicted and stores both items; the Rust engine rejects the argument with E_FANOUT before execution and its row validator also rejects the overlong column.

Why it happens: evaluateCase/applyMutation never validates Context.args. validateWriteRow checks only declared fields that happen to be present, and validateColumnValue does not enforce list kind or max and omits most scalar kinds, missing required fields, unknown fields, and the reserved system principal. No later evaluator call repairs the accepted state.

Suggested fix: port the complete Rust validate_inputs and validate_row semantics, including exact scalar types, text/JSON/list/bytes limits, enum membership, required/unknown fields, i53 bounds, and nested reserved-principal rejection. Add corpus vectors for each rejected shape.
