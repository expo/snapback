# Changes since the import

The adapter was imported unchanged from `ccheever/exact47` branch
`chat/snapback4-progressive` at `d4434fe5b7` (pinned to snapback4 0.4.53,
`9da2c76fdf`). Each entry below is one commit on this branch, made while
building an app (Eloq) on the latest `expo/exact` main. Base for every entry:
`expo/exact` `c364ef7a67` (2026-11-13).

## 1. The native slot takes `NativeStorage` (LLP 1154 D3)

Exact's `NativeModule::configure_storage` now receives one `NativeStorage`
instead of three roots. Its `sqlite(path)` admits `sqlite.open` under the
app's grants, creates the roots and reserves the file from Exact's own SQLite
for as long as the returned `SqliteFile` lives.

- `Module::configure_native_storage` keeps the `NativeStorage`; `open` asks it
  for the partition's file and holds the `SqliteFile` in the open partition,
  after the `Device`, so SQLite closes before the reservation ends.
- `sqlite()` creates an absent file empty. An open that must refuse with
  `NEEDS_BACKEND` (no partition yet, no backend sent) removes that empty file,
  so a later open does not take it for a kept partition.
- A Rust source (`DataSource::configure_storage`) still passes roots; that path
  is unchanged.
- Not covered by the adapter's tests: `NativeStorage::new` is private to
  `exact-js`, so the tests still configure roots. The path is exercised by an
  app on macOS and iOS.

## 2. Pinned to the rusqlite 0.41 engine (expo/snapback#25)

`expo/exact` `517a1bef88` (2026-11-12) moved to rusqlite 0.41.1 /
libsqlite3-sys 0.39 for RUSTSEC-2026-0459, and snapback4 0.4.53 was on
rusqlite 0.40.2. Both link `sqlite3`, so the adapter's native crate could not
resolve against latest Exact. expo/snapback#25 moves the engine to 0.41.1;
the adapter's three engine crates are pinned to its commit `fa535e227`
(still version 0.4.53) until it merges and a release carries it.

Checked on `expo/exact` `c364ef7a67` with no local changes: the crate graph
holds one `libsqlite3-sys` (0.39.1), the adapter's Rust tests pass (41) against
a 0.4.53 server, its TypeScript driver tests pass (59, Bun 1.4.2), and an
app's `snapback --rebuild` builds the web device. Re-pin to the release once
one carries the change.
