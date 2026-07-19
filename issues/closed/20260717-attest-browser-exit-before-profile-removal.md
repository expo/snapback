# Attest browser exit before removing acceptance profiles

**Status:** Closed
**Severity:** P1
**Systems:** CI, Testing, Demo apps, Browser lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-18
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

## Resolution

All six temporary-profile launchers use `demos/_kit/chrome-process.mjs`. The
shared helper owns the browser process tree, joins explicit and parent-signal
cleanup, attests bounded tree exit before removing the profile, and preserves
the profile with a diagnostic when exit cannot be proven. Startup failures and
normal teardown use the same path. Focused real-process and injected lifecycle
regressions cover ordering, failed attestation, idempotence, Windows spawn
shape, flag ownership, and the repository-wide launcher inventory.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` passed GitHub Actions
all-aboard-cold-clone run `29674515105` on 2026-07-18: registry install,
production Contract build, all 34 browser checks, and attested cleanup completed
successfully in 6m21s.
