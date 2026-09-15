# Clique custom-client API

Base URL for this lane: `http://127.0.0.1:49340`. All requests below use JSON and `Content-Type: application/json`. Except login/signup, send `Authorization: Bearer <token>`. This is the published Snapback 4 wire protocol; no SDK is necessary. IDs are opaque strings. Times are Unix milliseconds from the server.

## Identity

POST `/auth/signup` or `/auth/login` with `{"email":"…","password":"[REDACTED_LITERAL]"}` returns `{"session":{"principal":"…","kind":"user","token":"[REDACTED_LITERAL]","expiresAt":1780000000000}}`. Signup passwords have 8–1,024 UTF-8 bytes. Handle/profile creation is separate: POST `/m/saveProfile` with the mutation envelope below and `displayName`, `handle`, `bio`, `location`, `link` arguments. Tokens are scoped to that principal; row authorization applies to every operation. Password sessions last seven days; use the actual `expiresAt`. POST `/auth/refresh` with the bearer returns a replacement session and invalidates the old token. Adopt it atomically. POST `/auth/logout` revokes the presented session; POST `/auth/logout-all` revokes every session for the account. Revoked/expired tokens are refused. Keep tokens out of URLs and logs.

## Reads and pagination

POST `/q/chat.inbox` with `{"args":{}}` returns `{data,complete,next,seq,...}`. `data` contains membership objects with `conversationId`, `conversation` (`kind`, `name`, `description`), `latest`, `roster` profiles, and the caller's `state` (read/delivered timestamps). To find a named group, page this list and match `conversation.name`; for a DM match the other roster profile's `handle`. Continue with `{"args":{"c":<next>}}` until `next` is null. Preserve the opaque cursor as JSON; do not interpret it. Inbox pages contain up to 100 conversations.

POST `/q/chat.history` with `{"args":{"conversationId":"…"}}` returns the latest 50 messages, newest first by `(arrival,id)`. Continue older history with `{"args":{"conversationId":"…","c":<next>}}`. No cursor means latest. `next` controls continuation; `complete:false` can also mean authorization or a meter limited the result. Do not assume an incomplete page is the entire corpus.

Each history message exposes:

| Field | Meaning |
|---|---|
| `id`, `conversationId`, `senderId` | Opaque message, conversation and principal IDs |
| `at` | Authoritative display timestamp, Unix ms |
| `arrival` | Transactionally serialized per-conversation order, distinct even within one millisecond |
| `kind` | `text`, `image`, or `video` |
| `text` | Text or media caption |
| `photo`, `oncePhoto`, `video` | Nullable asset reference `{id,…}`; `oncePhoto` is view-once |
| `edited`, `deleted` | Edited flag and deletion tombstone flag |
| `replyToId`, `quote` | Nullable quoted message ID and visible referenced message |
| `reactions` | Array of `{emoji,count,mine}`; one reaction per caller |
| `receipt` | For own messages: `sent`, `delivered`, or `read`; otherwise null |
| `sender` | Public profile or null |
| `expiresAt`, `viewed` | Optional expiry time and caller's once-open state |

Optional/null media or reply fields may be absent. A tombstone has empty text and no media. Expired messages disappear. GET `/assets/<id>` with the bearer fetches authorized bytes (404 hidden/gone; 410 once consumed). Never prefetch a `oncePhoto`: the first successful GET consumes it for the principal. Do not persist those bytes. Ordinary bytes must be revalidated online and cleared on revocation/expiry; the official local SDK implements this policy.

## Sending and receiving

POST `/m/chat.send` with `{"id":"<unique-write-id>","args":{"messageId":"<unique-message-id>","conversationId":"…","text":"Hello","replyToId":null}}`. IDs can be UUIDs. Success is `{state:"sent",id,seq,result:{id}}`; failure is `{state:"failed",id,why}`. Retry the exact envelope with the same write ID after transport uncertainty: it applies at most once. Never advance a fixture action on a queued/non-authoritative response. Text is at most 2,000 characters and must be nonempty after trimming. Only current members can send.

