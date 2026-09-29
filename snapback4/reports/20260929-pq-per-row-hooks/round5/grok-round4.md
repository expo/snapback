I'll review the PQ port read-only: the diff from `main` through rounds 2–4, the lane prompts, and the earlier review findings, then check whether the retention and slot rules actually hold.The branch is rounds 2–4 on top of current `main`. Next I’ll read the lane prompts, the earlier findings, and the observation-work diff itself.Round 3 left a footprint-clearing bug and a sweep that reloaded kept answers. I’ll read the current observation path against those findings.Auto-compacting conversation (83% full)...
Conversation compacted.
The diagnosis is already in. I’ll confirm the cited lines, then write the review.**NOT READY.** Two bugs block landing. Both are on the local client, and both require a read that is already in flight. The idle and queued paths, and the online client's `/changes` sequence retry, hold.

## What is sound

The port does not depend on lane LV. Nothing in `packages/snapback4/src` mentions LLP 3000.029, and ordinary commits still re-read through `reload`. Expiry and `reset` still withdraw and bump `resetVersion`. A withdrawn server deadline survives `expire()` and is cleared only by `reset()`. Clock rollback cannot republish a body at or under that floor.

`ReadWork` caps starts at eight per turn and eight in flight. Coalescing does not reorder the queue. Cancellation and the 30s lifetime free the slot even if the adapter ignores the abort, and a stale controller cannot free a newer attempt. Retries wait outside the active set and rejoin the tail. Cancel-before-start does not leak a slot. I found no starvation beyond the FIFO the fairness tests cover.

These round-1 through round-3 fixes hold on the path each review named, and the detecting test fails if that path is undone:

- An unknown apply footprint still schedules the final drain (`local.ts:772`). `keep: false` is neither `kept` nor `runsOnServer`, so the caught-up branch at `local.ts:776` would not schedule it. `per-row-publication.test.mjs` and `per-row-liveness.test.mjs` cover that bit.
- A floor raised after evaluation is rejected by `withdrawnLocalResult` (`local.ts:1005`) before `publishLocal`. The sweep refreshes with `acquireRead` (`local-read-deadlines.ts:25`), not `scheduleRead`, so a held-only due watch records the floor and does not `reload` a raw answer whose own deadline is still in the future.
- Abort is not stored as a transport refusal. `per-row-liveness.test.mjs:135` asserts the diagnostic.
- Both `resetVersion` comparisons exist (`local.ts:1007` and `local.ts:1014`). The callback site is now pinned: `per-row-retention.test.mjs:238` resets inside the `expiredRetries` setter, which runs at `local.ts:1012`, after the early check and before `publishLocal`.
- Idle `keep: false` withdraws inside `reload` before the watch is queued. A known, nonempty, disjoint footprint does not clear disjoint remembered answers. Sign-out sets `sessionDead` before `setLink`, and `scheduleRead` returns immediately, so the denial stays.
- For an idle watch, `reload({ queued: true })` does not arm the one-second deadline. `rerun` arms it at `local.ts:1002` when the attempt starts. The real-clock 1,000-hook tests start from `not revalidating`, so their zero `loading` result is real for that path only.

I did not re-run the suite. `packages/snapback4/dist/` is not built, and the tests import it.

## Finding A — High. Blocks landing.

An in-flight local attempt publishes the pre-change body after a relevant `/changes` has already withdrawn the row or marked it revalidating.

Sites: `local.ts:843`, `local.ts:984`, `local.ts:1007`, `local.ts:1023`, `read-observation.ts:80`, `read-observation.ts:118`, `local-query.ts:204`, `local-query.ts:287`, `local-query.ts:335`.

`/changes` calls `scheduleRead` for a `runs: server` watch whose tables overlap, and it does not bump `answers.revision` or `resetVersion`. `scheduleRead` reloads and, if `watch.running`, only sets `dirty`. The attempt keeps running.

- `keep: false`: `reload` publishes `{ loading: true }` and bumps `revision`, not `resetVersion` (`read-observation.ts:114`). The row disappears.
- Default `keep`: `reload` assigns a revalidating snapshot and does not bump `revision` (`read-observation.ts:118`).

When the in-flight server call resumes, `watch.fetch` replaces only the top-level `read` on a revision mismatch (`read-observation.ts:80`). The callback at `local-query.ts:204` put the server body on `candidate.result.read`. `publish` destructures `{ result, origin }` at `local-query.ts:287` and returns that nested body at `local-query.ts:335`. For default `keep` the revision did not change, so both copies are the old body. `rerun`'s fence (`local.ts:1007`) sees the same incarnation, authority, and `resetVersion`, and `publishLocal` writes it (`local.ts:1023`). The revoked row is back, as a finished answer, until the `dirty` retry runs. Behind a 1,000-hook queue that retry waits.

