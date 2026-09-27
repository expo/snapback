# Demo-kit servers orphaned when the test parent exits without a signal

- **Opened:** 2026-09-26, from a process audit of the Office M1 (the LLP 0175
  local-proof backstop host).
- **Area:** `demos/_kit/server-process.mjs` (`ownProcessTree`),
  `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`.
- **Severity:** Medium. Nothing fails, but every affected run leaks a live
  server process and a temp store, and a backstop host accumulates them
  indefinitely.
- **Resolved:** 2026-09-26, in the same commit as this ticket (see Fix).

## What happened

The Office M1 held 71 `snapback start` processes spawned from
`~/.snapback-local-proof-backstop/repo/target/debug/snapback`, aged 15 hours to
28 days, every one re-parented to launchd (PPID 1). There were also 169
`$TMPDIR/snapback-offline-accept-*` entries. No backstop run was in progress. The
servers came in pairs about 2 s apart: a `--memory` server and a
`--db $TMPDIR/snapback-offline-accept-*/dashboard.db --port <fixed>` server. That
is roughly two per six-hourly backstop run.

Gate timeouts are not the cause. The backstop log records only a handful of
`SNAPBACK_PROOF_GATE_TIMEOUT` lines over its lifetime, far fewer than the leaks.

## Root cause

Reproduced on that host by running
`node demos/public-dashboard/tests/acceptance/offline-local-first.mjs` alone:
it exits 1 and leaves its `--db` server running under PPID 1.

1. The test booted its server at top level and called `ensureApp` **before**
   registering `server.stop()` as a cleanup and before `runAcceptance`. On that
   host provisioning is refused (`SNAPBACK_CAPABILITY_UNSUPPORTED: function
   dashboardMetrics requires capability single_table_v1`, a separate standing
   red), so node died on an uncaught rejection.
2. `startServer` spawns the server `detached` (its own process group), so the
   parent's death does not reach it.
3. `ownProcessTree` handled SIGINT and SIGTERM only. An uncaught throw or a
   bare `process.exit()` runs no async teardown, so nothing stopped the group.
4. The test never removed its `mkdtemp` state dir, or the
   `<dir>.snapback.restore.lock` instance reservation the server keeps beside
   it (`crates/snapback-kernel/src/instance_lock.rs`), even on success.

The `--memory` half of each pair was not traced to a specific test. Any
kit-owned server whose parent crashes follows the same path, and the fix below
covers them all.

## Fix

- `demos/_kit/server-process.mjs`: `ownProcessTree` records each owned child and
  installs one synchronous `process.on('exit')` hook. At exit, the hook
  SIGKILLs the process group of every tree still owned, meaning any tree whose
  `stop()` has not settled. It is a last resort. It does not replace the
  attested `stop()` proof, which remains the normal path. The hook also covers
  `chrome-process.mjs` and the other `ownProcessTree` callers.
- `offline-local-first.mjs`: provisioning moved inside `runAcceptance`, so a
  refusal is a reported setup failure that still runs the cleanups. The state
  dir and its restore lock are registered as the first cleanup, so they run
  last.
- `demos/_kit/tests/server-process-lifecycle.mjs`: a crash-mode fixture parent
  starts an owned server with a TERM-resistant descendant, then either throws
  uncaught or calls `process.exit(3)`. The test asserts the exit code and that
  neither process survives. Mutation check: with the exit hook disabled, the
  suite fails at `throw owner leaves no server leader`.

Verified on the Office M1 with the patched files: the same failing run now
exits 2 with `SETUP FAILURE … SNAPBACK_CAPABILITY_UNSUPPORTED`, leaves zero new
servers, and adds zero new temp entries. The 71 orphans and 169 temp entries
already there were removed by hand.

## Not fixed here

- The `SNAPBACK_CAPABILITY_UNSUPPORTED` refusal of `dashboardMetrics` on the
  backstop host is a separate red.
- Windows: the exit hook signals only the leader pid (`process.kill(pid)`),
  because the kit's Windows tree kill (`taskkill /T`) is asynchronous.
