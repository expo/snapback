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

## Open: rusqlite 0.41 (not yet changed here)

`expo/exact` `517a1bef88` (2026-11-12) moved to rusqlite 0.41.1 /
libsqlite3-sys 0.39 for RUSTSEC-2026-0459 (bundled SQLite 3.53.2 can read
uninitialized page-cache bytes on a WAL with a mismatched page size).
snapback4 0.4.53 is on rusqlite 0.40.2, and both link `sqlite3`, so the
adapter's native crate cannot resolve against latest Exact. rusqlite 0.41
also requires `&mut Connection` to install busy, progress, authorizer, trace,
preupdate and WAL hooks, and a `Transaction` gives only `&Connection`; the
program deadline (`store/port/lifecycle.rs`, `store/program_deadline.rs`)
installs its handlers inside a transaction.
