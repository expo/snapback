# Fork clone/scrub connections do not honor LLP 0188 persist-WAL

**Opened:** 2026-08-12 · **Severity:** P2 (correctness; fork/replication divergence) · **Area:** instance fork / replication

## What

Replication requires every Snapback connection to set persist-WAL because close-time checkpoint/unlink is connection-local. The serving writer, reader pool, and registered system writers do this when replication is on (`src/replication.rs:114-127`, `src/storage/connections.rs:381-384`).

`src/instance_fork.rs` has **zero** `replication` / `persist_wal` references. The production clone opens a short-lived `Connection::open` and runs `Backup::run_to_completion` (`src/instance_fork.rs:4766-4772`). `sync_sqlite_set` runs `PRAGMA wal_checkpoint(FULL)` on whatever connection it is given.

A fork of a **stopped** G2 instance is often the last opener. Close without persist-WAL checkpoints into the main file and may unlink `-wal` that LTX’s sidecar still names. A live parent is safer (other connections remain) but a source `wal_checkpoint(FULL)` still moves the replica frontier under LTX.

## Why it matters

Fork/replication divergence: parent restore/replica position no longer matches files. The module already warns about this class of bug for coverage-receipt writes (`src/instance_fork.rs:2008-2011`) and then omits the same discipline on clone/scrub.

## Fix

If `replication::configured_from_env()`, call `configure_connection_wal_lifetime` + `wal_autocheckpoint=0` on every fork opener of a live/replicated parent; refuse or copy via the serving connection; never `wal_checkpoint(FULL)` a replicated parent from a short-lived handle.

## Confidence

High on the missing persist-WAL. Pair with `issues/20260810-llp-0188-g2f-fencing-matrix.md`; that ticket is the G2f program, not this fork-opener hole.

## Resolution (2026-08-12)

`src/instance_fork.rs` now routes every production SQLite opener through one
replication-aware helper. When `SNAPBACK_REPLICATION_TARGET` is configured,
each backup, scrub, inspection, diff, asset-cut, and retained-base connection
sets connection-local persistent WAL and disables auto-checkpoint. The two
fork-owned `wal_checkpoint(FULL)` paths now run only when replication is not
configured; the replicated-parent copy remains SQLite's online-backup snapshot.

LLP 0188 §2 now records the fork-path obligation, and the code carries an
`@ref` to that section. No refusal path or new `SNAPBACK_*` code was needed.

Verification:

- `cargo test --test instance_fork_replication_wal_v0`: 1 passed, 0 failed.
- `cargo test --lib instance_fork::tests`: 52 passed, 0 failed.
- `cargo test --lib replication::tests`: 8 passed, 0 failed.
- targeted storage connection test: 1 passed, 0 failed.
- `cargo test --test shutdown_wal_checkpoint_v0`: 4 passed, 0 failed.
- `./ref-check --verbose`: 251 LLP docs, 5,110 refs, 0 errors, 0 unchecked.
- `cargo test --lib -- --quiet`: 2,629 passed, 2 failed, 2 ignored. Both
  unrelated timing-envelope failures pass in exact isolation; merge base for
  the pre-existing classification is `b5b5d2d5b931634a718a72aba44a3dbd7e39ac09`.
