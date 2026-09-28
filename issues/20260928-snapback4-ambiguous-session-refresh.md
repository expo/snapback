# Snapback 4: ambiguous session refresh needs a separate design

Status: Open — separate lane; design LLP required before implementation.
Date: 2026-09-28
Source: FU supervisor round-5 ruling; Astra rounds 3 and 4, Grok round 2.
Scope: Snapback 4 online/local clients, auth transport, session storage and app lifecycle.
Related: [LLP 3000, HTTP overload diagnostics](../llp/3000-snapback4.explainer.md#http-overload-diagnostics),
[client session invariants](../snapback4/packages/snapback4/CLIENT-AND-OPERATIONS.md#4-the-client).

The server consumes a bearer at `/auth/refresh` before returning its successor.
If the response is lost, the client keeps the consumed predecessor. Startup,
a timer, a clock correction, another explicit call, another client or a restart
can send it again, receive 401 and sign out. This already exists on main. For a
guest, signing in again creates another principal; it is not transparent recovery.
FU is scoped to truthful, paced overload. Its rounds 3/4 attempted custody fixes
are removed in round 5, with mainline refresh dispatch/persistence/scheduling
restored. Malformed-success diagnostics and retryable-auth refusal handling stay.

## Reproductions to carry into the new lane

1. **Startup/deferred startup and clock re-arm (Astra r2; Grok r2 #2).** Prime a
   saved device and near-expiry session. Let the real server rotate (200), discard
   the reply with `ECONNRESET`, and answer schema/sync/probe with admission
   refusals. Saved-state construction succeeds and arms a 60-second refresh.
   Fire it: the same bearer gets 401 and the client signs out. Plain-text refresh
   replies also re-arm; clock updates and final deferred startup can bypass a
   guard placed only in `refreshCurrent`.
2. **Cross-client and restart (Astra r3 #1).** Open two `createApp` runtimes sharing
   a session store, on both tiers; also use direct `createLocalClient`. Let one
   rotate with 200 and discard the response. Open the peer: its per-instance
   fence is empty, so the same bearer gets 401. Serialize only the kept session
   and device state into a fresh process: the same gap remains. Also exercise a
   concurrent peer while the first request has not returned, and a restored
   claimed session outside the automatic refresh window.
3. **Proven non-dispatch (Astra r3 #2).** Automatic refresh throws
   `ECONNREFUSED` before any server dispatch. Restore connectivity: queries and
   probes work, but the round-3 instance fence returns cached `E_OFFLINE`
   forever. `app.auth` remains signed-in with no `why` or warning. Explicit,
   scheduled and peer renewal must recover without requiring another guest.
4. **Malformed successful body (Astra r3 #4).** Replace a refresh success with
   HTTP 200 `{}`. Main fabricated `E_AUTH` and cleared both tiers' sessions.
   FU retains the independent fix: `invalidResponse(200, "session refresh")`.
   Empty, invalid-session, plain-text and failed-body replies still have unknown
   delivery; their diagnostics do not prove permission to resend.
5. **Stale constructor overwrites successor (Astra r4 #1).** Local B restores
   token T and observes A's pending claim. A saves successor S. B's later
   constructor save of T overwrites S; `keepSession` treats the different token
   as fresh and loses the claim. B refreshes T: actual server responses 200,
   then 401. Exercise that precise interleaving, not only two sequential opens.
6. **Storage failure loses proof of non-dispatch (Astra r4 #2).** On both app
   tiers persist a claim, fail refresh with pre-dispatch `ECONNREFUSED`, then
   fail exactly the write clearing the claim. Let storage recover completely.
   The owner has discarded its proof and every later call returns the durable
   unknown refusal; fetch count stays one. Also fail detailed-outcome persistence
   and successor persistence independently. The former must not erase the
   original diagnostic; the latter must retain ownership of the known successor.
7. **Explicit account replacement (Astra r4 #3).** Store account A, then supply
   B's valid near-expiry session to each lower client constructor. The round-4
   claim implementation returns synthetic `E_AUTH` without dispatching B;
   local cleanup additionally deletes unrelated A. This passes on round 3 and
   main, fails on round 4. B must refresh/open; a conflict is not authentication
   rejection. Keep app account-switch, failed-switch and stale-cleanup cases too.

Astra's other review findings are independent: nonretryable probe spin (r3 #3),
probe Retry-After coverage (r3 #5, r4 #4), nonretryable changes refusals (Grok r2
#3), and malformed ephemeral 503 (Grok r2 #4). FU retains those repairs. They
must remain green when the session lane changes shared transports.

## Constraints learned, not an accepted design

- If claims are used, bind them to the exact bearer and commit/check them under
  the existing session-store lock **before dispatch**. Bound persistent metadata;
  an instance flag cannot protect a peer or restart. Do not introduce nested
  lock acquisition through the app's already serialized authorized store.
- Restoration saves and cleanup must be conditional on the exact restored or
  rejected bearer/epoch still being current. If a successor won, restart
  restoration instead of overwriting it. Never delete another account as cleanup.
- Distinguish proven non-dispatch from unknown delivery. Connection-establishment
  failures may prove no send; reset, opaque browser failure, post-connect timeout,
  lost/malformed body do not. A body failure named `ECONNREFUSED` still does not
  prove non-dispatch. A crash after a pre-dispatch claim is inherently ambiguous.
- Keep the owner's proven result until its conditional clear commits, and retry
  that clear when storage recovers. A pending claim must not overwrite a known
  refusal/non-dispatch proof. Peers must recheck a claim once its owner releases
  it, rather than cache a permanent fence.
- Explicit installation of B is different from restoring stale A. Preserve app
  account-commit, authorization and late-successor revocation boundaries;
  storage conflicts need storage diagnostics, not synthetic terminal `E_AUTH`.
- A permanently paused automatic renewal must produce an actionable warning
  through `app.auth.why`/events and `useAuth`, including restoration outside the
  refresh window. Explain recovery and the guest-identity consequence. Test the
  React surface: Astra r4 removed `why` from `useAuth` and all 35 custody tests
  still passed, while its separate React controls failed on both tiers.
- Preserve sign-out, close, same-ID mutation custody and current I1–I13. A server
  receipt or idempotent refresh protocol may be needed to recover a lost successor;
  client claims alone cannot manufacture it. Evaluate that in the new LLP.

The new lane must author/review its own LLP and acceptance matrix before adding
another custody mechanism. No new LLP is minted by this overload lane. Historical
implementation/test evidence is in FU round3/round4 reports and git commits
`5ff508773` / `b22998869`; the original reviews are
`~/sb4-intent/reviews/fu-r3.astra.md` and `fu-r4.astra.md` (read-only).
