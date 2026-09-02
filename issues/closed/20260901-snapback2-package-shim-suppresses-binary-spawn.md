# snapback2: package shim suppresses binary spawn errors and signals

**Status:** Closed
**Resolution:** Reported spawn errors with the binary path and re-raised child signals in packages/snapback2/bin/snapback2.mjs, with EACCES and SIGTERM coverage.
**Systems:** snapback2, npm shim, CLI
**Severity:** P3
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/snapback2/bin/snapback2.mjs:21-22

Failure scenario: the resolved platform binary exists but is non-executable or mounted noexec. spawnSync returns EACCES in result.error with status null; the shim prints nothing and exits 1. If the binary terminates by signal, the shim also silently converts that signal into exit 1.

Why it happens: the shim reads only result.status and ignores result.error and result.signal, so the actual environment failure is discarded and no downstream diagnostic exists.

Suggested fix: print result.error with the binary path, propagate or conventionally encode result.signal, and reserve the fallback exit only for an otherwise unclassified result. Add non-executable and signaled-child process tests.
