# LLP 1018 move one — client lane review (codex)

**Change:** `s2/clique-client-sessions` — shared query entries and the browser follower tab. Round 1 reviewed commit `703425379`; round 2 reviews the fix delta `c8b7f1c1c` (appended when received).
**Reviewer:** codex `gpt-5.6-sol`, reasoning xhigh, read-only sandbox, blind.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Provenance:** every review below was actually received from the named model; verbatim text per round. The two reviewers never saw each other's reviews. Fix rounds were implemented by the orchestrator (the lane's implementer).

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | 703425379 (the slice) | VERDICT: NOT READY (9 MATERIAL) |
| 2 | c8b7f1c1c (fix round 1 delta) | VERDICT: NOT READY (3 MATERIAL) |
| 3 | d66c38a6e (fix round 2 delta) | VERDICT: NOT READY (1 MATERIAL) |
| 4 | 8dce9f0e6 (fix round 3 delta, targeted) | VERDICT: READY |
| 5 | a11b81128 (fix round 4 delta, with 8dce9f0e6) | VERDICT: NOT READY (1 MATERIAL) |
| 6 | 125ec3023 (fix round 5 delta, targeted) | VERDICT: READY |

## Round 1 (verbatim)

`llp-orient` tied the review to LLP 1018 §3, LLPs 1012/1013, and the Snapback 2 rules. No broken `@ref` or missing design decision was found; the issues are implementation defects.

- **MATERIAL — Reset and auth fencing do not invalidate queued replay.** The shared layer caches `last` independently and queues it without a version check ([client-sessions.ts:34](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:34), [client-sessions.ts:46](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:46)). `E_OFFLINE_RESET` resets only the underlying subscription, leaving this cache intact, while `clear()` merely removes map entries and does not cancel already queued replay ([client-sessions.ts:68](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:68)). Because a program reset does not advance `authGeneration`, a late consumer can receive a predecessor-generation answer after coverage was dropped. Likewise, an auth transition between `queueMicrotask` and replay can still deliver old-authority data. A newer delivery queued ahead of the replay can also be followed by the older replay.

- **MATERIAL — Refcounts collapse when two subscriptions use the same callback function.** Consumers are represented by a `Set` of callbacks ([client-sessions.ts:8](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:8), [client-sessions.ts:43](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:43)). Two `subscribe(..., sameListener)` calls therefore count as one; closing either deletes the listener and closes the underlying stream while the other handle remains live ([client-sessions.ts:50](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:50)). Consumer identity must be per attachment, not callback identity.

- **MATERIAL — Regular and drain subscriptions still overwrite one another’s mounted record.** Both use `(op,args)` without the subscription kind ([client.ts:383](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:383), [client-offline.ts:219](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-offline.ts:219)). If both kinds are mounted, the later record replaces the earlier; closing the later deletes the only record even though the earlier subscription survives ([client-offline.ts:252](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-offline.ts:252)). The identity guard prevents one deletion pattern but does not restore the overwritten survivor.

- **MATERIAL — The follower write fence runs after automatic asset uploads and misses other write surfaces.** `mutation()` enters `withMutationUploads` before reaching `submitMutation` ([client.ts:289](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:289)); only the latter checks `runtime.following` ([client-outbox.ts:89](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-outbox.ts:89)). A follower mutation containing a `File` can upload—and then issue cleanup writes—before returning `E_OFFLINE_FOLLOWER`. Direct `upload`/`discardUpload` are likewise unguarded ([client.ts:328](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:328)), as is the extracted channel publisher ([client-channels.ts:36](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-channels.ts:36)). This contradicts “every write refuses before any bytes leave.”

- **MATERIAL — A restored bearer follower is reopened and becomes auth-refused.** Cold restoration opens the bound principal and starts following; `confirmAuth` then calls `openOffline` again for the same principal. That second immediate lock refusal is accepted as follower only when `!this.following`; otherwise it is thrown ([client.ts:1002](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1002), [client.ts:1017](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1017)). Consequently the ordinary built-in-token-store second tab lands in `snapshot.auth.state === "refused"`, and its original wait retained `authenticated=false`, so takeover may not unseal/reauthenticate.

