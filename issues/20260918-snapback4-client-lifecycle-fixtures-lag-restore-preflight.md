# Client lifecycle fixtures lag restore preflight

**Status:** Open
**Scope:** `snapback4/packages/snapback4/test/client-lifecycle.test.mjs`
**Observed:** 2026-09-18, Repair B fix round 12; incoming client `fb5c8804d` also reproduces the two isolated failures below.

The wider client run has stale test expectations around the restore preflight:

- `emptyDevice` supplies `sync_state` but rejects `observe_store` as an unexpected call. Local reconnect and multiple lifecycle/fallback cases therefore fail before their own behavior is exercised.
- `native: another client sending after sync capture cannot publish an uncorrelated page` expects the obsolete reply to reach `apply`. Current client preflight can reject it at `observe_store`, leaving the test's apply-error slot empty.
- The broader file also reported a pending-write timeout and retained live handles after failures. That timeout is not independently baseline-qualified by the two isolated checks.

The isolated command was run against the final client and the compiled incoming `fb5c8804d` client (same final device binary); both report the same `unexpected device call observe_store` and `no error` assertion. Source comparison puts preflight before apply in the incoming client too. The evidence does not claim every broader failure has been baseline-qualified.

Evidence: `snapback4/target/review-fix12/lifecycle-diagnosis.log`, `lifecycle-incoming.log`, `incoming-client.mjs`, and `client-final.log`. The wider run was terminated after the lifecycle file retained handles; affected Repair B/host tests were rerun separately. Repair the harness without bypassing production head validation, and make failure cleanup release its handles.

Acceptance: the lifecycle file exits normally and its relevant assertions cover preflight and apply at the boundary where the current client actually rejects each stale response. Keep test controls for healthy responses and no stale publication.
