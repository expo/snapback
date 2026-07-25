# Kit: watchdog the server child after readiness

**Status:** Open
**Severity:** P2
**Systems:** Local server lifecycle, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** demos/_kit/server-process.mjs, expo-jam-allaboard issues/0007
**Marker:** all-aboard-external-review

`demos/_kit/server-process.mjs` monitors the child's exit only during
the startup window (`:236-255`, throwing "exited before verified
readiness"). After readiness verifies, the returned handle
(`serverHandle`, `:304-323`) carries no exit listener, no health
re-probe, and no restart policy — a child that dies mid-session leaves
the handle (and any wrapper built on it) alive and lying. The All Aboard
external review observed exactly this once (expo-jam-allaboard
`issues/0007`): the child died silently and the arm's control wrapper
kept answering 500 `{ok:false}` on every request. Kit test coverage
confirms the gap — `demos/_kit/tests/server-process-lifecycle.mjs:373-400`
asserts only pre-readiness exit reporting.

Proposed: attach an `exit`/`close` listener after readiness that (a)
marks the handle dead so subsequent use fails fast with a typed
diagnostic instead of connection errors, (b) surfaces the event to the
caller (callback or exposed state) so wrappers can exit non-zero or
restart, and (c) makes `stop()` on an already-dead child report that
fact rather than attesting a clean teardown. Restart-on-death can stay a
caller policy; detection belongs in the kit so a dead backend can never
masquerade as a live one during acceptance.

**Done when:**

- The kit detects post-readiness child death and exposes it on the
  handle (state + notification), with a typed diagnostic on further use.
- A lifecycle test kills the child after readiness and asserts
  detection, fail-fast behavior, and honest `stop()` reporting.
- At least one demo wrapper consumes the signal (exit non-zero), closing
  the loop the external review asked for.
