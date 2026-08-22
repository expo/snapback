# Agent auth-transition residuals around reload and ephemeral settlement

**Status:** Closed
**Opened:** 2026-08-20 (split from the duplicate open copy of
`20260815-agent-lifecycle-auth-seams.md`)
**Systems:** Client auth coordinator, Live queries, Ephemeral state, Dev loop
**Related:** LLP 0059; LLP 0227;
`issues/closed/20260815-agent-lifecycle-auth-seams.md`;
`issues/closed/20260815-headless-auth-churn-stalls-backend.md`;
`issues/closed/20260820-optional-user-live-query-auth-transition-stall.md`;
`issues/closed/20260820-authenticated-query-signed-out-settlement.md`

## Why this ticket was opened

The original Clique 0.1.21 client-lifecycle findings are closed: sequential
logout joins the authority barrier, mounted React consumers re-admit without
an app remount, and `closeAuth()` drains realtime demand. A later investigation
appended three different residuals to an open duplicate of that closed ticket.
Those residuals remained independently actionable and are preserved here.

## Residuals

1. **Transient `SNAPBACK_AUTH_MODE_PENDING` clears custody.** The client calls
   `clearAuthSession()` when a request sees the watch-reload refusal, even
   though the mode transition is normally retryable and measured in seconds.
   A signed-in headless client can therefore lose its session merely because
   it touched the backend during a reload window.
2. **`SNAPBACK_AUTH_MODE_PENDING` is live-stream terminal.** A routine dev
   reload terminates live streams rather than projecting a bounded transition
   and successor, compounding the custody loss above.
3. **Post-signin ephemeral authority can lag signin settlement.** A live query
   started immediately after awaited password signin intermittently refused
   with `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING` (3 observations in roughly 200
   signin-to-subscribe sequences); a 250 ms retry cleared each occurrence.

## Requested repair

- Treat transient mode-pending as retryable transition state, not evidence that
  durable custody is invalid.
- Define and test the live-stream successor behavior through a watch reload;
  do not silently preserve stale-authority frames.
- Make awaited signin settle only after ephemeral authority is usable, or have
  the client absorb the bounded successor wait.
- Add tight-loop and watch-reload witnesses through the packed client surface,
  including a no-custody-loss assertion.

## Exit

A signed-in client survives an ordinary watch reload without losing custody;
its live resources settle or rebuild with an explicit state; and an operation
started immediately after awaited signin does not expose an ephemeral-authority
race to application code.

## Residual-1 progress before this resolution (2026-08-21)

The W2 client now treats an axisless finite
`SNAPBACK_AUTH_MODE_PENDING` refusal as reconnecting: it performs a bounded
client-owned retry, does not invoke terminal-auth custody clearing, and
releases/re-enters the authorization-dispatch gate between attempts. A
disposition-bearing occurrence is terminal only with the full
`reason: "mode_transition"` discriminant, so malformed carriers cannot
authorize destructive custody work and a real staged auth-mode transition
still runs the LLP 0059 item-5 path.

`authority-transition-conformance.test.mjs` pins transient, malformed, and
fully discriminated terminal branches and projects the in-flight retry through
the production classifier as `reconnecting`. This closes residual 1.

At that point the coordinator readiness suite's 200 waiters proved the generic
phase-9 signal but were not a real subscribe-after-sign-in ephemeral operation,
and the packed HTTP retry was not a live-stream watch-reload/re-arm witness.
Residuals 2 and 3 consequently remained open for the real evidence now recorded
in the resolution below:

- residual 2 required a real live-stream watch-reload proving the
  predecessor is fenced and exactly one successor reaches an authoritative
  snapshot; and
- residual 3 required a real repeated awaited-sign-in → immediate
  ephemeral subscribe/publish path absorbs the pending window without app-
  visible `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING`.

## Resolution (2026-08-21)

All three residuals are complete. Residual 1 landed earlier on 2026-08-21.
This landing completes residuals 2 and 3:

- A scoped live `resync_required` now fences its predecessor synchronously,
  publishes `connection: "stale"` with retained rows, coalesces duplicate
  transition evidence, and installs exactly one latest successor subscription.
  A second reload scoped to a held installing response retires that response
  before publication and serializes one replacement using the retired id only
  as its supersession witness. Frames addressed to either fenced predecessor
  cannot reach the public update callback.
- The resync cut advances a per-subscription publication generation before
  yielding. Authorization-invalidation and optimistic-presentation tasks carry
  it, so tasks held in either queue cannot commit callbacks after their
  predecessor has been fenced.
- The real sessions dev-loop witness edits the watched functions source while
  an authenticated stream is live. It observes the bounded stale state, one
  authoritative successor snapshot, no stale-authority frame, and byte-identical
  custody across 64 concurrent reads at the reload cut.
- Ephemeral subscribe and publish absorb the effect-free
  `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING` successor window with a finite client
  retry budget. While waiting, authority readiness reports `reconnecting` and
  `ephemeralAuthorityUsable: false`; exhaustion preserves the typed refusal.
  Each retry is pinned to the first exact coordinator capture or external
  bearer/transport generation and refuses before redispatch across logout or
  A → B.
- The real password witness completed 200 awaited sign-in → immediate protected
  ephemeral subscribe/publish cycles with no app-visible
  `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING`. Its natural server-pending count is
  observational only. A deterministic effect-free request-boundary control
  positively induces one pending subscribe and one pending publish, and both
  retries complete against the real sessions server. Focused client witnesses
  separately prove the finite exhaustion boundary and the four held
  logout/A → B subscribe/publish cancellations.

The Exit condition holds: ordinary watch reload preserves signed-in custody,
live resources expose and recover through an explicit bounded successor state,
and immediate post-sign-in ephemeral operations do not expose the successor
race to application code.

Verification:

- `demos/_kit/tests/regression-midflight-resync.mjs` — 5/5, including fenced
  predecessor, held reload-during-reload, and exactly one latest authoritative
  successor.
- `packages/snapback-cli/sessions-dev-loop.test.mjs` — real watch reload,
  live-stream successor, and tight-loop custody witness passed.
- `demos/_kit/tests/password-ephemeral-authority-successor.mjs` — 200/200,
  two positive controlled absorbed occurrences, zero app-visible pending
  refusals; natural pending count observational.
- `authorization-invalidation.test.mjs`,
  `generated-optimistic-default.test.mjs`, and `password-auth.test.mjs` — held
  authorization/optimistic publication queues refuse after the cut; held
  subscribe/publish retries cancel across logout and A → B with one dispatch.
- `packages/snapback-client/authority-transition-conformance.test.mjs` and
  `packages/snapback-contract/authority-transition-signal.test.mjs` — 11/11.
- Affected password-auth, hosted-ephemeral, ephemeral-room, coordinator, and
  missed-wakeup suites passed.

Landing SHA: ea062befb5419dffcec5679c84e7f2325f432af4