A local commit does not have this hole: `committed` bumps `answers.revision` (`local-reads.ts:165`), and the authority check drops the attempt. The online client does not either: `/changes` bumps `minimumReadSeq`, `accept` fails, and the same `fetch` retries; `refresh` publishes the top-level `read` that the bailout replaced.

Do not fix this with `answerIdentity !== startedWith` on the success path. Episode withdrawal replaces the snapshot and installs a new identity (`read-observation.ts:136`), and LLP 3000.023 says that withdrawal is not a reset: the re-read already in flight may still publish. That check would drop the legitimate late success and leave `loading` with `dirty` unset. The existing identity check is correctly limited to `retryExpired` (`local.ts:1011`).

Smallest fix: bump an invalidation generation at the start of local `scheduleRead`. Commits are already fenced by `answers.revision`; do not bump this generation from episode withdrawal. Capture it next to `resetVersion` at `local.ts:998` and reject at `local.ts:1007` and in the callback at `local.ts:1014`, setting `dirty` so `finally` requeues. Pair this with Finding B. `queued: !watch.running` would otherwise arm the one-second episode on the `/changes` that this fix discards.

## Finding B — Medium. Blocks landing.

A pre-invalidation attempt starts the retention episode. The replacement is what should start it.

Sites: `local-reads.ts:168`, `local.ts:984`. The same predicate is at `client.ts:684`; online usually retries inside the same `fetch`, so it is narrower and does not block on its own. Give it the same change.

`reload({ queued: false })` arms `Date.now() + 1000` when the watch has data and is not `keep: true` (`read-observation.ts:118`, `read-episode.ts:12`). `beginEpisode` will not move a deadline that already exists. Invalidation uses `queued: !watch.running`, so an attempt that is already running arms the deadline at the invalidation, or keeps the deadline of the attempt that is about to be discarded.

Concrete case: a default-keep local row is on screen and a sweep or dirty `acquireRead` is inside `runLocal` (`local-read-deadlines.ts:25` does not reload, so no episode yet). A relevant `apply` runs. `committed` bumps authority and calls `reload({ queued: false })` because `running` is true, arming the deadline at now+1s. The in-flight attempt then fails `local.ts:1007` and does not publish. Only `finally` queues the replacement. At one second from the commit the row is `{ loading: true }` even though the post-commit attempt has not started. With eight slots and a long queue, that replacement is still waiting. This is the 1,000-hook claim, limited to the rows that were in flight. `per-row-retention.test.mjs:206` waits until the watch is idle, then syncs, and asserts `episodeDeadline === started + 1000` for the attempt that sync started. Nothing in the suite invalidates a watch whose `running` is already true.

The guide states the broken claim as fact at `client.md:60`: the one-second bound starts when the attempt starts. That is true only when `running` was false at the invalidation.

Smallest fix: invalidation always passes `queued: true` at `local.ts:984` and `local-reads.ts:168` (and `client.ts:684`). The replacement's `if (watch.kept) watch.reload()` at `local.ts:1002` is what arms the deadline. A second invalidation during an attempt that already armed its own episode still does not move that deadline.

## Finding C — Low. Does not block.

A selective memory clear deletes the ordering slot, so an older in-flight `set` can restore the pre-write fallback.

Site: `local-reads.ts:114`. `expire` fences first (`local-reads.ts:101`), which leaves a barrier, and `admit` rejects an older ticket (`local-reads.ts:138`). `clear` does `answers.delete` and `written.delete`. With the slot gone, `admit` treats the next writer as newer.

Concrete case: an online-only row is remembered, its re-read is in flight at ticket T1, and a relevant `apply` clears that key. T1's `set` is admitted. Go offline before the replacement read. A direct query returns the pre-write body. The full clear already had this hole; the footprint path copied it. The usual path re-reads online and overwrites the slot. Smallest fix: `fence(key)` before deleting the answer.

## Not blocking, and not new

The online client's own successful `send` still schedules every watch, not the touched footprint. `setLink("offline")` can still let an in-flight local result republish a withdrawn fresh answer. `ReadWork.clear` does not reset the per-turn start count. None of these are PQ regressions.

## Tests

The suite pins the idle episode, the unknown-footprint drain, the late floor, the abort diagnostic, the publication-callback `resetVersion` check, sign-out, and disjoint remembered answers. It does not pin an in-flight local read.

Mutations that stay green:

- Delete only `resetVersion !== watch.resetVersion` at `local.ts:1007` and keep `local.ts:1014`. The setter reset in `per-row-retention.test.mjs:238` runs at `local.ts:1012`, so `1014` still rejects it. The fetch-reset test is also caught by `1014`.
- Leave Findings A and B as they are. No test parks a local read across `/changes` or across a commit. Forcing `queued: false` on the idle path would go red; forcing it only while `running` is the current code, and it stays green.

Verdict: **NOT READY.** Fix A and B together. C can follow.
