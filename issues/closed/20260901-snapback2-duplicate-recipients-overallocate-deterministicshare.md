# snapback2: duplicate recipients overallocate DeterministicShare

**Status:** Closed
**Resolution:** Rejected duplicate DeterministicShare recipients in both engine/runner.rs and evaluator.ts; added atomic rollback and amount-conservation regressions.
**Systems:** snapback2, core engine, evaluator, builtins
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/engine/runner.rs:516-533

Failure scenario: allocate amount 1 over recipients ["u1","u1"]. Each occurrence asks DeterministicShare for u1; both find position zero, both receive the one-unit remainder, and two share rows totaling 2 are written. The evaluator repeats the same findIndex behavior at snapback2/packages/evaluator/src/evaluator.ts:675-687.

Why it happens: argument validation enforces list length/type but not uniqueness, and the builtin identifies an occurrence only by value using the first equal position. No table constraint or maintained aggregation detects the over-allocation.

Suggested fix: reject duplicate recipients with a typed E_INPUT before any write, or redesign the builtin to receive an occurrence index. Add duplicate-recipient cases asserting both rollback and sum(shares)==amount.
