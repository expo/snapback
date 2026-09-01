# snapback2: evaluator mutations leak writes after a rejected execution

**Status:** Open
**Systems:** snapback2, evaluator, client prediction
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:157-176

Failure scenario: apply a mutation that inserts users/ghost and then executes Require(false, "NO"). applyMutation throws, but a subsequent store.byId("users", "ghost") returns the inserted row. The authoritative Rust engine runs the mutation in a SQLite transaction and rolls it back on the same error, so the two client twins disagree and later local reads observe a write the server never committed.

Why it happens: applyMutation runs Runner directly against the persistent ClientStore. Runner mutates tables, coverage-related state, and maintained rows incrementally, and there is no snapshot, staging store, or error-path restoration before the exception escapes.

Suggested fix: execute each local mutation against an isolated snapshot/staging store and atomically replace the live tables, coverage, and range-deletion state only after successful completion. Add a mutation that writes before Require(false) and assert every local state component is unchanged.
