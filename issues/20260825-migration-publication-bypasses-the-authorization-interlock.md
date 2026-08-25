# Migration publication and rollback bypass the authorization interlock

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-engine
Related: llp/0053-authorization-invalidation.rfc.md,
  llp/0081-migration-publication.md,
  llp/0303-subject-authority-correlation-policy.decision.md

## The defect

A review deriving the correct predicate — *every durable mutation that can realize one of LLP 0053's
four invalidation events, including active schema, function and auth-metadata changes even when the
authorization pair is otherwise unchanged* (LLP 0053:448) — found both migration directions violate it.

- Public `LocalDatabase::migrate_apply`
  (`crates/snapback-kernel/src/storage/migration_executor.rs:1498`) writes active schema metadata at
  `:2123-2181` and commits **without an authorization hook or participant bind**.
- Public rollback (`:2405`) republishes the predecessor at `:2562-2708`, also without the interlock.
- `ServingDatabase` publicly forwards both.
- `publish_manifest_for_migration` writes the capability-aware and legacy active manifests
  (`crates/snapback-kernel/src/storage/auth_mode.rs:1996-2017`).

The engine's forward wrapper retires subscriptions **after** the kernel commit
(`crates/snapback-engine/src/local/engine.rs:29778-29794`). That is not the same publication
transaction LLP 0081 requires (lines 506–509), cannot protect the public kernel APIs a dependent
reaches directly, and leaves a post-commit failure window. The rollback wrapper (`:29825-29838`)
merely refreshes manifests and performs no equivalent retirement at all.

Checked-in tests already exercise both compositions.

## Why this ticket exists separately

**It is inherited, not introduced.** The reviewer found it while assessing a lane's exhaustive-census
claim and was explicit that it exists independently on current `origin/main`, citing main-side paths
separately from lane-worktree paths. So it belongs to nobody: it is not the lane's to fix, it closes
no enumerated row, and no scheduled gate reports it.

That combination — real, reachable from a dependent, and unowned — is exactly the kind of finding that
evaporates when a review is filed under the lane that happened to surface it.

## What it means for the census

A lane's claim to have enumerated "every writer requiring invalidation" is false while these two
public paths exist. The predicate is right; the enumeration under it was not exhaustive. This is the
**fifth** distinct miss found on that surface — each previous enumeration was thorough and each read a
narrower predicate than the row required.

## Direction

Either the publication and rollback transactions enter the interlock themselves — the same transaction
as the metadata write, not a wrapper after the commit — or the public kernel entry points stop being
reachable by a dependent so the engine wrapper is the only route. The second is a visibility question
of the kind recorded in
`issues/20260825-no-in-database-mechanism-defends-against-a-raw-connection.md`, and shares that row's
constraint: production callers cross crate boundaries and Rust has no friend visibility.

Not urgent enough to displace open rows, but it should not be lost.
