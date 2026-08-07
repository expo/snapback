# SNAPBACK_AUTH_STREAM_RESET flake (~50%) on fresh anonymous clients at server boot

**Status:** Resolved (2026-08-07)
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Auth, Server lifecycle, Client transport
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Immediately after server start, fresh anonymous clients' first
`prepareReactBinding`/`liveQuery` fail with `SNAPBACK_AUTH_STREAM_RESET`
roughly half the time; bounded retries mask it. A boot-ordering race
(auth stream authority not yet settled when the listener admits
connections?). Cold agents read it as their own bug first — expensive.
Fix shape: gate readiness (the ready-file) on the auth stream being
admittable, or classify the refusal as retryable-with-hint.

## Resolution (2026-08-07)

**The boot-ordering suspicion was disproved.** `run_composed` (src/cli.rs)
settles every auth authority — coordinator build, invalidation boot issuer,
expiry-worker handshake — strictly before `bind_listener`, and the ready file
is written after bind. The listener never admits a connection before the auth
stream authority exists.

**Actual mechanism (reproduced deterministically, 20/20).** Function manifests
are process-memory-only, so the CLI dev loop re-provisions on every boot
*after* the port is already answering: `start` → ready → `loadGenerated`
(schema, functions, then a versioned **seed reset**). The reset premarks and
rotates the authorization stream (LLP 0059). A fresh anonymous client whose
`POST /connection/open` overlaps that window resolves its anonymous fenced
publication before the premark and is refused at the response-publication
fence — `stale_prepared_authority` (src/server.rs, anonymous `_` arm), called
from the auth middleware — as a bare 401 `SNAPBACK_AUTH_STREAM_RESET` with
`details: {}`. The client classifies that code as terminal and surfaces it on
the app's very first operation. The ~50% wild rate is the app's
connect-time distribution straddling the reset window; it recurs on every
schema-change reset, so server-side readiness ordering cannot close it.

Repro loop (kit client, first `/connection/open` racing an in-flight seed
reset): 20/20 iterations failed `SNAPBACK_AUTH_STREAM_RESET` before the fix,
20/20 succeeded after (loops in the session scratchpad,
`boot-flake-repro-f.mjs`; sequential non-overlapping variants b/d/e all pass
before and after, confirming the window is the only failing shape).

**Fix (the ticket's retryable-with-hint shape, since the window is genuinely
unorderable).** Commit b4c572d01:

- Server: the two anonymous-class stream-reset refusals
  (`stale_error_at` `Anonymous` arm, `stale_prepared_authority` `_` arm in
  src/server.rs) now carry typed
  `details: { authorityDisposition: "carrier", retryable: true, cause:
  "stream_replaced" }`. Anonymous authority is always re-establishable by a
  fresh handshake, so the hint is honest; the LLP 0059 publication fence
  (predecessor capture never publishes under the successor stream) is
  unchanged, and session/service arms keep their distinct codes untouched.
  Old clients parse the widened details as disposition `carrier`, which is
  already the anonymous default.
- Client (`@expo/snapback-client`): exactly one bounded internal retry of the
  full connection-open negotiation ladder (250 ms delay) when the refusal
  carries the typed hint, plus the existing refresh-once seam in `#withGrant`
  (previously `SNAPBACK_CONNECTION_TOKEN_INVALID` only) now also engages for
  the hinted refusal. A second failure surfaces unchanged; unhinted refusals
  are never retried.
- Tests: `packages/snapback-client/connection-open-stream-reset-retry.test.mjs`
  (retry-once success, no-hint no-retry, bounded two-attempt surface,
  `#withGrant` refresh path; registered in the package test chain and
  `scripts/check-package-test-inventory.mjs`, 229 → 230), plus Rust
  assertions: `anonymous_stream_reset_refusal_is_retryable_carrier` and the
  extended `prepared_connection_act_loses_to_concurrent_stream_premark`
  (refusal during a live premark carries the typed hint).

Follow-up worth noting for the dev-loop layer (not done here): the CLI could
shrink — not close — the window by provisioning before announcing readiness;
apps polling the fixed port would still race schema-change resets, which is
why the typed-retry shape is the durable fix.


## Additional evidence (Lane B, 2026-08-07)

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Auth, Server lifecycle, Client transport
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

2026-08-07 additional evidence (declarative-mutation-misroute lane): the
same boot window also surfaces as `SNAPBACK_AUTH_MODE_PENDING` (503) on
`authRequestCode` and on mutations, `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`
/ `SNAPBACK_AUTH_TRANSITION_FAILED` /
`SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH` on the mint-and-exchange
sequence, and transient `SNAPBACK_AUTH_REQUIRED` (401) on mutations for
several seconds after the ready-file reports ready in sessions mode. All
are order-independent and hit JS and declarative mutations equally
(swapped-order probe runs). Strengthens the ready-file-gating fix shape:
readiness should cover auth-mode settlement, not just the listener.

