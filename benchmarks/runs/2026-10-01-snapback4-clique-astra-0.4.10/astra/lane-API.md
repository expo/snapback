# Clique custom-client API

This app uses Snapback 4 (`snapback4@0.4.10`)'s JSON-over-HTTP protocol. In this lane the server is `http://127.0.0.1:49360`. Production deployments should use HTTPS. No service credential is needed; all operations below enforce the bearer user's rules.

## Authentication and lifetime

`POST /auth/signup` or `POST /auth/login` with `Content-Type: application/json` and `{"email":"...","password":"..."}` returns `{"session":{"principal":"...","kind":"account","token":"...","expiresAt":1790000000000}}`. Use the returned expiry (Unix milliseconds), not a hard-coded lifetime. Passwords are hashed by the backend. Signup creates the account; `saveProfile` creates its public profile.

An issued token is sufficient: send `Authorization: Bearer TOKEN` on every subsequent call. `POST /auth/refresh` with `{}` replaces the bearer and invalidates the old one. `POST /auth/logout` with `{}` revokes that session family, including its refreshed tokens. `POST /auth/logout-all` revokes all sessions of that account. Tokens are one-user credentials, cannot be used after expiry/revocation, and do not grant access to other users' private conversations. Logout is an online revocation; the app also retires local credentials and the account's live device state. Never log tokens or put them in URLs.

## Reads, paging, and errors

A query is `POST /q/OPERATION` with `{"args":{...}}`. Success contains `data`, `complete`, `next` (opaque continuation or null), `seq`, and `nextExpiry`. A missing point can have `data:null`. A refusal has `denied:{code,message}`. HTTP success alone is insufficient: inspect that field. Mutation failures have `state:"failed"` and `why`. Dead/missing credentials produce HTTP 401. Do not infer absence from incomplete or loading data.

- `inbox`, arguments `{c?: cursor}`, returns up to 50 membership objects. Each has `conversation`, `role`, `seenOrdinal`, `deliveredOrdinal`, `chat:{id,kind,title,description,color,disappearing,...}`, and `unread`. Follow `next` using the next request's `c` until null. DMs have title `Direct message`; `directPeer` with `{conversation}` returns `profile:{displayName,handle,...}` for identifying the peer. Groups use their configured title.
- `apiHistory`, arguments `{conversation: ID,c?: cursor}`, returns up to 20 messages, newest first by server-assigned ordinal. Follow `next` unchanged in `c` for older pages; no offset or client sorting is required.
- `message`, `{message:ID}`, fetches a raw point for diagnostics; use `apiHistory` for the portable message manifest.
- `profile`, `{handle}`, resolves a public profile. `people`, `{q,c?}`, searches by NFC-normalized, case-insensitive word prefix. `searchChat`, `{conversation,q,c?}`, and `searchMessages`, `{q,c?}`, search readable messages newest first. Search continuations are tied to the original arguments.

Every `apiHistory` message includes:

| Field | Meaning |
|---|---|
| `id`, `conversationId`, `senderId` | Stable opaque entity and principal IDs |
| `timestamp`, `ordinal` | Server Unix milliseconds and per-chat arrival order |
| `type`, `text` | `text`, `photo`, or `video`; text body or caption |
| `media`, `viewOnce` | Asset descriptor or null; whether one-view policy applies |
| `edited`, `tombstone` | Edit and delete-for-everyone flags |
| `replyToId` | Quoted message ID or null |
| `reactions` | `{emoji,count,mine}` array, one group per emoji |
| `receipt` | For caller's messages: `sent`, `delivered`, or `read`; null for others |
| `expiresAt` | Server expiry deadline or null |

Expired rows are absent. Tombstones retain identity/order but clear media and content. `GET /assets/ASSET_ID` with the same bearer fetches bytes under the owning row's authorization. A second view-once fetch is refused with `E_ASSET_VIEWED`; deleted/expired assets are unavailable. Clients must discard revoked handles and must never persist view-once bytes.

## Send and receive

`POST /m/send` body:

```json
{"id":"WRITE_ID","args":{"id":"MESSAGE_ID","conversation":"CHAT_ID","text":"Hello","quote":null}}
```

Use distinct fresh IDs minted with `mintId()` from the exact dependency `snapback4@0.4.10` (`import {mintId} from 'snapback4/client'`). The outer ID is the idempotency key: retry an uncertain request with the same outer ID and identical arguments. Success is `{"state":"sent","id":...,"seq":...,"result":MESSAGE_ID}`. An acknowledged replay sets `replayed:true` and can omit `result`. Do not create a new write ID to retry an uncertain send. The server chooses timestamp/ordinal; clients cannot backdate. Messages allow 1–2000 characters. Membership is enforced at settlement. Edit/delete use `editMessage` / `deleteMessage` with `{message,text}` / `{message}` and the same outer write envelope; server windows come from the deployed config.

The portable demo uses **polling**: call the first `apiHistory` page every 1 second while the chat is open and deduplicate by message ID. To recover after a long pause, page backward until reaching a known ID; polling one page alone can miss a burst larger than 20. Mark only content actually received using `/m/delivered` arguments `{conversation,from,through}` with inclusive contiguous ordinal runs; mark content seen in a visible conversation with `/m/seen` arguments `{conversation,through}`. Both use the normal idempotent write envelope. Arrival in history is distinct from a read receipt.

## Run the headless demo

After `npm install`, start the backend and install starter segments. Run:

```sh
CLIQUE_TOKEN="$YOUR_TOKEN" CLIQUE_CONVERSATION="$CHAT_ID" node scripts/custom-client-demo.mjs
```

Alternatively provide `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`; the demo logs in. Optional `CLIQUE_BACKEND` selects another instance. It lists chats, pages history, sends one text, polls it back, and validates every message-manifest field. It prints IDs and test results, never credentials. If no conversation is supplied, it uses the first readable chat.

To fetch the latest message of a named group using only a token: page `inbox` until `row.chat.title` matches, take `row.conversation`, query `apiHistory` with that ID, and use `data[0]`. For a named DM, resolve each DM's `directPeer` and match its handle. Display names and group names need not be unique: return the candidate IDs for an ambiguous name rather than silently choosing.
