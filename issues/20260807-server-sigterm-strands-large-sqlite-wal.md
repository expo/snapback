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
