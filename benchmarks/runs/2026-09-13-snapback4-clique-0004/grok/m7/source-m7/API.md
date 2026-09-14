# Clique custom-client API

Clique is a Snapback 4 backend. Third-party clients talk HTTP JSON to the
server. No REST resource tree is required; the native protocol is enough.

Base URL: the Snapback server (development: `http://127.0.0.1:49300`).

## Auth

Password accounts (`use identity`).

- `POST /auth/signup` `{ "email", "password" }` → `{ "session": { principal, kind, token, expiresAt } }`
- `POST /auth/login` `{ "email", "password" }` → same
- `POST /auth/logout` with `Authorization: Bearer <token>` ends this session
- `POST /auth/logout-all` revokes every session for the principal
- `POST /auth/refresh` rotates the presented token; adopt the returned session

Sessions last seven days. Pass the bearer on every subsequent request:

```
Authorization: Bearer <token>
```

Tokens are scoped to one user. Logout (or logout-all) revokes them
server-side. A revoked token is 401.

## Operations

Authenticated `POST /q/<name>` with `{ "args": { ... } }` runs a query.
Authenticated `POST /m/<name>` with `{ "id", "args" }` runs a mutation.
`id` is a client-minted idempotency key.

Useful operations (see `GET /api.ts` for generated types):

| op | kind | purpose |
| --- | --- | --- |
| `inbox` | query | list conversations (`messageCount` is visible messages) |
| `threadMessages` | query | page message history (`c` cursor); polls include `question` / `optionA`–`optionD` / `myVote` |
| `conversationOf` | query | one conversation plus backfilled `messageCount` |
| `convPollVotes` | query | votes in a conversation |
| `send` | mutation | send a text message |
| `sendMedia` | mutation | photo / video / view-once |
| `createPoll` | mutation | group poll (question ≤200, 2–4 options ≤50); client mutation id |
| `setPollVote` | mutation | idempotent set-state vote (`optionKey` `a`–`d`); client mutation id |
| `me` | query | the caller's profile |

Receive new messages by polling `GET /changes?since=<seq>&wait=25` (long
poll, documented Snapback streaming) or by paging `threadMessages` again.

## Message object (history field manifest)

Each message from `threadMessages` includes:

- `id`
- `conversationId`
- `authorId` (sender)
- `at` (server timestamp, ms)
- `body` / `caption` (text)
- `photo` / `photoOnce` / `clip` (media reference `{ id }` or null)
- `editedAt` (edited flag when non-null)
- `tombstoned` (tombstone flag)
- `quoteId` (reply-to)
- `myReaction` (caller's reaction)
- `pending` (this device's unconfirmed write)
- `question` / `optionA`–`optionD` / `myVote` (M7 poll fields; null on pre-M7 rows)

Receipts for the caller's own messages are aggregated from `convReceipts`
(`delivered` / `read` per recipient). Reactions for a message: `messageReactions`.
Poll votes: `convPollVotes`. Conversation `messageCount` is currently visible
messages (excludes tombstoned and expired; polls count).

## Demo

`scripts/custom-client-demo.mjs` logs in as Alice, lists conversations, pages
history, sends a text message, and reads `/changes`.
