I'll review the PQ port read-only: the diff against current main, the lane prompts, and the round-1 and round-2 findings. No files will be changed.The diff is large and mostly reports. I'll read the lane prompts, prior review findings, and the source changes next.Round 2 left a High on queued `keep: false` and a Medium on a late deadline floor. I'll read the ported observation code and the round-3 fixes against those findings.Auto-compacting conversation (82% full)...
Conversation compacted.
The review is ready to write. I am pinning the exact line numbers for the findings before the verdict, and I will not change any files.**NOT READY.** The port is real, the queue bounds hold, and the round-3 `keep: false` invalidation fix holds for commits and `/changes`. The round-3 deadline-floor fix does not. A clock sweep that leaves the raw answer in place then reloads it, and the new test still passes.

Conclusions are from the tree at `b8cd041ee` (`git diff 4fd338de5..b8cd041ee`). Tests import `dist/` and were not re-run. No file was changed.

## The port

Nothing in `packages/snapback4/src` names LLP 3000.029, answer-order, dependency fences, or touched-dependency withdrawal. Ordinary `apply` / `admit` / `settle` go through `LocalReads.committed` (`local-reads.ts:153`), which calls `reload()` (`local-reads.ts:161`), not `reset()`. `reload()` keeps a retained body and marks it revalidating (`read-observation.ts:109-118`). Other commits `reset({ loading: true })` and bump `resetVersion` (`read-observation.ts:143`). `expire()` still withdraws and bumps `resetVersion` (`read-observation.ts:145`).

An apply with no `touched` array sets `committedTables.unknown` (`local.ts:314`). The sync round's final drain then schedules every watch (`local.ts:772-773`). A known empty footprint schedules nobody. `/changes` still filters by table (`local.ts:843`, `client.ts:826`). A successful online mutation still schedules every watch (`client.ts:863`); that was already true on `main`.

## What is sound

`ReadWork` (`read-work.ts:41-96`) is a per-client FIFO: 8 starts per turn, 8 active, coalesce-in-place, abort listener releases the slot even if the promise ignores abort, a stale `release` is a no-op, `cancel` and the 30s lifetime free the slot, `retry` waits outside the active set. Skipping a watch that is already active does not burn a start.

Round-3 High is fixed for invalidation. `scheduleRead` reloads and notifies before it enqueues (`local.ts:982-984`, `client.ts:682-684`). `keep: false` becomes `{ loading: true }` immediately; default and `keep: true` keep the body. `per-row-boundaries.test.mjs:46-88` fills eight slots, transfers the row, and asserts the notification happens before any replacement query.

The publication-time floor check is real. `withdrawnLocalResult` (`local-read-deadlines.ts:8-11`) runs before `publishLocal` in `rerun` (`local.ts:1004`) and `refreshPresence` (`local.ts:960`). A rejected data body does not publish. The presence case in that test expires a peer, leaves the target's raw deadline in the future, and asserts the snapshot object is unchanged (`per-row-boundaries.test.mjs:152`).

Round-3 Low is fixed. Abort returns before the transport diagnostic is stored (`client.ts:565`, `local.ts:551`). `per-row-liveness.test.mjs:152-158` stops the abort event and rejects with `ABORT_ERR` after an `ECONNREFUSED`; removing the guard would overwrite the diagnostic.

The three earlier lows are fixed in code: a due completion with a newer answer identity does not publish synthetic loading (`client.ts:716-717`, `local.ts:1010`); local expiry backoff is `readWork.retry` after `running = false` (`local.ts:1040-1042`); an accept-time floor returns before `scheduleExpiry` (`client.ts:703`).

Unknown-footprint drain and both local `resetVersion` checks (`local.ts:1006` and `local.ts:1013`) are present. Canonical keys are `observationKey` (`observe-watch.ts:23-24`) over `readKey`. With the default policy, a queued relevant write reloads to `revalidating` rather than `{ loading: true }`, which is what the "1,000 hooks, zero loading renders" claim depends on.

## Medium — blocks landing

A sweep that preserved the raw answer immediately reloads it. `correctReadExpiries` adds the owner to `due` when a **held** deadline is due (`read-expiry.ts:83-89`) even if the raw deadline is still in the future and is only re-armed (`read-expiry.ts:105`). It also adds the owner when the raw device deadline is due (`read-expiry.ts:99-104`). Local `withdrawExpiry` then deliberately does not expire a local-wakeup answer whose server deadline is still in the future (`local-read-deadlines.ts:31-35`). Both refresh callbacks call `scheduleRead` (`local-read-deadlines.ts:25`, `client.ts:639`), and `scheduleRead` always `reload()`s (`local.ts:984`, `client.ts:684`).

`holdReadExpiry` (`read-approval.ts:72`) copies the raw deadlines at approval time. This is the production held deadline.

Failing scenario. A `keep: false` or default observation is showing value 8 with raw server deadline D+60. The approved facade still has deadline D. Server time reaches D.