Receiving uses documented polling: query the latest history every second while the conversation is open; merge by ID, update edits/reactions/tombstones, and use pagination for gaps. Poll `/q/chat.inbox` for new conversation activity. The SDK instead follows the change stream. A custom client that wants to count as connected may hold GET `/changes?since=<seq>&wait=25&heartbeat=1`, tolerate whitespace heartbeats, then repeat with its returned sequence; the server retains presence for 35 seconds between polls. Otherwise it can receive push-seam notifications even while polling ordinary queries.

POST `/m/chat.mark` with `{id,args:{conversationId,deliveredAt,readAt,deliveredArrival,readArrival}}` acknowledges fetched content; pass zero for unread. Use the fetched message’s `arrival` for the two arrival watermarks (zero for unread); timestamp-only callers retain compatibility but cannot distinguish arrivals within the same millisecond. Watermarks and timestamps are monotonic and clamped to server now. Acknowledge only content actually received/viewed. Receipt obligations exclude departed members and include all members present when sent. Edits use `/m/media.edit` (`messageId,text`); deletion uses `/m/media.delete` (`messageId`); reactions use `/m/media.react` (`messageId,emoji`, null clears). Server configuration controls edit/delete windows.

Every read can return `{denied:{code,family,message,…}}`; handle this before using `data`. Jobs and service routes are not callable by user tokens. Unknown arguments and invalid values are refused.

Run the dependency-free demo from a clean checkout with Node 24:

```sh
CLIQUE_EMAIL=alice@example.com CLIQUE_PASSWORD='[REDACTED_LITERAL]' node scripts/custom-client-demo.mjs
# Or CLIQUE_TOKEN='[REDACTED_LITERAL]' CLIQUE_CHAT_ID='<conversation ID>' node scripts/custom-client-demo.mjs
```

It authenticates (or uses the token), lists conversations, follows a history cursor when present, sends one message, and receives it by polling. It prints no token. The backend and starter data must already be running; the script has no local database dependency.

## M7: group polls and message counts

`chat.conversation`, `chat.inbox`'s nested conversation, and `chat.group` now
expose `messageCount`, including zero for empty conversations. This field is
backed by a stored Quarry sum of each message's backfilled `countWeight`.
Visible text, media, and poll messages contribute one; tombstones contribute
zero. Expired contributions are removed by the server's expiry sweep (within
one second); message reads themselves refuse expired rows immediately.

`kind` additionally supports `poll`; its `text` is the question. Create through
POST `/m/polls.create` with the standard `{id,args}` envelope:

```json
{"id":"client-write-uuid","args":{"messageId":"message-uuid","conversationId":"group-id","question":"Where?","options":["Park","Cafe"],"optionKeys":["park","cafe"]}}
```

Only current group members can create polls. Questions are 1–200 characters;
there are 2–4 nonblank options of 1–50 characters, with distinct immutable keys
(1–128 characters). Poll questions/options are immutable after creation; the
sender can delete the poll within the normal message deletion window.

POST `/q/polls.view` with `{"args":{"messageId":"message-uuid"}}` returns
`data.question`, `data.options` (creation order: `key`, `label`, `count`), and
`data.vote` (null or the caller's `optionKey`). All current members can read
these live tallies. POST `/m/polls.vote` with
`{"id":"client-vote-uuid","args":{"messageId":"message-uuid","optionKey":"cafe"}}`
sets the caller's vote. There is one row per caller/poll. A new intent may
change it; retry the same envelope and ID after an uncertain result. Replaying
an older acknowledged intent cannot overwrite a later choice. A new ID with
the same choice also leaves counts unchanged. The app's local SDK generates
mutation IDs, durably queues votes offline, predicts the selected option with
a pending marker, and reconciles on reconnect through its standard outbox.
