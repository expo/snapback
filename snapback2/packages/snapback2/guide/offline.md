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
the startup transport cut; only `online()` reconnects.
Clients share one packaged offline runtime.

Expiry seals; session change wipes. One writer/account; web followers read live,
submit inbox rows once their account is established, and inherit the writer queue on closure. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await `online()`. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`observe`/`useQuery` with `{ drain: true }` page then tail. The returned page
must be a certified ascending append log (`after c first N`, N <=50), with one
Cursor argument through aliases/shapes/branches. Auxiliary reads add no coverage.
Snapshots carry one page; edits/removals append events. Other shapes
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
| wait | none`. `useOutbox().detail.status.draining` means active replay:
wait; paused work offers Sync, even after a connected read. Followers use
inbox readiness; `detail.writer` holds announced status.
Use the selected mutation's `can` for a composer: text, edit and media can
need different ID slices. Render its reason; `can.action === "connect"`
offers a visible **Sync now** button that awaits `client.online()` and surfaces
failure without clearing the draft or attachment. A connected transport does
not replenish an exhausted grant by itself. After recovery, let the user
submit normally; do not automatically resubmit a refused write or add a
periodic `online()` loop. Generic `useOutbox().can` cannot price a specific op.
`outbox.observe(op?)` feeds hooks; `intentLabel` labels entries.
Discharged successes compact automatically. Unresolved successes and failures
remain dismissible; queued work cannot be dismissed. Older snapshots expose
`reason.code: "changed"` and `freshness.compactedThrough`; refresh their query.
Committed does not mean shown: query `items` need the target's observation
through commit. `arrived`/global sequence cannot substitute. Expose failures.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Fence/transport/authority/offline/pending/writer-unresponsive pauses keep
queued bytes. Retry `online()` or an online drain; transport reconnect alone never replays.

## Entry fields

`await client.outbox.entries()` returns this account's durable work:

| Field | Meaning |
| --- | --- |
| `intent`, `op`, `args` | Stable intent identity and the submitted operation/arguments. Never edit queued bytes. |
| `state` | `queued`, `committed`, `rejected`, or `expired`. Replaying is writer activity (`status.draining`), not another entry state. |
| `issuedSeq` | Coverage sequence seen by this client at admission. It is neither a server commit nor proof of flush order. |
| `order` | Device ledger FIFO position. Other devices have their own order. |
| `response` | The terminal result. A committed `response.seq` is the owner's commit sequence; rejection includes its refusal. |
| `ids`, `targets` | Reserved IDs and certified semantic targets. Use `mutationTarget(op, table)` rather than indexing `ids`. |
| `createdAt`, `updatedAt` | Device timestamps; never use them to enforce a server edit/expiry window. |
| `inbox` | Follower alias key; admission and later compaction preserve it atomically with the ledger. |

For completion, await `client.outbox.settled()` and check `stopped`/`remaining`.
For visibility, read the receiving query: a committed result alone does not mean
its row reached that view. Server edit windows use Quarry `now`.

## Resume

`/api/resume` compares receipt validators. Resume reauthorizes held rows and follows the
log before mounted queries, up to 1 MiB per response. Only the mounted-limit
refusal allows one smaller retry. Backward watermarks keep `online()` refused
across reopen; coverage, grants, IDs and queue stay. Drain may replay in
existing trust; write success does not repair a refused resume.

E_OFFLINE_RESUME: rewrite an unsupported log as a direct ascending `after c first N`
page (N <= 50); `online()` may retry mounted-limit once, not an unsupported log.
E_OFFLINE_RESET: drop coverage, keep outbox, fetch program, re-resume.
A mounted drain restarts once at null. E_AUTH_SESSION seals; E_OFFLINE_AUTHORITY keeps coverage.

Legacy `{c:null}` keys require a cold store for this pre-release.
No migration/merge; preserve old stores for queued-work recovery.

## Grants and bytes

Signup/login/guest/resume grant 30-day principal IDs; replay needs a live session.
The client stages each grant for its validated principal; failed carrier opens
and account switches never install it into another partition, and wipe discards it.
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

## Custody

`deliver to T[.keys] as name` on a content table derives an engine-owned per-recipient log:
recipient, row, incarnation, the keys, kind (delivered/changed/removed),
audience, seq, at; byRecipient/byRecipientGroup/byRow; read `.recipient =
viewer`; removed tombstones its row; programs never write it. Keys must pin a
`cap N by` group of T (E_DELIVER_UNBOUNDED); T needs one principal column or
`by .column` (E_DELIVER_PRINCIPAL); name must be free. `with receipts` adds
nameReceipts (row, recipient, received, seq, the read rule's columns) under
that rule. Installing, bootstrapping, removing, and the audience bound `A`:
`guide migrations`.

Inserts/seeds deliver to the group at that write, deduplicated by principal.
Changed updates/upserts and deletes append to original recipients, including
departed members. Omitted optionals are null; equivalent writes add no events.
Repeated edits get distinct ids; rollback removes their events. A deleted id
cannot be reused (E_DELIVER_INCARNATION): repair inserts into that table
with its required fields and a fresh id. Receipt-only replay derives no events.
Private audience probes are traced, outside receipts. Insert reserves N+1;
update/delete A; upsert max(N+1, A). Nonuniform scans cannot spend this reserve,
including in job chunks. E_BOUND names a dominant deliver term; loop-dominated
steps keep E_STEPS. A replay or then refused by historical A settles durably.
