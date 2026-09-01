# snapback2: pre-spawn test failures leak isolated owner scratch state

**Status:** Closed
**Resolution:** Installed OwnerCleanup before the first scratch mutation in crates/snapback2/src/test.rs, with injected copy/link/executable/spawn failure coverage.
**Systems:** snapback2, test runner, resource handling
**Severity:** P3
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/test.rs:254-288

Failure scenario: copying an unreadable project source, creating the store link, resolving the executable, or spawning the owner fails after .snapback/test-run-<stamp> or test-<stamp>.sqlite has been created. start returns immediately and leaves those paths behind.

Why it happens: OwnerCleanup is constructed only after Command::spawn succeeds at lines 268-284. Every fallible filesystem operation before that point has no RAII owner and no explicit error cleanup.

Suggested fix: create a cleanup guard with child=None before the first scratch/store mutation, attach the child after spawn, and make every return path idempotently clean both paths. Add injected failures at copy, link, executable, and spawn stages.
