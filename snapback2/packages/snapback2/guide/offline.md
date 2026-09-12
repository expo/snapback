# Offline

Pass the store factory:

```js
import { createClient } from "snapback2/client";
import { indexedDbRangeStore } from "snapback2/react";
const client = createClient({
  url: "http://127.0.0.1:3210",
  offline: { store: indexedDbRangeStore() },
});
```

Web requires IndexedDB and Web Locks. Expo `<SnapbackProvider url persona
offline>` from `snapback2/react-native` owns SQLite and secure tokens.
`startOffline` preserves the startup cut; `online()` or recovery reconnects.

Expiry seals; session change wipes. One writer/account; web followers read live,
submit inbox rows once their account is established, and inherit the writer queue on closure. Uploads,
channels, or no carrier refuse E_OFFLINE_FOLLOWER pre-byte; else:
E_OFFLINE_LOCK. Beyond `fenceDays` (1..30), reads are stale; prediction/replay
await `online()`. Queued writes survive; held reads/`offline()` bypass startup auth.

## Drain

`observe`/`useQuery` with `{ drain: true }` page then tail. Requires a certified ascending append log (`after c first N`, N <=50), with
one Cursor argument. Auxiliary reads add no coverage. Edits/removals append events;
other shapes refuse E_OFFLINE_RESUME (`unsupported-log`). `next` pages older newest-first
results. `caughtUp`: exhausted; `live`: tail active.
Offline drains need held eligibility; repeated cursors refuse. Offline keeps its watermark. Covered reads are exact; others partial.

## Recovery

Admitted offline `run()`: `{ state: "queued", intent, ids }`; replay is FIFO.
After sign-in a follower persists `{ state: "queued", intent: "inbox:<key>", ids: [] }`;
the writer admits its inbox rows in order. Durable clients refuse before custody
when account restoration failed; they never fall back to plain transport. Follower status: `forwarding` or
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
or `{ refusal }`. Keep drafts/attachments on refusal; never guess a queue count. Admission/subscribed operations acquire capacity through one bounded resume;
`can`/snapshot reads do no I/O. Never auto-resubmit refusals or poll `online()`.
One automatic attempt per opportunity; an explicit offline cut forbids
networking until `online()`. Recovery deadlines are below.
`outbox.observe(op?)` feeds hooks with `entries`, `work`, `can`, and status.
Each `work` item has `{ entry, label, dismissible }`; `getWork(intent)` also
resolves follower aliases. `useMutation(op).last` stays the immediate result;
its `work` tracks that intent through replay and disappears on compaction.
Discharged successes compact; unresolved successes/failures stay dismissible.
Queued work is dismissible only after bad-input/schema replay refusal. Replay
clears that before sending; unknown/in-flight outcomes cannot be dismissed. `status.blocked`
names the refused head (label and item Dismiss agree). `dismiss` returns the
bytes to re-author; FIFO continues on either tab, and a follower's result is
recoverable once by its alias after a takeover or reopen. Older snapshots expose
`reason.code: "changed"` and `freshness.compactedThrough`; refresh their query.
Committed does not mean shown: query `items` need the target's observation
through commit; `arrived`/global sequence cannot substitute. Expose failures.

`outbox.drain()`/`settled()`: `{ stopped, remaining }`; false is drained.
Online writes also queue before replay; `settled()` waits for the whole queue.
A rejected wait carrying `intent` may still own queued work: expiry seals it.
Sign in as the same account, then find that intent via `outbox.observe().getWork`;
never submit a fresh duplicate. Work is unreadable while sealed.

Keep the provider above routes. After `const result = await run(args)`,
retain input/show refusal on `rejected`; show pending before navigation on
`queued`; navigate on `committed`. Admission is atomic carrier completion:
reopen preserves it, but unloading beforehand may lose the write.
Pauses retain queued bytes. Reconnect starts bounded recovery; explicitly
recover stopped work. Recovery shares resume/drain work; each wait expires
after 10 seconds with E_TRANSPORT and custody intact. Close, offline, takeover
or account change ends the wait before another partition read. Followers
refresh their inbox; recovery neither takes a writer lock nor clears another
tab’s offline cut.

## Entry fields

`await client.outbox.entries()` returns this account's durable work:

| Field | Meaning |
| --- | --- |
| `intent`, `op`, `args` | Immutable submitted identity, operation and arguments. |
| `state` | `queued`, `committed`, `rejected`, or `expired`. Replay activity: `status.draining`. |
| `issuedSeq` | Coverage at admission; neither server commit nor flush order. |
| `order` | Device ledger FIFO position. Other devices have their own order. |
| `response` | Terminal result: committed owner `seq`, or refusal. |
| `ids`, `targets` | Reserved IDs and certified semantic targets. Use `mutationTarget(op, table)` rather than indexing `ids`. |
| `createdAt`, `updatedAt` | Device timestamps, not authoritative edit/expiry times. |
| `inbox` | Follower alias, preserved atomically through admission/compaction. |

## Resume

`/api/resume` compares receipt validators. Resume reauthorizes held rows and follows the
log before mounted queries, up to 1 MiB per response. Only the mounted-limit
refusal allows one smaller retry. Backward watermarks keep `online()` refused
across reopen; coverage, grants, IDs and queue stay. Drain may replay in
existing trust; write success does not repair a refused resume.

E_OFFLINE_RESUME: use the supported ascending log above.
E_OFFLINE_RESET: reset answers/facts, keep outbox and delivered-history bodies anchored by held delivered events; removed events still evict. Fetch program, re-resume.
A mounted drain restarts once at null. E_AUTH_SESSION seals; E_OFFLINE_AUTHORITY keeps coverage.

## Grants and bytes

Signup/login/guest/resume grant 30-day principal IDs; replay needs a live session.
Failed opens/account switches cannot transfer grants; wipe discards them.
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
