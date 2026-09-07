# Offline

`offline.store`: IndexedDB (web), SQLite (Expo), files (Node).
Expiry seals; sign-out/replacement wipes. One writer per account; a second web tab
follows (live reads, writes refuse E_OFFLINE_FOLLOWER, inherits partition and queue
when the writer closes); elsewhere E_OFFLINE_LOCK. Past `fenceDays` (1..30), reads
are stale; prediction/replay await resume. Queued writes survive; held reads/`offline()`
bypass startup auth.

## Drain

`client.subscribe(op, args, listener, { drain: true })` and
`useQuery(op, args, { drain: true })` page then watch the tail.
Use an ascending append log (`after c first N`, N <=50); append edit/removal
events for history. Callbacks emit one page; held coverage is not live history.

Every return must continue a certified ascending page via the same Cursor argument
(aliases/shapes/branches too); auxiliary reads confer none. Mixed-order/non-page returns refuse E_OFFLINE_RESUME with
`reason: "unsupported-log"`, `op`, `shape`, before watermark/catch-up.
Newest-first: subscribe at `c: null`; page older with opaque `next`. `caughtUp`: exhausted; `live`: active tail.

Offline drains need held eligibility metadata or reconnect. Repeated cursors
refuse; offline traversal keeps the server watermark. Covered reads are exact; others partial.

## Recovery

`run()` queues offline: `{ state: "queued", intent, ids }`; replay is FIFO.
`useOutbox()`: entries/dismiss/ready/status/fence (inside/past).
`useMutation(op).status` and `client.outbox.status(op)` explain readiness:
reason: ready/sealed/grant-missing/grant-expired/ids-exhausted/program-missing/follower;
action: none/login/resume/load-program; remaining: queued count; fence.
Expired grants stop new writes; the owner judges queued ones.
Predicted previews; committed confirms.

`outbox.drain()`/`settled()` return `{ stopped, remaining }`: false means drained;
fence/transport/authority/offline/pending explains a pause; queued bytes stay. Retry via
`online()` or online `outbox.drain()`; reconnect alone replays nothing.
Unclaimed media expires 24h after creation/last release; grants/leases never extend it.
After a replay refusal use a new upload/intent; never rewrite queued args.

## Resume

Equal validators: unchanged. `/api/manifest` carries retention;
`GET /api/program?generation=` supplies schema, IR, certificates, drain metadata.

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
runs log then mounted, to 1 MiB (`more` past it).
Only E_OFFLINE_RESUME `{ reason: "limit", which: "mounted", cap }` permits one
smaller retry (mounted <=32); other refusals never drop log.
Backward watermarks keep the hook refused and `online()`
rejected across reopen. Coverage, valid grants, pinned IDs and queued bytes stay.
Explicit `outbox.drain()` may replay within existing trust,
skipping an unsupported settlement tail. Write success leaves
`online()` rejected.

E_OFFLINE_RESET: drop coverage, keep outbox, fetch program, re-resume.
Stale authEpoch seals (E_AUTH_SESSION); foreign delivery refuses
E_OFFLINE_AUTHORITY, preserving coverage. Without facts, query a receipt then
resume; without a query, refuse and keep the queue.

## Grants and bytes

Login/guest/resume mint 30-day principal-bound grants when remaining IDs
are absent or below 1024. Replay carries `{ grant, offset, count, intent, trace }`.
Identical bytes return stored terminals despite operation/schema changes;
session required. Different bytes: E_OFFLINE_INTENT_REUSE. Invalid
slice: E_OFFLINE_ID_BLOCK. Owner expiry: E_OFFLINE_INTENT_EXPIRED. A 503 after
commit never double-sends. Changed traced points/verdicts: E_OFFLINE_CONFLICT;
ranges re-execute. Past-fence traces are empty; program checks still apply.
Compare-and-set edits: `require msg.body = baseBody else CONFLICT`.

Bytes share row leases, keyed (assetId,width), under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache or offline fetch (aliases, predictions
too). Offline media is null; online bytes stay in the viewing instance's memory. Repeats: E_ASSET_VIEWED (assets,410).
E_OFFLINE_CARRIER: configure carrier. E_OFFLINE_STATE: inspect state.
E_OFFLINE_DELIVERY: retry authenticated query. E_OFFLINE_LIFECYCLE: sign in/reopen.
E_OFFLINE_FOLLOWER: write from the writer tab.
