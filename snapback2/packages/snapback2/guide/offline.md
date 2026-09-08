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

Custom factories need `open()` or throw
`TypeError`. IndexedDB and Web Locks are required; no memory fallback.

Expiry seals; session change wipes. One writer/account. Web followers read live, forward
replayable writes, and inherit its queue on close. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await resume. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`subscribe`/`useQuery` with `{ drain: true }` page then tail. The returned page
must be a certified ascending append log (`after c first N`, N <=50), with one
Cursor argument through aliases/shapes/branches. Auxiliary reads add no coverage.
Callbacks emit one page; edits/removals append events. Held coverage is not live
history. Mixed-order/non-page returns refuse E_OFFLINE_RESUME before catch-up
with `reason: "unsupported-log"`, `op`, `shape`. Newest-first starts at `c: null`,
then pages older with opaque `next`. `caughtUp`: exhausted; `live`: tail active.
Offline drains need held eligibility; repeated cursors refuse. Offline traversal
retains its watermark. Covered reads are exact; others partial.

## Recovery

Offline `run()`: `{ state: "queued", intent, ids }`; replay is FIFO; results
are terminal or durable. A non-writer tab inserts a durable `inbox` row and
resolves `{ state: "queued", intent: "inbox:<key>", ids: [] }`; the writer
admits rows in key order, one swap with the entry, recording `inbox`; the
alias names it on either tab. Follower status: `forwarding` or
`writer-unresponsive` (ready), `inbox-full`, `follower` (no route).

`useMutation(op).can`/`useOutbox().can` derive send/action/reason from
`detail.status`, connection, and queue. `outbox.observe(op?)` shares
`{ entries, status }` with the hooks; `intentLabel` labels entries. Writes
retain terminals until explicit `dismiss(intent)`; queued entries cannot be
dismissed. `run()` success means committed, not shown. Query `items` resolve
indicators from the target's own observation through commit, including no-ID
edits; `arrived`/global sequence cannot substitute. Expose dismissal for
failures, missing targets, and old successes. See live-query.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Fence/transport/authority/offline/pending/writer-unresponsive pauses keep
queued bytes. Retry `online()` or online drain; reconnect does not replay.
Unclaimed media expires after 24h; grants cannot extend it. After refusal,
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
