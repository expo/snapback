# Snapback 4: store ownership's `flock` on the SQLite file breaks `dev` and devices on macOS and iOS

- **Opened:** 2026-09-27, by the 0.4.4 publication's native witness on the M5.
- **Severity:** Release blocker for 0.4.4 (not published; npm is still 0.4.3).
  On `main` since `0cca900d8`, `snapback4 dev` on macOS loops forever on
  "startup schema adoption failed: E_STORE: database is locked".
- **Area:** `crates/snapback4/src/store_owner.rs` (`acquire`),
  `crates/snapback4-core/src/store/ownership.rs` (`Store::open_shared`).

## Cause

Lane R (LLP 3000.019 §3.4) fences ownership with `flock` on the database
file itself: exclusive for backend commands, shared for devices, including
the native C ABI open used by the Expo app. On Linux `flock` and SQLite's
POSIX `fcntl` locks are independent. On Darwin they conflict, even within
one process. A Python process holding a shared `flock` on a file cannot
commit an SQLite write to it ("database is locked"). Every 0.4.4 test ran on
Linux.

## Reproduction (macOS)

`snapback4 init && snapback4 dev --no-watch --port 0` in a fresh directory:
the adoption retry line repeats and the server never becomes ready.

## Fix

Lane OW (`sb4-intent/ow-sidecar`) takes ownership on a sidecar lock file,
`<database>-owner`, and never locks the SQLite file. It keeps the inode
identity checks, made with `stat` alone. The fix is verified on macOS before
0.4.4 publishes.

## Resolution (2026-09-27)

Fixed by lane OW (`fe6b733c2`, merged to `main`): ownership takes its
`flock` on the sidecar `<database>-owner` (exclusive for backend commands,
shared for devices and the native C ABI), never on the SQLite file; the
database's inode identity is checked by `stat` alone, and a missing database
is created and closed before any SQLite connection exists. Verified on macOS
(the M5): a fresh `init` then `dev` becomes ready; ownership 5/5, admission
25/25 (one test compared an unresolved `/var` path; it now compares the
resolved store path), residency 5/5 and native-opening 6/6 pass. Linux: the
lane's full suite passed except two intermittent client tests, one of which
reproduces on the base commit.
