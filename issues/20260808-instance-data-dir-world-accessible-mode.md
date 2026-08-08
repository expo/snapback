# Instance data directory created world-accessible (mode 0o777, umask-dependent)

**Opened:** 2026-08-08 · **Severity:** P2 (local tamper/DoS on the SQLite data directory) · **Area:** auth / instance_lock

## What

`src/instance_lock.rs:580`

```rust
if unsafe { libc::mkdirat(self.parent.as_raw_fd(), name.as_ptr(), 0o777) } != 0 { ... }
```

The reserved target instance directory is created `0o777` with no chmod and no
mode validation — `ensure_target_identity` (:630) checks only that it is a
directory with the expected inode, never its mode. The adjacent
`create_staging_directory` (:657) does the opposite: `mkdirat(..., 0o700)` then
**validates** `metadata.permissions().mode() & 0o777 == 0o700` (:682), rejecting
anything looser.

## Failure scenario

On a host with a permissive umask (0o000/0o002 — common in containers, CI, some
daemons) the directory holding the SQLite database is created 0o777/0o775. A
local co-tenant can then create/rename files in it (SQLite needs directory write
for its `-wal`/`-shm`/`-journal` sidecars) — pre-plant a sidecar or race a
rename of the DB. Local tamper/DoS on the exact data directory the rest of the
module protects obsessively. Masked to 0o755 under the usual umask 022 (still
world-traversable).

## Fix

Create at `0o700`, or chmod + validate `mode & 0o777 == 0o700` after `mkdirat`,
mirroring `create_staging_directory`.

## Confidence

Medium. No `@ref`/comment justifies 0o777, and the adjacent staging path
deliberately does the opposite — reads as an oversight in an otherwise uniformly
owner-only file-I/O layer.
