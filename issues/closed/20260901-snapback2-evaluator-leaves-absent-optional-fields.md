# snapback2: evaluator leaves absent optional fields missing instead of Null

**Status:** Closed
**Resolution:** Materialized absent Optional columns at ClientStore hydration/write boundaries in evaluator.ts; added hydration, insert, and point-read regressions.
**Systems:** snapback2, evaluator, value model
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:277-284

Failure scenario: declare an optional note column, insert {id:"one"} locally, then return row.note. The evaluator stores only id and throws E_FIELD for note; the Rust engine materializes the declared optional field as Null and returns Null for the same certified program.

Why it happens: ClientStore.put calls normalizeRow, but normalizeRow at lines 1054-1056 only sorts/clones the authored fields. field at lines 1065-1068 rejects a missing key. The Rust read path calls materialize_optional_fields in snapback2/crates/snapback2-core/src/engine/runner.rs:730-732.

Suggested fix: materialize every absent declared Optional column as Null at the same evaluator boundaries as Rust, before rule/constraint evaluation and whenever rows enter or leave ClientStore. Add insert, receipt-hydration, point-read, and scan parity cases.
