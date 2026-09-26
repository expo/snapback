# Clique custom-client API

Use HTTP JSON against `http://127.0.0.1:49360` locally. Production deployments must use HTTPS. No SDK is required. Every query and mutation below uses `Authorization: Bearer <access-token>` and `Content-Type: application/json`. IDs are opaque strings.

## Authentication and revocation

POST `/auth/signup` or `/auth/login` with `{ "email": "...", "password": "..." }`. The successful response contains `session: { token, principal, ... }`. Store the token privately. Password sessions expire after seven days. POST `/auth/refresh` with the bearer exchanges the live token atomically; adopt the returned session and discard the old token. POST `/auth/logout` revokes the current bearer; POST `/auth/logout-all` revokes all sessions for this principal. Tokens grant one user's permissions, never another user's chats. Signing out locally while offline cannot revoke a remote token until reconnect; the app fences local access immediately.

## Request and response envelopes

Queries: POST `/q/<operation>` with `{ "args": { ... } }`. The response has `data`, `complete`, `next`, and freshness information, or `denied`. Page queries accept `c` with the preceding response's `next`; begin with `c: null`. Stop when `next` is absent. A response with `complete: false` is incomplete; do not claim exhaustive results. Never change other arguments while continuing a cursor.

Mutations: POST `/m/<operation>` with `{ "id": "client-generated-unique-intent-id", "args": { ... } }`. A successful authoritative receipt has `state: "sent"` and `result`. Retry a lost response with the same ID and identical arguments. A failed receipt or `denied` must be surfaced. Distinct user actions use distinct IDs. All checks occur server-side.

## Conversations and history

`inbox`, args `{ "c": null }`: returns membership rows with `chat` (conversation ID), `room` (kind, title, description, color, background, disappearing setting), `roster` (member principal and profile), `readUpTo`, and `unread`. To find a named group, page inbox until `room.title` matches. To find a DM, match `room.kind === "dm"` and its counterpart's `roster[].profile.handle`. Titles are not globally unique; retain the selected `chat` ID.

`history`, args `{ "chat": "<conversation-id>", "c": null }`: newest messages first, twenty per page, stable server-assigned ordinal order. Pass `next` as `c` to read older pages. Refresh with null to see newer messages. The first item of a fresh history query is the latest message in the named conversation.

Message manifest:

| Product field | Wire field |
|---|---|
| ID | `id` |
| Conversation | `chat` |
| Sender | `sender` and `senderProfile` |
| Server timestamp | `at` (Unix milliseconds) |
| Type | `type`: text, image, or video; `deleted` takes precedence |
| Text/caption | `body` |
| Media reference | `photo`, `video`, `oncePhoto`: `{id,type,bytes,width,height,duration}` or null |
| Edited / tombstone | `edited` / `deleted` |
| Reply-to | `quote` or null; `quoted` is the current target preview |
| Reactions | `reactions[]`: `emoji`, `count`, `mine` |
| Own receipt | `receipt`: sent, delivered, read; SDK predictions may additionally be pending |
| Expiry | `expiresAt` or null |

GET `/assets/<id>` with the same bearer retrieves authorized bytes. Deleted, expired, or unauthorized assets return 404. `oncePhoto` returns bytes once per principal, then 410; never prefetch or persist these bytes. Revoke the transient URL when the viewer closes. Ordinary assets must be purged on server revocation. Backend expiry proceeds with no clients open.

## Send and receive

`send`, args `{ "messageId": "<new-entity-id>", "chat": "<conversation-id>", "body": "Hello", "quote": null }`. Optional `photo`, `video`, or `oncePhoto` accepts an uploaded `{id}`; only one media kind. POST raw supported image/MP4 bytes to `/assets` first. Text limit 2000; media caption 500; video maximum 60 seconds. The sender must be a current member.

This custom-client contract uses **polling**: query history with `c:null` every second, merge by ID, and replace changed message objects. Remove missing expired/deleted content as indicated by a fresh relevant page or the `message` point query. Do not equate absence from the first page with deletion. `message` args `{ "message": "<id>" }` returns a row or null.

After locally receiving message IDs, call `acknowledge` with `{ "ids": [...] }` (maximum 100). When actually viewing the conversation, call `markRead` with `{ "chat": "...", "through": <largest observed ordinal> }`. Read state is monotonic and shared across this account's devices. Offline third-party clients must retain intent IDs, submit sequentially on reconnect, and handle permission changes.

## Runnable example

Node 24 or later, no dependencies:

```sh
CLIQUE_TOKEN='<issued-token>' CLIQUE_CHAT='d-alice-bob' node scripts/custom-client-demo.mjs
```

Alternatively set `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`. `BACKEND_URL` overrides the local backend. The demo authenticates, lists conversations, pages history, sends a uniquely identified text, and receives it by polling. It prints no credentials. `npm run seed -- --segment m1`, then m2 and m3 establish the starter environment.