- **MATERIAL — Account replacement leaves the follower runtime naming the old principal.** `OfflineRuntime.open(B)` wipes A, but assigns its own `partition = B` only after `store.open(B)` succeeds ([offline.ts:285](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:285), [offline.ts:300](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:300)). The store correctly clears its partition before the failing carrier open ([range-store.ts:658](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/range-store.ts:658)), but the runtime remains on A. Its follower no-op applies only when the runtime partition is `undefined`; a B delivery instead hits the A/B authority mismatch ([offline.ts:543](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:543), [offline.ts:556](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:556)). Thus an account-switch follower cannot reliably perform the promised live reads.

- **MATERIAL — Follower drains fail before `caughtUp`.** After deliberately no-oping the delivery commit, drain `mark` still reads `runtime.outbox.grant()` from the unopened store ([client-offline.ts:230](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-offline.ts:230), [client-offline.ts:242](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-offline.ts:242)). That rejects with a carrier lifecycle error. The test covers only a one-shot query, not the documented drain/`useQuery(...,{drain:true})` live-read path.

- **MATERIAL — Restart and terminal auth expiry leave follower waits alive.** `close()` aborts following, but the separate `restart()` shutdown does not ([client.ts:573](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:573), [client.ts:612](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:612)); `expireSession()` also closes transports and seals without withdrawing the wait ([client.ts:1314](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1314)). The IndexedDB backend records `lockRequest` only after acquisition ([indexeddb.ts:223](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/indexeddb.ts:223), [indexeddb.ts:238](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/indexeddb.ts:238)), so closing the store cannot cancel a still-queued request. After restart, the discarded client can later acquire and hold the writer lock ahead of the replacement client.

- **MATERIAL — Follower admission opens before takeover finishes.** `OfflineRuntime.follow` clears `followingPrincipal` and notifies observers immediately after opening the carrier ([offline.ts:273](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:273), [offline.ts:279](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:279)). The client then clears its own marker before awaiting reauthentication and resume ([client.ts:1029](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1029)). During either await, `submitMutation` sees `following === false` and admits writes against inherited, not-yet-reauthenticated custody. The follower state must cover the full takeover barrier.

- **MINOR — Late-replay callbacks bypass callback isolation.** Ordinary fan-out catches listener exceptions, but the queued replay invokes the listener without a guard ([client-sessions.ts:35](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:35), [client-sessions.ts:47](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:47)), producing an uncaught microtask exception for a callback that would otherwise be isolated.

- **REFUTED-RISK — Ordinary transport/auth closure does not make a later attach reuse the same dead map entry.** `closeTransports` clears the shared map and closes every tracked underlying subscription ([client.ts:1417](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1417)). The defect is stale queued replay/reset state, not reuse through map lookup.

