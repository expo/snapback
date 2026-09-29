I'll review the deferred-admission change read-only: first the lane prompt, the round-1 report, the prior findings, and the diff itself.The lane prompt and round-0 report are in. Next I’ll pull the prior review findings and the exact diff range.Round 0 left four high defects. I’ll read the custody path and the tests that claim to close each one.The four fixes are in the admission plan. I’ll check the device, sender, and tests against the wrong-store, double-send, and dedup cases.Auto-compacting conversation (82% full)...
Conversation compacted.
The prior review left two High defects unexecuted and the round-0 fixes unread by a detector. I’ll confirm the exact lines, then run copy-only repros before writing the verdict.The first CAS helper would hang on an unresolved gate. I’ll drop it and run only the schedule that can finish.**NOT READY.** Two High defects remain. A deferred write whose store was already identified is refused as `E_ADMISSION_TIMEOUT` if the freeze did not land before the deadline, and an online intent a peer has already dispatched is sent again or replaced with `E_STORE_REPLACED` when the originator's probe returns.

Round-0 is fixed in the paths I executed: the native compare token is per attempt, exact-input recovery refuses a different body, and web capture keeps the schema store rather than a staged replacement. I did not rebuild the native binary or rerun the claimed 96 / 319 / 10,000 suites. There is no `dist/` or `target/debug/snapback4` in this worktree. The detectors below imported this tree's source from `/tmp`.

## 1. Deferred custody

**High.** `snapback4/packages/snapback4/src/identity-admission.ts:107`

The timeout predicate is `!record.store && deadline <= now`, and it runs before the store is consulted. `record.store` is set only later, at lines 115–119, and only when that same pass still has time left. A pass that first observes a published `state.store_id` after the deadline never reaches the freeze. It writes `E_ADMISSION_TIMEOUT` and does not admit.

The deadline timer is what makes this ordinary, not exotic. Capture arms it (`identity-admission.ts:52–54`; the web wake is `web.ts:105`). Delivery polls on a backoff that reaches 5 seconds (`local.ts:1076–1081`). `device:store_id` is published when the snapshot apply commits, which is before catch-up finishes and before the flush at `local.ts:731–757`.

Failing scenario: a profile save is captured at t=0, deadline t=30s. The last admission poll runs at t=27.8s, before identity exists. The snapshot publishes `device:store_id` at t=28s and catch-up continues. The next `queued()` is the deadline wake at t=30s. The store fingerprint matches the captured backend and store, but the write is refused and never sent. Reproduced: with `store_id` already `store-A`, a matching captured store, and a deadline 1ms in the past, `queued()` admitted 0 writes and returned `E_ADMISSION_TIMEOUT` with `admission_waiting: true`. The same state with the deadline still in the future admitted once. A record whose `store` was already frozen admitted after the deadline, so the kept-identification path works only if some earlier pass persisted it.

A process killed after the store-id commit and reopened after 30 seconds takes the same path. Identity that truly arrives only after the deadline must still time out; `expired identification deadline survives reopen` is that case, and its probe never publishes a store.

Smallest fix: in the transaction that first publishes `device:store_id`, also record that publication time. At `identity-admission.ts:107`, expire only when the store is still unknown or that timestamp is after the record's deadline. If the store was published in time and the backend and store checks pass, set `record.store` and admit even when `backend_required` makes this pass stop before the admit yield. Do not treat "admit whenever `store_id` is set now" as the fix. That would also send a write whose first identification was after 30 seconds, which is the case a later new-id retry is allowed to replace.

**High.** `snapback4/packages/snapback4/src/app-journal.ts:22` and `app-online.ts:224`

`bindIntentStore` treats a missing or different `storeId` as a mismatch and, once `dispatched` is set, deletes the deadline. On a match it falls through, sets `dispatched` again, and returns `undefined`. `client.ts:514–515` posts whenever `before()` returns `undefined`. The expiry branch does check `intent.dispatched` (`app-online.ts:199`). The success path does not. After the identity wait it always calls `raw.mutate`.

Failing scenario, same store: tab A journals the profile save and blocks in `/probe`. Tab B opens on the same journal, probes `store-A`, sets `dispatched`, and posts. A's probe then returns `store-A` while B's response is still in flight. Reproduced posts were `B`, then `A`, for the same id. The final receipt was `sent`. A real server replays the second post inside the writer transaction (`engine/mod.rs:1074–1081`), so this one is a duplicate send, not a double apply.

Failing scenario, replacement: the same schedule, but A's probe returns `store-B`. Reproduced: only B posted, to `store-A`, and the journal receipt was `E_STORE_REPLACED` ("whether it executed is unknown") with the intent removed. Releasing B's `sent` response afterward did not replace that receipt. The executed write has no durable success. A new id on the replacement store applies it again.

`onlineExpirySchedule` does not catch either case. It rejects A's probe and only then moves the clock.

Smallest fix: if `intent.dispatched`, return `{ state: "pending", id }` immediately and do not change `storeId`, the deadline, or receipts. `sendPost` already skips the fetch when `before()` returns a write, and `send()` will not settle a pending body that has no `why`. Keep the mismatch refusal only for an intent that is not yet dispatched.