- The sweep records floor D, withdraws only the facade, and re-arms D+60.
- `keep: false`: `reload()` hits `read-observation.ts:111-112` and publishes `{ loading: true }` before the re-read is queued. The re-read returns a body whose `serverExpiry` is still ≤ D. `local.ts:1004` returns without `retryExpired` and without publishing. Nothing puts 8 back. The row stays `{ loading: true }` for as long as every body carries a deadline ≤ D, which is the rollback case the floor exists for.
- Default keep: `reload()` copies 8 as `revalidating` and `beginEpisode` arms `Date.now() + 1000` (`read-episode.ts:12`, `read-observation.ts:21-24`) because no episode was active. A floor-rejected completion does not publish. About one second later the episode assigns `{ loading: true }` directly (`read-observation.ts:38-44`) and does not queue another attempt. The same withdrawal happens if that re-read is still behind the eight-slot cap when the second elapses. A later body whose deadline is after the floor can still publish, because the episode does not bump `resetVersion`. A body that is not after the floor cannot.
- `keep: true` is unbounded. The answer stays. This policy is fine.

The queued test drives this sweep and does not see it. Inside `RememberedAnswers.set` it publishes value 8 and calls `live.sample(deadline)` (`per-row-boundaries.test.mjs:112-114`), which is the real sweep, while the read is still `running`. The assertion is only `data?.value !== 7` (`per-row-boundaries.test.mjs:151`). After the wipe, loading's value is `undefined`, so `keep: false` passes. The test never waits out the one-second episode, so default keep still shows 8. Removing `readDeadlineWithdrawn` from `withdrawnLocalResult` would still fail that assertion, so the floor clause itself is tested. The reload is not.

Smallest fix: the sweep callback should enqueue without `reload()`. Local already has `acquireRead` (`local.ts:986`). Split online `scheduleRead` the same way. Do not change `/changes` or commit scheduling; those still need reload-before-queue. A real server expiry has already called `expire()` before `refresh` (`read-expiry.ts:107-110`), so `reload()` was a no-op on that path.

## Medium — does not block

Local sign-out publishes the denial and then destroys it. `setLink("signed-out")` publishes `{ denied }` (`local.ts:353`) and then `scheduleRead`s every watch (`local.ts:364`). The denial has no `data`, so `reload()` publishes `{ loading: true }` for every policy (`read-observation.ts:111-112`).

The completion cannot restore the denial. `publishLocal` requires `!unavailable()` (`local.ts:927`). `sessionDead` makes that false, so `publishDelivery` returns before the publish callback (`local-publication.ts:10`). `rerun`'s `finally` does not reschedule while `sessionDead` (`local.ts:1039`). The watch stays `{ loading: true }` until a later sign-in.

On `4fd338de5`, `rerun` reloaded only when `watch.retain` (`local.ts:989` there). `keep: false` kept the denial. Default and `keep: true` already ended on loading; that part is not new. Online sign-out publishes the denial and does not `scheduleRead` (`client.ts:326-341`), so the denial sticks. This is not a signed-in row left on screen. It should be fixed, and it does not by itself stop landing.

Smallest fix: after the signed-out denial, do not `scheduleRead`. A signed-out evaluation cannot publish.

## Low — none block

Online success publish has no identity check. The due branch returns when the displayed identity already changed (`client.ts:716-717`). The success branch publishes whatever `currentRead` accepted (`client.ts:724`). A `/changes` notification that does not move `minimumReadSeq` past the in-flight sequence can let `keep: false` paint the old body, then `dirty` withdraws it again in the same turn. Local has the same shape: `/changes` does not bump `answers.revision`, and `local.ts:1022-1025` publishes a non-expired body over the revalidating snapshot before `finally` schedules again. Smallest fix: the same identity check as `client.ts:717` before the success publish.

The local reset fence is checked twice (`local.ts:1006` and `local.ts:1013`), and the test only needs one. `per-row-publication.test.mjs:62` resets inside the fetch mock, then expects loading and `queries === 2` (`per-row-publication.test.mjs:81-83`). Deleting either comparison alone still drops the body and queues one replacement. Deleting both publishes the pre-reset body and fails the test. Online has one check (`client.ts:711`).

A floor return at `local.ts:1004` does not change `expiredRetries`, so the next real expiry retry keeps the old backoff count. `ReadWork.clear` (`read-work.ts:64-69`) does not reset `starts` or `queued`; that lasts one turn after `close`.

## Test strength

Two mutations survive.

Delete either `local.ts:1006` or `local.ts:1013`, not both. `per-row-publication.test.mjs:45` still passes.

Leave the sweep on `scheduleRead`. `per-row-boundaries.test.mjs:151` still passes while value 8 has already been replaced by loading. Assert `getSnapshot().data.value === 8` on the queued path for all three policies, and for default keep advance `Date.now` past the episode before asserting it again.

## Verdict

**NOT READY.** One Medium blocks: the sweep refresh must queue without `reload()`, and the queued floor test must show that value 8 is still the snapshot after the sweep, including after the one-second episode for default keep. The sign-out Medium and the lows should be fixed or explicitly left, and they do not change the verdict.
