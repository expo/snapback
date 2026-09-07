# Offline

`offline.store`: IndexedDB (web), SQLite (Expo), files (Node).

```js
import { createClient } from "snapback2/client";
import { indexedDbRangeStore } from "snapback2/react";
const client = createClient({
  url: "http://127.0.0.1:3210",
  offline: { store: indexedDbRangeStore() },
});
```

Call `indexedDbRangeStore()` to get the factory. Custom factories return a
RangeStore; a result without `open()` fails at setup with `TypeError`.
IndexedDB and Web Locks are required; no memory fallback.

Expiry seals; session
change wipes. One writer/account. Web followers read live, forward
replayable mutations, and inherit its partition/queue on close. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await resume. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`subscribe(..., { drain: true })` and `useQuery(..., { drain: true })` page then
tail. Results require a certified ascending append page (`after c first N`,
N <=50) through one Cursor argument across aliases/shapes/branches; auxiliary
reads confer no coverage. Callbacks emit one page; edits/removals append events;
held coverage is not live history.

Mixed-order/non-page returns refuse E_OFFLINE_RESUME before catch-up with
`reason: "unsupported-log"`, `op`, `shape`. Newest-first starts at `c: null`,
then pages older with opaque `next`. `caughtUp`: exhausted; `live`: tail active.
Offline drains require held eligibility or reconnect. Repeated cursors refuse;
offline traversal retains its watermark. Covered reads exact; others partial.

## Recovery

Offline `run()`: `{ state: "queued", intent, ids }`; replay is FIFO. Follower
queued proves durable admission. A sent request unanswered for
2s returns `{ state: "admission-unknown", recovery }`; never send fresh.
`recoverMutation(op, sameArgs, recovery)` retries the identity. Only a durable
receipt returns queued; unreachable writer/expired miss remains unknown.

`useOutbox()`: entries/dismiss/ready/status/fence. Readiness:
`useMutation(op).status` or `client.outbox.status(op)`. Reasons:
ready/sealed/grant-missing/grant-expired/ids-exhausted/program-missing/follower/
writer-discovery/writer-capacity/writer-unresponsive. Actions:
none/login/resume/load-program. `remaining`: queued; `fence`: inside/past.
Expired grants stop admission; owner judges queued writes. Prediction previews;
commit confirms.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Fence/transport/authority/offline/pending pauses; queued bytes stay. Retry
`online()` or online drain; reconnect does not replay. Unclaimed media expires
after 24h; grants/leases cannot extend it. After refusal,
use a new upload/intent; never rewrite args.

## Resume

Equal validators mean unchanged. `/api/manifest`: retention;
`GET /api/program?generation=`: schema, IR, certificates, drain metadata.

`POST /api/resume { protocol: 1, generation, schemaHash, authEpoch, remaining?,
log?: { op, args, watermark, validator }, mounted: [{ op, args, validator }] }`
runs log then mounted to 1 MiB (`more` beyond). Only E_OFFLINE_RESUME
`{ reason: "limit", which: "mounted", cap }` allows one smaller retry (mounted
<=32); others keep the log. Backward watermarks keep hooks/`online()` refused
across reopen; coverage, grants, pinned IDs and queue stay. Drain may replay in
existing trust, skipping unsupported settlement tails; write success keeps
`online()` refused.

E_OFFLINE_RESET: drop coverage, keep outbox, fetch program, re-resume. Stale
authEpoch seals: E_AUTH_SESSION. Foreign delivery: E_OFFLINE_AUTHORITY, retaining
coverage. No facts: query a receipt then resume; no query: refuse, keep queue.

## Grants and bytes

Login/guest/resume grants 30-day principal IDs if remaining is absent/<1024.
Replay `{ grant, offset, count, intent, trace }` needs session. Same bytes reuse
terminals across op/schema changes. Changed bytes: E_OFFLINE_INTENT_REUSE; bad
slice: E_OFFLINE_ID_BLOCK; expiry: E_OFFLINE_INTENT_EXPIRED. Trace point/verdict
conflict: E_OFFLINE_CONFLICT; ranges rerun. Verdicts bind the whole schema;
additive columns may conflict. Read current data, then use a new intent; never
rewrite queued args/trace. Past-fence traces empty; program checks apply.

Bytes share `(assetId,width)` row leases under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache/offline fetch, including aliases and
predictions. Offline media is null; online bytes stay in its viewing instance.
Repeats: E_ASSET_VIEWED (assets,410). E_OFFLINE_CARRIER: configure carrier;
E_OFFLINE_STATE: inspect state; E_OFFLINE_DELIVERY: retry authenticated query;
E_OFFLINE_LIFECYCLE: sign in/reopen; E_OFFLINE_FOLLOWER: use writer tab.
