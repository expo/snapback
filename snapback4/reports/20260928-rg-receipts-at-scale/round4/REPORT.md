# RG round 4 — protect every outstanding terminal delivery

2026-09-28, `sb4-intent/rg-receipts-at-scale`. First ran `git fetch origin &&
git merge origin/main`, merging 80036b4664 in 412c9191c. Kept both lanes'
journal entries and source changes. The two receipt-helper conflicts were
imports and the queue-reader signature; the automatic merge also produced
two readQueued definitions. Retained RG's owner-aware implementation and
main's restore/Worker changes. Merge and final commit carry the co-author
trailer. Read rounds 0–3's prompts, reports and journal entries and Astra's
full round-3 NOT READY review. Grok had no verdict at startup; did not wait.
[Context and governing constraints](CONTEXT.md).

## Findings, implementation and controls

**Both reported duplicate-success paths are fixed.** Copied Astra's tests
from lines 117, 142 and 172 of its `rg-review-extra.test.mjs` into the existing
`store-reset-review.test.mjs` audit module. Also copied its fourth test,
where a pending subscriber initiates the lookup without an artificial host
barrier. On the merged pre-fix code, both held-host reproductions deliver
**two events instead of one** ([before](reproductions-before.log)). The
pre-dispatch and pending-subscriber cases pass that control; they are not
claimed as additional pre-fix failures.

`WriteHistory.protectEmission` counts each delivery's ownership separately.
Replacement acquires its guard synchronously at the observe_store commit,
before the host may yield, and releases it in the notification's `finally`.
The already-successful-entry path acquires before receipt reads and possible
retirement and releases after delivery in `finally`. The shared completeWrite
callback preserves resolution before emission. The existing settling set
continues to arbitrate exclusive ordinary/keepalive settlement; notification
guards do not change settlement authority or dispatch order.

**The audit found a third duplicate-success race.** An earlier flush snapshot
can contain two already-emitted successes. While recovery of the first awaits
history, replacement retires both. After replacement finishes, a lookup of
the second success clears its marker; the old snapshot then reaches that
entry and emits it again. The new real-wasm regression
`replacement cannot duplicate a success still in an older flush snapshot`
fails the initial two-path fix ([before](snapshot-audit-before.log)).

The FIFO iterator now owns every snapshot id until it is exhausted, returns
or throws. During the queue read, cleanup is deferred until the unknown ids
can be pinned; once known, unrelated ids are again eligible for cleanup.
This closes both the later-entry gap and the delayed-queue-reply gap. Guards
are reference-counted because the snapshot, its current entry and replacement
can own the same id at once. They retain only emission markers, not results
or another durable receipt window. Normal queue reads prune after all owners
finish. Early-return, failed-read, failed-settle and failed-notification tests
verify release; overlap tests cover both completion orders.

**The pre-dispatch fault test is independently effective.** It seeds KNOWN
refusal during admission, before the first recoverReceipt, then throws from
the host after settle has committed. Caller and listener receive failed,
with one event and zero POSTs. Changing only that first call's receiptCall to
call fails the new test ([mutant](pre-dispatch-raw-call.log)). No production
change to that already-correct wrapper was needed.

Five isolated built-client mutation controls all fail at their intended
assertions, without editing live source or dist:

| Mutation | Failure |
|---|---|
| First recoverReceipt uses raw call | Caller outcome absent after durable refusal |
| Replacement omits its guard | Two sent events across concurrent lookup |
| Ownership count is always one | Both overlap orders lose the other owner's marker |
| FIFO snapshot omits id guards | Old snapshot emits an already-delivered success again |
| Queue acquisition omits its temporary guard | A delayed snapshot loses its marker before its ids are known |

[Control runner](controls.py), [outcomes](controls.json) and individual logs
are retained. The original acknowledgement race fails the merged pre-fix
control; snapshot and per-entry ownership both protect it in the final code.
The new snapshot ownership also preserves round 3's successful FIFO pair,
refused-tail sync, final-loop sync and retryable-head behavior.

Only SDK notification custody, tests and documentation change this round.
No server outcome, meter, authorization, disclosure, receipt qualification,
wire/store format or wasm ABI changes. `local.ts` remains **1,500 lines**;
the two delivery helpers live beside the existing receipt helpers. The writes
card now covers retirement and overlapping notification, with its existing
fact-home fixture updated. LLP 3000.019 §3.3 records the ownership rule.

## Exactly-once emission audit

