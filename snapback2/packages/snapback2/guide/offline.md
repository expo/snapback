# Offline

`offline.store`: a durable carrier (React web: IndexedDB; journeys/Node tests:
`snapback2/test`'s file carrier); `E_OFFLINE_CARRIER` if it can't open, never
memory. Per principal: terminal session expiry seals it until that principal
re-authenticates; sign-out or a new principal wipes it; one writer each
(`E_OFFLINE_LOCK`). `offline.fenceDays` (1..30) bounds trust, not reading:
past it no predicting or replay until a resume succeeds; held answers stay
readable, `stale`. `useQuery(op, args, { drain: true })` drains to `null`,
keeps its watermark, watches the tail. Offline, `run()` resolves `{ state:
"queued", intent, ids }`, durable, replayed FIFO at the next resume;
`useOutbox()` is `{ entries, dismiss }`, `useMutation().pending` its queued
ones, `client.outbox.drain()` replays now. Fetched asset bytes cache under
their row's lease, keyed `(assetId, width)`, and leave with it;
`offline.maxAssetBytes` (default 256 MiB) caps the LRU.
`offline.viewOnce(table, row)` names render-once rows: viewed, they answer
`null`, never cache, refuse `E_ASSET_VIEWED`.

Certified answers, no replica: `receipt: true` on `POST /api/query` or
`receipt=1` on `/api/subscribe` returns `{ protocol: 1, generation,
schemaHash, planHash, authority, state, data, next, seq, rows, receipt,
validator }`; `rows` pools each row once, `data` and `receipt` cite
`{ "$row": { table, id } }`, an equal `validator` gets `{ state: "unchanged",
seq, validator }`. `GET /api/program?generation=` serves IR, certificates,
schema; `/api/manifest` has `tables[<name>].retain` per generation.

## Resume

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
is one owner action: the log tail after `watermark` (`{ unchanged: true }` if
empty and validator matches, else an envelope and new `watermark`), then each
mounted query, to 1 MiB, then `more` (set if the log alone exceeds it). The
log op pages ascending, `after c first <=50`; mounted caps at 32
(`E_OFFLINE_RESUME` 413, `which`). Changed program or schema:
`E_OFFLINE_RESET` (409) with the live `{ generation, schemaHash }`; drop held
coverage, keep the outbox, fetch `/api/program`, cold-drain. Stale
`authEpoch`: `E_AUTH_SESSION`. No subscription reopens.

## Grants

Login, guest, resume return `grant: { id, from, count: 8192, mintedAt,
expiresAt }` (principal-bound engine ids, server time, 30 days) if
`remaining`, the client's unused ids, is absent or under 1024.
`POST /api/mutation { op, args, replay: { grant, offset, count, intent:
"<grant>:<offset>", trace } }` injects ids `from + offset …` as the program's
`new` envelope. Refusals: `E_OFFLINE_INTENT_EXPIRED` (grant unknown, foreign,
or expired), `E_OFFLINE_ID_BLOCK` (slice outside the grant or already
settled), `E_OFFLINE_INTENT_REUSE` (same intent, other bytes). Same bytes
twice get the stored response unexecuted; a post-commit 503 never
double-sends.

## Conflict

`trace: { points: [{ table, index, key, digest }], verdicts: [{ ruleHash,
inputsDigest, result }] }` is the client's read set when queuing: each point's
row digest (SHA-256 of the canonical wire row; `null` if absent), each rule
verdict, `inputsDigest` = SHA-256 of the JSON `[table, index, key]`, keys in
wire form. At commit the server executes on current rows, then compares in
the transaction; a moved point or verdict rolls back: `{ state: "rejected",
reason: "conflict", site, intent }` (`E_OFFLINE_CONFLICT`). Ranges re-execute
fresh, never validated: a fan-out uses members at commit. The compare-and-set
edit, universal:

```q
mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'edit', at: now }
  return null
```
