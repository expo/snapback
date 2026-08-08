# Server SIGTERM shutdown strands the SQLite -wal sidecar at multi-GiB scale

**Opened:** 2026-08-07
**Area:** server shutdown path (`src/cli.rs` `shutdown_signal` → connection close order), SQLite WAL lifecycle
**Severity:** P2 — data is safe (db+wal remain a consistent SQLite state), but shutdown does not deliver a checkpointed single-file store at scale

## Observed

Two contrasting facts on the same binary (f4d4d8c18 debug build, macOS arm64):

1. **Small store:** `snapback start` against a fresh db, then SIGTERM —
   `-wal` and `-shm` are removed cleanly on exit (probe recorded in the
   supervising session; sidecars present during run, gone after SIGTERM).
2. **Large store:** the Zerobugs zb5-hot gate's paused baseline — a
   ~12 GiB store immediately after the 5,549,113-row / 6,176-batch
   acceptance ingest — SIGTERM'd via the kit. The server exited within
   seconds (the whole pause + downstream failure took ~9 s of wall clock)
   **leaving the `-wal` sidecar behind**. Raising the kit's SIGTERM→SIGKILL
   grace from 3 s to 600 s changed nothing: the process exits fast without
   completing/removing the WAL, so no kill escalation is involved.

Receipts: `demos/zerobugs/evidence/snapback-control-hot.zb5.v1.json` and
`.v2.json` (both preserved FAILs of `fresh-precycle-reset-is-byte-provable`
on `paused baseline has no SQLite -wal sidecar`).

## Why it matters

Anything that treats the closed db file as the complete committed state —
byte-provable clones, backup/copy flows, digest-based receipts — silently
loses whatever lives in the stranded WAL unless it knows to fold it. The
zb5-hot gate now folds the strand explicitly (`PRAGMA
wal_checkpoint(TRUNCATE)` on the paused pair, disclosed in the receipt as
`shutdownWal`), and the v3 receipt records the stranded WAL's byte size —
useful for diagnosing which of the candidate mechanisms below is real.

## Candidate mechanisms (undiagnosed)

- A long-lived `query_only` reader connection (`src/storage.rs:11149`
  posture) pinning the WAL so the closing writer's passive checkpoint
  cannot complete, combined with connection-close ordering at process exit.
- Checkpoint starvation during the 66-minute ingest (readers holding
  snapshots) growing the WAL far beyond `wal_autocheckpoint`'s reach, with
  the shutdown path not performing a final blocking checkpoint.
- Tokio task teardown dropping pool connections on threads whose
  destructors never run once the graceful-shutdown future resolves.

## Ask

On graceful shutdown, after the listener drains: close every SQLite
connection in an order that lets the last close run a blocking
`wal_checkpoint(TRUNCATE)` (or perform one explicitly), so a SIGTERM'd
server always leaves a single-file store. A shutdown that cannot complete
the checkpoint within its own bound should say so on stderr rather than
exiting silently.

Found by LLP 0183 Stage 0.5 Lane 8 (zb5-hot). The control's fold-and-
disclose workaround is in
`demos/zerobugs/control/tests/acceptance/gates/zb5-scale-support.mjs`
(`foldStrandedWal`).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution

**Resolved:** 2026-08-08

### Mechanism diagnosed

Candidate 1 was right, with a sharper cause than the ticket guessed, and it has
nothing to do with WAL size or ingest duration:

`LocalDatabase` (`src/storage.rs`) declares its writable `conn` as its **first**
field and `reader_pool` several fields later, so Rust drops the writer while the
pool's retained idle `query_only` connections are still open. A WAL-mode SQLite
connection that has actually read a page holds a SHARED lock on the database
file until it closes, so the closing writer cannot take the EXCLUSIVE lock its
close-time checkpoint requires: it silently skips the checkpoint and leaves the
sidecars. The `query_only` readers that close last can neither checkpoint nor
unlink them. Nothing in `src/cli.rs`'s teardown after
`serve_with_graceful_shutdown` resolved closed a connection or checkpointed
anything.

