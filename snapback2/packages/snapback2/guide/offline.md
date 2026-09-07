# Offline

`offline.store`: IndexedDB (web), SQLite (Expo), files (Node).
Expiry seals; sign-out/replacement wipes. One writer/account. Second web tab:
live reads, writes E_OFFLINE_FOLLOWER, inherits partition/queue on writer close;
elsewhere E_OFFLINE_LOCK. Past `fenceDays` (1..30), reads
are stale; prediction/replay await resume. Queued writes survive; held reads/`offline()`
bypass startup auth.

## Drain

`client.subscribe(op, args, listener, { drain: true })` and
`useQuery(op, args, { drain: true })` page then watch the tail.
Use an ascending append log (`after c first N`, N <=50); append edit/removal
events for history. Callbacks emit one page; held coverage is not live history.

Every return needs a certified ascending page via the same Cursor argument
(aliases/shapes/branches too); auxiliary reads confer none. Mixed-order/non-page returns refuse E_OFFLINE_RESUME with
`reason: "unsupported-log"`, `op`, `shape`, before watermark/catch-up.
Newest-first: subscribe at `c: null`; page older with opaque `next`. `caughtUp`: exhausted; `live`: active tail.

Offline drains need held eligibility or reconnect. Repeated cursors refuse;
offline traversal keeps server watermark. Covered reads exact; others partial.

## Recovery

`run()` queues offline: `{ state: "queued", intent, ids }`; replay is FIFO.
`useOutbox()`: entries/dismiss/ready/status/fence (inside/past).
Readiness: `useMutation(op).status`, `client.outbox.status(op)`:
reason: ready/sealed/grant-missing/grant-expired/ids-exhausted/program-missing/follower;
action: none/login/resume/load-program; remaining: queued count; fence.
Expired grants stop admission; owner judges queued writes.
Prediction previews; commit confirms.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false means drained;
fence/transport/authority/offline/pending means paused; queued bytes stay.
Retry `online()` or online `outbox.drain()`; reconnect alone replays nothing.
Unclaimed media expires 24h after creation/last release; grants/leases never extend it.
After a replay refusal use a new upload/intent; never rewrite queued args.

## Resume

Equal validators: unchanged. `/api/manifest`: retention;
`GET /api/program?generation=`: schema, IR, certificates, drain metadata.

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
runs log then mounted, to 1 MiB (`more` past it).
Only E_OFFLINE_RESUME `{ reason: "limit", which: "mounted", cap }` permits one
smaller retry (mounted <=32); other refusals never drop log.
Backward watermarks keep hooks/`online()` refused across reopen; coverage,
valid grants, pinned IDs and queued bytes stay. `outbox.drain()` may replay
within existing trust, skipping unsupported settlement tails; write success
keeps `online()` refused.

E_OFFLINE_RESET: drop coverage, keep outbox, fetch `/api/program`,
re-resume.
Stale authEpoch seals: E_AUTH_SESSION. Foreign delivery: E_OFFLINE_AUTHORITY,
coverage retained. No facts: query a receipt then resume; no query: refuse,
keep queue.

## Grants and bytes

Login/guest/resume: 30-day principal-bound grants if remaining IDs absent/<1024.
Replay `{ grant, offset, count, intent, trace }` needs session; same bytes
reuse terminals across op/schema changes. Changed bytes: E_OFFLINE_INTENT_REUSE;
bad slice: E_OFFLINE_ID_BLOCK; expiry: E_OFFLINE_INTENT_EXPIRED.
Traced points/verdicts conflict: E_OFFLINE_CONFLICT; ranges rerun.
Rule verdicts bind the whole schema; even an additive column may conflict.
Read current data, then submit a new intent; never rewrite queued args/trace.
Past-fence traces empty; program checks apply.

```quarry
mutation edit(id: messages, base: text <=4000, body: text <=4000):
  m = messages[id] ! else MISSING
  require m.body = base else CONFLICT
  update messages[id] { body }
```

Bytes share row leases, keyed (assetId,width), under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache or offline fetch (aliases, predictions
too). Offline media is null; online bytes stay in the viewing instance's memory. Repeats: E_ASSET_VIEWED (assets,410).
E_OFFLINE_CARRIER: configure carrier. E_OFFLINE_STATE: inspect state.
E_OFFLINE_DELIVERY: retry authenticated query. E_OFFLINE_LIFECYCLE: sign in/reopen.
E_OFFLINE_FOLLOWER: write from the writer tab.