The guarantee here is terminal delivery in an open client runtime with a
subscribed listener, under the existing receipt/custody contract. Reopen
creates a new client and listener lifetime. Pending/retryable/unknown outcomes
are not terminal events; close intentionally removes listeners. Lookup alone
never emits. Application callbacks must return normally for all subscribed
listeners to be reached; the new cleanup tests additionally prove guard release
when a callback throws, not delivery to later throwing-client subscribers.
This is not a claim of durable cross-process event delivery or infinite receipt
retention: the device retains its existing 256-receipt window.

The common rule is `firstEmission(id)` before invoking listeners. Queue reads
retain markers for queued ids, unpersisted/local outcomes, exclusive settlement
owners and all outstanding delivery guards. A retry cannot erase that marker
while any path can still emit the outcome. With no queued custody or outstanding
owner, later lookup may prune it but cannot create a new delivery. Reusing a
completed mutation id routes through recovery, not fresh admission.

| Path | Why one terminal event; relevant evidence |
|---|---|
| New successful POST | The FIFO snapshot and exclusive settling owner cover receipt save, retirement, observation and emitWrite. A failed save keeps the known summary; the caller/event still receive the original sent result. Repeated recovery reaches firstEmission with its marker retained. App-local receipts test both wasm/native failures, pending-writes tests FIFO and dropped connections, and Astra's acknowledged-success race pins concurrent lookup. |
| Non-retryable refusal | Same ownership through settleReceipt and delivery. A failed observation check schedules sync retry without skipping resolution/emission. A refusal removed from the outbox cannot be replayed; a failed receipt save leaves local custody whose recovery is deduplicated. The original queued E_STORE regression and receipt-save retry regression remain green. |
| Retryable refusal / transport loss | Neither emits a terminal Write. Head custody blocks later dispatch and same-id retry eventually reaches ordinary settlement once. pending-writes tests require zero events during interruption/hold and exactly the final two events in FIFO order. |
| Already-successful / qualified acknowledgement | deliverAcknowledgedReceipt protects before acknowledged() and optional settle. Snapshot ownership protects entries waiting for their turn. Persisted sent entries do not refresh receipt retention; authored refusals are not overwritten. Notification precedes subsequent sync. The held-settle lookup, pending subscriber, overlap and old-snapshot regressions cover the cleanup boundaries. |
| Replacement | observe_store commits a map of success-qualified retired ids. retiredReceipts acquires all their guards in that committed callback before asynchronous host completion. Each callback resolves and emits once, releasing in finally. A prior ordinary event is suppressed by its marker. Existing state/metadata/media/host failure tests prove first delivery despite later failures; the new held-observe lookup proves no second delivery. |
| Reset / restore / generation adoption | A reset qualifying for retirement uses the same observe_store map and notification guards. Device reset keeps unknown-outcome entries, clears predictions and retains their original store binding; it does not invent sent or a separate terminal event. Such entries settle later by recovery or original-store replay. A proved same-store restore halt fences transport and retains unknown custody; it does not emit an invented per-write result. Generation adoption alone emits no terminal Write. Existing reset/reconnect, store-replacement and legacy-receipt tests cover these distinctions. |
| Reconnect and reopen | setLink/flush coalesce ordinary work; the exclusive owner prevents keepalive from competing with an ordinary settlement. Queued successes enter the protected iterator; unknown entries keep same-id replay and original binding. Repeated reconnect reads cannot manufacture an event once outbox custody is gone. Pending-writes' held/sent reload and dropped-connection cases assert one event per settled id in the receiving runtime; legacy receipts require one NOT_ADMIN after replay and none while unknown. |
| Recovered receipt before dispatch | The snapshot and exclusive settling owner precede the first history read. keep must succeed before retirement. receiptCall preserves a committed result through a host failure and schedules housekeeping separately; delivery still resolves/emits once, with no POST. Astra's newly copied pre-dispatch test kills the raw-call mutant independently. |
| Receipt returned by begin_send | The same owner spans the second recoverReceipt and notification. Existing recovered-refusal media/host tests enter this branch, verify no POST and require one caller/listener outcome even after housekeeping retry. |
| Keepalive refusal | exitRefusalSettlement acquires exclusive ownership before reading history and atomically committing settle_exit. A concurrent ordinary owner makes it decline settlement; an existing terminal receipt wins. Only a committed true result publishes. receiptCall preserves post-commit failure, and finally releases the owner. The audit's keepalive media/host faults and browser admission/session tests exercise this path. |
| client.write(id) / pending list racing delivery | Both only inspect custody/history, with no call to emitWrite. Their queue reads retain all owners. Held replacement and settlement reproductions explicitly look up sent while the queue is empty; the pending-subscriber control exercises lookup reentry. Delayed snapshot and overlapping-owner tests prove that releasing one owner cannot expose another notification to cleanup. |
| Earlier FIFO snapshot racing retirement | Snapshot acquisition defers cleanup until ids are pinned, then retains all ids until iterator cleanup, including a later entry not yet processed. Replacement's independent guard can finish first without dropping this ownership. The new real-wasm reproduction and no-batch/no-read mutants pin both gaps. |
| Admission failure / same-id recovery | Local terminal admission errors are remembered before emitWrite; ordinary history retains their marker. MutationIds shares an in-flight result or recovers a used id rather than dispatching it again. These are not proof that an unknown captured journal executed; recovery retains the existing known/unknown distinction. Existing admission, pending-write and receipt tests cover the boundary. |
| Raw online / app facade / delivery reporter | Raw online settlement performs synchronous resolution/emission after classifying its response. The app custody wrapper persists or retains a known outcome and deduplicates its facade notification; local receipt-save tests pin this across wasm/native tiers. The separate onDeliveryRefused stream publishes only after conditional debt persistence and never enters ordinary onWrite. The receipt/delivery suite covers their independent notification contracts. |

