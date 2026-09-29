I'll review the deferred-admission change read-only: first the lane prompt, the round-2 report, and the diff, then check each earlier finding against a detecting test.Round 0 and 1 left custody races around binding, expiry, and restore. I’ll read the current admission path and check those handoffs against the code, not the report.The success path looks like it can drop an outbox settle after a receipt is stored. I’ll reproduce that on a copy with the native device, without touching the worktree.Auto-compacting conversation (81% full)...
Conversation compacted.
The prior session already reproduced a native settle that leaves an executed write looking unsent. I am checking the exact lines and whether a later store replacement re-enqueues that row, then I will write the review.**NOT READY.** A native deferred write that the server has already accepted is not given an outbox receipt. A later store replacement keeps it as unsent custody of the old store. Round 0 and round 1 defects that the handoff tests cover are fixed.

## High — history wins over a live outbox row

`snapback4/crates/snapback4-device/src/device/identity_admission.rs:84`

`compare` attaches a write-history receipt and sets `admitted: false` before it looks at the outbox (`:91`). Every native read of `identity-admissions` commits that rewrite (`device.rs:1185`). Production settlement writes history first, then settle:

```10:13:snapback4/packages/snapback4/src/local-receipts.ts
export async function settleReceipt(history: WriteHistory, call: Call, write: Terminal, revalidatedStore?: string): Promise<void> {
  await history.keep(write, revalidatedStore);
  const applied = await call({ op: "settle", id: write.id, ...(write.state === "sent" ? { seq: write.seq } : {}) });
```

`IdentityAdmissions.settle` then sees `record.outcome` and returns `{ ok: null }` without yielding device `settle` (`identity-admission.ts:154`), and drops the deferred row (`:155`). `record_receipt` never runs, so `sent_seq` and `receipt_store.success_seq` stay unset (`predictions.rs:310`).

Measured on the native device, sources byte-identical to this worktree:

1. Admit before identity, publish `session-model-store`, promote, `keep_write` of `{state:"sent", seq:7}`, then `settle`. Settle returns `{ok:null}`. The outbox row remains with `sent_seq: null` and `receipt_store: {id: "session-model-store"}`. `pending_ids` still contains the id.
2. A second `settle` on the same store does repair it (`sent_seq: 7`, `success_seq: 7`). The success path does not schedule that second settle: `syncSettledWrites` only syncs when every row already has a success sequence.
3. `observe_store` of `replacement-store` before that second settle returns `reset: true`, `retired: {}`. The row is still pending, still bound to `session-model-store`. Reopen and two further settles return `{ok:null}` and still leave `sent_seq` null. `stamp_receipt` no-ops when the receipt store is not the current store (`predictions.rs:334`). Replacement re-enqueues any row whose `success_seq` is missing (`store_identity.rs:146`).

So the write is not retired, not lost from the outbox, and not posted again while history still holds the receipt (`local.ts:1115` returns that receipt and does not POST). It stays in `pending_ids` across reload. `pendingWrites` hides it because history already marks the id settled (`pending-writes.ts:28`). I did not drive `createLocalClient`, so I did not observe the extra `onWrite`; `flushOnce` emits whatever `recoverReceipt` returns, on every later flush, for as long as `sent_seq` stays null. I did not evict the 256-receipt history cap. If that receipt is evicted, the stranded row is sendable again with `store_id` taken from the old `receipt_store.id`.

Wasm never runs `compare`, so the web profile-save path is not this hole.

**Smallest fix.** In `compare`, if `outbox_get` still has the row, keep the outbox branch (`admitted: true`, store from `receipt_store` or `STORE_ID`, no `outcome`). Attach the history outcome only when the row is gone. The first settle then yields device `settle`, stamps `sent_seq`, and replacement retires it. Do not "fix" this by admitting whenever `store_id` is set.

**Test that survives.** The current history-before-outbox order is the mutant. `identity-handoffs.test.mjs` (13/13) and `identity-publication.test.mjs` (9/9) passed on that binary. Neither asserts `sent_seq` after `keep_write` + `settle`, nor `retired` after a later `observe_store`. Server apply count of 1 would also miss it.

## Round 0 and round 1

Fixed, on those same runs plus the code they lock:

- Two-process empty-queue bypass of binding and FIFO: both cached-empty tests passed. Custody ops go through the plan (`native-admission.ts:38`).
- Peer expiry of an executed write reported as unsent: both `settled=true` and `settled=false` late-capture tests passed. Dispatched online intent is not failed at the deadline (`app-online.ts:214`).
- ID-only recovery: three retired-receipt input mismatches returned `E_WRITE_ID_REUSE`. `sameInput` is op, viewer, and canonical args (`identity-admission.ts:35`).
- Freeze save before native admit: the freeze handoff passed (`identity-admission.ts:120`).
- Timely publication versus a real 30s miss: all eight publication schedules passed, including native reopen, plus the peer expiry recheck. Timeout still requires that `identity-established` was not already within the deadline (`identity-admission.ts:114`).
- Restore no longer hides an unsent deferred refusal: the restore handoff passed. Flush settles `admission_refusal` before the restore fence (`local.ts:1091`).
- Compare token is per `attempt()`, not a shared state read (`native-admission.ts:18`).
- Web capture uses a non-empty `/schema` `expected_store` before the staged transfer id (`web-journal.ts:213`). No web test re-run.

## The rest of the questions

Deferred waiting still forces `predictable: false` (`identity-admission.ts:68`). The admitted entry keeps the caller's flag; the device still decides prediction. Viewer and args are unchanged, so authorization is the normal POST check. `E_ID_REUSED` is still the exact op, viewer, and args mismatch.

A successful POST still resolves the caller. `usePendingWrites` shows "waiting for backend identification" while `admission_waiting` is set (`local.ts:1246`). `E_ADMISSION_TIMEOUT` and `E_ADMISSION_STORE` are family `store`, site `client.mutate`, with rewrite text (`identity-admission.ts:10`), and they are documented in `guide/why/E_ADMISSION.md`, `guide/client.md`, `guide/codes.rs`, and `CLIENT-AND-OPERATIONS.md`. The pre-ready refusal when neither store nor backend is loaded is still the public "reopen the client" error (`web-journal.ts:209`).

I did not re-run the claimed 96 regressions, the delivery matrix, or the 10,000 session sequences. This worktree has no SDK build and no `snapback4` binary; the runs above used an existing binary whose `identity_admission.rs`, `device.rs`, `store_identity.rs`, `predictions.rs`, `identity-admission.ts`, `native-admission.ts`, `local.ts`, `local-receipts.ts`, `web-journal.ts`, and `app-online.ts` matched this tree.

**NOT READY.**
