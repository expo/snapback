I'll review the PQ round 2–6 port read-only: the diff, the lane prompts, and the prior review findings, then check whether retention, slot bounds, and the claimed fixes actually hold.The branch is `sb4-intent/pq2-per-row-hooks` at `6b71b7379`. I'll read the prior findings and the observation, retention, and scheduling code those rounds claim to have fixed.Round 5 left a presence-refresh hole and two smaller gaps. I'll read the current observation path and the tests that claim to close them.Auto-compacting conversation (80% full)...
Conversation compacted.
The review has to stand on the current tree, so I am pinning the port, the retention paths, and the round 1–5 fixes to exact lines before writing the verdict.**READY.** Nothing here should stop PQ landing. One Medium on the online client does not block.

Reviewed `b7d05baff..6b71b7379` from source. I did not rebuild `dist/` or run the suite; the per-row tests import `dist/`, so a run would not be this tree.

## 1. Port

Sound. Nothing under `packages/snapback4/src` references LLP 3000.029. The only `3000.029` string in the package is an old fixture comment in `keep-reset.test.mjs`, and it is not in this diff. Ordinary commits re-read through `reload({ queued: true })` (`local-reads.ts:169`, `local.ts:982-984`, `client.ts:682-685`) and keep the answer. `keep: false` publishes `{ loading: true }` immediately (`read-observation.ts:113-116`). That is LLP 3000.023, not LV withdrawing a retained answer. `reset` and `expire` still withdraw and bump `resetVersion` (`read-observation.ts:147-149`). `expire` leaves the withdrawn-deadline floor; `reset` clears it (`read-expiry.ts:17-20`, `read-observation.ts:147`).

## 2. Correctness

No starvation and no slot leak. `ReadWork` coalesces with `Map.set` in place (`read-work.ts:41-44`), starts at most eight attempts per turn, and keeps at most eight active (`read-work.ts:71-85`). Abort releases the slot even if the promise ignores it (`read-work.ts:87-94`). The 30s lifetime rejoins the queue. `retry` waits outside the active set (`read-work.ts:46-52`). Cancellation removes a delayed timer before it can enqueue (`read-work.ts:54-62`).

Retention matches §7. Queueing does not start the episode (`read-observation.ts:118-121`); `beginEpisode` does not move an existing deadline (`read-episode.ts:10-12`); `rerun` arms it only when the attempt starts and the watch is still kept (`local.ts:1002`). A burst does not renew that deadline. Sweeps call `acquireRead`, not `scheduleRead` (`local-read-deadlines.ts:25`, `client.ts:639`), so a held-only expiry does not reload a still-future raw answer. Sign-out sets `sessionDead` before `setLink` (`local.ts:397-408`); `scheduleRead` then returns without another read (`local.ts:982-983`). Resubscription goes through `scheduleRead` (`local.ts:1205-1209`, `observe-watch.ts:111`).

The round-5 presence hole is closed. `/changes` bumps `changeVersion` and then `scheduleRead` (`local.ts:843`). `runLocal` captures that version from the watch or the presence owner (`local.ts:875-879`). Presence passes the watch as the background owner, not as `watch`, so it does not take `fetch`/`reload` (`local.ts:958`). Evaluation’s `current()`, `serverAnswers.set` (`local-query.ts:332-336`), and both publication checks (`local.ts:963`, `local.ts:966`) see the same version. A second change while the snapshot object is stable no longer publishes or remembers the pre-change body. A completion that wins the `witnessRestore` yield is not that bug: the bump and `scheduleRead` still run and put the watch back into its policy state. It does not stay finished-and-fresh.

Known footprints stay selective (`local.ts:271-278`, `local-reads.ts:110-116`). Empty known footprints schedule nobody. Unknown footprints and scope resets clear every watch and all memory. Selective `forget` still fences tickets (`local-reads.ts:96-108`, `139`). Floor-rejected and aborted attempts return before `publish` (`local.ts:1005`, `local.ts:1014`, `client.ts:705-713`). Canonical keys sort object keys and keep array order (`read-key.ts:2-4`); React deps are `[client, op, key, options?.keep]` (`react.tsx:113`).

**Medium — an already-due online attempt can wipe a retained answer and drop the replacement.** `client.ts:707`, `read-observation.ts:86`, `client.ts:721`, `client.ts:738`. Does not block.

`currentRead` treats `nextExpiry <= now` as failure, so `accept` returns false (`client.ts:707`). `fetch` then retries inside the slot and, on the fourth rejection, publishes `{ loading: true }` even when `publishResult` is false (`read-observation.ts:82-87`). `reload` does not bump `revision`, so that publish is not retired by a concurrent invalidation. `refresh` then publishes loading again (`client.ts:721`): the due-and-replaced guard requires `"data" in snapshot`, which this publish just destroyed. `retryExhausted` makes `finally` ignore both `retryExpired` and `dirty` (`client.ts:738-740`).

Failing scenario, online client, default keep:

1. A row is showing `"hello"`. Its in-flight read is already due (`nextExpiry` in the past), so `accept` is rejecting it.
2. A commit for that row runs `scheduleRead`: the snapshot becomes revalidating `"hello"`, and `dirty` is set because the attempt is in flight.
3. The fourth rejection publishes `{ loading: true }` and returns `retryExhausted`.
4. `finally` does not call `acquireRead`. Nothing else is armed if this answer never stored a presence interval.