No remaining unargued SDK retirement-to-notification path was identified in
this scope. The extra snapshot and overlap tests were added where the original
two-path reasoning was insufficient. Round 3's report remains a historical
await-failure audit; its marker-lifetime claim was incomplete and is corrected
by this round's three races and ownership argument.

## Validation

Final affected checks pass: **552 client tests**, with one explicit legacy-server
skip, and **135 Rust tests**, with one opt-in measurement ignored.
[Commands](commands.sh), [test counts](test-summary.json), [exit codes](check-exits.txt)
and all full logs are retained.

| Check | Result |
|---|---:|
| Audit module (42 existing + 12 new) | 54 passed |
| Clock, React and pending writes | 141 passed |
| Client receipts and delivery | 212 passed |
| Settlement, outcomes, replacement, reconnect and generation | 90 passed; 1 legacy-server skip |
| Chromium admission/session boundaries | 55 passed |
| Whole guide, final | 93 passed |
| Rust receipt gaps and delivery | 42 passed; 1 opt-in measurement ignored |
| Client build/typecheck and merged native debug build | passed |
| Root reference audit, whitespace and source limits | passed |

The skipped client test requires SNAPBACK4_LEGACY_BIN for published 0.2.32;
it is not silently counted as a pass. The earlier targeted 4/4 and 10/10
runs overlap the final audit module and are not additional counts.
The initial guide run remains **91 passed / 2 failed** in guide.log; the
corrected full guide is separately retained in guide-final.log. No runtime
source changed after these final checks started.

## Failures and disposition

| Classification | Failure | Disposition |
|---|---|---|
| Ours, reported regressions / expected pre-fix control | Replacement and acknowledged-success lookup each emit twice | Both fixed; pre-fix and fixed logs retained |
| Ours, audit finding / expected initial-fix control | A later success in an old FIFO snapshot emits twice | Protect snapshot acquisition and all its ids; regression now passes |
| Ours, expected mutants | Five isolated mutations fail six assertions (two overlap orders) | Final unmutated audit passes; all control logs retained |
| Ours, documentation | Whole guide initially fails its word target and writes-04 fact home | Shorten the changed sentence and update the existing fact fixture; whole guide passes 93/93, with no budget change |
| Ours, discovery/setup | Uninitialized local skill link, guessed guide/local filenames absent, first controls.py write used an extra snapback4/ path from that directory | Read initialized sibling skill without modifying it; use discovered paths; create control runner at the correct path. No product check counted as passing from these errors |
| Ours, merge integration | Three textual conflicts; automatic merge duplicated readQueued | Keep both journal sides and combine source semantics before compiling; merge/build/typecheck pass |

No baseline or environmental test failure has been observed in this round.
The earlier full-suite reds are not relabeled or cleared by these affected
checks. **Did not run scripts/test.sh**, as instructed; the supervisor owns
that next landing suite. No tools installed, push or publication.

[Wasm measurement](wasm.json): **2,019,815 B raw / 585,381 B gzip**, SHA-256
`2e12e4657211129dfe80e58ff8ef88a23d52ad19885ed5d461c30a68d47e68a0`.
Byte-identical to round 3, **812 B** below the unchanged **586,193 B** cap.
Remeasured using GNU `gzip -9 -c` file input, not rebuilt. The merged Rust
core/device changes are test-only, and this round changes no wasm input.
No new scale latency or calibration-store measurement is claimed.
