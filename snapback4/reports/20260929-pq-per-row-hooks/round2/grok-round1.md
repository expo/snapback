I'll review the PQ per-row hooks change read-only: the diff from `f56e8048a` to `6f1d75c16`, the lane prompts, and the round-0 findings, then check each fix against the code and tests.The branch is three commits on top of `main`. I'll read the round-0 findings and the source diff, then check each claimed fix in the code and tests.Round 0 left six findings. I'll read the scheduling, expiry, and publication code those fixes claim to touch.Auto-compacting conversation (82% full)...
Conversation compacted.
The review needs exact line citations before the verdict. I am pinning those locations in the current tree, then writing the review.Round-0 items 1–6 are fixed in the source, and each has a test that encodes the old failure. One new publication hole should stop landing. I did not re-run the suite (tests import `dist/`).

## Round-0 items

1. **Active reads no longer hold a slot until settle.** `ReadWork.cancel` (`read-work.ts:44`) aborts the active attempt; the abort listener (`read-work.ts:71`) frees the slot before the promise settles. A 30s deadline (`read-work.ts:70`) aborts with `READ_WORK_EXPIRED` if the adapter ignores abort. Last-owner `stop` and idle both call `readWork.cancel` (`client.ts:1016`, `local.ts:1227`). A shared owner is not aborted. Late publish is refused by `checkRead`, `duringRead`, and `signal.aborted` before `update` / `publishLocal`. Expired attempts rejoin at the tail (`client.ts:774`, `local.ts:1060`). Covered by `per-row-work.test.mjs:56` and `per-row-liveness.test.mjs:38`.

2. **Unknown apply footprints refresh.** `local.ts:282` schedules every affected owner when `touched === undefined`. `per-row-liveness.test.mjs:108` strips `touched`, freezes timers, and requires a new evaluation.

3. **A withdrawn deadline is not republished after rollback.** The sweep stores it on the watch (`read-expiry.ts:22`, `read-expiry.ts:100`). `expire()` does not clear it (`read-observation.ts:167`); `reset()` does (`read-observation.ts:165`). `readDeadlineWithdrawn` (`read-expiry.ts:17`) rejects `deadline <=` that mark. Ordinary expiry (`nextExpiry <= now`) still fails `current` and retries; only a deadline that still looks future is suppressed (`client.ts:613`). `keep-clock.test.mjs:386` returns a real post-rollback body, expects `{loading:true}`, one recovery query, and then a later deadline through `client.query`. Staying loading with no further refetch is the required behavior.

4. **Hooks memoize on canonical keys.** `readKey` sorts object keys and does not reorder arrays (`read-observation.ts:8`). `useQuery` / `usePage` depend on `[client, op, key, options?.keep]` (`react.tsx:111`, `react.tsx:120`). `observationKey` uses the same key (`observe-watch.ts`). `per-row-react.test.mjs:12` covers reorder, page-2 retention, and that `keep` and array order still split.

5. **The card excludes the paths that do not take a slot.** `client.md:72` states eight queued starts per turn, eight active, and that direct queries and timed presence refreshes are separate. `client.rs:9` pins both phrases.

6. **Fairness under continuing arrivals is tested.** `pending.set` does not reorder (`read-work.ts:41`). `per-row-work.test.mjs:54` expects `started.indexOf('waiting') === 16`. `pending.delete` before `pending.set` fails that test.

## Finding that blocks landing

**Medium.** `client.ts:613` and `local-query.ts:335`. A floor-rejected body is turned into a successful `{loading:true}` and then published.

`currentRead` rewrites a still-future withdrawn deadline to `{loading:true}`, nulls `nextExpiry`, and returns success so the accept loop does not spin. `reconcile` then treats any loading read as an immediate success and skips the answer-order fence (`client.ts:630`). `refresh` publishes it with `watch.update` (`client.ts:763`). Presence does the same (`client.ts:713`). Local evaluation `return loading` at `local-query.ts:335` never reaches the drop at `local.ts:1014`, so `rerun` publishes it (`local.ts:1039`) and presence does too (`local.ts:985`). `update({loading})` is `reload()` (`read-observation.ts:131`): `keep === false` replaces the snapshot with `{loading:true}` (`read-observation.ts:119`); omitted/`true` sets `revalidating` and keeps the body (`read-observation.ts:122`). `refresh`'s `finally` does not reschedule, because `dirty` is false.

