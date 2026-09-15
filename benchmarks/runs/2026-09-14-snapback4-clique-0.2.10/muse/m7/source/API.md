# Clique API

Headless HTTP API for the Clique social messenger, served by the lane
backend (default `http://127.0.0.1:49340`). Everything below was verified
against the running server; the companion
`scripts/custom-client-demo.mjs` exercises the core flow with plain
`fetch` and no dependencies.

## Auth

`POST /auth/signup` and `POST /auth/login` take
`{ "email", "password" }` and return `{ "session": { "token",
"principal", ... } }`. Pass the token as
`Authorization: Bearer <token>` on every `/m` and `/q` call.

## Mutations — `POST /m/<op>`

Body: `{ "id": "<client request id>", "args": { ... } }`. The `id`
makes writes idempotent: re-sending the same `id` returns the first
result instead of applying twice. Response: `{ "state": "sent",
"result": ... }` on admit, or `{ "state": "failed", "why": {
"code": "NOT_MEMBER", ... } }` when a rule refuses. Common codes:
`NOT_MEMBER`, `NOT_ADMIN`, `NOT_AUTHOR`, `NOT_FOUND`,
`ALREADY_VIEWED`, `DELETE_WINDOW`, `EDIT_WINDOW`, `E_RULE`.

## Queries — `POST /q/<op>`

Body: `{ "args": { ... } }`. Response: `{ "data": [...] }`, or
`{ "denied": { "code": ... } }` when the viewer may not read.

## Paging

List queries accept `{ "c": <cursor|null> }` and return page arrays;
`historyPage` rows additionally carry `total` (conversation message
count). `threadMessages` returns newest-first message rows
(`id`, `conversationId`, `authorId`, `kind`, `body`, `photo`,
`clip`, `photoOnce`, `quoteId`, `tombstone`, `editedAt`,
`expiresAt`, `at`).

## Core operations

- `upsertProfile { displayName, handle, ... }` — claim a profile.
- `dmCreate { otherHandle }` → `{ id }` — open (or return) a DM.
- `groupCreate { secondMemberHandle, name, description? }` → `{ id }`.
- `sendText { conversationId, body, quoteId? }` → `{ id }`.
- `sendMedia { conversationId, mediaKind: "image"|"video", photo?,
  clip?, caption?, viewOnce }` → `{ id }`. Upload bytes first (below).
- `editMessage { messageId, text }`, `deleteMessage { messageId }`
  (author only, inside the edit/delete windows).
- `reactMessage { messageId, emoji }` (`"none"` removes; one row per
  user per message).
- `openViewOnce { messageId }` → `{ id }` — first open records a
  view; a second open fails `ALREADY_VIEWED`.
- `memberAdd/memberRemove/promoteAdmin { conversationId, handle }`,
  `leaveChat { conversationId }`, `renameChat`,
  `setChatDescription`, `setChatColor` (one of `indigo teal coral
  amber violet emerald rose slate`), `setChatBackground { id }`,
  `setDisappearing` (`off|24h|7d`) — group writes need admin.
- Polls (group or DM, any member may create; one changeable vote per
  user as an idempotent set-state intent carrying the client mutation
  `id` — re-sending the same `id` replays without flipping state):
  `createPoll { conversationId, pollId?, question (≤200 chars),
  optionIds (2–4 stable client-chosen ids, ≤64 chars), labels (2–4,
  ≤50 chars each) }` → `{ id }` (refusals: `BAD_OPTIONS`,
  `EMPTY_BODY`); `pollVote { pollId, optionId }` → `{ voted, optionId }`
  (refusals: `NOT_A_POLL`, `BAD_OPTION`); `pollState { pollId }` →
  `{ question, options: [{ id, label, tally, mine }], total, myOption }`
  with live tallies for every member. Poll messages have `kind: "poll"`
  and `pollQuestion`; they count as messages, carry receipts, and queue
  offline like reactions.
- Message counts: `convoMessageCount { conversationId }` →
  `{ conversationId, count }` — currently visible messages only
  (tombstoned and expired excluded; polls count), backfilled over all
  existing conversations and maintained forward; also shown in chat
  settings.
- Reads: `inbox {}`, `membersOf { conversationId }`,
  `convoReactions { conversationId }`, `myViews { conversationId }`,
  `typingIn { conversationId }`, `convLatest {}`,
  `convoAggregates { conversationId, msgIds }`,
  `searchPeople { q }`, `searchChat { conversationId, q }`,
  `searchAll { q }`, `searchAllOnline { q }`,
  `profileByHandle { handle }`, `myWindows {}`.

## Assets

`POST /assets` with `Content-Type: application/octet-stream` and the
bearer token returns `{ "asset": { "id", ... } }`. `GET
/assets/<id>` (same bearer token) returns the bytes; a view-once
asset is refused once viewed, and revoked/expired assets are denied.

## Receiving new messages

Poll `POST /q/threadMessages` with `{ conversationId }` and compare
row ids against the last seen set (see `receiveNew` in
`scripts/custom-client-demo.mjs`). New rows arrive newest-first;
`at` is the server arrival timestamp.

## Example: latest message of a named conversation

```sh
T=$(curl -s $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"[REDACTED_LITERAL]"}' | \
  python3 -c 'import sys,json; print(json.load(sys.stdin)["session"]["token"])')
INBOX=$(curl -s $BASE/q/inbox -H "authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"args":{}}')
CID=$(echo "$INBOX" | python3 -c \
  'import sys,json; print([r for r in json.load(sys.stdin)["data"] if r["conversation"].get("name")=="Weekend Plans"][0]["conversationId"])')
curl -s $BASE/q/threadMessages -H "authorization: Bearer $T" \
  -H 'content-type: application/json' \
  -d "{\"args\":{\"conversationId\":\"$CID\"}}" | python3 -c \
  'import sys,json; print(json.load(sys.stdin)["data"][0])'
```
