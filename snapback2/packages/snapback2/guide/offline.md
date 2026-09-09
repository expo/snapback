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

IndexedDB and Web Locks are required. Expo `<SnapbackProvider url persona
offline>` from `snapback2/react-native` owns its client, with SQLite and secure
token custody by default. Pass `offline={{ store }}` to choose a carrier.

Expiry seals; session change wipes. One writer/account. Web followers read live, write
inbox rows the writer admits, and inherit its queue when it closes. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await resume. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`observe`/`useQuery` with `{ drain: true }` page then tail. The returned page
must be a certified ascending append log (`after c first N`, N <=50), with one
Cursor argument through aliases/shapes/branches. Auxiliary reads add no coverage.
Snapshots carry one page; edits/removals append events. Mixed-order/non-page returns refuse E_OFFLINE_RESUME before catch-up
with `reason: "unsupported-log"`. Newest-first omits the cursor,
then pages older with opaque `next`. `caughtUp`: exhausted; `live`: tail active.
Offline drains need held eligibility; repeated cursors refuse. Offline traversal
retains its watermark. Covered reads are exact; others partial.

## Recovery

Offline `run()`: `{ state: "queued", intent, ids }`; replay is FIFO; every
result is terminal or durable. A non-writer tab inserts a durable `inbox` row
and resolves `{ state: "queued", intent: "inbox:<key>", ids: [] }`; the writer
admits rows in key order, one swap with the entry, which records `inbox`; the
alias names it on either tab. Follower status: `forwarding` or
`writer-unresponsive` (ready), `inbox-full`, `follower` (no route).

`useMutation(op).can`/`useOutbox().can`: send/action/reason from
outbox status, connection and queue. Actions share `sign-in | connect | other-tab
| wait | none`. `useOutbox().detail.status.draining` means active replay:
wait; paused work offers Sync, even after a connected read. Followers use
inbox readiness; `detail.writer` holds announced status.
`outbox.observe(op?)` feeds hooks; `intentLabel` labels entries.
Terminals persist until `dismiss(intent)`; queued work cannot be dismissed.
Committed does not mean shown: query `items` need the target's observation
through commit. `arrived`/global sequence cannot substitute. Expose failures.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Fence/transport/authority/offline/pending/writer-unresponsive pauses keep
queued bytes. Retry `online()` or an online drain; reconnect never replays.
After refusal,
use a new upload/intent; never rewrite args.

## Resume

`/api/resume` compares receipt validators. Resume reauthorizes held rows and follows the
log before mounted queries, up to 1 MiB per response. Only the mounted-limit
refusal allows one smaller retry. Backward watermarks keep `online()` refused
across reopen; coverage, grants, IDs and queue stay. Drain may replay in
existing trust; write success does not repair a refused resume.

E_OFFLINE_RESET: drop coverage, keep outbox, fetch program, re-resume. E_AUTH_SESSION seals; E_OFFLINE_AUTHORITY retains coverage.

## Grants and bytes

Login/guest/resume grants 30-day principal IDs. Replay requires that session.
Same bytes reuse terminals across op/schema changes. Changed bytes refuse
E_OFFLINE_INTENT_REUSE; bad slices E_OFFLINE_ID_BLOCK; expiry
E_OFFLINE_INTENT_EXPIRED; trace conflicts E_OFFLINE_CONFLICT. Read current
data, then use a new intent; never rewrite queued args/trace.

Bytes share `(assetId,width)` row leases under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache/offline fetch, including aliases and
predictions. Offline media is null; online bytes stay in its viewing instance.
Repeats: E_ASSET_VIEWED (assets,410). E_OFFLINE_CARRIER: configure carrier;
E_OFFLINE_STATE: inspect state; E_OFFLINE_DELIVERY: retry authenticated query;
E_OFFLINE_LIFECYCLE: sign in/reopen; E_OFFLINE_FOLLOWER: use writer tab.
