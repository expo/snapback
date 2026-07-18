# Drain startup diagnostics and own signal-time server cleanup

**Status:** Closed
**Severity:** P1
**Systems:** Acceptance testing, CI, Local server lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0010 §Required Tool Surfaces; LLP 0015 §Acceptance Rules; ENG-24378
**Marker:** acceptance, diagnostics, signals, process-lifecycle

The shared demo launcher checked a child's `exitCode` before its `close` event.
Node can observe process exit while inherited stdout or stderr remains open, so
the launcher could freeze its bounded startup log before a final diagnostic
tail arrived. Cleanup then terminated the remaining process group, permanently
discarding the evidence needed to diagnose a pre-readiness failure.

The helper also detached every spawned server into its own process group but
owned that group only through the returned `stop()` callback. If a test parent
received SIGINT or SIGTERM before ordinary cleanup, Node's default signal
behavior terminated the parent immediately and left the detached server tree
running.

**Done when:**

- A child that exits before readiness gets a bounded close/stdio-drain window
  before the already-bounded startup log is snapshotted.
- A deterministic fixture proves a diagnostic written after leader exit is
  retained in the thrown startup error.
- All live shared-server handles use one parent signal owner for SIGINT and
  SIGTERM, without accumulating one listener pair per server.
- Signal cleanup routes through the same strict, idempotent process-tree stop
  operation as explicit cleanup and reports every rejection before termination.
- The original parent signal is re-delivered only after cleanup settles.
- A subprocess fixture proves SIGINT and SIGTERM both preserve signal
  termination and leave neither the server leader nor a TERM-resistant
  descendant alive.
- If another runner listener absorbs a re-delivered signal, ownership state is
  released so a later server and signal receive a fresh cleanup generation.

## Resolution

Closed 2026-07-17. Pre-readiness exit now awaits the child process's existing
close tracker for a bounded one-second drain before formatting the bounded log;
when the drain itself times out, the error says the log may be incomplete. The
lifecycle fixture holds inherited stderr open past leader exit, writes a late
tail, and proves that tail appears in the startup exception.

`startServer` now registers each launched child with a module-level signal
owner. The owner installs only one SIGINT/SIGTERM listener pair, drains every
owned server through the existing `stopChild` proof, aggregates cleanup
rejections rather than treating them as success, and then re-delivers the
original signal. Explicit `stop()` remains idempotent and continues to reject
unchanged on cleanup failure. A disposable parent fixture covers both signals
against a server group containing a TERM-resistant descendant.

Signal shutdown is generation-scoped and releases its latch before
re-delivery. This matters when a larger test runner already has a listener and
intentionally keeps the parent alive: a second owned server re-installs the
shared handlers, and a later signal performs full tree cleanup instead of being
misclassified as a force-exit repeat. A two-generation subprocess regression
proves both resistant process trees are gone while the pre-existing listener
absorbs both re-delivered signals.

Verified with:

- `volta run --node 24.18.0 -- node demos/_kit/tests/server-process-lifecycle.mjs`
- `node --check demos/_kit/server-process.mjs`
- `node --check demos/_kit/tests/server-process-lifecycle.mjs`
- `git diff --check -- demos/_kit/server-process.mjs demos/_kit/tests/server-process-lifecycle.mjs`
- `./ref-check --verbose`
