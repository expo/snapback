# Clique custom-client API

Clique's third-party surface is Snapback 4's native protocol, not REST.
A client with a user access token talks to the same backend the Expo app uses.

## Issuance, expiry, revocation

- Password signup/login (`POST /auth/signup`, `POST /auth/login`) mint a bearer session.
- Sessions last seven days. `refreshSession` exchanges a live token. `logout` / `logoutAll` revoke server-side; the old bearer then fails.
- Tokens are scoped to one user (the session principal). There is no app-wide key.

Use `snapback4/auth` (`signup`, `login`, `logout`, `logoutAll`, `refreshSession`) and `snapback4/client` (`createClient({ url, session })` or `{ url, token }`).

## Operations

Generated names live in `snapback/generated/api.ts` after `npx snapback4 check`. The demo uses the same names.

| Need | Operation | Notes |
| --- | --- | --- |
| Authenticate | `login` / `signup` | returns `{ session: { token, principal, expiresAt } }` |
| Who am I | query `whoAmI` | principal id |
| List conversations | query `inbox` `{ c }` | page of memberships + chat |
| Page history | query `history` `{ conversation, c }` | last 20, pass `next` as `c` |
| Send text | mutation `send` `{ id, conversation, text, quote?, photo?, clip?, oncePhoto? }` | client-generated `id` |
| Live receive | `client.observe(api.history, { conversation, c: null })` | streaming; polling `history` also works |

## Message object (history)

Each history row exposes:

- `id`, `conversation`, `sender`, `at` (server timestamp)
- `text` (text/caption)
- `photo`, `clip`, `oncePhoto` (media references, `{ id }` or null)
- `edited`, `tombstone`
- `quote` (reply-to id)
- `ordinal`, `recipients`, `expiresAt`, `pending`

Receipt state for the caller's own messages: query `messageReceipts` `{ conversation, c }` → `{ id, receipt }` where `receipt` is `sent` / `delivered` / `read`.

Reactions: query `messageReactions` `{ message }` → `{ emoji, principal, count via aggregation }`. The caller's own emoji is the row with `principal = viewer`.

## Streaming vs polling

`createClient().observe(query, args)` is the live arm. `client.query` is one-shot polling. Both are supported.

See `scripts/custom-client-demo.mjs` for a headless walkthrough.