That explains the small/large contrast exactly, and it is a *traffic* threshold,
not a scale threshold: a server that never served a read has an empty pool, so
its writer *is* the last closer and the sidecars vanish cleanly. One `GET
/health` is enough to strand the WAL — `ReadLane::health` checks out a pooled
reader and reads `_snapback_version`. Reproduced at process level in ~10 s on a
few-hundred-KiB store; no 12 GiB ingest needed.

Candidates 2 and 3 are not implicated: raising the SIGTERM→SIGKILL grace changed
nothing in the original report because the process was never trying to
checkpoint, and the reader-pool connections are ordinary struct fields, not
tokio-task-owned resources.

### Fix

- `ReaderPool` gained a `closing` flag plus `close_for_shutdown()`, which drains
  and closes every retained idle reader; a late check-in after the drain closes
  its connection instead of re-pinning the WAL.
- `LocalDatabase::shutdown_checkpoint(bound)` closes the pool, then runs a
  bounded blocking `PRAGMA wal_checkpoint(TRUNCATE)` on the writer, then
  `PRAGMA journal_mode = DELETE` — which is what actually unlinks `-wal`/`-shm`
  while the writable connection is still open. `LocalDatabase::configure` re-
  enters WAL on every file-backed open, so the mode switch is not durable state
  loss. It returns a non-panicking `ShutdownCheckpointReport`.
- `WriterAuthorityV1` gained a scoped `enter_shutdown_maintenance()` token (same
  shape as `enter_internal_schema_maintenance`) so the armed SQLite authorizer
  admits exactly those two shutdown pragmas and nothing else — no new
  `LocalWriterLaneV1` variant.
- `src/cli.rs` runs the checkpoint after the workers abort and before the
  database lock is released, on every exit reason, bounded by
  `SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS` (default 30 s). The writer-mutex
  acquisition carries the same bound so shutdown can never hang. Anything short
  of a single-file store prints
  `SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE: <detail>` on stderr.
- LLP 0003 §Server Responsibilities records the now-implemented contract.

### Evidence

`tests/shutdown_wal_checkpoint_v0.rs`, 4 tests, on macOS arm64 debug:

```
running 4 tests
test a_blocked_checkpoint_reports_on_stderr ... ok
test plain_drop_strands_the_wal_only_once_the_reader_pool_is_warm ... ok
test pooled_readers_no_longer_strand_the_wal_on_shutdown ... ok
test sigterm_leaves_a_single_file_store ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.61s
```

The process-level test is genuinely red without the fix — with only the
`src/cli.rs` hook stashed out and everything else identical:

```
test sigterm_leaves_a_single_file_store ... FAILED
thread 'sigterm_leaves_a_single_file_store' panicked at tests/shutdown_wal_checkpoint_v0.rs:291:5:
WAL survived SIGTERM
```

`a_blocked_checkpoint_reports_on_stderr` holds a genuinely pinned external read
snapshot across SIGTERM with a 500 ms bound and asserts the stderr diagnostic, so
the "say so rather than exit silently" half is proven, not assumed.

Also green: `cargo test --lib storage::` (341 passed), `--test host_ops_v0`
(12 passed), `--test admin_reachability_v0` (1 passed), `./ref-check --verbose`
(0 errors), `node scripts/check-inventories.mjs` (PASS). `cargo clippy
--all-targets -- -D warnings` fails only on a pre-existing
`clippy::type_complexity` red in `src/instance_fork.rs:124` that this change does
not touch (ticketed separately).

Not run here: the multi-GiB Zerobugs zb5-hot qualification. The mechanism is
scale-independent and reproduced at small scale, but the large-store receipt is
the honest confirmation and has not been re-minted.

### Follow-up for the Zerobugs control

The kit's `foldStrandedWal` workaround in
`demos/zerobugs/control/tests/acceptance/gates/zb5-scale-support.mjs` can retire
once a zb5 run on a binary carrying this fix records `shutdownStrandedWal:
false`. Nothing under `demos/zerobugs/` was modified here — its receipts are
frozen, and retiring the workaround should happen with the run that proves it
unnecessary.
