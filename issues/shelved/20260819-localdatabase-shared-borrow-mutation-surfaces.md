# `LocalDatabase` mutates and destroys state through shared-borrow surfaces

**Status:** Open
**Filed:** 2026-08-19
**Severity:** High
**Systems:** Security/authorization, Storage, Rust core
**Related:** LLP 0285 §8 risk 3, LLP 0283 F-1

## Finding

LLP 0285 §8 risk 3 treats `Deref` on `ServingDatabase` as safe-ish because `DerefMut`
is removed, so callers only obtain `&LocalDatabase`. An independent review of the
steps 3-4 implementation established that **`&LocalDatabase` is not read-only**: several
public shared-borrow surfaces mutate or destroy durable state through interior mutability.

- `checkpoints_read()` returns a handle that erases and recovers checkpoints and performs
  protected erasure (`crates/snapback-kernel/src/storage/checkpoints.rs:232`, `:240`).
- `versions_read()` returns a handle that reconfigures history retention and prunes
  history through `&self` (`crates/snapback-kernel/src/storage/versions.rs:356`).
- `reader_pool()` returns a cloneable `Arc<ReaderPool>` whose public
  `quarantine_vector_generation` opens a write-capable system connection
  (`crates/snapback-kernel/src/storage/connections.rs:596`).
- `persist_derived_fork_app_row_coverage_receipt` durably writes caller-provided coverage
  bytes from `&self` (`crates/snapback-kernel/src/storage/auth_invalidation.rs:572`).
- The "after hosted preflight" DDL methods accept no proof that the preflight ran
  (`crates/snapback-kernel/src/storage/auth_sender.rs:319`,
  `crates/snapback-kernel/src/storage/auth_throttle.rs:17`).

## Failure scenario

A caller holding only a shared `&ServingDatabase` can lower history retention and prune
audit/history rows, erase checkpoint material, or persist an arbitrary coverage record —
without ever holding a mutable borrow or an admission carrier.

## Why this is filed separately

These surfaces are **pre-existing**, not introduced by the steps 3-4 change. But they mean
the `Deref`-containment argument in LLP 0285 §8 risk 3 is incomplete as written: removing
`DerefMut` is necessary and not sufficient. LLP 0285 should be amended, and the LLP 0284
gate property for Deref containment must inspect shared-borrow effects, not just
return types and mutability.

## Provenance

Independent codex `gpt-5.6-sol` review of `c963a5bcb`, verified against the tree.

## Acceptance

- Each listed surface either requires an authority-bearing carrier, becomes `pub(crate)`
  with an authority-deriving `ServingDatabase` method, or is documented as intentionally
  unprivileged with the reason.
- LLP 0285 §8 risk 3 amended to state that `DerefMut` removal is not sufficient.
- The LLP 0284 Deref-containment property covers `&self` effects.
