I'll review the PQ round-2 port read-only: the diff from `ac5c4e21c` to `b2e88c201`, the lane prompts, and the round-1 findings, then check whether observation bounds and LLP 3000.023 still hold.Auto-compacting conversation (84% full)...
Conversation compacted.
The earlier pass is enough to judge the port. I am locking the exact lines the findings cite, then writing the review.PQ round 2 is a real port onto pre-LV `main`. It does not depend on lane LV, and it does not put touched dependencies back on the withdrawn-to-loading path. Nothing here should stop it landing.

## Verdict: READY

No Highs. No Mediums. The Lows below do not block landing.

## The port

`git diff ac5c4e21c..b2e88c201` adds `ReadWork` and threads it through the online client and the local client. There is no LV fence, no answer-order withdrawal, and no “touched dependency drops the answer” path. Ordinary commits still go through `reload()`, not `reset()`.

LLP 3000.023 holds on the paths that matter:

- A queued observation with retention reloads to `revalidating` and keeps the answer (`client.ts:684`, `local.ts:984`, `read-observation.ts:109-118`). `keep: false` does not retain. Online always reloads at queue time, which withdraws `keep: false`. Local reloads only when `watch.retain` is set. That conditional is the fix for the first full-suite failure (`retention-lifecycle`, keep=false resubscription).
- Expiry and scope reset still withdraw and bump `resetVersion`. Episode policy in `read-episode.ts` is untouched.
- A warm local apply marks the answer revalidating at commit, then queues the re-read only in the `syncRound` final drain (`local.ts:276-278`, `local.ts:772-773`). That is the unknown-footprint fix, not a withdrawal. If the watermark takes longer than the one-second episode, a default-keep row can flash `loading` before the re-read. That is the episode bound, which this lane was told not to change. The zero-`loading` claim is the online, frozen-clock test, and that path does keep the answer.

## What is sound

- **Cap and lifetime.** One FIFO per client, at most eight starts per turn and eight active (`read-work.ts:55-69`). A repeated `schedule` of a queued watch does not reorder it. Cancel aborts the active attempt; the abort listener frees the slot even if the promise ignores abort (`read-work.ts:71-78`). The 30s deadline aborts with `READ_WORK_EXPIRED` and the attempt rejoins the tail. `release` ignores a stale controller. `close()` clears the queue before aborting the lifetime signal. No permanent slot leak.
- **Unknown footprint.** An apply reply with no `touched` array sets `committedTables.unknown` (`local.ts:314`). The final drain then schedules every watch (`local.ts:772-773`). An empty known footprint schedules nobody. `tables.size === 0` watches are included whenever the footprint is non-empty. `per-row-publication.test.mjs:9` holds the watermark and fails if the drain is deleted (`no-unknown-drain`).
- **Future floor.** A still-future withdrawn deadline does not publish. Online returns at `client.ts:709`. Local returns `{deadlineWithdrawn: true}` before `serverAnswers.set` (`local-query.ts:325`) and `rerun` returns at `local.ts:1000`. The publication test (`per-row-publication.test.mjs:89`) plants value 8 in the continuation gap with `resetVersion` still 0 and expects 8 to survive, for online and both local tiers, all three `keep` values.
- **Due replies still retry.** `deadlineWithdrawn` requires `nextExpiry > now` (`client.ts:577`). A due body is not swallowed. `keep-clock.test.mjs:416` expects three queries and a recovered empty row. That is the fix for the `typing-expiry` failure.
- **Reset.** A reset inside `fetch`, before final publication, does not publish the old body (`client.ts:710`, `local.ts:1002` and `local.ts:1008`). The pre-reset test expects `{loading: true}`, no data subscriber, and exactly one replacement query.
- **Abort vs transport.** Both `sendPost` catches return `{ok: false}` on `signal.aborted` before `transportRefusal` (`client.ts:565`, `local.ts:551`).
- **Rollback.** The floor is `Math.max` of withdrawn deadlines. The clock sweep re-arms due watches only. A rolled-back deadline is not re-queued. Canonical `readKey` sorts object keys; distinct `Date`s do not collide. React deps are `(client, op, key, keep)`.
- **Not LV.** A removed row under default keep stays `revalidating` until the one-second episode, then `loading`, even while queued. `keep: true` has no episode and waits for its re-read. That is the retention policy, not a touched-dependency withdrawal.

