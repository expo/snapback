# Offline

A client holds certified answers, never a replica. Ask for the envelope with
`receipt: true` on `POST /api/query` or `receipt=1` on `/api/subscribe`:
`{ protocol: 1, generation, schemaHash, planHash, authority, state, data,
next, seq, rows, receipt, validator }`. `rows` is the pool (each row once);
`data` and the receipt reference rows as `{ "$row": { table, id } }`. Echo
`validator` to get `{ state: "unchanged", seq, validator }` instead of a full
delivery. `GET /api/program?generation=` serves the certified IR and
certificates once; `/api/manifest` carries `tables[<name>].retain` per
generation.

## Resume

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, log: { op,
args, watermark, validator }, mounted: [{ op, args, validator }] }` is one
owner action: the log tail after `watermark` (`{ unchanged: true }` when the
tail is empty and the validator matches, else the envelope plus a new
`watermark`), then each mounted query (`unchanged` by validator or the
envelope), stopping at 1 MiB with `more`. Mounted is capped at 32
(`E_OFFLINE_RESUME`, 413). A changed program or schema answers
`E_OFFLINE_RESET` (409) with the current `{ generation, schemaHash }`: drop
held coverage, keep the outbox, fetch `/api/program`, cold-drain. A stale
`authEpoch` refuses `E_AUTH_SESSION`. Subscriptions are never reopened.

## Grants

Login, guest, and resume return `grant: { id, from, count: 8192, mintedAt,
expiresAt }`: engine ids bound to the principal (any session of it may spend
them), minted with server time, good for 30 days. Pin ids from a grant before
the server has seen the write.

## Replay

`POST /api/mutation { op, args, replay: { grant, offset, count, intent:
"<grant>:<offset>", trace } }` injects ids `from + offset …` as the program's
`new` envelope. Refusals: `E_OFFLINE_INTENT_EXPIRED` (grant unknown, another
principal's, or past 30 days by the server clock), `E_OFFLINE_ID_BLOCK` (slice
outside the grant or overlapping a settled intent), `E_OFFLINE_INTENT_REUSE`
(same intent, different bytes). The same bytes twice return the stored
response without executing, so a 503 after a commit is never a double send; a
rejection replays as the same rejection.

## Conflict

`trace: { points: [{ table, index, key, digest }], verdicts: [{ ruleHash,
inputsDigest, result }] }` is what the client read when it queued the write:
each point read's row digest (SHA-256 of the canonical wire row, as the pool
carries it) or `null` for an absence, and each rule verdict. At commit the
server executes against current rows, then compares inside the same
transaction; a moved point or verdict rolls the write back and answers
`{ state: "rejected", reason: "conflict", site, intent }`. Ranges re-execute
fresh and are never validated, so a fan-out uses the members at commit. It is
the compare-and-set edit, made universal:

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

## Client options

`offline: { fenceDays: 7 }` (1..30) bounds trust: past it the client stops
predicting and replaying until a resume succeeds, and labels views `stale`.
`offline: { maxAssetBytes }` (default 256 MiB) caps cached bytes.
`useQuery(op, args, { drain: true })` follows `next` to `null` and keeps the
watermark; `useOutbox()` lists queued intents with `dismiss(intent)`.
