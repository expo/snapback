I'll review the round-3 receipt settlement change read-only: first the diff and the prior findings, then whether Astra's lost-notification case is actually fixed.The range is one commit, mostly reports. I'll read the source delta and the round-3 claim next, then check the delivery paths against Astra's case.The settlement path moved into helpers. I'll read those functions and the new tests before judging whether the Medium is actually closed.The focused tests pass on a copy. Next I’ll break the fix on that copy and check whether a repeated media failure can stall the next send.**NOT READY.** Astra's lost refusal notification is fixed, and the new tests kill that bug. The same round adds a send stall: once media housekeeping keeps failing, an already-queued tail never posts.

## Astra's Medium is fixed

The refusal is still removed from `settled` before the observation check, but that check can no longer skip delivery.

```1156:1162:snapback4/packages/snapback4/src/local.ts
        if (!closed && !("persistencePending" in result)) {
          if (outcome.state !== "sent") rerunTables(predictedTables(entry.predicted));
          // Durable completion survives a failed observation check; retry sync separately.
          try { await syncUnobserved(outcome.state === "sent"); } catch { retryFlush(); }
        }
        settle?.resolve(outcome);
        emitWrite(outcome);
```

`a durable refusal still completes when its observation queue read fails` is the right case: first write sent, second refused, one `E_STORE` from `queued` after that refusal is stored, timers frozen, `/sync` held. On a copy of this tree it passes. Deleting only the new `try/catch` fails it with `terminal delivery cannot wait for observation recovery or a caller timeout`. The caller, `onWrite`, and `client.write(id)` all get `failed`, once.

## What else holds

- **Success and non-retryable refusal.** The resolver is captured before the guarded check. A retryable head and a not-ok send return at `local.ts:1143` and `local.ts:1147`, before `settled.delete`, so a throwing check cannot retire them. The entry stays queued and the caller stays `pending`.
- **Known success.** `local.ts:1101` resolves and emits before `syncOnce`. A later sync failure cannot un-deliver it.
- **Reset.** Retired-success notifications are queued on the committed `observe_store` reply and run in `call`'s `finally` before `sync_state`, `set_meta`, or a rejected host call (`local.ts:337`). The state-failure test passes: one `sent` event, `client.write(id)` agrees, `acquired` stays false, and a healthy retry does not emit again.
- **Post-commit settle / exit.** `terminalDeviceCall` (`local-receipts.ts:66`) returns a non-denied committed reply and retries housekeeping separately. Media and host failures still deliver the recovered refusal and the keepalive refusal.
- **Duplicates.** `readQueued` keeps active settlement ids in the emission set (`local-receipts.ts:83`). Dropping `...settling` fails `receipt-save retry preserves refusal notification deduplication through observation`.
- **Spec.** Two successful posts still complete with sync held (`a queued send follows a settled receipt without waiting for an intermediate sync`). A refused tail still syncs the earlier success before the batch promise resolves, and not between the posts. Deleting only the post-loop `await syncUnobserved()` at `local.ts:1167` fails `the final flush sync publishes an earlier success when the tail retires before its queue lookup`.
- **Reconnect** is another `flush()`. A refusal already removed from the outbox is not emitted again. There is no second reset emission after the bookkeeping failure.

The only await between `settled.delete` (`local.ts:1150`) and `resolve` (`local.ts:1161`) is the guarded sync. `rerunTables` is synchronous and `predicted` is always a `string[]`.

## Medium — a repeating media failure stalls an already-queued send

`snapback4/packages/snapback4/src/local.ts:1090`

Any post-commit rejection after a durable non-denied reply sets `reconcileNeeded` and schedules a flush (`local.ts:1051`, `local-receipts.ts:71`). The next flush awaits `media.reconcile()` and **throws before the outbox loop** if that fails again. `MediaCache.reconcile` runs on every `settle`, not only when bytes change. One throw is harmless: the chain is not poisoned, and the next reconcile can succeed. If it keeps throwing, every later flush dies on the gate.

The device is fine. Both writes stay queued. The head caller has already been told `sent`. The tail never reaches `begin_send`.

Reproduced on a copy, not in this worktree. Admit two sends while the mutation route is held, so the second is not in the flush snapshot. Then make `MediaCache.prototype.reconcile` throw forever, release the route, and advance the frozen retry timer. Result: first outcome `sent`, `sends === 1`, both ids still in `queued`, including after 8 retries of 5 seconds. That probe is not in the round's tests.

This blocks landing. It is a new stuck send on a healthy outbox, in the housekeeping split this round added.

**Smallest fix:** at `local.ts:1090`, catch the reconcile failure, leave `reconcileNeeded` set, call `retryFlush()`, and fall through into the queue loop. Do not throw.

## Test strength

These one-line deletions are killed: the observation `try/catch`, `...settling` in `retainEmissions`, and the final `await syncUnobserved()`.

This one survives: empty the observation `catch` so it does not call `retryFlush()`. `a durable refusal still completes when its observation queue read fails` still passes, including publication of the first success. The post-loop sync is already waiting on the held `/sync`, and releasing that hold publishes it. The test does not prove the catch scheduled a retry.

The media stall above also survives the new file. No test keeps `reconcile` failing after the first `settle`.
