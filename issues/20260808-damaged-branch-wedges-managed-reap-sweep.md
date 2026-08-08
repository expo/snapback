# One damaged expired branch wedges the whole managed-branch reap sweep

**Opened:** 2026-08-08 · **Severity:** P2 (self-heal gap; unbounded workspace accumulation behind a stuck row) · **Area:** fork_promotion

## What

`src/fork_promotion.rs:948-951` (`reap_expired_managed_branches_bound`)

```rust
let workspace = MaterializedBase::reopen(&path)?;   // errors if head/base file missing
let branch = inspect_in_app_branch(&workspace.conn, &profile.branch_id)?;
```

`MaterializedBase::reopen` (`src/branches.rs:413-425`) refuses if either the
writable head or immutable base file is missing/not a real file. The reopen
exists only to build the receipt; the teardown itself needs no open workspace.
Rows are processed `ORDER BY created_at_ms, branch_id` and the first `?` aborts
the whole function.

## Failure scenario

An `active` custody row whose workspace files were lost out-of-band (disk
cleanup, partial restore) makes every future reap call error at that branch; it
can never transition to `tearing_down`, and every later-expiring branch behind
it is never reaped — unbounded workspace accumulation with no self-heal.
`reconcile_incomplete_managed_branches` self-heals `creating`/`tearing_down`
rows, but an `active`-with-missing-files row falls between reconcile and reap
and heals through neither.

## Fix

On reopen/inspect failure for an expired branch, still perform the `active →
tearing_down → dropped` transition and file removal (which already tolerates
NotFound), synthesizing the receipt from the custody `profile_json` as
`dropped_managed_receipt` already does.

## Confidence

Medium-high — the module already self-heals adjacent states; this row class is
the gap between reconcile and reap.
