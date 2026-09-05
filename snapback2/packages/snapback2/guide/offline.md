# Offline

`offline.store`: IndexedDB on web, SQLite on Expo, test files in Node.
Session expiry seals; sign-out or replacement wipes. One writer per partition
(`E_OFFLINE_LOCK`). `offline.fenceDays` (1..30) bounds trust: past it, held
reads are stale and prediction/replay wait for resume; queued writes survive.
Held reads and `offline()` do not wait for startup authentication.

`useQuery(op, args, { drain: true })` follows its Cursor to null, then watches
the tail. Cold offline starts restore the cursor name from the held program;
a repeated cursor refuses. Offline traversal preserves the server watermark.
Covered reads are exact; others partial.

## Sending and recovery

Offline `run()` resolves `{ state: "queued", intent, ids }`; replay is FIFO.
`useOutbox()` exposes entries, dismiss, ready, status and fence (inside/past).
`useMutation(op).status` or `client.outbox.status(op)` explains readiness:

- reason: ready, sealed, grant-missing, grant-expired, ids-exhausted, program-missing;
- action: none, login, resume, load-program;
- remaining: queued count; fence: inside/past.

Expired grants disable new writes; existing intents await the server's verdict.
A queued entry's predicted flag marks a preview; committed confirms acceptance.
`outbox.drain()` and `settled()` return `{ stopped, remaining }`: false means
drained; fence, transport, authority, offline or pending explains a pause. Transport
pauses keep queued bytes. Use `client.online()` to resume and retry,
or `outbox.drain()` to retry online. Subscription reconnect alone does not
promise replay. The chat offers **Sync now** and keeps refused drafts.

## Resume and custody

An equal receipt validator yields unchanged.
`GET /api/program?generation=` supplies schema, IR and certificates;
`/api/manifest` carries retention.

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
is one owner action: log tail, then mounted queries, to 1 MiB (more past it).
The log pages ascending, first <=50; mounted caps at 32 (E_OFFLINE_RESUME).
E_OFFLINE_RESET: drop coverage, keep the outbox, fetch `/api/program`,
re-resume. Stale authEpoch seals (E_AUTH_SESSION); another partition's
delivery refuses E_OFFLINE_AUTHORITY, keeping coverage. Without facts, query
for a receipt then resume; without a query, refuse and keep the queue.

## Grants and conflicts

Login, guest and resume mint principal-bound grants for 30 days when
remaining IDs are absent or below 1024. Mutation replay carries `{ grant, offset, count, intent, trace }`.
Same bytes return the stored terminal, even after operation/schema changes;
a live session is still required. Other bytes refuse E_OFFLINE_INTENT_REUSE.
E_OFFLINE_ID_BLOCK refuses invalid slices; E_OFFLINE_INTENT_EXPIRED is the
server's expiry verdict. A 503 after commit never double-sends.

Changed traced points/verdicts reject as conflict (E_OFFLINE_CONFLICT).
Ranges execute on current rows. Past-fence traces are empty; program checks
still apply. For edits:

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

## Bytes and diagnostics

Bytes share their row's lease, keyed (assetId, width), under maxAssetBytes
(256 MiB LRU). viewOnce marks images at fetch, clips at play (native: memory only): the row then
reads null, no URL is minted and assetBlob refuses E_ASSET_VIEWED.
E_OFFLINE_CARRIER means install/configure the carrier. E_OFFLINE_STATE means
preserve and inspect persisted state; E_OFFLINE_DELIVERY means retry an
authenticated query; E_OFFLINE_LIFECYCLE means sign in or reopen. Refusals
name the operation and recovery; preserve queued writes.
