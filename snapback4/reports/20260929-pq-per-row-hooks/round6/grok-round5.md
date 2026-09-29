I'll review the PQ branch read-only against `main`, starting with the diff, the lane prompts, and the round 1–4 findings so the port and the claimed fixes can be checked against the code.Prior rounds left specific holes in in-flight reads, retention, and memory fences. I'll read the observation path itself and check those fixes against the current tree.Auto-compacting conversation (82% full)...
Conversation compacted.
The prior pass already isolated one landing blocker. I am checking the exact source lines for that path and the round 1–4 fixes before writing the review.**NOT READY.** One High blocks landing. The port, the eight-slot queue, and the named round 1–4 observation fixes are sound. I reviewed the source at `b90c2eca3`. I did not run the suite: those tests import `dist/`, and `dist/local.js` contains neither `changeVersion` nor `refreshPresence`, so a dist run would not be this tree.

## 1. Port

Sound. Nothing under `packages/snapback4/src` depends on LLP 3000.029. Ordinary `apply`, `admit`, and `settle` re-read through `reload({ queued: true })` (`local-reads.ts:169`, `local.ts:984`, `client.ts:684`) and keep the answer. `keep: false` publishes `{ loading: true }` immediately; that is LLP 3000.023, not LV withdrawing a `keep: true` answer. `reset` and `expire` still withdraw and bump `resetVersion` (`read-observation.ts:147-149`). A withdrawn server deadline survives `expire` and is cleared only by `reset` (`read-expiry.ts:17-23`).

## 2. Correctness

**High — a queued local watch’s presence refresh publishes a stale finished answer, and can remember it.** `local.ts:958`, fence at `local.ts:879`, publish at `local.ts:963` and `local.ts:966`, memory write at `local-query.ts:334`. Does block landing.

`refreshPresence` calls `runLocal(op, args, undefined, true, watch)`. The real watch is only `backgroundWatch`. `current()` is `!watch || watch.changeVersion === changeVersion`, so with no `watch` argument it is always true. The body is therefore admitted, and `serverAnswers.set` runs. Publication is gated on object identity (`watch.snapshot !== shown`) and `watch.running`, not on `changeVersion`.

That identity does not move once the watch is already invalidated. `revalidatingAnswer` returns the same object when the snapshot is already revalidating (`read-observation.ts:23`). `reload` does not replace an existing `{ loading: true }` (`read-observation.ts:115`). Presence is outside `ReadWork`, and it returns immediately only when `watch.running` (`local.ts:955`). A full queue leaves `running === false` for the whole wait, which is the steady state this lane creates. Round 5 closed this race for the observation attempt (`local.ts:843`, `879`, `1007`, `1014`). It did not close it for presence. Online presence is fine: `/changes` raises `minimumReadSeq` (`client.ts:816`) and `refreshPresence` refuses `!currentRead` (`client.ts:669`).

Failing scenario, default keep, eight slots held, the server answer included a numeric `refresh`:

1. A relevant `/changes` marks the row revalidating and queues the replacement. `running` stays false. Snapshot object is S1.
2. The presence timer fires, captures `shown = S1`, and starts `/q/`.
3. A second `/changes` removes the row. `reload({ queued: true })` keeps S1 and bumps `changeVersion`. The replacement is still queued.
4. The in-flight `/q/` still contains the row. `snapshot === shown`, `running` is false, authority is unchanged, so `watch.publish` installs that row as a finished fresh answer. `replace` clears the episode and `kept`. `serverAnswers.set` stores the body, because `current()` never saw the second change.

The removed row is back on screen as current, not revalidating, until the queued read eventually returns. With `keep: false`, step 1 already showed `{ loading: true }`; step 4 paints the removed row over that loading snapshot. One `/changes` that hits a fresh snapshot is safe, because fresh-to-revalidating changes the object. The bug needs the watch already sitting in that stable post-invalidation snapshot, which is exactly a saturated queue.

Smallest fix: in `runLocal`, take the generation from `watch ?? backgroundWatch` and make `current()` false when it changes. Do not pass the presence watch as the `watch` argument; `watch.fetch` would reload the observation. Also refuse at `local.ts:963` and inside the callback at `966` when that generation differs. Snapshot identity is the wrong fence. Add the two-change presence case next to `per-row-boundaries.test.mjs:45`; that test fills the queue and sends one `/changes`, and the presence case at line 94 only rechecks the deadline floor.

**Low — a full memory clear drops the ticket barrier.** `local-reads.ts:111`. Does not block.

`clear(undefined)` does `answers.clear()` and `written.clear()`. `admit` treats a missing slot as newer (`local-reads.ts:137`), so an in-flight body with any seq is stored again. Selective `forget` does fence (`local-reads.ts:96-108`). Unknown footprints and scope resets are specified to drop memory; this is only the refill. Smallest fix: record a barrier `admit` checks before the `!slot` short-circuit, including across a full clear. Not a landing block. The selective path round 4 asked for is in place.

