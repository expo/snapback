# Snapback Messenger

A messaging app on Snapback: 1-1 DMs, group chats, text and image messages,
emoji reactions, WhatsApp-style reply previews (a quoted pointer to the
original message, never a nested thread), live typing indicators, and a
headless acceptance witness for session-bound view-once media grants. Expo
Router client (iOS, Android, web from one codebase), dev-mode client-asserted
auth with a persona switcher.

## Run it

Backend first:

```sh
node demos/messaging-snapback/scripts/dev-server.mjs --reset
```

This boots a local `snapback` server, provisions the schema/functions, seeds
users/conversations/a message backlog (including replies and reactions), and
uploads two real photos through the actual asset pipeline (CLI-driven — see
"Known limitation" below for why). It prints the origin to point the app at.

Then the app:

```sh
cd demos/messaging-snapback
EXPO_PUBLIC_SNAPBACK_ORIGIN=http://127.0.0.1:4421 bun run web
```

Press `w` for web, or scan the QR code for iOS/Android via Expo Go.

## Trying it

- **Chats tab** lists every conversation (DMs and groups), newest activity
  first, with a live connection indicator.
- **People tab** switches which persona you are (dev-mode identity — there
  are no real accounts) and starts a DM with anyone else.
- Inside a conversation: send text, attach a photo, long-press a message to
  react or reply. A reply shows a small quoted preview above the new
  message — tap it to jump back to the original.
- Start typing and another open client (or a second `SnapbackClient` in a
  script) sees "X is typing…" live.
- **+** on the Chats tab creates a new group.

## How it is built

`snapback/schema.mjs` + `snapback/functions.mjs` are the whole backend: eight
tables (`users`, `conversations`, `conversationMembers`,
`conversationMemberships`, `messages`, `reactions`, `viewOnceMessages`,
`viewOnceConsumptions`) and one ephemeral collection (`typing`). Four things
shaped the design:

- **Conversations are denormalized for a single-scan inbox.** `lastMessageText`/
  `lastMessageAuthorName`/`lastMessageAt` are patched on every send, so
  `myConversations` never joins into `messages` to render the list.
- **Typing is authorized by the canonical conversation roster.** Both publish
  and subscribe use the new restricted `conversationMemberships` membership
  declaration, scoped by the nominal `conversationId`. The existing public
  `conversationMembers` table remains the app's denormalized read projection.
  Leaving therefore revokes the departing member's room edge and removes their
  retained typing entry from the peers who remain.
- **Reactions and reply previews are JS-handler aggregates, not declarative
  plans.** `conversationMessages` reads `messages` and `reactions` in one
  snapshot and groups reactions per message / looks up the quoted reply
  target with same-file helper functions — the shape a declarative plan
  can't express, and exactly what `defineJsLiveQuery` is for.
- **View-once keeps security authority in first-class grant edges and product
  state in app rows.** Send attaches one owner-only, private-strict asset and
  mints a pending grant per recipient. Open inserts a unique consumption row
  before activating the grant; close revokes it and clears its id from the
  owner-visible grants map; owner delete-for-everyone revokes every remaining
  id and removes the typed reference and consumptions atomically.

Auth is `dev` mode (client-asserted identity via a persona switcher), the
same trade-off `demos/warble` documents — not a production posture. The
interactive client sends the selected persona as the direct call's asserted
`userId`; typing also sends
`SnapbackClient.roomPermission('m_conversationMemberships', scope)` on its
subscription and inherits it for publication. A Sessions server ignores both
client assertions and resolves the principal and permissions itself, which is
the intended dev/production split.

## Why view-once is headless-only

The Expo UI is intentionally unchanged. Its persona switcher runs against a
dev-mode server and has no real sessions, while view-once grant ownership,
activation, and revoke derive the principal from `ctx.auth.userId`. The
headless acceptance suite stages the same backend in Sessions mode, mints four
ordinary principals, and is the honest witness for the flow. Wiring the
session-bound feature into the dev-persona UI would demonstrate a different,
weaker authority model.

The inspection live query is also explicitly demo-scoped: it lets any
authenticated test principal address a row so the suite can inspect owner-side
grant bookkeeping. A production app would scope that query to conversation
membership and the author/recipients.

## Known limitation: in-app photo upload

The in-app photo picker (`useSnapbackAssetUpload`) is wired correctly, but
against this dev-mode-no-sessions server it will 403: dev-mode HTTP asset
requests always resolve an anonymous caller, and this app's upload intent
records a specific owner per upload, so every step after the create call
fails a caller/owner match — for any auth mode, not just `authenticated`.
Seeded and CLI-uploaded photos work (they go through
`snapback assets put --user <handle>`, which does carry a real identity).
Full mechanism and a suggested guide fix in
[`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`](../../issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md).

## Proof

```sh
node demos/messaging-snapback/tests/acceptance/headless.mjs
```

Twenty-five checks: the existing messaging and asset-upload proofs; an
eight-part Sessions-mode typing-membership battery (anonymous and non-member
refusal, creator principal binding, cross-member visibility, removal
revocation, leave/add projection coherence, and fresh rejoin); plus
recipient-set validation; hostile pending/outsider delivery; repeated and
concurrent second-open refusal from product consumption state; strict
403→200→403 close; two-recipient delete-for-everyone; and close-then-delete
bookkeeping. Strict asset requests include the Sessions protocol offer so the
403 assertions are authorization evidence rather than malformed-request 400s.

Screenshots from a real run (Expo web + a real local server) are under
[`evidence/`](./evidence/). Build notes and comparisons to Convex/Supabase are
in
[`diaries/0058-messaging-snapback.diary.md`](../../diaries/0058-messaging-snapback.diary.md).