Local `admit` / `settle` replies still carry no `touched` array, so a local `client.mutate` of those ops re-reads every observation. That matches pre-port behavior. The “zero evaluations for an unrelated write” test is a sync apply, which does filter.

## Round-1 findings

| Finding | Fixed? | Test that fails without the fix |
|---|---|---|
| Unknown-footprint drain runs before the watermark fence | Yes. Unknown bit is stored at `local.ts:314` and the drain is in the `finally` at `local.ts:772-773`. | `per-row-publication.test.mjs:9`. Control `no-unknown-drain` breaks it. |
| Floor-rejected attempt publishes `{loading: true}` over a newer body | Yes, for a still-future deadline. | `per-row-publication.test.mjs:89`. |
| Abort stored as `transportRefusal` | Yes, in both catches. | **No.** Deleting `client.ts:565` and `local.ts:551` survives the PQ tests. Liveness checks that a late body is not published, not that `transportFailure` stayed unset. |
| `resetVersion` untested | Pinned online. Local is only pinned if every comparison is removed. | `no-client-reset` fails the online pre-reset test. `no-local-reset` fails only when both `local.ts:1002` and `local.ts:1008` are replaced. Deleting either site alone still yields `{loading: true}` and `queries === 2`, because the reset happens inside `fetch` and the other site still refuses publication. |

## Findings

**Low. Does not block.** `snapback4/packages/snapback4/src/client.ts:715` and `snapback4/packages/snapback4/src/local-query.ts:323`.

A due completion still publishes synthetic `loading` through the same continuation gap the floor fix closed for a future deadline. `deadlineWithdrawn` is false once `nextExpiry <= now` (`client.ts:577`). Local `evaluateLocal` returns `{...loading, retryExpired}` at line 323 before the floor check at line 325, and `rerun` then publishes that loading read.

Failing scenario: the floor test’s setup, except the in-flight body’s deadline is already due. During `fetch`, the test publishes `{value: 8}` without bumping `resetVersion`. The due attempt is rewritten to `{loading: true}` and replaces 8. The future-floor test uses `now + 1h`, so it stays green. The due-retry test wants this withdrawal when 8 was not published in the gap; that part is correct.

Smallest fix: if the snapshot was replaced after the attempt started, do not publish the synthetic loading. Still schedule the paced retry.

**Low. Does not block.** `snapback4/packages/snapback4/src/local.ts:1032-1036`.

Local expiry backoff awaits inside the `ReadWork` attempt, before `running = false`. `ReadWork` counts the attempt active until the promise settles (`read-work.ts:78`). Eight point reads that return `retryExpired` hold all eight slots for the pause (25 ms, doubling, capped at 1 s). A ninth observation, including a membership re-read, cannot start until that pause ends. The prompt’s “retries rejoin the queue” is not what this path does. It is not a leak and not a 30 s starvation. The default episode still withdraws on its own clock.

Smallest fix: set `running = false` and let the attempt promise finish, then `scheduleRead` from a timer after the pause.

**Low. Does not block.** `snapback4/packages/snapback4/src/client.ts:702`.

The accept-time floor return is unpinned. The publication test sets `expiredServerDeadline` after `fetch` returns, so only the post-`duringRead` return at `client.ts:709` is what fails if removed. Deleting line 702 still passes. In production that line is what stops `scheduleExpiry` (line 705) and an in-fetch retry of a withdrawn deadline.

Smallest fix: set the floor inside the `fetch` mock before `accept` runs, and assert a single query.

## Test strength

The mutation that survives: delete `if (signal?.aborted) return { ok: false };` at `client.ts:565` and `local.ts:551`. Every current PQ test still passes. Abort is then stored as `transportRefusal`, which is the round-1 bug.

A second survivor: delete only `local.ts:1002` or only `local.ts:1008`. The pre-reset test still passes. Online does not have this hole; it has one comparison, and `no-client-reset` kills it.

I did not re-run `scripts/test.sh`. The report’s one full run was red on `retention-lifecycle` (keep=false reload) and `typing-expiry` (due body treated as a future floor). Both fixes are in this tree. They were rechecked as a narrower run, not as a second full suite. That is process debt, not a defect in the diff.
