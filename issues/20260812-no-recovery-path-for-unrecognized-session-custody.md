# No paved recovery when the server no longer recognizes stored session custody

**Status:** Open
**Severity:** P2
**Systems:** snapback-contract auth coordinator, auth invalidation, browser custody, dev loop
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-12
**Related:** Aurora `surfaces/contract/auth.ts`; LLP 0059; LLP 0060

## Problem

After a local dev database reset, a browser still holding bearer custody in
IndexedDB (`AuthCoordinator` + `createIndexedDbAuthCustodyStorage`) is wedged:
the stale bearer rides every request, so even anonymous-eligible calls refuse —
`client.health()` and `client.authRequestCode(...)` both fail with
`SNAPBACK_AUTH_REQUIRED`, which in Aurora surfaced as the signup form refusing
to send a one-time code (base commit
`d6fc55d7f97798591ec68d3490c489375ae840dc`, 2026-08-12; deterministic repro:
sign up → wipe `dev.sqlite3*` → restart → reload the same browser profile →
request a code).

Every apparent exit is closed:

- `coordinator.compareAndClear(capture)` refuses with
  `SNAPBACK_CLIENT_AUTHORITY_CLEARING: authority custody is not settled for
  app-visible work` — the invalidation barrier enters its clearing phase but
  can never settle against a server that has no record of the session.
- `client.authLogout()` begins with `await this.authSession()`, which refuses
  with the same stale bearer, so logout cannot run.

The working recovery Aurora shipped app-side: detect an `SNAPBACK_AUTH_*`
refusal from `health()`/`authSession()` during restore, then
`coordinator.close()` → `indexedDB.deleteDatabase(AUTH_CUSTODY_DATABASE_NAME)`
→ rebuild the client on fresh anonymous custody. That is a blunt instrument no
app should have to write, and it deletes custody for every app sharing the
database name.

## Acceptance criteria

- A first-party recovery exists when the server is reachable but does not
  recognize the stored authority (e.g. the coordinator observes a terminal
  "unknown session" fact and transitions to settled anonymous custody, or a
  documented `coordinator.reset()`-class API does).
- `authRequestCode` (and other anonymous-eligible calls) succeed from a client
  whose stored bearer the server rejects, without app-side custody surgery.
- The dev-loop story is explicit: resetting the local store must not strand
  every previously signed-in browser profile.
