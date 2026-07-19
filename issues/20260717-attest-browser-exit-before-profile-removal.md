# Attest browser exit before removing acceptance profiles

**Status:** In Progress
**Severity:** P1
**Systems:** CI, Testing, Demo apps, Browser lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0015 §Acceptance Rules; LLP 0010 §Test Surfaces and Harness; GitHub Actions run 29636498866
**Marker:** chrome, cleanup, process-tree, cold-clone, acceptance

The All Aboard cold-clone proof passed all 34 browser assertions, then failed
teardown with `ENOTEMPTY` while recursively removing Chrome's temporary profile.
The launcher delivered `SIGKILL` to the browser leader and immediately removed
the directory, but signal delivery is not process-exit evidence: Chrome or one
of its descendants could still create files during the recursive removal.

The same copied launcher shape appears in other browser acceptance suites. A
one-file retry would leave those suites exposed to the same teardown race and
would also leave startup-failure cleanup outside the shared acceptance
lifecycle invariant.

**Done when:**

- Acceptance browsers run in an owned process tree on platforms that support
  process groups.
- Cleanup uses the shared bounded cross-platform process-tree shutdown and
  removes the profile only after exit is attested.
- Failure to attest exit fails cleanup and leaves the still-live profile alone.
- Browser startup failures also stop the owned tree before removing the
  partially initialized profile.
- Every repository launcher that owns a temporary Chrome profile uses the
  same helper, and focused tests pin shutdown-before-removal ordering.
- The All Aboard cold-clone workflow passes remotely.

## Implemented; remote verification pending

All six temporary-profile launchers now use `demos/_kit/chrome-process.mjs`.
The shared launcher creates a detached POSIX process group, registers its
leader-close tracker immediately, joins explicit and parent-signal cleanup onto
one idempotent promise, and awaits the existing bounded `stopChild` tree proof
before removing the profile. Synchronous spawn failure, asynchronous spawn
failure, premature exit, and readiness timeout all cross the same cleanup; an
unattested exit preserves and reports the profile path.

The helper owns `--user-data-dir` and `--remote-debugging-port` and rejects both
`--flag=value` and split override forms before creating a profile. The admin CSP
and update-economy runners retain every cleanup failure and aggregate it with
any primary failure; update-economy can reach its explicit exit 0 only after
that failure combiner returns cleanly.

The focused lifecycle proof uses real detached leader/descendant fixtures for
POSIX success, timeout, and premature-exit paths. Dependency-injected cases pin
`stopChild` completion before profile removal on both normal and startup
cleanup, profile preservation on failed attestation, Windows-shaped spawn
options, lifecycle-flag refusal, idempotent stop, and the repository-wide
single-launcher inventory. Remote cold-clone verification remains pending.
