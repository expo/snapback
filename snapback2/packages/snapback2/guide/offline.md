# Offline

`offline.store`: IndexedDB (web), SQLite (Expo), test files (Node). Expiry seals;
sign-out/replacement wipes. One writer per partition (`E_OFFLINE_LOCK`). Past
`offline.fenceDays` (1..30), held reads are stale and prediction/replay await resume;
queued writes survive. Held reads and `offline()` never wait for startup auth.

`useQuery(op, args, { drain: true })` drains its Cursor, then watches the tail.
Cold offline restores the held cursor name; repeated cursors refuse. Traversal
preserves the server watermark. Covered reads are exact; others partial.

## Sending and recovery

Offline `run()` resolves `{ state: "queued", intent, ids }`; replay is FIFO.
`useOutbox()` exposes entries, dismiss, ready, status and fence (inside/past).
`useMutation(op).status` or `client.outbox.status(op)` explains readiness:

- reason: ready, sealed, grant-missing, grant-expired, ids-exhausted, program-missing;
- action: none, login, resume, load-program;
- remaining: queued count; fence: inside/past.

Expired grants block new writes; existing intents await the server verdict.
A queued entry's predicted flag marks a preview; committed confirms acceptance.
`outbox.drain()` and `settled()` return `{ stopped, remaining }`: false means
drained; fence, transport, authority, offline or pending explains a pause. Transport
pauses keep queued intent bytes. Unclaimed media can expire 24h after creation/latest release;
grants/leases do not extend it. After a replay refusal, use a new upload/intent;
never rewrite queued args (`guide operator`). Resume with `client.online()`,
or `outbox.drain()` to retry online. Subscription reconnect alone does not
promise replay. The chat offers **Sync now** and keeps refused drafts.

## Resume and custody

Equal receipt validators yield unchanged. `GET /api/program?generation=` supplies
schema, IR, certificates; `/api/manifest` carries retention.

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

The membership cap (50/conversation) covers the loop.

## Bytes and diagnostics

Bytes share their row's lease, keyed (assetId, width), under maxAssetBytes
(256 MiB LRU). `image <=N once` comes from the manifest/program schema; there
is no client viewOnce option. Web and native caches refuse such rows even before
viewing. Offline media is null, even in aliases and predictions; no fetch. Memory stays in the viewing instance; repeats refuse E_ASSET_VIEWED (assets, HTTP 410).
E_OFFLINE_CARRIER: install/configure carrier; E_OFFLINE_STATE: inspect persisted
state; E_OFFLINE_DELIVERY: retry authenticated query; E_OFFLINE_LIFECYCLE: sign
in/reopen. Preserve queued writes. Refusals name the operation and recovery.
