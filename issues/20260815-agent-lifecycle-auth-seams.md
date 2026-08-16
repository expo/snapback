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
