# Published asset blobs are never fsynced: power loss can commit a `Ready` asset whose bytes are gone

**Opened:** 2026-08-08 · **Severity:** P1 (data loss; a durable DB row can reference a truncated/empty blob) · **Area:** assets

## What

`src/assets_store.rs` (`AssetFsStore`)

The staging path is deliberately durable:

```rust
fn append_staging(&self, ...) -> SnapbackResult<()> {
    ...
    .and_then(|()| file.flush())
    .and_then(|()| file.sync_data())   // durable before caller advances
```

But the publish and canonical-rewrite paths are not:

```rust
fn write_canonical(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
    std::fs::write(path, bytes)        // no sync, no temp+rename
}
fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
    if path.exists() { return Ok(()); }
    std::fs::write(path, bytes)        // no sync, no temp+rename, no dir fsync
}
```

Finalize Phase B publishes the blob with `put_blob_idempotent`, verifies the
digest by reading back through the page cache, then Phase C/D commit the `Ready`
transition in SQLite (which *is* fsynced on commit).

## Failure scenario

Kernel panic / power loss after the SQLite `Ready` commit but before the blob's
page-cache writeback reaches disk → a durable DB row references a truncated or
empty blob file. Delivery then fails `UnexpectedEof` ("blob object shorter than
its record", src/server.rs ~21190) forever, and the original staging bytes have
already been deleted. This is the one place in the asset pipeline where "partial
upload committed as complete" can actually happen — the staging path's explicit
durability comment shows the invariant was intended to hold end to end.

## Fix

Write blob objects to a temp name in the blobs dir, `sync_data()`, rename into
place, then fsync the parent directory. Same for `write_canonical`. (The
rename-into-place also removes the current non-atomic overwrite window.)

## Confidence

High on the mechanics; medium that it's unintended — no `@ref`/comment blesses
the gap, and the adjacent staging path's durability comment argues against it
being a decided tradeoff.
