# snapback2: synchronous journeys bypass the five-second timeout

**Status:** Open
**Systems:** snapback2, test runner, lifecycle
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/test.rs:684-703

Failure scenario: a valid journey body contains while(true){}. Node never returns to its event loop, so the JavaScript Promise.race timeout cannot run. Rust waits forever in Command::output, the isolated owner is not stopped, and snapback2 test never completes.

Why it happens: the only deadline is an in-process setTimeout at snapback2/packages/snapback2/src/test.ts:53-64. The parent supplies no process deadline, output cap, process-group kill, or reap path. A leaked active handle can likewise keep the runner alive after an async check.

Suggested fix: spawn and supervise the runner with a hard host deadline per journey, bounded stdout/stderr, and process-group kill/reap, while closing tracked clients in JavaScript finally blocks. Add synchronous-loop and leaked-handle tests.
