# Snapback Messenger

A messaging app on Snapback: 1-1 DMs, group chats, text and image messages,
emoji reactions, WhatsApp-style reply previews (a quoted pointer to the
original message, never a nested thread), and live typing indicators. Expo
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

`snapback/schema.mjs` + `snapback/functions.mjs` are the whole backend: five
tables (`users`, `conversations`, `conversationMembers`, `messages`,
`reactions`) and one ephemeral collection (`typing`). Two things shaped the
design:

- **Conversations are denormalized for a single-scan inbox.** `lastMessageText`/
  `lastMessageAuthorName`/`lastMessageAt` are patched on every send, so
  `myConversations` never joins into `messages` to render the list.
- **Reactions and reply previews are JS-handler aggregates, not declarative
  plans.** `conversationMessages` reads `messages` and `reactions` in one
  snapshot and groups reactions per message / looks up the quoted reply
  target with same-file helper functions — the shape a declarative plan
  can't express, and exactly what `defineJsLiveQuery` is for.

Auth is `dev` mode (client-asserted identity via a persona switcher), the
same trade-off `demos/warble` documents — not a production posture.

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

Ten checks: seed shape, reply-as-pointer semantics (not a thread), reaction
idempotency, DM dedup, group membership, a real asset upload through the
trusted pipeline, empty-message refusal, and a live cross-client ephemeral
typing check.

Screenshots from a real run (Expo web + a real local server) are under
[`evidence/`](./evidence/). Build notes and comparisons to Convex/Supabase are
in
[`diaries/0058-messaging-snapback.diary.md`](../../diaries/0058-messaging-snapback.diary.md).
