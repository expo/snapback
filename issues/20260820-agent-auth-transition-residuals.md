# Agent auth-transition residuals around reload and ephemeral settlement

**Status:** Open
**Opened:** 2026-08-20 (split from the duplicate open copy of
`20260815-agent-lifecycle-auth-seams.md`)
**Systems:** Client auth coordinator, Live queries, Ephemeral state, Dev loop
**Related:** LLP 0059; LLP 0227;
`issues/closed/20260815-agent-lifecycle-auth-seams.md`;
`issues/closed/20260815-headless-auth-churn-stalls-backend.md`;
`issues/20260820-optional-user-live-query-auth-transition-stall.md`;
`issues/20260820-authenticated-query-signed-out-settlement.md`

## Why this ticket remains open

The original Clique 0.1.21 client-lifecycle findings are closed: sequential
logout joins the authority barrier, mounted React consumers re-admit without
an app remount, and `closeAuth()` drains realtime demand. A later investigation
appended three different residuals to an open duplicate of that closed ticket.
Those residuals remain independently actionable and are preserved here.

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
