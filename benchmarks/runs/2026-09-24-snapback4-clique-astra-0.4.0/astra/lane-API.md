# Clique custom-client API

Base URL for this lane: `http://127.0.0.1:49360`. Use HTTPS for production. All data requests require `Authorization: Bearer <token>`. Password signup and login are built into Snapback 4; no developer persona is needed.

POST `/auth/signup` or `/auth/login` with JSON `{ "email": "…", "password": "…" }`. Success returns `{session:{principal,kind,token,expiresAt}}`. Refusal returns `{denied:{code,message,...}}`. Passwords require at least eight characters. Tokens identify exactly one user and normally expire after seven days. `expiresAt` is milliseconds since the Unix epoch. POST `/auth/refresh` with the bearer rotates it; immediately persist the returned replacement. POST `/auth/logout` revokes the current family server-side; POST `/auth/logout-all` revokes all this account's sessions. Old/revoked/expired tokens are refused. Never send credentials or tokens in URLs or logs.

Queries use POST `/q/<operation>` with JSON `{ "args": {...} }`. Check `denied` before reading `data`. Successful reads include `complete`, `cut`, and `next`. A false `complete` is not proof of absence. Pass an opaque `next` as `c` for the next page, preserving all other arguments. Cursors are not snapshots.

| Operation | Arguments | Result |
|---|---|---|
| `chat.inbox` | `{c?: cursor}` | Membership rows: `chat`, `conversation` (name/kind), `other` profile, `unread` |
| `chat.history` | `{chat: conversationId,c?: cursor}` | Messages newest first, 50 per page |
| `chat.roster` | `{chat}` | Authorized membership and profile rows |
| `profile` | `{handle}` | Discoverable profile |
| `chat.searchChat` | `{chat,q,c?}` | Authorized word-prefix message search |
| `chat.searchAll` | `{q,c?}` | Search over authorized chats, with conversation objects |

Every history message includes `id`, `conversationId`, `senderId`, `serverTimestamp` (server arrival milliseconds), `type` (`text`, `image`, `video`), `text` (text/caption), `mediaReference` (asset id and sniffed facts or null), `edited`, `tombstone`, `replyToId`, `reactions` (`emoji`, `count`, `mine`), and `receipt` (`sent`, `delivered`, `read`). It also exposes native aliases `chat`, `sender`, `at`, `body`, `quote`, and separate `photo`, `video`, `oncePhoto`. A `oncePhoto` is never a durable cache candidate. Expired rows are absent. Tombstones contain no media reference. Asset GET `/assets/<id>` uses the same bearer; it refuses revoked assets and consumes one view of a once asset.

Mutations use POST `/m/<operation>` with `{ "id": "<mutation ULID>", "args": {...} }`. A fresh successful result is `{state:"sent",id,seq,result}`; a retry has `replayed:true` and no historical result. `{state:"failed",why}` is terminal. Keep exactly the same mutation ID, operation and arguments for retries. The JS SDK's `mintId()` creates valid IDs. The row ID is a separate `mintId()` placed in `args.id`.

Send text with `chat.send`: `{id: messageId,chat: conversationId,body:"hello",quote:null}`. Optional `photo`, `video`, or `oncePhoto` is a previously uploaded `{id:assetId}`; uploads use POST `/assets` with raw bytes and require a live connection. Edits use `chat.edit` `{message,body}`, deletion uses `chat.deleteMessage` `{message}`. Window checks use server time. Reaction intent: `chat.react` `{message,emoji:"👍"}` or `{message,emoji:null}`. Likes: `setLike` `{post,enabled:true|false}`. These are set-state operations.

Receiving: this API documents polling. Re-query the first history page every second, merge by message id, and honor edits, tombstones, and absent/expired rows. For lossless catch-up across longer gaps, page until the previously seen id. Third-party clients may instead use the authenticated Snapback change stream documented by the pinned SDK. Fetch acknowledgment uses `chat.fetched` `{chat,ids:[up to 50 message IDs],opened:false}`; set `opened:true` only when the conversation is visible. Receipt advancement is monotonic and account read state syncs across devices.

Run `node scripts/custom-client-demo.mjs`; it logs no credentials. Supply `CLIQUE_TOKEN`, or `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`, and optionally `BACKEND_URL`. The default credentials come from the declared fixture exception. The script authenticates, lists conversations, pages history, sends text, and receives it through polling. Generated operation handles are in `snapback/generated/api.ts` after `npx snapback4 check`.
