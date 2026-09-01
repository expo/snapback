# snapback2: blocked compiler requests orphan the worker process

**Status:** Open
**Systems:** snapback2, owner, compiler worker, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/project.rs:218-262

Failure scenario: the compiler worker accepts a request but never emits a response line. dev --stop waits 500ms for the watcher, detaches the still-blocked thread, and exits; CompilerWorker::drop never runs on that abandoned thread before process teardown, so its Node child remains orphaned. Detached startup timeout also kills only the owner PID.

Why it happens: read_line has no deadline or cancellation. Worker kill/reap exists only in Drop, while watcher timeout and startup timeout do not supervise the descendant process group.

Suggested fix: add a cancellable bounded worker protocol, guarantee watcher join, and launch owner/worker under process-group or parent-death supervision so every stop/startup failure kills and reaps descendants. Extend the slow-worker test to capture and assert the compiler PID exits.
