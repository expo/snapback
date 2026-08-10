# Storage: unbounded migration-checkpoint growth + branches.rs atomicity API-shape traps + misc hygiene

**Opened:** 2026-08-08 · **Severity:** P2 (checkpoint growth) + P3 (the rest) · **Area:** storage / branches

**Status:** Resolved 2026-08-10

Grouped storage findings below P1. The checkpoint growth is the P2; the rest are
latent API-shape traps and consistency hardening.

## [P2] `_snapback_migration_checkpoint` never purged

`src/storage/migration_executor.rs:1676-1684` (populate), :2473 (only reader).
Admission does `INSERT OR IGNORE INTO _snapback_migration_checkpoint … SELECT …
FROM {table}` for every in-place-written table; there is **no** `DELETE FROM
_snapback_migration_checkpoint` anywhere in `src/`. Every migration touching an
N-row table permanently retains N checkpoint rows keyed by operation_id — ten
migrations of a 1M-row table leave 10M dead rows inflating the DB and every
backup forever, though the rollback window they serve closes at release.
*Fix:* delete the operation's checkpoint rows inside the release/rolled-back
cleanup transaction.

## [P3] `create_branch` does two dependent INSERTs with no internal transaction

`src/branches.rs:184-203` inserts into `_snapback_branches` then
`_snapback_branch_versions` on a bare `&Connection`. A caller that doesn't wrap
it (the signature invites this) can crash between inserts, leaving a registered
branch with no version stream; `allocate_child_version` then fails closed
forever and the PK blocks re-registration. The sole production caller
(`fork_promotion.rs:542`) wraps it, so latent. *Fix:* take `&Transaction` (or
open one internally) so atomicity is structural.

## [P3] `allocate_child_version` is an unlocked read-increment-write

`src/branches.rs:270-286`: `child_current_version(...)` then `UPDATE … SET
current_version = ?2`. Two connections outside a transaction can both read N and
write N+1. In-repo callers wrap it (serializes via BUSY today), so it's an API
trap. *Fix:* single-statement `UPDATE … SET current_version = current_version +
1 … RETURNING` plus the portable-max guard.

## [P3] Cross-table copy batches ignore the journaled resume boundary

`src/storage/migration_executor.rs:3597` (`run_cross_table_copy_batches`) seeds
`after = None` where siblings `run_backfill_batches` (:3352) and
`run_staged_copy_batches` (:3495) seed from `resume_backfill_boundary(...)`.
Crash-resume rescans the source from the start; the idempotency guard keeps it
correct (no skip/duplicate), so it's wasted rescan + misleading batch ordinals,
not corruption. *Fix:* seed `after` from `resume_backfill_boundary` like the
siblings.

## [P3] PRAGMA identifier interpolation without quote-doubling

`src/storage/auth.rs:2295, 2312, 2342, 2358`:
`format!("PRAGMA table_xinfo(\"{table}\")")` wraps names without doubling
embedded `"` (contrast `src/auth/rescue.rs:75`). Impact is ~nil (runs against
restored backup catalogs; `prepare` executes only the first statement; read-only
PRAGMAs; exact-shape validation fails closed) — consistency hardening only.
*Fix:* route these four through the quote-doubling helper.

## Confidence

High on all mechanics; the P3s are latent (in-repo callers currently compensate)
but are exactly the API shapes that fail a future reviewer.

## Progress (2026-08-08)
P2 checkpoint-retention item fixed on main (Lane A): operation checkpoint rows are deleted in the released/rolled-back cleanup transaction. The P3 branches.rs atomicity items (create_branch, allocate_child_version, cross-table copy resume, PRAGMA quoting) remain open for a later lane.

## Resolution (2026-08-10)

The four P3 remainders are implemented in the uncommitted Slice G1 worktree:

- `create_branch` structurally requires a caller-owned `Transaction`, with a rollback test covering both dependent rows;
- child-version allocation is one guarded `UPDATE ... RETURNING`, with independent-connection uniqueness/gap-free and portable-maximum tests;
- cross-table copy resumes from the operation-and-step-scoped journal boundary, with a committed-boundary regression test; and
- all four catalog PRAGMAs use the shared quote-doubling helper, with an embedded-double-quote schema test.

All five targeted regressions pass and `cargo test --lib branches` passes 23/23. The required `cargo test --lib storage` filter runs 422 tests and has one unrelated suite-order/shared-state red (`auth_backup_excludes_push_registry_custody_rows`, which passes alone); the exact counts and diagnostic are recorded in `SLICE-G1-NOTES.md`. `ref-check` and scoped rustfmt checks pass.
