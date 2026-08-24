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

**Not verified — do not treat as diagnosed:** *why* Linux rejects it. Two plausible causes,
untested:

1. `tempfile::tempfile()` unlinks immediately, so `/proc/self/fd/N` resolves to a path marked
   `(deleted)`.
2. SQLite derives sidecar paths from the database path, and cannot create
   `/proc/self/fd/N-journal` or `-wal` under `/proc`.

Cause 2 would also explain why a plain read of the same path is not what fails. Whoever picks
this up should establish which it is before choosing a fix — the two lead to different
answers, and the macOS in-memory-then-serialize workaround suggests the sidecar theory is
worth checking first.

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
