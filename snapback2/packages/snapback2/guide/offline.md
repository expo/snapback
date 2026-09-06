# Offline

`offline.store`: web IndexedDB, Expo SQLite, Node files.
Expiry seals; sign-out/replacement wipes. One writer (E_OFFLINE_LOCK). `fenceDays` (1..30) bounds trust: past it, reads are stale
and prediction/replay wait for resume. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`client.subscribe(op, args, listener, { drain: true })` and
`useQuery(op, args, { drain: true })` download pages then watch the final tail.
Use an ascending append log (`after c first N`, N <=50); append edit/removal
events for history. Callbacks/hooks emit one page; the store holds coverage. History is not kept live.

Every possible return must continue a certified ascending page through the
same Cursor argument, through aliases/shapes/branches. Auxiliary reads confer none. Mixed-order/non-page returns refuse E_OFFLINE_RESUME with
`reason: "unsupported-log"`, `op`, `shape`, before watermark/catch-up.
For newest-first data, subscribe normally at `c: null`; fetch older pages
with opaque `next`, keeping scope/state/freshness. `last N` stays valid. `caughtUp` means exhaustion; `live` means an active tail.

Offline drains need held eligibility metadata; missing metadata needs reconnect. Repeated cursors refuse; offline traversal preserves the
server watermark. Covered reads are exact; others partial.

## Recovery

`run()` queues offline: `{ state: "queued", intent, ids }`; replay is FIFO.
`useOutbox()` exposes entries/dismiss/ready/status/fence (inside/past).
`useMutation(op).status` and `client.outbox.status(op)` explain readiness:
reason ready/sealed/grant-missing/grant-expired/ids-exhausted/program-missing;
action none/login/resume/load-program; remaining queued count and fence.
Expired grants stop new writes; the owner judges queued intents.
Predicted previews; committed confirms.

`outbox.drain()`/`settled()` return `{ stopped, remaining }`: false means drained;
fence/transport/authority/offline/pending explains a pause. Transport pauses keep
queued bytes. Retry via `online()` or online `outbox.drain()`. Reconnect alone promises no
replay. Chat offers **Sync now** and keeps refused drafts.

## Resume and custody

Equal validators yield unchanged. `/api/manifest` carries retention;
`GET /api/program?generation=` supplies schema, IR, certificates and drain metadata.

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
runs log then mounted, to 1 MiB (`more` past it).
Only E_OFFLINE_RESUME `{ reason: "limit", which: "mounted", cap }` permits one
smaller retry (mounted <=32). Other refusals never drop log.
Backward watermarks keep the hook refused and `online()`
rejected across reopen. Coverage, valid grants, pinned IDs and queued bytes stay.
Explicit `outbox.drain()` may replay within existing trust,
skipping an unsupported settlement tail. Write success leaves
`online()` rejected.

E_OFFLINE_RESET drops coverage, keeps outbox, fetches program, re-resumes.
Stale authEpoch seals (E_AUTH_SESSION); foreign delivery refuses
E_OFFLINE_AUTHORITY, preserving coverage. Without facts, query a receipt then
resume; without a query, refuse and keep the queue.

## Grants, conflicts and bytes

Login/guest/resume mint principal-bound grants for 30 days when remaining IDs
are absent or below1024. Replay carries `{ grant, offset, count, intent, trace }`.
Identical bytes return the stored terminal despite operation/schema changes;
session required. Different bytes: E_OFFLINE_INTENT_REUSE. Invalid
slice: E_OFFLINE_ID_BLOCK. Owner expiry: E_OFFLINE_INTENT_EXPIRED. A 503 after
commit never double-sends. Changed traced points/verdicts: E_OFFLINE_CONFLICT;
ranges re-execute. Past-fence traces are empty; program checks still apply.
Use compare-and-set `require msg.body = baseBody else CONFLICT` for edits.

Bytes share row leases, keyed (assetId,width), under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache or offline fetch, including aliases
and predictions. Offline media is null; online bytes stay in the viewing
instance's memory. Repeats: E_ASSET_VIEWED (assets,410).
E_OFFLINE_CARRIER: configure carrier. E_OFFLINE_STATE: preserve/inspect state.
E_OFFLINE_DELIVERY: retry authenticated query. E_OFFLINE_LIFECYCLE: sign in/reopen.
Keep queued writes.
