I'll review the PQ per-row hooks diff read-only: the claimed bounds, retention rules, clock refetch, and cost at N=1,000. Starting with the prompt, the report, and the exact commit range.The review skill would write artifacts and delegate; this request is a read-only review of one commit range, so I’ll inspect that diff and the lane report directly.The report claims an eight-start queue and a clock-loop fix. Next I’ll read the scheduling, expiry, and publication code those claims depend on.Auto-compacting conversation (81% full)...
Conversation compacted.
The prior pass left the expiry-rollback publish path and a few line citations unverified. I'll confirm those against the current tree, then write the review.**NOT READY.** One landing blocker: a deadline the client has already withdrawn can be published again after the server-time estimate moves backward, and the new queue makes that the common path for any recovery that has not started. Authorization revocation does not have this hole.

Diff reviewed: `ee514de11..3e2961ee8` (`3e2961ee8`), lane PQ. `dist/` is not in the tree, so this is from the source and the lane’s own tests and report, not a rerun. No repo file was changed.

## Sound

Finite observation work is not starved and is not delayed without a bound. `ReadWork` (`read-work.ts:11-36`) is FIFO, coalesces by watch, starts at most eight per turn, and keeps at most eight in flight. A mount that arrives later is appended. At N=1,000 that is about 125 timer turns, which matches the wasm point mount of 593.2 ms. It becomes unbounded only if eight starts never return (below).

A relevant write does not publish a pre-write body from a deferred evaluation. Online `/changes` and receipts reset affected watches to `{loading:true}` before `scheduleRead` (`client.ts:861-870`, `client.ts:908-920`). Local commit does the same inside `LocalReads.changed` (`local-reads.ts:208-220`) before the delivery callback. An evaluation already running fails `resetVersion` (`client.ts:741`, `local.ts:1010` and `:1021`), `answers.revision` (`local.ts:1010`), or `seq >= minimumReadSeq` (`client.ts:613-615`). A read that has not started yet runs against the post-write server or replica and captures the post-reset version. Closing cancels a still-queued watch (`client.ts:1010`, `local.ts:1220`). A revoked row does not come back from a deferred re-evaluation.

Plain revalidation is the other path: `reload` keeps the last answer with `revalidating: true` (`read-observation.ts:115-124`). That is the retention rule, not a deferred stale publish. The queued run still has to pass the same fences.

Empty and unrelated applies do not re-evaluate known watches. `ReadIndex.affected` (`read-index.ts:57-61`) returns only the `"*"` bucket for an empty table list, and `changed` reloads rather than resets when `touched` is empty (`local-reads.ts:214-220`). The warm apply skips the per-page `scheduleRead` and drains once after the watermark (`local.ts:279-281`, `local.ts:786-790`).

The clock-loop fix is in the right function and is tested. `correctReadExpiries` used to call `refresh` for every watch; it now calls it only for due owners (`read-expiry.ts:93-96`). Withdrawals still run before any subscriber (`read-expiry.ts:66-93`). `per-row-work.test.mjs:44-72` drives that function with 1,000 watches: a sample with nothing due must record no evaluations. The old loop would push every id and fail. Production passes `scheduleRead` as that callback (`client.ts:671-674`, `local-read-publication.ts:44-47`).

## High — a withdrawn server deadline is republished after rollback

`read-expiry.ts:96`, accepted at `client.ts:615` and `local.ts:951-952`. The ticket fence that does not cover this read is `local-reads.ts:110` and `:135`. Online withdrawal never fences tickets: `client.ts:677-679`.

`issuedDeviceNow` only moves forward (`clock.ts:38`), so a local `expire at` row stays expired. `estimatedServerNow` does not (`clock.ts:35`). LLP 3000.029 §2 says a row, asset, or answer deadline is never renewed by revalidation or wall-clock rollback. The report states “Clock rollback cannot resurrect withdrawn answers.”

Scenario. An online `useQuery` is showing a row whose answer has `nextExpiry = T`. A sample moves the estimate to T. The sweep clears the deadline, `watch.expire()` swaps in `{loading:true}` and bumps `resetVersion`, then `scheduleRead` queues `refresh`. Before that refresh is judged, the estimate goes back below T. That can happen in the withdrawal subscriber, which runs at `read-expiry.ts:93`, before `refresh`, or any time the recovery is still waiting behind eight in-flight starts. `refresh` then captures the already-bumped `resetVersion` (`client.ts:734`), so line 741 passes. `runQuery` takes a new `answerOrder` ticket (`client.ts:585`). The server still has the row, because its clock never reached T. `currentRead` accepts `nextExpiry > estimatedServerNow`. The hook shows the row again.

The local client does the same for a server deadline. `publishLocal` compares `serverExpiry` to the live estimate. `RememberedAnswers.expire` only rejects tickets that had already begun; the queued read calls `begin()` after the barrier and is admitted.

Why the tests stay green. `per-row-work.test.mjs:70-72` only checks that a second sweep does not call `refresh` again. It never runs the refresh that was already queued. `keep-clock.test.mjs:73` answers a held `/q/` with `{loading:true}`, and the rollback tests either never release a real body (`keep-clock.test.mjs:206-225`) or fail the later query. None of them publish a real post-rollback body.