Failing scenario: expiry remembers deadline D and starts recovery. Before that attempt returns, `client.query` (or the other retention policy's watch) publishes a body with deadline D+60s. `publish` does not bump `resetVersion` and does not clear the floor. The in-flight attempt then returns D. Online rewrites it to loading and `update`s it. With `keep: false` the newer row disappears and nothing retries. With retention, the newer row stays on screen with `revalidating: true` forever. `keep-clock.test.mjs:386` misses this because it waits for recovery to finish before the later query.

Smallest fix: a floor rejection must not be an accepted read. Do not rewrite it to loading. In `refresh`, `refreshPresence`, and `rerun`, return before `update` / `publishLocal`, and do not set `dirty` or `retryExpired`. The snapshot is already `{loading:true}` from `expire()` when nothing newer arrived, so the rollback test still holds. A newer body published during the attempt stays put.

## Liveness and bounds

Every observation's first answer is bounded: FIFO, at most eight starts per turn, at most eight active, and 30s on an attempt that ignores abort. Cancel and the deadline both release the slot; `release` ignores a stale controller, so a late settle cannot drop the replacement (`read-work.ts:73`). A cancelled attempt does not publish. There is no path that holds a slot until a hung promise settles.

The Medium above is the liveness hole: after a newer body is installed, the rejected attempt either erases it or leaves `revalidating` set with no further read.

## LV fences

Intact for a withdrawal that does not overlap a newer publish. Revoking changes, receipts, unknown footprints, and search roots still `reset` / `expire` before `scheduleRead` (`client.ts:867`, `local.ts:282`, `local-reads.ts:224`, `local-search.ts:26`). `reconcileLocalRead` is unchanged aside from a `void` return type. Local replies are still not remote evidence. `expire()` leaves the floor in place, so a new ticket cannot renew the withdrawn deadline. Page membership is unchanged: a loading first page replaces the combined read; a loading later page keeps the ready prefix and drops the suffix (`react-pages.ts:99`). A removed row does not stay after a revoking reset. Queueing delays the replacement read, not the withdrawal.

The new hole sits beside those fences: manufacturing a loading result skips both `resetVersion` and answer order.

## What else showed up

**Low, does not block.** `client.ts:577` and `local.ts:563`. Aborting an active read is new, and both `sendPost` catches still store `transportRefusal(error)` on `AbortError`. The link is not flipped offline. A later `!ok` that does not overwrite `transportFailure` reports that abort as `E_OFFLINE`. Smallest fix: skip the assignment when `signal?.aborted` or the reason is `READ_WORK_EXPIRED`.

**Low, does not block.** Test gap, not a missing check. Deleting `resetVersion !== watch.resetVersion` at `client.ts:747`, `local.ts:1016`, and `local.ts:1027` still survives the new tests. Recovery in `keep-clock` starts after `expire()`, so the versions match. Liveness aborts the signal, so `checkRead` blocks the late body. The checks are present and still needed for a write `reset()` (which clears the floor) overlapping an in-flight body whose deadline is still in the future.

The logged full-suite exit 1 was mid-fix. I did not re-run it, and I am not treating the later 61-case and 26-case logs as verified.

## What is sound

Slot release on cancel and on the 30s deadline. Coalescing without moving a queued owner. No publish after abort. Unknown-footprint withdrawal plus refresh. The deadline floor across rollback, including a real later body and no retry spin. Canonical `useQuery` / `usePage` identity. The client card's exclusion of `client.query` and presence. Synchronous LV withdrawal before the queued read. Page suffix removal on reset.

## Verdict

**READY WITH CHANGES.** The Medium blocks landing. The Lows do not. Do not land until a floor-rejected attempt cannot `update` the watch.
