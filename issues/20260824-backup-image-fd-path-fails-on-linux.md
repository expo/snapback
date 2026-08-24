# `backup_database_image_into` cannot open its output descriptor on Linux

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Systems:** Kernel, Engine, Testing
**Date:** 2026-08-24
**Related:** `issues/20260824-linux-build-hosts-for-snapback-crates.md`,
  `crates/snapback-kernel/src/storage/auth.rs`,
  `crates/snapback-engine/src/local/admission_fence_tests.rs`

## Symptom

At `96c168dfc`, `cargo test -p snapback-engine --features test-support admission_fence_tests`:

| Platform | Result |
|---|---|
| macOS (Apple silicon) | **26 passed, 0 failed** |
| Linux (x86_64, Ubuntu 24.04) | **22 failed** of the same 26 |

Every Linux failure is the same panic, from
`crates/snapback-engine/src/local/admission_fence_tests.rs:258`:

```
capture complete database image: SnapbackError { diagnostic: Diagnostic {
  code: "SNAPBACK_SQLITE_ERROR", severity: Error, subsystem: "storage",
  message: "SQLite operation failed",
  details: Object {"error": String("unable to open database file: /proc/self/fd/11")} } }
```

The descriptor number varies per test; nothing else does.

## Where it comes from

`durable_database_image` (`admission_fence_tests.rs:253`) allocates
`tempfile::tempfile()` and calls `backup_database_image_into(&image)`.

That lands in `open_backup_image_connection`
(`crates/snapback-kernel/src/storage/auth.rs:2484`), which deliberately binds SQLite to the
**open descriptor** rather than a pathname:

```rust
#[cfg(target_vendor = "apple")]
let path = format!("/dev/fd/{}", image.as_raw_fd());
#[cfg(target_os = "linux")]
let path = format!("/proc/self/fd/{}", image.as_raw_fd());
```

The intent is documented and worth preserving: *"no rename or symlink in the staging parent
can redirect where SQLite reads or writes."* That is a real anti-TOCTOU property, not
incidental. Any fix must keep it.

The macOS side already carries a workaround for its own quirk of this approach
(`auth.rs:2253`): `/dev/fd/N` is opened read-only for pager writes, so the code copies into a
private in-memory database and serializes that to the pinned descriptor.

## What is verified, and what is not

**Verified:** the two platform results above at the same commit; the failing call site; the
`#[cfg]`-selected path construction; that the descriptor is the *output* image opened
`SQLITE_OPEN_READ_WRITE`.

**Measured and RULED OUT, 2026-08-24.** I ran a probe on the same Linux host against the system
`libsqlite3` and eliminated every hypothesis this ticket originally recorded. All of the
following **succeed**, opening `/proc/self/fd/N` and then actually writing:

| Case | Result |
|---|---|
| Unlinked `tempfile` (path resolves to `/tmp/#30441180 (deleted)`) | OK |
| Named on-disk file | OK |
| `journal_mode` = `delete`, `wal`, `truncate`, `persist`, `memory` — each on its own fd | **all OK** |
| `sqlite3_open_v2` with the repo's exact `SQLITE_OPEN_READ_WRITE \| SQLITE_OPEN_NO_MUTEX` (no `CREATE`), then `CREATE TABLE` + `INSERT` | OK |
| Same, with `SQLITE_OPEN_CREATE` added | OK |
| Same, `PRAGMA journal_mode=wal` before the write | OK |

So on this host, with system SQLite: the deleted-inode theory is **wrong**, and the
journal/WAL-sidecar theory is **wrong**. `/proc/self/fd/N` is fully usable as a SQLite database
path, for unlinked files, in every journal mode, with the exact flags the repo passes.

*(A first version of that probe reused file descriptors after `close()` and produced
`table t already exists` / `database is locked`. Those were artifacts of fd reuse, not results.
The table above is from the corrected probe that holds every file open so no two share an fd.)*

**Still not diagnosed.** The leading remaining candidate is that **rusqlite does not use the system
SQLite**. If it is built with the bundled amalgamation, that is a different library with different
compile-time options from the one probed above, and the probe therefore does not exercise the code
that actually fails. Check `rusqlite`'s features in `Cargo.toml` first, and re-run the equivalent
probe against the bundled build before looking anywhere else.

Two lesser candidates, untested: the failing open may not be the output image at all but another
open in the same chain (the code copies into an in-memory database and serialises to the pinned
descriptor, so there is more than one); or the descriptor may not be live at the point of use.

## Why it matters

- The engine admission-fence suite — 22 security-relevant tests asserting that retired epochs
  are refused *without* durable effect — **has apparently never run on Linux**.
- The repo ships a `snapback-runtime-linux-x64` package, so Linux is not a hypothetical target.
- It blocks using Linux build hosts for the full `snapback-engine` suite, which otherwise work
  well (509 of 531 pass there).

## Scope note

This is a **portability defect in a kernel API**, not a test bug. `admission_fence_tests` is
just the caller that exposed it. Other callers of `backup_database_image_into` should be
checked before assuming the blast radius is the test suite.

No product behaviour on macOS is implicated, which is why urgency is low and impact is not.
