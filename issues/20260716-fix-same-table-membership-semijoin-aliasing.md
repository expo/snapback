# Fix same-table membership semi-join aliasing

**Status:** Open
**Severity:** P1
**Systems:** RBAC, Query planner, SQLite, Live queries
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Rule helpers
**Marker:** security, privacy

Membership-filter SQL uses physical table names instead of distinct outer and
inner aliases. When a query's primary table is also its membership table, the
inner subquery shadows the outer name and the resource correlation becomes a
tautology.

`build_query_sql` in `src/storage.rs` emits `SELECT * FROM "table"` with no
outer alias. `build_membership_exists_sql` emits an inner
`FROM "membership_table"` and correlates a row field as
`"membership_table"."resource" = "outer_table"."field"`. If the two table
names match, SQLite resolves both sides to the inner row.

With rows `(u1,event1)`, `(u2,event1)`, and `(u3,event2)`, a query intended to
show u1 the member rows for resources u1 belongs to lowers to an `EXISTS` whose
resource predicate is effectively `eventId = eventId`; it returns rows from
event2 as well. `validate_membership_predicate` currently permits this shape.

**Done when:**

- Query SQL always uses explicit, distinct outer and membership-subquery
  aliases, including identifier-safe generated names.
- Same-table row-field membership predicates correlate inner resource to the
  actual outer row.
- A regression proves u1 sees event1 membership rows and never event2 rows.
- Tests cover same-table and different-table predicates, app scope, arguments,
  initial query snapshots, and live re-query convergence.
