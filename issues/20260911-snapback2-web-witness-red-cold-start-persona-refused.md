# Snapback 2 web witness is red, and its offline cold start refuses a dev persona

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/scripts/witness-web.mjs`, Snapback 2 client auth (`src/client-auth.ts`), React chat starter (`Auth.tsx`)
**Related:** LLP 1012 §10, LLP 1002 §9, LLP 1019

## Evidence and impact

`node scripts/witness-web.mjs` (headless Google Chrome, macOS) fails on `main`, most likely
since `951e24da8` (2026-09-10), and nothing reported it: its header calls it scheduled, but no
schedule in the repository runs it. It is the only real-browser check of the React chat
starter.

It first stopped on three stale expectations, fixed alongside this ticket:

- the connection status copy `log downloaded` and the held search copy `Downloaded indexed
  results`, both reworded in `75a67c92c`;
- a removal expected to leave no preview. Since `951e24da8` (LLP 1019 D6)
  `conversationView` takes `latest` from `messages`, so removing the newest message returns
  the preview to the earlier one; the witness now asserts that.

With those fixed, four steps pass and the cold offline start fails (`witness-web.mjs:1046`):

    cold start held 0 chats and queued=false: {"inbox":{"state":"complete","connection":"offline",
    "rows":9,...,"caughtUp":true},"snapshot":{"connection":"offline","auth":"refused"},
    "outbox":["committed","committed","committed","queued"],"requests":[...every owner request
    failed with "TypeError: Failed to fetch"...]}

The data is held locally, but the page shows the login form. The witness app signs in with a
dev persona (`persona="alice"`). In `client-auth.ts`, `failed()` turns a transport error into a
retrying `hydrating` state only when the client holds a bearer token; a persona client falls
through to `refused`, and `restoringViewer()` also requires a token. `Auth.tsx` renders the app
only when there is a viewer or restoring viewer. The shipped starter's `main.tsx` uses
`browserTokenStore`, so this step no longer exercises the path the starter ships.

`ee435c50e` (2026-09-09) changed later steps after the Auth gate landed in `2c577e88f`, so this
step likely passed then. At least 25 commits touching the client, auth or starter files have
landed since, and none was bisected. The steps after it (carrier refusal, 503 replay and kill
before settlement, revocation on resume, shared sessions) have not run on current `main`.

## Requested outcome and acceptance

- Decide what the witness drives: a real account through the starter's token store (seeding
  that account's memberships), or a dev persona whose transport failures restore like a bearer
  session. Record the choice here.
- Get `node scripts/witness-web.mjs` green on `main`, or file each remaining real failure.
- Run it on a schedule that reports a red, or remove the "scheduled" claim from its header.
