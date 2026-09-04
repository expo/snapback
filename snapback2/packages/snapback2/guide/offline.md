# Offline

`offline.store`: IndexedDB or test files; `E_OFFLINE_CARRIER` if unavailable.
Session expiry seals; sign-out or replacement wipes;
one writer (`E_OFFLINE_LOCK`). `offline.fenceDays` (1..30) bounds trust, not
reading: past it no predicting or replay until a resume succeeds; held
answers read `stale`. `useQuery(op, args, { drain: true })` drains to `null`
by its `Cursor`, then watches the tail. Offline `run()` resolves
`{ state: "queued", intent, ids }`, replayed FIFO after resume.
`useOutbox()` exposes `entries`, `dismiss`, `ready` (current grant or no partition),
and `fence: "inside" | "past"`. `client.outbox.drain()` replays;
it and `settled()` return `{ stopped: "fence" }` when resume is needed.
The twin evaluates held rows: exact if covered, else `partial` with `reason`.
Asset bytes share their row's lease, keyed `(assetId, width)`;
`offline.maxAssetBytes` (256 MiB) caps an LRU. `offline.viewOnce(table, row)`
marks an image at fetch, a clip at play (`assetCache.markViewed`): then the
row reads `null`, `useAssetUrl` mints no URL, `assetBlob` refuses `E_ASSET_VIEWED`.

Answers: `receipt: true` on `POST /api/query` or
`receipt=1` on `/api/subscribe` returns `{ protocol: 1, generation,
schemaHash, planHash, authority, state, data, next, seq, rows, receipt,
validator }`; `rows` pools each row once, `data` and `receipt` cite
`{ "$row": { table, id } }`, an equal `validator` gets `{ state: "unchanged",
seq, validator }`. `GET /api/program?generation=`: IR, certificates, schema;
`/api/manifest` has `tables[<name>].retain`.

## Resume

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
is one owner action: the log tail (`{ unchanged: true }` or an envelope
and `watermark`), then mounted queries, to 1 MiB (`more` past it).
The log op pages ascending, `after c
first <=50`; mounted caps at 32 (`E_OFFLINE_RESUME` 413, `which`). New
program or schema: `E_OFFLINE_RESET` (409) with the live `{ generation,
schemaHash }`; drop held coverage, keep the outbox, fetch `/api/program`,
cold-drain. Stale `authEpoch`: `E_AUTH_SESSION`. Another partition's delivery:
`E_OFFLINE_AUTHORITY`, coverage kept.
No facts: query for a receipt, then logless resume. No query:
`E_OFFLINE_RESUME`; keep the queue.

## Grants

Login, guest, resume return `grant: { id, from, count: 8192, mintedAt,
expiresAt }` (principal-bound, 30 days) if `remaining`, the client's unused
ids, is absent or under 1024. `POST /api/mutation { op, args, replay: {
grant, offset, count, intent: "<grant>:<offset>", trace } }` injects ids
`from + offset …` as the `new` envelope. Refusals:
`E_OFFLINE_INTENT_EXPIRED` (unknown, foreign, or expired grant),
`E_OFFLINE_ID_BLOCK` (slice outside the grant or settled),
`E_OFFLINE_INTENT_REUSE` (same intent, other bytes). Same bytes twice get the
stored response; a 503 never double-sends.

## Conflict

`trace: { points: [{ table, index, key, digest }], verdicts: [{ ruleHash,
inputsDigest, result }] }` is the read set at queue time: each point's row
digest (SHA-256 of the canonical wire row, `null` if absent), each verdict's
`inputsDigest` (SHA-256 of wire `[table, index, key]`). At commit the server
executes on current rows and compares; a moved point or verdict rolls back:
`{ state: "rejected", reason: "conflict", site, intent }`
(`E_OFFLINE_CONFLICT`). Ranges re-execute unvalidated: a fan-out uses members
at commit. Past-fence entries have `predicted: false, reason: "fence"` and
an empty trace: only the program checks conflicts. The compare-and-set edit:

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