- **REFUTED-RISK — The in-process lock handoff itself preserves FIFO ownership and queued cancellation.** It replaces the holder token before synchronously starting the dequeued waiter and removes aborted waiters from the queue ([locks.ts:39](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/locks.ts:39), [locks.ts:64](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/locks.ts:64)). Abort after acquisition is correctly ignored. The browser contract likewise ignores a signal after grant. [Web Locks specification](https://w3c.github.io/web-locks/)

- **REFUTED-RISK — Awaiting an IndexedDB lock release is not intrinsically circular.** The release resolver completes the callback the request promise is awaiting, then `releaseHeldLock` awaits that request ([indexeddb.ts:203](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/indexeddb.ts:203)). The real cancellation problem is that a pending request is not retained until acquisition.

VERDICT: NOT READY (9 MATERIAL)

## Round 2 (verbatim)

Reviewed only `c8b7f1c1c` against LLP 1018 §3 and LLP 1012 §§4, 7–8. No builds or tests run.

### Findings

- MATERIAL — Stale follower completions can clear a newer follower’s write fence. `TabFollower` identity-checks only removal of `this.wait`; both success and failure unconditionally call `runtime.followed()` (`client-sessions.ts:154-159`). `OfflineRuntime.followed()` unconditionally clears the single marker (`offline.ts:268-289`). During an account switch, an old wait can finish after a new wait starts and clear the new account’s marker. `trackWrite()` then permits mutation, upload, discard, and channel writes (`client.ts:1393-1399`), potentially sending plain writes while another tab owns that partition.

- MATERIAL — An unsuccessful takeover is still treated as complete. `takeover()` swallows retryable, `E_OFFLINE_RESUME`, and `E_OFFLINE_RESET` failures and returns authority (`client.ts:1034-1043`); the caller then clears the follower marker and launches an unawaited drain (`client-sessions.ts:153-156`). Consequently uploads/channel publishes—and potentially later mutations—are admitted before the inherited queue has successfully resumed and replayed. The round-1 “marker clears before takeover finishes” finding remains open.

- MATERIAL — Restored-bearer confirmation can race past the one reauthentication check. After lock acquisition, `wait.authenticated` is sampled once before `takeover()` waits for `ready` (`client-sessions.ts:149-153`). Confirmation arriving during that wait merely mutates the record (`client-sessions.ts:138-142`), while `openOffline()` returns without reauthenticating (`client.ts:1010-1013`). A newly rotated session can therefore resume inherited coverage using the predecessor epoch and be auth-refused/sealed. The new test closes the writer only after restoration completes (`client-sessions.test.ts:223-230`), so it misses this ordering.

- MINOR — Two new assertions are weaker than their test names: `calls >= before` does not prove the surviving attachment receives another event (`client-sessions.test.ts:177-181`), and the follower-drain test asserts grant custody but never verifies the writer’s watermark is unchanged (`client-sessions.test.ts:187-203`).

### Round-1 disposition

REFUTED-RISK / closed:

- Stale replay after reset; callback-identity refcounting; replay identity guarding; callback isolation (`client-sessions.ts:39-80`).
- Regular/drain mounted-record collision (`client.ts:390-392`; `client-offline.ts:219-259`).
- Write fencing for mutation uploads, direct uploads, discard, and channel publish (`client.ts:291-347`, `client.ts:524-530`, `client.ts:1393-1399`).
- Direct old-principal retention on a refused account switch (`offline.ts:307-323`).
- Follower drain admission/marking against unopened custody (`client.ts:227-228`, `client.ts:507-509`; `client-offline.ts:230-249`).
- Pending waits are now stopped by restart/session expiry, queued lock requests are abortable, and abort-at-grant rejects (`client.ts:585-594`, `client.ts:1305-1307`; `store/indexeddb.ts:205-255`).

Not closed:

- Restored-bearer takeover under lock-before-confirm ordering.
- Follower marker retention through a successful resume/replay.
- Cancellation/account-switch safety once an older follower continuation is already running.

VERDICT: NOT READY (3 MATERIAL)

## Round 3 (verbatim)

- **MATERIAL** — The fence release remains vulnerable to same-principal ABA. Stale continuations call `followed(principal)` unconditionally ([client-sessions.ts:165](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:165), [client-sessions.ts:177](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:177)), while `followed` distinguishes attempts only by principal ([offline.ts:289](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:289)). If a withdrawn wait for principal P is replaced by another wait for P before the old asynchronous continuation settles, the old continuation clears the new wait’s marker. Writes then pass the `following` fence and can take the plain path while no partition is open ([client.ts:1395](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1395), [client-outbox.ts:92](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-outbox.ts:92)), violating LLP 1012’s FIFO custody constraint. Release needs a per-wait identity, not the principal string.

- **REFUTED-RISK** — I accept the orchestrator’s refutation of (d), as framed for retryable resume failure. `follow()` resolves after opening the acquired partition ([offline.ts:273](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:273), [offline.ts:280](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:280)); subsequent writes encounter the inherited queue, attempt it first, and enqueue behind it when draining stops ([client-outbox.ts:106](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-outbox.ts:106), [client-outbox.ts:117](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-outbox.ts:117)). A retryable transport failure preserves the inherited intent ([client-outbox.ts:201](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-outbox.ts:201)).

No additional finding on (b), (c), or the origin-stream terminal-refusal repair.

VERDICT: NOT READY (1 MATERIAL)

## Round 4 (verbatim, targeted confirmation)

MATERIAL: none.

MINOR: none.

REFUTED-RISK:

- Same-principal ABA is closed. Each wait has unique object identity, and every completion releases that exact object; `followed()` clears only the currently owning object. `snapback2/packages/snapback2/src/client-sessions.ts:156-178`, `snapback2/packages/snapback2/src/offline.ts:269-295`
- A `follow()` rejection before marker assignment cannot strand this wait: the capability rejection occurs before either marker is set, and the caller’s `followed(wait)` becomes a safe no-op. `snapback2/packages/snapback2/src/offline.ts:269-272`, `snapback2/packages/snapback2/src/client-sessions.ts:176-180`
- Every terminal `begin()` path clears its own marker: acquisition/open rejection, stale continuation, reauthentication/takeover failure, and successful takeover. A stale release correctly leaves `following` true only when a newer wait owns the marker. `snapback2/packages/snapback2/src/client-sessions.ts:165-180`, `snapback2/packages/snapback2/src/offline.ts:283-295`
- The chat status map now exhaustively covers the `OutboxStatus.reason` union, including `follower`. `snapback2/packages/snapback2/templates/chat/shared/offline.ts:14-23`, `snapback2/packages/snapback2/src/types.ts:296-300`

Read-only review; no builds run.

VERDICT: READY

## Round 5 (verbatim)

- MATERIAL — A terminal refusal from a drain tail still does not reach the shared consumers. [`SharedSubscriptions.clear`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:102>) preserves the owning `DrainSubscription`, but [`closeTransports`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1409>) immediately closes that outer subscription because it is not reference-equal to the tail. This marks the drain closed and suppresses the terminal delivery. The new test at [`client-sessions.test.ts:252`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/tests/client-sessions.test.ts:252>) covers only a regular subscription, not `drain: true`.

- MINOR — Follower capability is split: [`canFollow`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:264>) requires only `acquire`, while [`giveBack`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/range-store.ts:305>) is optional. A custom waiting carrier implementing `acquire` without `giveBack` can still leak an acquired-after-withdrawal lock. The shipped IndexedDB carrier is unaffected.

- REFUTED-RISK — The same-principal marker ABA is closed: marker clearing is keyed by the unique wait object at [`client-sessions.ts:166`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:166>) and checked at [`offline.ts:292`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:292>).

- REFUTED-RISK — For IndexedDB, [`giveBack`](</Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/store/indexeddb.ts:114>) does not close an open database or abort a newer queued request; it releases and awaits only the captured held request.

Read-only inspection against LLP 1018 §3 and LLP 1012 §§4, 6–7; no builds run.

VERDICT: NOT READY (1 MATERIAL)

## Round 6 (verbatim, targeted confirmation)

- MATERIAL — None.
- MINOR — None.
- REFUTED-RISK — [client.ts:1413](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1413): `owns(except)` cannot spare unrelated subscriptions. Only `DrainSubscription` implements it, using exact current-tail identity at [drain.ts:47](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/drain.ts:47). The refusal path then closes and clears that tail, latches the refusal, and delivers it at [drain.ts:83](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/drain.ts:83); final consumer closure still retires the outer drain at [client-sessions.ts:73](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client-sessions.ts:73).
- REFUTED-RISK — [offline.ts:264](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:264): follower admission now requires both `acquire` and `giveBack`. The sole admission path checks `canFollow` at [client.ts:1025](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/client.ts:1025), so the late-abort cleanup at [offline.ts:280](/Users/ccheever/projects/snapback-worktrees/clique-client-sessions/snapback2/packages/snapback2/src/offline.ts:280) is available.

VERDICT: READY
