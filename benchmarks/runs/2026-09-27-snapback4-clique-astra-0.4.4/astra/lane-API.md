# Clique custom-client API

Base URL locally: `http://127.0.0.1:49360`. All requests below are JSON POSTs with `Content-Type: application/json`. HTTPS is required outside local development. This protocol is Snapback 4, pinned at 0.4.4.

Authenticate with `POST /auth/login` (or `/auth/signup`) and `{ "email": "alice@example.com", "password": "Alice!Clique2026" }`. The response contains `session: {principal, kind, token, expiresAt}`. Keep tokens secret. For every query, mutation, and asset request send `Authorization: Bearer <token>`. Issued tokens are scoped to that one principal; membership and ownership rules apply on the server. Password sessions expire in seven days (use the returned expiry). `/auth/refresh` rotates the bearer and invalidates the previous bearer. `POST /auth/logout` with the bearer ends its session family, including refresh/recovery descendants. Account-wide revocation is also available through the published `logoutAll(url, token)` auth helper. Expired, logged-out and revoked tokens cannot query or mutate. Never use a service token in a client.

Queries use `POST /q/<operation>` with `{ "args": {...} }`. Successful responses include `data`, `next` (opaque pagination cursor or null), `complete`, `cut`, `seq`, `viewer`, and possibly `nextExpiry`. Refusals contain `denied`; treat them as errors. Private cross-conversation searches can have partial coverage: do not assume `complete: false` means there is another visible result. Continue pagination only with a returned cursor.

List conversations: `/q/messaging.inbox`, args `{}`. Each item has `conversation` (the ID), `chat` (`id`, `kind`, `title`, `description`, `color`, `disappearing`, `lastOrdinal`), membership progress and `peers` with public profiles. Pass `{ "c": "<next>" }` for another page. A DM's display name is its peer profile; groups have a title.

History: `/q/messaging.history`, args `{ "conversation": "<id>" }`. It returns up to 20 messages newest-first by server ordinal. Another page uses `{ "conversation": "<id>", "c": "<next>" }`. To fetch the latest message of a named group, page inbox until `item.chat.title` matches, then request its history and take `data[0]`. For a named DM find the matching `item.peers[].profile.handle` instead. Empty history is `[]`.

Each history message contains:

| Field                          | Meaning                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `id`, `conversation`, `sender` | Stable message, conversation and sender IDs                              |
| `at`, `ordinal`                | Server timestamp and per-chat server-arrival order                       |
| `type`                         | `text`, `image`, `video`, or `view-once`                                 |
| `text`                         | Text or media caption (empty for a deleted message)                      |
| `mediaRef`                     | Asset reference or null; `photo`, `video`, `oncePhoto` are also exposed  |
| `edited`, `tombstone`          | Edit and deletion flags                                                  |
| `quote`                        | Replied-to message ID or null                                            |
| `reactions`                    | Array of `{emoji, count, mine}`; `mine` is the caller's reaction         |
| `receipt`                      | `sent`, `delivered`, or `read`; meaningful for the caller's own messages |
| `expiresAt`                    | Server expiry timestamp or null                                          |

History also includes `senderProfile` and `quoted` preview. Expired messages disappear; deleted messages remain as tombstones and no longer expose media. The server controls expiry and edit/delete windows from `config/windows.json`. Assets are authorization-checked; use the published client `asset(id)` with a session for a transient handle and call its revoke function on close. Ordinary media can use the replica's durable asset arm. Never cache view-once bytes: a second server open is refused. An old URL does not grant durable access after revocation.

Send text: `POST /m/messaging.send` with `{ "id": "<write-id>", "args": { "id": "<message-id>", "conversation": "<id>", "text": "Hello", "quote": null } }`. Both IDs are client-generated ULIDs (the public `mintId` export from `snapback4/client` supplies them). The top-level ID identifies the intent; preserve it and the exact args on an uncertain retry. A fresh authoritative receipt is `{state: "sent", id, seq, result}`; a replay is `{state: "sent", id, seq, replayed: true}` and may omit result. `{state: "failed", why}` is terminal. Do not treat an HTTP response alone as write success. Text is limited to 2,000 characters; media captions to 500.

New messages use **polling**, not a custom streaming protocol: re-query the latest history page every two seconds, deduplicate by message ID, and reconcile existing messages for edits, tombstones and reactions. Use older-page cursors for scrolling. Receipt acknowledgements are explicit: `/m/messaging.delivered` args `{conversation, from, through}` acknowledge contiguous ranges of actually received ordinals; `/m/messaging.seen` args `{conversation, through}` advances the user's read position. Each is an ordinary mutation with its own stable write ID. Do not acknowledge messages you have not received or seen.

Run the headless demo after `npm install` with `CLIQUE_TOKEN=<token> node scripts/custom-client-demo.mjs`, optionally `CLIQUE_URL` and `CLIQUE_CONVERSATION`. Alternatively supply `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`. It authenticates, lists conversations, requests history and its next page when present, sends a text, then polls until that new message arrives. It prints no token. The account must already belong to a conversation. No browser, generated types, or app internals are required by the demo.