Smallest fix. On expiry withdrawal, store that deadline on the watch. `currentRead` and `publishLocal` must reject a body whose `nextExpiry` or `serverExpiry` is less than or equal to it. Clear the mark only on a non-expiry `reset` (a real write, sign-out, or store replacement), so a newer answer with a later deadline can still publish. Do not `cancel` the coalesced queue entry: a later write shares that key and must still run. Do not treat this rejection as `dirty` or `retryExpired` (`local.ts:1038-1055`) or as a `watch.fetch` accept failure (`read-observation.ts:86-97`); those paths would retry the same body.

This blocks landing.

## Medium — eight non-completing starts freeze every later observation

`read-work.ts:22` and `:31-34`. The observation request is `client.ts:594`. The slot drops only in the `finally` after `run` settles.

Scenario. Eight `/q/` calls never return. There is no per-start timeout; `AbortSignal` aborts on close, and `waitSeconds` applies to `/changes`, not to this cap. A row mounted after that stays `{loading:true}` until one of the eight finishes. Before this lane those eight hangs did not block the ninth start. Completing work is still bounded, so this is not the steady-state mount delay.

Smallest fix. Give each observation start a deadline that rejects and releases the slot, and do not let the existing accept-retry occupy the slot across its backoff unless a replacement is allowed to start.

This does not, by itself, block landing. It is a liveness regression, not a stale publish.

## Cost

A relevant write re-evaluates all 1,000 point observations because each one depends on the table, not because the queue fans out. `ReadIndex.affected` is table-granularity (`read-index.ts:57-61`). LLP 3000.029 §13 forbids inferring row independence from arguments, and this lane does not. One edited `cards` row is 1,000 evaluations and one list observation is 1. That is the whole remaining cost: the old online point fixture did 139,711 HTTP calls and 98,405 ms for one write; the qualified run does 1,000 calls, eight at a time. At N=1,000 the qualified relevant-write times, including the 200 ms settlement wait, are 796 ms wasm, 1,261 ms Worker, 1,051 ms online, and 439 ms process, against about 230–280 ms for the list. The last row waits out the drain. Row-level certificates would turn a one-id write from 1,000 evaluations into one. That is worth doing later. It is not a defect in this lane, and it is why the list advice exists.

## Guidance

The client card change is accurate for the client, and it does not describe ChatRail as cheap. `client.md:61-76` says per-row hooks stay supported, a list of the same fields is one evaluation instead of 1,000, the wasm sample was 23 ms versus 593 ms and is a single run, unrelated writes are zero, the cap is eight starts and eight in flight, and a write to the table re-evaluates every row even if one id changed. Those counts match the report (22.7 ms rounded, 593.2 ms). The example is one `useQuery` for members and one `usePage` for the list. ChatRail’s own N=1,000 mounts (5.7 s wasm, 27.2 s Worker, 7.7 s online) are in the report, not the card.

## Low — the card overclaims for `useQuery` key order

`react.tsx:110` and `:119`, contradicted by `client.md:64-65`. `observationKey` now uses canonical `readKey` (`observe-watch.ts:23`), so two live hooks with reordered object keys share one watch. `useQuery` and `usePage` memoize on raw `JSON.stringify`. A re-render that only reorders keys changes the memo, unsubscribes, and, unless `keep` is true, closes the watch at zero subscribers and starts another. The hook flashes `loading`. The lane did not edit `react.tsx`.

Smallest fix. Memoize on `readKey`, still including `keep`. Does not block landing.

Also low, and not landing blockers: presence probes and `client.query` never enter the queue (`client.ts:695`, `local.ts:961`), which the report states and the card’s “observation” wording allows; `read-work.ts:34` swallows a rejection after the slot is released; the full `scripts/test.sh` on this lane exited 1 with 23 client failures that the report says were later fixed in affected files, and there was no second full run. The keep-remount timeout is ticketed as baseline. I did not re-run it.

## Tests

The cap, coalescing, cancellation, N-versus-zero write counts, and the due-only clock sweep are real. Deleting the due-set and refreshing every watch fails `per-row-work.test.mjs:53-54`. Empty and unrelated applies are pinned at N=1,000 on wasm and process.

A mutation that survives: delete `resetVersion !== watch.resetVersion` in `client.ts:741` and `local.ts:1010`. `per-row-work.test.mjs:96-106` waits until every row is idle, then fires the change, and the mock `/q/` resolves on `setImmediate`. No body is in flight across the reset, so the count test stays green while a response that started before the write and finished after it publishes the old row.

The rollback mutation also survives: leave `currentRead` and `publishLocal` comparing the deadline only to the live estimate. Both the sweep unit test and `keep-clock.test.mjs` stay green.

## Verdict

**NOT READY.** Land after the withdrawn deadline is rejected at publish on both clients, with a test that returns a real post-rollback body and expects the hook to stay `loading`. The queue, the revocation fences, the empty-apply behavior, the clock-loop fix, and the list-versus-per-row card are sound. The eight-slot hang and the `useQuery` key are follow-ups, not this blocker.