The row stays on `{ loading: true }`. The commit’s replacement never starts. Local expiry does not do this: a due body sets `retryExpired` and `readWork.retry` runs outside the slot (`local.ts:1041-1043`). The online 1,000-hook test never sends a past `nextExpiry`, so it stays green.

Smallest fix: in `accept`, return true for an already-due body the way `deadlineWithdrawn` does, so `fetch` does not publish and does not set `retryExhausted`. In the `!currentRead` branch, set `retryExpired` for every due body, and publish loading only when the snapshot still has this attempt’s identity. Reschedule on `dirty` even if some other attempt exhausted.

**Low — a one-shot local `query()` can remember a body that crossed `/changes`.** `local.ts:1190-1197`, `local.ts:875-879`, `local-query.ts:335`. Does not block.

`query()` calls `runLocal` with no watch, so `current()` is true for the whole attempt. A watch’s presence and observation paths refuse the pre-change body; this call can still `serverAnswers.set` it. Pre-existing, not the queue. Reachable only if something calls `query` for that key while a watched read is what the fence was written for. Smallest fix, if you touch it: do not let a watch-less attempt write memory after a matching watch’s `changeVersion` has moved.

## 3. Rounds 1–5

Fixed in source. Each of these tests asserts the behavior the fix added; deleting the fix fails that assertion. I did not execute the mutations.

| Finding | Fix | Detecting test |
|---|---|---|
| R1 unknown-footprint drain | `local.ts:772-773` | `per-row-publication.test.mjs:9`, `per-row-liveness.test.mjs:108` |
| R1 floor must not publish | `local.ts:1005`, `local-read-deadlines.ts:8-11` | `per-row-boundaries.test.mjs:183`, `per-row-publication.test.mjs:88` |
| R1 abort is not a transport failure | `local.ts:551`, `client.ts:565` | `per-row-liveness.test.mjs:135` |
| R1 reset version | `local.ts:1007`, `1014` | `per-row-retention.test.mjs:222`, `per-row-publication.test.mjs:44` |
| R2 queued `keep: false` before enqueue | `local.ts:984` | `per-row-boundaries.test.mjs:134` |
| R2 floor rechecked at publication | `local.ts:960`, `1005` | `per-row-boundaries.test.mjs:183` |
| R2 abort-diagnostic coverage | the guards above | `per-row-liveness.test.mjs:135` |
| R3 footprint, not a full memory wipe | `local-reads.ts:110-116`, `165-169` | `per-row-retention.test.mjs:93`, `:124` |
| R3 episode starts at the attempt | `local.ts:984`, `1002` | `per-row-inflight.test.mjs:122`, `per-row-react.test.mjs:142` |
| R3 sweep does not re-invalidate | `local-read-deadlines.ts:25` | `per-row-retention.test.mjs:66`, `per-row-work.test.mjs:106` |
| R3 sign-out keeps the denial | `local.ts:397-408`, `982-983` | `per-row-retention.test.mjs:45` |
| R4 resubscribe uses `scheduleRead` | `local.ts:1209`, `observe-watch.ts:111` | `raw-read-deadlines.test.mjs:57` |
| R4 late cancel | `local.ts:1014` | `per-row-retention.test.mjs:254` |
| R4 in-flight read across `/changes` | `local.ts:843`, `1007`, `1014` | `per-row-inflight.test.mjs:106`, `:144` |
| R4 episode not armed while in flight | `local.ts:1002` | `per-row-inflight.test.mjs:122` |
| R4 selective ticket barrier | `local-reads.ts:96-108`, `139` | `remembered-answers.test.mjs:110` |
| R5 presence fenced by `changeVersion` | `local.ts:875-879`, `958`, `963`, `966` | `per-row-boundaries.test.mjs:47` |
| R5 listener removal | `read-work.ts:13-17` | `per-row-work.test.mjs:14` |

The 1,000-hook claim is `per-row-react.test.mjs:98` (online, zero `loading`) and `:142` (local wasm, worker, and process, real clock, attempts spread more than one second, zero `loading`). Caps, coalescing, and unrelated-write counts are `per-row-work.test.mjs:36` and `:137`.

Round 5’s full-clear note is not a reachable refill. `clear(undefined)` drops `written` (`local-reads.ts:111`), and `admit` treats a missing slot as newer (`local-reads.ts:137`), but `LocalReads.clear` bumps `revision` first (`local-reads.ts:166`) and `checkpoint` runs in the same turn as `set` (`local-query.ts:333-335`). A commit cannot land between them.

## 4. What blocks

Nothing. The Medium is a stuck `{ loading: true }` on the online client when an already-due read overlaps a commit. The local queue, the presence fence, and the 1,000-hook retention path do not hit it. The Low is outside the watch fence. Neither should stop this landing.

## 5. A mutation that survives

Delete `resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion` from the early return at `local.ts:1007` and leave the same comparisons in the publication callback at `local.ts:1014`.

`per-row-publication.test.mjs:44` resets inside `fetch`, before either check, so the callback still refuses the body. `per-row-retention.test.mjs:222` and `per-row-inflight.test.mjs:144` bump the fence in the `expiredRetries` setter, which runs after line 1007 and before the callback, so only the callback is what those tests observe. Presence coverage is on `refreshPresence`, not on this early return. The early return is still what skips `publishLocal` for a fence that moved during `runLocal`; the suite does not isolate it.

## Verdict

**READY.** Land it. The online due-body overlap is worth a follow-up; it is not this lane’s landing bug.
