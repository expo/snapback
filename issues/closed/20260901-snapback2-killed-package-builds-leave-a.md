# snapback2: killed package builds leave a permanent lock wedge

**Status:** Closed
**Resolution:** Added dead-PID atomic lock reclamation and token-owned release in packages/snapback2/build.mjs, covered by a killed-child rebuild regression.
**Systems:** snapback2, package build, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/snapback2/build.mjs:169-183

Failure scenario: SIGKILL or host crash occurs after target/b2-package-build.lock is created. Every later package build waits 30 seconds and fails forever until a person manually deletes the lock.

Why it happens: EEXIST handling never reads the recorded PID, checks process liveness or age, or attempts an ownership-safe stale takeover. Process death skips the finally removal, and acquisition itself is outside the try.

Suggested fix: record PID plus a random ownership token, reclaim only demonstrably stale locks atomically, and delete only a lock still carrying the current builder's token. Add a child-process kill/restart test.
