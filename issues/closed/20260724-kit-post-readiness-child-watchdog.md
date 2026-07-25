# Kit: watchdog the server child after readiness

**Status:** Resolved (2026-07-25)
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

## Resolution (2026-07-25)

Implemented in `demos/_kit/server-process.mjs`:

- After verified readiness, `armChildWatchdog` subscribes to the leader's
  existing close tracker. An exit is classified against a `stopRequested`
  flag set at the start of the owned teardown action, so explicit
  `stop()` and the parent-signal owner both count as expected; anything
  earlier is an unexpected post-readiness death. Pre-readiness exits stay
  the startup loop's "exited before verified readiness" diagnostic — the
  watchdog only arms on success.
- Exposed state and notification: `handle.exit` (`null` while alive, then
  frozen `{ code, signal, expected }`), a `startServer({ onUnexpectedExit })`
  option, and `handle.onUnexpectedExit(listener)` (late subscribers fire
  immediately; returns unsubscribe). Unexpected death also prints a loud
  `SNAPBACK SERVER DIED:` line with a bounded tail of the child's output.
  Reused handles have no owned child; their `exit` stays `null`
  (documented in `demos/_kit/README.md`).
- Fail-fast: `handle.assertAlive()` throws a typed error with
  `code === 'SNAPBACK_SERVER_CHILD_DIED'` (carrying `.exit`) once the
  child has exited, instead of letting callers hit raw connection errors.
- Honest stop: `stop()` after an unexpected death still runs the attested
  tree teardown and ready-dir cleanup, then **rejects** with
  `SNAPBACK_SERVER_CHILD_DIED` ("cannot attest a clean shutdown") —
  memoized, so repeated calls report the same verdict. Restart-on-death
  remains caller policy.
- Tests: `demos/_kit/tests/server-process-lifecycle.mjs` kills the fixture
  child after readiness and asserts detection (state, option callback,
  late subscription, loud log), typed fail-fast on `assertAlive`, and the
  honest `stop()` rejection twice; the clean-stop path asserts
  `exit.expected === true` with no unexpected-death callback. Suite: PASS.
- Wrapper consumer: `demos/chat-matrix/dev.mjs` (the one-terminal dev
  environment) now passes `onUnexpectedExit`, tears down its gateway, and
  exits non-zero when the backend dies. The expo-jam-allaboard wrappers
  that motivated the review live in that external repo and can adopt the
  same option when the kit lands there.
