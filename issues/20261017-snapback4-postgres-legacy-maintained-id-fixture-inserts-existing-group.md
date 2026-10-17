# Snapback 4: PostgreSQL maintained-ID fixture inserts an existing group

**Status:** Open
**Date:** 2026-10-17
**Systems:** Snapback 4, PostgreSQL evaluation tests
**Found by:** LIVE final expanded qualification

`engine::postgres::tests::reopening_legacy_maintained_ids_rebuilds_before_publishing_the_generation`
fails before reopening the database: after loading `groups/group`, it edits
that row and invokes `tx.put(..., None)`. PostgreSQL treats None as an insert
and refuses the existing `(t,id)` primary key (`23505`, `r_pkey`).

Reproduced unchanged on RULES4 base `bbc4b4a9fd` (0 passed / 1 failed)
and LIVE `041313aafb` (expanded PostgreSQL suite: 29 passed / this one failed)
using the same private socket-only PostgreSQL 16.15 instance. The live adoption,
index rebuild, transfer rollback, transfer and trusted restore test passes.
The archived baseline lives only in this worktree's ignored target directory;
no other checkout was changed.

Suggested fix: retain the original group image and pass Some(original) for
this deliberate fixture update, preserving the migration/reopen assertions.
This is an inherited fixture failure, not a deferred LIVE feature change.

Evidence: [candidate log](../snapback4/reports/wave14-live/qualification/postgres-expanded.log)
and [base reproduction](../snapback4/reports/wave14-live/qualification/postgres-base-legacy.log).
