# Snapback 4 Postgres replay skips the id binding

Status: Open
Date: 2026-09-15
Scope: Postgres evaluation executor; follow-up owned by the bound-replay lane.

`crates/snapback4-core/src/engine/postgres/mod.rs`, `PostgresEngine::mutate`,
checks `self.replay(&context.viewer, op)` before validating the operation or
arguments. `replay` queries `_ops` by `(principal, id)` and returns that receipt
without comparing the operation name or canonical argument binding.

[LLP 3000.009 §5.1](../../llp/3000.009-general-purpose-backend.rfc.md#51-declared-actions-and-routes-typed-handlers)
requires an operation id to be bound to its operation and arguments. Reusing an
id for different input currently replays the old Postgres receipt instead of
refusing the mismatch. SQLite's bound path is being implemented in another
lane; C1 must not duplicate it or change the protected identity/contract files.

Resolution: route Postgres mutation replay, including duplicate receipt races,
through the shared bound path once available; persist its binding atomically
with the receipt. Preserve sanitized replay (no historical result rows).
Verify same-id/same-input replay, changed arguments, changed operation, and
concurrent mismatching submissions against both stores.
