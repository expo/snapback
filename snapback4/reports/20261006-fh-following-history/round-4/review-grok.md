I'll review lane FH end to end against the approved design, the earlier round-1 findings, and the merged main, then run the following-history, serve, read-only, guide, and typecheck checks before giving a verdict. No lane files will be changed and nothing will be pushed.The checkout is at `200eda60b6` with about 75 GB free. Next I’ll read the design, the three FH reports, and the round-1 reviews, then map the diff.The route checks body size before identity, and several `assert!(take(...))` calls remain on the reader path. I’ll read those against the allowance ruling and the outer read-only guard.Auto-compacting conversation (81% full)...
Conversation compacted.
The core Following-history suite is still compiling. I'll wait for it to finish, then run the remaining suites before writing the verdict.The core suite is in the scale cases now. While that runs I will re-check the hook’s retry loop and any remaining request-path assertions.Core history tests passed, including scale. Next I’ll check whether the remaining `assert!(b.take(...))` calls can still panic, and start the language, guide, and typecheck runs.The allowance panic is gone and pages publish only after discovery. I’m starting the language, guide, and typecheck runs, and checking the hook’s retry timing.**Verdict: READY WITH CHANGES**

Reviewed `200eda60b6` (“Merge main and make Following history continuation budget-safe”) against main at `2a5fc454aa`. The history guarantee holds: the round-1 panic is gone, post-bound follow churn stalls instead of preparing forever, and the route, cards, read-only refusal, and claims match what the tests prove. One client scheduler path still tight-loops. It does not advance a token or publish a page, but it should be fixed before this is called done.

Evidence is in `reviews/fh-r3.grok.evidence/results.md`. No lane files were edited and nothing was pushed. Wasm glue and `dist/` are build outputs in this disposable checkout.

## 1. Round-1 findings

Both are resolved.

The continuation panic is gone. A request whose allowance cannot hold the retained page returns `E_FOLLOWING_REQUEST_TOO_SMALL` and does not swap the session in (`following_history.rs` commits the forked session only for `page`, `preparing`, and `stalled`). `smaller_allowances_refuse_retained_page_without_advancing_and_same_token_recovers` passed: output 1024, heap, examinations, probes, steps, and rows-written all refuse with the pending token and staged image unchanged, and the same token then recovers and replays. An allowance that cannot hold the 2 MiB scratch plus 512-byte envelope returns `RuntimeError::Input` (`E_INPUT`) before that fork. That is the infrastructure refusal §9.10 already allows, and it also does not commit.

The stalled ruling holds. Discovery sets `obstructed` for a post-bound follow and does not clear it in that request. A finished page is chosen before stalled. A self-edge is skipped and is not obstruction. `discovery_checkpoints_post_bound_follow_churn_without_a_false_end` and `discovery_self_skip_is_preparing_and_finished_page_wins_over_post_bound_churn` passed. The bound is the store head at the first unit, not at `open`, so a follow that lands between open and that unit is inside the domain. The hook issues the unit immediately.

Request-path assertions are still in the code, but a too-small allowance does not reach them. `assert!(b.take(used))` remains in replay, advance, and refresh (`session.rs` 47, 203, 314; `refresh.rs` 126, 133, 175, 183), and the frontier still asserts block capacity and greatest-key identity. Each `take` sits behind `fits` of a fixed reservation. `shape` clamps its meter to that reservation and zeroes output. Reauthorization uses the card meter, which aborts at the same limit and does not charge output on this path. I did not find another allowance check left as a bare assert.

## 2. Route and protocol

`POST /following/<operation>` takes `open`, `unit`, `refresh`, and `cancel`. Identity is checked before the 64 KiB body, and the bearer is rechecked under the engine lock. Unknown actions and bad JSON are `E_FOLLOWING_INPUT`. A missing program restarts; a non-projection is `E_FOLLOWING_DECLARATION`. Controller refusals stay the five named codes. Pinned unit bytes are returned without re-encoding, with `Cache-Control: private, no-store`.

Replay of the current or previous token does not advance. A lost HTTP response is retried with the same token (the client test drops the response and still completes). A head rewind, store change, generation change, or idle expiry (5 minutes) restarts instead of substituting a page. Four sessions per viewer and declaration; a fifth is `E_FOLLOWING_QUOTA` and does not evict another tab. The controller is process-local, so a restart is a new incarnation and the old opening restarts rather than ending empty. Two tabs keep independent openings. There is no Rust HTTP test of this route; the client journeys are the coverage, and they passed.

Read-only: `read_permitted` does not list `/following/`. A `ro.` bearer hits the closed allow-list and gets `E_READ_ONLY` before the body is read. The route checks `SessionScope::Read` again. The client test refuses `open`, `unit`, `refresh`, and `cancel` with 403, no `head` or `store_id`, and no change to the store snapshot, including `_read_sessions`. The Rust read-only suite (8 tests) still does not name `/following/` in its path list; the allow-list plus that client test are what cover it. Ordinary `/q/` remains a read.

## 3. SDK hook

