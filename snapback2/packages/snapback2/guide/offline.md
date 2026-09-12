# Offline

`offline.store` is a factory of stores with `open()`. Call its builder:

```js
import { createClient } from "snapback2/client";
import { indexedDbRangeStore } from "snapback2/react";
const client = createClient({
  url: "http://127.0.0.1:3210",
  offline: { store: indexedDbRangeStore() },
});
```

Requires IndexedDB and Web Locks. Expo `<SnapbackProvider url persona
offline>` from `snapback2/react-native` owns its client, with SQLite and secure
token custody by default. `startOffline` on either provider/client preserves
the startup transport cut; `online()` or explicit recovery reconnects.

Expiry seals; session change wipes. One writer/account; web followers read live,
submit inbox rows once their account is established, and inherit the writer queue on closure. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await `online()`. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`observe`/`useQuery` with `{ drain: true }` page then tail. The returned page
must be a certified ascending append log (`after c first N`, N <=50), with one
Cursor argument through aliases/shapes/branches. Auxiliary reads add no coverage.
Each delivery carries one durable page; edits/removals append events. Other shapes
refuse E_OFFLINE_RESUME (`unsupported-log`). `next` pages older newest-first
results. `caughtUp`: exhausted; `live`: tail active.
Offline drains need held eligibility; repeated cursors refuse. Offline keeps its watermark. Covered reads are exact; others partial.

## Recovery

Admitted offline `run()`: `{ state: "queued", intent, ids }`; replay is FIFO.
A non-writer tab must establish its account (sign in), then inserts a durable `inbox` row
and resolves `{ state: "queued", intent: "inbox:<key>", ids: [] }`;
the writer admits rows in order. Follower status: `forwarding` or
`writer-unresponsive` (ready), `inbox-full`, `follower` (no route).

`useMutation(op).can`/`useOutbox().can`: send/action/reason from
outbox status, connection and queue. Actions share `sign-in | connect | other-tab
| wait | none`. `detail.status.draining` means active replay; `recovering`
means the owner is acquiring capacity/reauthorizing. Both wait; stopped work
offers Sync. A real reconnect/auth recovery resumes durable queued work. Followers use
inbox readiness; `detail.writer` holds announced status.
Use the composer's mutation `can`: text, edit and media need different ID slices.
Render its reason; `can.action === "connect"`
offers **Sync now**: await `useOutbox().recover()` (headless:
`client.outbox.recover()`). It returns `{ settlement: { stopped, remaining } }`
or `{ refusal }`. Keep drafts/attachments on refusal; never guess a queue count. Admission and a subscribed
selected operation acquire missing capacity through one bounded resume flight;
`can`/snapshot reads do no I/O. After recovery, let the user submit;
never auto-resubmit refusals or poll `online()`.
One automatic attempt per opportunity, with a 10-second deadline; an explicit
offline cut forbids automatic networking until `online()`.
`outbox.observe(op?)` feeds hooks with `entries`, `work`, `can`, and status.
Each `work` item has `{ entry, label, dismissible }`; `getWork(intent)` also
resolves follower aliases. `useMutation(op).last` stays the immediate result;
its `work` tracks that intent through replay and disappears on compaction.
Discharged successes compact automatically; unresolved successes and failures
stay dismissible. Queued work is dismissible only after the owner refused its
last replay as bad input or schema; another replay durably clears that before
sending, and in-flight or unknown outcomes cannot be dismissed. `status.blocked`
names the refused head (label and item Dismiss agree). `dismiss` returns the
bytes to re-author; FIFO continues on either tab, and a follower's result is
recoverable once by its alias after a takeover or reopen. Older snapshots expose
`reason.code: "changed"` and `freshness.compactedThrough`; refresh their query.
Committed does not mean shown: query `items` need the target's observation
through commit; `arrived`/global sequence cannot substitute. Expose failures.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Online writes queue before replay. Their promise resolves their result;
`outbox.settled()` waits for the whole queue. Session expiry refuses the call
but seals admitted bytes for replay after sign-in.
Fence/transport/authority/offline/pending/writer-unresponsive pauses keep
queued bytes. A real reconnect can start bounded recovery; retry stopped work
with explicit recovery. Each recovery call owns a 10-second wait while sharing
resume/drain work. Timeout returns E_TRANSPORT; work keeps its custody. Closing,
going offline, takeover, or changing account ends the wait before further
partition reads. Followers refresh their inbox; recovery never takes a writer
lock or clears another tab’s offline cut.

## Entry fields

`await client.outbox.entries()` returns this account's durable work:

| Field | Meaning |
| --- | --- |
| `intent`, `op`, `args` | Stable intent identity and the submitted operation/arguments. Never edit queued bytes. |
| `state` | `queued`, `committed`, `rejected`, or `expired`. Replay activity: `status.draining`. |
| `issuedSeq` | Coverage at admission; neither server commit nor flush order. |
| `order` | Device ledger FIFO position. Other devices have their own order. |
| `response` | The terminal result. A committed `response.seq` is the owner's commit sequence; rejection includes its refusal. |
| `ids`, `targets` | Reserved IDs and certified semantic targets. Use `mutationTarget(op, table)` rather than indexing `ids`. |
| `createdAt`, `updatedAt` | Device timestamps; never use them to enforce a server edit/expiry window. |
| `inbox` | Follower alias key; admission and later compaction preserve it atomically with the ledger. |

Server edit windows use Quarry `now`.

## Resume

`/api/resume` compares receipt validators. Resume reauthorizes held rows and follows the
log before mounted queries, up to 1 MiB per response. Only the mounted-limit
refusal allows one smaller retry. Backward watermarks keep `online()` refused
across reopen; coverage, grants, IDs and queue stay. Drain may replay in
existing trust; write success does not repair a refused resume.

E_OFFLINE_RESUME: rewrite an unsupported log as a direct ascending `after c first N`
page (N <= 50); `online()` may retry mounted-limit once, not an unsupported log.
E_OFFLINE_RESET: reset answers/facts, keep outbox and delivered-history bodies anchored by held delivered events; removed events still evict. Fetch program, re-resume.
A mounted drain restarts once at null. E_AUTH_SESSION seals; E_OFFLINE_AUTHORITY keeps coverage.

Legacy `{c:null}` keys require a cold store for this pre-release.
No migration/merge; preserve old stores for queued-work recovery.

## Grants and bytes

Signup/login/guest/resume grant 30-day principal IDs; replay needs a live session.
Grants belong to their validated principal: failed opens/account switches cannot
install them elsewhere; wipe discards them.
Identical bytes reuse terminals; changed bytes refuse
E_OFFLINE_INTENT_REUSE; bad slices E_OFFLINE_ID_BLOCK; expiry
E_OFFLINE_INTENT_EXPIRED; trace conflicts E_OFFLINE_CONFLICT. Read current
data, then use a new intent; never rewrite queued args/trace.

Bytes share `(assetId,width)` leases under maxAssetBytes (256 MiB LRU).
`image <=N once` is schema-owned: no cache/offline fetch, including aliases and
predictions. Offline media is null; online bytes stay in its viewing instance.
Repeats: E_ASSET_VIEWED (assets,410). E_OFFLINE_CARRIER: configure carrier;
E_OFFLINE_STATE: inspect state; E_OFFLINE_DELIVERY: retry authenticated query;
E_OFFLINE_LIFECYCLE: sign in/reopen; E_OFFLINE_FOLLOWER: sign in; use writer tab for uploads/channels or no inbox route.

## Delivery custody

Declare `deliver` on the content table; drain its generated log. See `guide
deliver` for the declaration, original recipients, reads, prediction and receipts.
