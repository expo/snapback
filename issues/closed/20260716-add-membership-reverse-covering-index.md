# Add the membership reverse covering index

**Status:** Closed
**Severity:** P3
**Systems:** RBAC, SQLite schema, Membership lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table
**Marker:** performance, reliability

Membership DDL generates the unique `(principal, resource)` index, but the
holder/invalidation direction has no matching index.

`eligible_protected_holder_rows` and `has_other_eligible_holder` filter by
resource, role, and principal. With only the principal-first unique index,
`lastHolder` checks can scan the roster while holding a writer transaction.
Large membership tables therefore turn a security invariant and lifecycle
operation into avoidable lock duration and denial-of-service pressure. LLP
0056 explicitly calls for a reverse covering `(resource, role, principal)`
index.

**Done when:**

- Every resource-scoped membership declaration generates a stable, collision-
  checked `(resource, role, principal)` index in addition to the unique index.
- App-scoped declarations receive the appropriate reduced equivalent.
- Migration/reapplication and table/field rename diagnostics are deterministic.
- `EXPLAIN QUERY PLAN` regressions prove holder lookup and protected departure
  use the covering index on a large roster.

## Resolution

Closed 2026-07-16. Commit `6b81e1a` added stable, collision-checked reverse membership
indexes in `src/storage.rs` and `src/storage/auth_mode.rs`; the large-roster query-plan
regression is in the inline `src/storage.rs` tests.
