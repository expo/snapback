# P0: fast rollback after crash+reopen republishes the SUCCESSOR manifest as the "restored predecessor"

**Opened:** 2026-08-08 · **Severity:** P0 (data integrity; live manifest ends up describing tables/columns that don't physically exist) · **Area:** storage / migration executor

## What

`src/storage/migration_executor.rs:2399` (`migrate_rollback`), publication at
:2486-2490.

```rust
let predecessor_schema = self.schema.clone();
...
super::auth_mode::publish_manifest_for_migration(
    &tx,
    &serde_json::to_string(&predecessor_schema)...,
)?;
```

Rollback republishes `self.schema` as the predecessor. But at `published-held`
— the exact state fast rollback is gated to (2381-2387) — a **freshly opened
handle loads the SUCCESSOR manifest** into `self.schema`. This is stated
directly in the code's own comment (migration_executor.rs:5922-5926, "a real
reopen at published-held loads the successor manifest") and asserted by the
reopen test (`assert_eq!(reopened.schema(), &successor_schema())`, :5919). The
two `self.schema = successor_schema.clone()` assignments (:1575 terminal-apply,
:2216 release) never make `self.schema` the predecessor for a reopened handle.

The predecessor is unrecoverable from the artifact: the journal persists only
`predecessor_schema_hash` (:2068, :2508), never the predecessor schema **bytes**.

## Reachability

The CLI rollback (`cli.rs` ~15341) opens a fresh handle
(`LocalSnapback::open(&db)`) and calls `migrate_rollback_artifact`. So:

1. `migrate apply` publishes the successor, enters `published-held`.
2. Process crashes (or is restarted) before `migrate release`.
3. `snapback migrate rollback <approved>` opens a fresh handle → `self.schema`
   = successor.
4. `migrate_rollback` physically renames predecessor tables back and NULLs the
   in-place columns — **correct physical restore** — but republishes the
   **successor** manifest bytes as the live "restored predecessor."

Result: the live manifest declares required fields whose columns are now
all-NULL, and tables whose physical shape is the predecessor. Because
ephemeral-room `permissionBacking` can read maintained-projection output tables,
this can also produce wrong authorization decisions.

## Why the tests miss it

Every rollback test uses the same in-process handle (where `self.schema` is
still the predecessor at published-held), never reopen-then-rollback. The apply
path DOES guard this exact mismatch —
`artifact.body.predecessor_schema_hash != schema_identity(&predecessor_schema)`
at :1580 — but the guard is apply-only; the rollback path has no equivalent.

## Fix

Two parts:
1. **Fail closed immediately:** in `migrate_rollback`, refuse when
   `schema_identity(&self.schema) != artifact.body.predecessor_schema_hash`.
   This turns silent corruption into a clean refusal.
2. **Make rollback-after-crash actually work:** persist the predecessor manifest
   bytes at admission (alongside the hash) and republish those bytes, rather
   than trusting `self.schema`.

Add a reopen-then-rollback regression test that asserts the republished live
manifest equals the predecessor, not the successor.

## Confidence

High. Independently verified: the two `self.schema` assignment sites, the
reopen-loads-successor behavior (code comment + test), the absence of any
schema-identity guard on the rollback path, the CLI's fresh-handle entry, and
that only the hash (not the bytes) is persisted. A live reproduction should be
the first step of the fix.

## Resolution (2026-08-08)
Fixed on main (Lane A). Verified: cargo build; migration_executor suite 29 pass; projection activation 3 pass; new regression tests pass; ref-check clean.