What is sound on this axis:

- Web capture prefers a non-empty `expected_store` over `device:deferred:identity` (`web-journal.ts:213`). Reproduced: schema store `schema-store` won over staged `replacement-store`. An empty `expected_store` still falls through to the staged id, which is the right fallback.
- Native compare state is per `attempt()` (`native-admission.ts:17–27`). `sync_state` only `remember()`s (`native-admission.ts:43–48`). Reproduced with two wrappers on one core: A paused after reading an empty blob, B committed a second id, A reread state three times, and both ids survived.
- A deferred id whose outbox row has different arguments becomes `E_WRITE_ID_REUSE` and does not replace that row. The same arguments with different key order resubmit the captured entry; the fake device kept the outbox mint. Rust `admit_with_replay` (`device.rs:1037–1048`) does the same under the writer transaction.
- `E_ID_REUSED` is unchanged: principal, operation name, and canonical args digest (`store.rs:1058–1067`). `new_ids` are not part of the binding. Local equality is op, args, and viewer, which is stricter than the server and does not weaken it.
- Promotion yields ordinary `admit` with the captured `predictable` bit (`identity-admission.ts:126`). A backend fingerprint or captured-store mismatch refuses before that yield. Waiting views force `predictable: false`; that is the pending view, not the admit.
- Order is the captured `seq`, including after the handoff (`identity-admission.ts:142–143`). The metadata blob is what reload reads back. A frozen record is not dropped.
- Worker orphan adoption reads raw device `queued()`, not the merged waiting view, and copies deferred metadata through `adopt`. It does not enqueue an unadmitted view into another store.
- Wasm skips `require_admission_identity` (`call.rs:166–169`). The page and worker journal chains are single-owner and check the binding before the yield. That is not a second store fence across processes; native has the Rust check.

`compare_identity_admissions` (`device.rs:1181–1185`) does not itself reject a same-id argument change in the deferred blob when the outbox lacks that id. The JavaScript load, compare, and retry does. I did not execute the Rust function.

## 2. Stuck states and visibility

The calibration failure mode is gone. A save before store identity is durable custody, `mutate` resolves `pending` with "waiting for backend identification", and a real timeout or store mismatch is settled from `admission_refusal` before the waiting check (`local.ts:1091–1096`), then `onWrite`. `usePendingWrites` shows that wait (`pending-writes.ts:32–33`) and drops the row once the receipt is stored. Nothing in this change leaves the form on the old internal `E_ADMISSION` with no pending row.

The false timeout is not a stuck form. It resolves to a terminal public refusal, and the save is what is lost. The replacement clobber is the same shape: `onWrite` can report failure for a post that is still in flight, and a later success is not recorded.

`admission_waiting` stays true on a refused view (`identity-admission.ts:69`), so a pending read in that gap still says "waiting". The flush that writes the refusal also settles it. That is not a second stuck state.

Online `waitSeconds: 0` returns `pending` on purpose. The terminal result is `onWrite` or `write(id)`.

## 3. Refusals

`E_ADMISSION_TIMEOUT` and `E_ADMISSION_STORE` are public, unsent, and documented: `guide/why/E_ADMISSION.md:14–25`, `guide/client.md:26`, `guide/codes.rs:89–90`, and `CLIENT-AND-OPERATIONS.md:998–1001`. Both say the write was not sent, and both tell the caller to fix the connection or backend and submit a new id. That wording is right only when it is true.

The timeout above uses that code after identification succeeded. The message says identity did not arrive. The replacement clobber uses `E_STORE_REPLACED`, whose rewrite says not to retry automatically, but the intent is already gone, so the in-flight success cannot be attached later.

The synchronous `E_ADMISSION` at `web-journal.ts:209` ("the backend has not loaded") remains when neither store id nor backend fingerprint is loaded. It is the not-ready client, not the calibration refusal, and the id reservation is released so the same id can be retried. The old "backend store is not identified yet; mutation was not admitted" string is gone.

## 4. What should stop landing, and the tests

Do not land this as-is. The two mutations that survive the round-1 schedules:

1. Publish `device:store_id` after the last pre-deadline `queued()` and let the deadline wake be the next pass. Every timeout test fast-forwards before `start()`, while the probe is still down. None publishes the store first and then crosses the deadline.
2. Hold the peer's `/m/` response, then let the originator's `/probe` return 200 for the same store and for a different store. `onlineExpirySchedule` throws on A's probe instead. `posts.length === 1` there means "A never got an identity," not "a dispatched intent is sent once."

The 10,000 session sequences call those same schedules (`app-session-model.test.mjs:12–14` and `identity-custody-model.mjs:66–96`). More iterations will not hit either mutation.

I did not verify 96/96, the 319 delivery matrix, or the 10,000 sequences. The detectors I did run, against source, were: freeze-versus-timeout, exact-input refusal and same-input recovery, schema-over-staged capture, two-wrapper compare-and-swap, and the two online probe outcomes above.

**Verdict: NOT READY.**