`useFollowing` is one `Following` per consumer via `useSyncExternalStore`. It owns open, unit, refresh, cancel, restart, and the phases. Preparing is not an empty page: items stay withheld until refresh authorizes the mounted set, and the React test sees a `preparing` phase before the first page of 20. Own-post and pending-write fences are checked before a server page is shown; a blocked delivery discards the reply and retries the same token. Offline leaves history withheld, sets `fact` to “older posts are not on this device”, and serves the ordinary inbox. While offline, following calls do not increase. Event identity is the engine id, including reposts. Withdrawal drops mounted ids that fail refresh. Unmount cancels only that opening; a second tab keeps its page. A refused read-only observer does not poll again.

The steady cadence is fine: preparing retries at 10 ms, stalled at 1 s, and a settled subscription refreshes about once a second (which also keeps the server session from idle-expiring). That is the live-prepend heartbeat, not a storm.

The defect is `following.ts` line 187. After a run, if `wantPage` is still set and `phase` is already `"page"`, the next attempt is scheduled at 0 ms. `loadMore` is what sets `wantPage` without leaving `page`. If the transport then returns no reply while the client is still online — the pending-write fence does this without sending — `run` immediately schedules another 0 ms attempt. That spins for as long as the fence holds. It does not double-advance. Initial load stays at 1 s, because the phase is still `preparing`. Network failures and HTTP 5xx mark the client offline, and scheduling stops. The fix is to back off when `send` returns nothing, instead of using that 0 ms branch.

## 4. Card shaping

Shaping is the ordinary authorized point path, inside the card slice (64 examinations, 128 index entries and probes, 32,768 steps, 8 MiB heap, 128 KiB card output). A page reserves 256 KiB of encoded payload and about 1 MiB of staged card custody. A card over 1 MiB, or one that cannot fit, is `E_FOLLOWING_ROW_TOO_LARGE` and the scan continues past that event key. If the omission envelope itself cannot fit, the request refuses without advancing. A later card that fits shortens the page; it is not omitted because an earlier row used the rest of the budget. Object and map nodes are priced, not just JSON length. Replay rechecks current policy inputs and disclosed private-field owners, not edited body fields. The shaped oracle, omission, heap-shortening, and pinned-replay tests passed.

## 5. Claims

`guide feeds` and the separate `followingHistory` certificate state the guarantee the tests prove, including stalled as an explicit checkpoint rather than a false end, named omissions, no follow cap, and no unrelated-author scan. The certificate line is separate from the inbox `scale` object (`generated_card_query_has_a_separate_exact_history_certificate` passed).

§9.5’s approved completion sentence includes “within session lifetime, admission and resource quotas.” The certificate says bounded requests continue once post-bound births and follow additions stop obstructing, and that expiry or authority loss may restart. It does not repeat the quota parenthetical. The guide’s completion sentence is the same shape (“post-start”), and the next paragraph does name `E_FOLLOWING_QUOTA` and expiry restart. I do not treat that as an overclaim: stalled, the frozen domain, and the quota refusal are all stated. “At session start” matches the first unit, which is when the bound is captured.

## 6. Merge with read-only mode and RX

No conflict markers. Following stays outside the read allow-list. `FollowingSnapshot` is not a `Read` and is not passed to `matchRead`; offline, `snapshot.inbox` is the ordinary read, and the client test renders it with `matchRead`. The inbox certificate is unchanged. This lane’s wasm build measured 2,135,336 bytes raw and 645,307 gzip, under the 645,607 cap. I did not re-review the rest of RX beyond these surfaces.

## Measurements

Unshaped scale, seven samples, meters identical across samples. sparse-1100 and sparse-50000 both return 1,101 events in 56 requests with the same totals (13,884 examinations, 1,325 index entries, 6,830 probes). The extra 49,000 posts do not change the scan meter. The first sparse-50000 sample’s first page was 7.4 ms; later samples match sparse-1100 at about 1.1 ms. follows-8200 takes 5 preparing requests (first request examines 8,112, just under the 8,192 ceiling), then 410 pages, and peaks at 17,087,232 session bytes, under the 32 MiB session quota. Over HTTP, sparse-50000’s first page was 27 ms with no preparing round; 8,200 follows took 323 ms and five 95-byte preparing responses, then ~5.9 KB pages at 10–22 ms.

## Tests run

| Suite | Result |
|---|---|
| `snapback4-core` `following_history` `--include-ignored` | 27 passed, including both scale tests |
| lang `following_history`, `following_history_research`, `guide` | 8 + 3 + 113 passed |
| `following_view` | 3 passed |
| binary `read_only_tests` | 8 passed |
| client typecheck and `tsc` build | passed after `scripts/build-wasm.sh` (wasm is not committed) |
| `following-history.test.mjs`, `following-hook-react.test.mjs` | 11 passed; measurement test passed when run with `SNAPBACK4_FH_MEASURE=1` |

**READY WITH CHANGES.** Change the 0 ms reschedule in `Following.run` so a dropped unit while `loadMore` is waiting backs off instead of spinning. I would not hold the history protocol, the stalled ruling, or the read-only merge for anything else I found.
