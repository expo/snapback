# Agent-lifecycle auth seams: AUTHORITY_CLEARING logout race, forced post-auth remounts, closeAuth lease retention

**Filed:** 2026-08-15 · **Source:** Clique 0.1.21 exploratory sweep ·
**Systems:** Client auth coordinator / React binding / realtime leases

**Related:** `issues/20260815-auth-churn-backend-stall.md` (server-side
sibling), diary `0076-password-auth-acceptance` (fixed the first round of
projection seams), LLP 0059 (session projection and client barrier),
LLP 0227 (password credential auth RFC)

## Problem

The 0076 acceptance diary fixed several auth projection seams, but the
Clique 0.1.21 sweep surfaced three remaining client-side lifecycle seams
that every agent-driven (headless or scripted) auth flow trips over:

1. **`SNAPBACK_CLIENT_AUTHORITY_CLEARING` race on logout.** A recently
   completed authority transition can leave an immediately following
   `logout` seeing `SNAPBACK_CLIENT_AUTHORITY_CLEARING`. The lane's
   workaround was a bounded logout retry while the coordinator finished
   its prior barrier (diary `0083-clique-0121-snapback-explicit`, M1).
   Sequential awaited auth operations should not race each other: if the
   prior transition's barrier hasn't settled, the next operation should
   queue behind it (or the transition promise shouldn't resolve until
   the authority is actually settled), rather than surfacing a retryable
   error to the caller.

2. **Forced post-auth remounts.** Auth-driven query consumers needed an
   intentional remount after signin/logout (0083, M1). A mounted live
   query consumer should survive an authority change by re-admitting /
   re-evaluating under the new principal, not by requiring the app to
   tear down and recreate the component tree. This is the client-barrier
   contract of LLP 0059 not yet reaching the React binding's post-auth
   path.

3. **Headless `closeAuth` retained a realtime lease** (diary
   `0079-clique-0121-snapback-familiar`, M1). One-shot scripts that
   close out their auth custody should not leave a live lease behind;
   this both leaks server demand and interacts badly with the churn
   workloads that trigger the backend stall in the sibling ticket.

## Definition of done

- Logout/authority transitions serialize behind the coordinator barrier;
  no caller-visible `AUTHORITY_CLEARING` from sequential awaited calls;
  witness test for signin → logout → signin in a tight loop.
- A mounted React live-query consumer stays mounted across
  signin/logout and reflects the new authority without app-level
  remount; witness in the React binding tests.
- `closeAuth` (headless) releases realtime leases; witness asserts no
  surviving lease after close.
- Guide pages for served auth / react-expo updated if any documented
  workaround (remount advice, retry loops) becomes obsolete.

## Additions 2026-08-15/16 — three more seams found during the backend-stall investigation

Observed live while running the sibling ticket's repro harnesses
against a current build; each is a client-lifecycle seam a headless
agent hits during ordinary dev-loop churn:

4. **The client clears auth custody on transient `AUTH_MODE_PENDING`.**
   `packages/snapback-client/index.mjs` (~5029) calls
   `clearAuthSession()` when a request fails with
   `SNAPBACK_AUTH_MODE_PENDING` — but that code is the *transient*
   "watch reload in progress" refusal (measured 3.3 s at dev boot;
   seconds around a reload). A signed-in headless client that touches
   the backend during any reload window silently loses its session
   custody and must re-authenticate, which is precisely the
   sign-in-churn behavior that aggravates the sibling backend ticket.
   MODE_PENDING should be retryable-after, not custody-clearing.
5. **`SNAPBACK_AUTH_MODE_PENDING` is a live-stream terminal code**
   (`LIVE_TERMINAL_AUTH_CODES`, index.mjs ~1356): every reload window
   also terminates all live streams, so agent consumers see stream
   death + custody loss + signin refusals from one comment-only schema
   touch. Combined with seam 2 (forced remounts), a dev-loop reload
   costs an agent its entire session state.
6. **Post-signin `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING` race:** a
   `liveQuery` issued immediately after an awaited
   `authPasswordSignIn` intermittently refuses with
   `SNAPBACK_EPHEMERAL_AUTHORITY_PENDING` (3 occurrences across ~200
   signin→subscribe sequences; one 250 ms retry always cleared it). An
   awaited signin should leave the ephemeral authority usable, or the
   client should absorb the settle internally.

Also relevant to DX here (documented server behavior, not client bugs):
a fresh `snapback dev` reports its ready file before the first sessions
activation settles, so an installer's first signup wave eats
`SNAPBACK_AUTH_TRANSITION_FAILED`; recommendation filed in the sibling
ticket is to delay ready or emit `Retry-After`.