**Low — a one-shot local `query()` can remember a body that crossed `/changes`.** `local.ts:1192`. Does not block.

`client.query` calls `runLocal` with no watch, so it has the same always-true `current()` and can `serverAnswers.set` a pre-change body. Pre-existing, not the queue. The presence fix above should keep using `backgroundWatch` only; this caller still has neither. Smallest fix, if you touch it: give the attempt a generation or skip `set` when a `/changes` seq moved during the post. Not a landing block.

No starvation and no slot leak in `ReadWork`. `Map.set` on an existing key does not reorder, so a queued watch keeps its place (`read-work.ts:41-44`). Eight starts per turn, eight active (`read-work.ts:72-85`). Abort releases the slot even if the promise ignores it (`read-work.ts:87-94`). The 30s lifetime aborts with `READ_WORK_EXPIRED` and the attempt rejoins. `retry` waits outside the active set (`read-work.ts:46-52`). An active watch is not also pending; a newer invalidation sets `dirty` and `acquireRead` runs after `running` is cleared (`local.ts:986-989`, `1036-1045`). Unrelated local applies do not schedule point watches that are not `runsOnServer` and not `kept` (`local.ts:774-776`).

The observation attempt itself does not publish across `/changes`, does not arm the episode at enqueue, and does not publish a floor-rejected or aborted body. `reload({ queued: true })` does not start the 1s bound (`read-observation.ts:118-121`); `beginEpisode` does not move an existing deadline (`read-episode.ts:10-13`); `rerun` calls `reload()` only when the attempt starts and the watch is still kept (`local.ts:1002`). Expiry and reset still withdraw.

## 3. Rounds 1–4

Fixed in source, and each has a test that fails without the fix, except the selective ticket barrier (the code is fixed; the test is not).

| Finding | Where it is fixed | Detecting test |
|---|---|---|
| R1 unknown-footprint drain | `local.ts:772-773` | `per-row-publication.test.mjs:9`, `per-row-liveness.test.mjs:108` |
| R1 floor-rejected attempt must not publish | `local.ts:1005`, `local-read-deadlines.ts:8-11` | `per-row-boundaries.test.mjs:94`, `per-row-publication.test.mjs:88` |
| R1 abort is not a transport failure | `local.ts:551`, `client.ts:565` | `per-row-liveness.test.mjs:135` |
| R1 reset-version | `local.ts:1007`, `1014` | `per-row-retention.test.mjs:222`, `per-row-publication.test.mjs:44` |
| R2 queued `keep: false` transitions before enqueue | `local.ts:984` | `per-row-boundaries.test.mjs:45` |
| R2 floor rechecked at final publication | `local.ts:960`, `1005` | `per-row-boundaries.test.mjs:94` |
| R3 invalidation follows the known footprint | `local-reads.ts:110-116`, `161-169` | `per-row-retention.test.mjs:93` and `:124` |
| R3 episode starts at the attempt | `local.ts:984`, `1002` | `per-row-inflight.test.mjs:122`, `per-row-react.test.mjs:142` |
| R3 sweep uses `acquireRead`, not `scheduleRead` | `local-read-deadlines.ts:25`, `client.ts:639` | `per-row-work.test.mjs:83`, `per-row-retention.test.mjs:66` |
| R3 sign-out | `sessionDead = true` before `setLink` at `local.ts:397-408`; `scheduleRead` returns at `983` | `per-row-retention.test.mjs:45` |
| R4 resubscribe uses `scheduleRead` | `local.ts:1209`, `observe-watch.ts:111` | `raw-read-deadlines.test.mjs:56` |
| R4 late cancel | `local.ts:1014` | `per-row-retention.test.mjs:254` |
| R4 in-flight read across `/changes` | `local.ts:843`, `879`, `1007`, `1014` | `per-row-inflight.test.mjs:106` and `:144` |
| R4 episode not armed by an in-flight invalidation | `local.ts:1002` | `per-row-inflight.test.mjs:122` |
| R4 selective ticket barrier | `local-reads.ts:96-108`, `139` | **no detecting test** |

Caps, fairness, canonical keys, and the 1,000-hook zero-`loading` claim are tested in `per-row-work.test.mjs` and `per-row-react.test.mjs:98` and `:142`. Those hooks do not send a second `/changes` during presence, so they do not catch the High.

## 4. What blocks

The High blocks. Both Lows do not.

## 5. A mutation that survives

In `RememberedAnswers.forget` (`local-reads.ts:96-98`), replace `this.fence(key)` with `this.written.delete(key)`. `per-row-retention.test.mjs:124-136` still passes. Cleared keys are simply absent, and the later `seq: 1` write is asserted only for keys that were not forgotten, where `seq < highest` rejects it with no barrier. Nothing asserts that an older ticket with a higher seq is rejected after a selective delete. Production does fence. The test does not prove Grok C.

## Verdict

**NOT READY.** Fence presence with `changeVersion` before this lands. The rest of the port can land with it.
