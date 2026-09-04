# Offline

Pass a durable carrier through the client's `offline.store` option (React web:
IndexedDB; journeys and Node tests: the file carrier from `snapback2/test`).
`E_OFFLINE_CARRIER`: it could not open; memory is never substituted. The store
is partitioned by principal: a terminal session expiry seals it until that
principal authenticates again; sign-out or another principal wipes it; one
writer per principal (`E_OFFLINE_LOCK`). `offline.fenceDays` (1..30) bounds
trust, not reading: past it the client stops predicting and replaying until a
resume succeeds and labels views `stale`; held answers stay readable.
`useQuery(op, args, { drain: true })` follows `next` to `null`, keeps the
watermark, watches the tail; `useOutbox()` lists queued intents. Asset bytes
the components fetched are cached under the owning row's lease, keyed
`(assetId, width)`, and leave in the swap that evicts the row;
`offline.maxAssetBytes` (default 256 MiB) is the LRU ceiling.
`offline.viewOnce(table, row)` names rows that render once: viewed, they answer
`null`, are never cached, and refuse `E_ASSET_VIEWED`.

A client holds certified answers, never a replica. Ask for the envelope with
`receipt: true` on `POST /api/query` or `receipt=1` on `/api/subscribe`; `rows`
is the pool (each row once), `data` and the receipt reference rows as
`{ "$row": { table, id } }`; an equal `validator` answers `{ state: "unchanged",
seq, validator }`.
`GET /api/program?generation=` serves the IR, certificates, and schema;
`/api/manifest` carries `tables[<name>].retain` per generation.

## Resume

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
is one owner action: the log tail after `watermark` (`{ unchanged: true }` for
an empty tail with a matching validator, else the envelope plus a new
`watermark`), then each mounted query, stopping at 1 MiB with `more` (set when
the log alone exceeds it). The log op must page ascending, `after c first
<=50`; mounted is capped at 32 (`E_OFFLINE_RESUME` 413, `which`). A changed
program or schema answers `E_OFFLINE_RESET` (409) with the current `{
generation, schemaHash }`: drop coverage, keep the outbox, cold-drain. A stale
`authEpoch` refuses `E_AUTH_SESSION`. No subscription reopens.

## Grants and replay

Login, guest, and resume return `grant: { id, from, count: 8192, mintedAt,
expiresAt }` (principal-bound engine ids, server time, 30 days) only when
`remaining`, the client's unused ids, is absent or below 1024.
`POST /api/mutation { op, args, replay: { grant, offset, count, intent:
"<grant>:<offset>", trace } }` injects ids `from + offset …` as the program's
`new` envelope. Refusals: `E_OFFLINE_INTENT_EXPIRED` (grant unknown, foreign,
or past 30 days), `E_OFFLINE_ID_BLOCK` (slice outside the grant or already
settled), `E_OFFLINE_INTENT_REUSE` (same intent, different bytes). The same
bytes twice return the stored response without executing.

## Conflict

`trace: { points: [{ table, index, key, digest }], verdicts: [{ ruleHash,
inputsDigest, result }] }` is what the client read when it queued the write:
each point read's row digest (SHA-256 of the canonical wire row) or `null` for
an absence, and each rule verdict with `inputsDigest` = SHA-256 of the JSON
`[table, index, key]`, key values in wire form. At commit the server executes,
then compares in the same transaction; a moved point or verdict rolls the
write back: `{ state: "rejected", reason: "conflict", site, intent }`. Ranges
re-execute fresh, never validated. The compare-and-set edit, universal:

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
