# LLP 1018 panel review — grok

**Change:** `llp/1018-structural-moves-to-surpass-convex.research.md`, the 2026-09-06 draft (uncommitted at review time; its revised form landed with this record).
**Reviewer:** Grok 4.6 — `~/.grok/bin/grok -m grok-4.6 --reasoning-effort xhigh --permission-mode auto --no-subagents --no-memory`.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`, 2026-09-06/07.
**Provenance:** every review below was actually received from the named model; verbatim text per round. Round one was blind; round two showed each panelist all five round-one positions and the orchestrator's provisional decisions on the browser-tab policy and cap metering. Reviews are input to the orchestrator's decision (LLP 1018 §9), not verdicts on a code change.

| Round | Reviewed | Received |
|---|---|---|
| 1 | the draft, blind | yes |
| 2 | all five round-one positions plus the provisional decisions | yes |

## Round 1 (verbatim)

## Verdict on the thesis

The measure — **application-owned infrastructure removed** — is the right *design* target for Clique. Convex’s holistic lead is “it composed”; Snapback’s 0.0.8 loss is a second client: inbox cache, time-dependent query isolation, a permanent resume anchor (`score.md` client_integration 63, queries_and_live 65, offline_sync 68). B4 is 7 weighted points for *authoring* that behavior. Closing those workarounds is how a 68 observed-offline score becomes a 90 authoring score.

It is not a sufficient *winning* measure. Convex also leads on queries_and_live (87 vs 65), diagnostics (87 vs 65), setup/docs (83 vs 68), and scale (80 vs 58). Those are not all “the builder wrote a cache.” Convex’s live win is closer to a primitive: subscriptions propagate without a resume ritual. Snapback already *wins* the primitives Convex lacks (auth 92 vs 82, media 94 vs 76, offline 68 vs 48). So the thesis “primitives competitive; composition is the gap” is **half-supported**: composition is the largest *self-inflicted* gap, but beating 84 also needs (1) Snapback-attributed correction loops (B10 / loop bar), (2) O5 scale predicates that still fail on the published 0.0.8 package, and (3) one search path — already authorized, not a new move.

Do not treat “smaller backend” as the score. The document is right that a compact `.q` with a second sync implementation still loses.

## The four moves (keep / change / drop / add)

**Move one — keep, then narrow.** Completing LLP 1012’s model (one query is live/held/local; one mutation is predicted/settled) is the highest-confidence structural bet. Drop “invent a new ownership boundary” as the work. `StoreSwap` + `PersistentRangeStore.commit` already is that boundary (`snapback2/packages/snapback2/src/store/range-store.ts`). The fight is above it.

**Move two — keep.** Cap metering that prices 49 membership inserts against `cap 1000` and splits a 50-person group is a real product defect (`issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md`). Aligning admitted cost with the plan that actually runs is the right obligation. Do not replace SQLite.

**Move three — change.** Keep “Quarry owns semantics” as *hygiene and one search*. Drop “typed IR / compiler replacement” as a Clique program. The `reactions` collision is a lowering leak, not proof the compiler is the bottleneck (`issues/20260906-snapback2-quarry-operation-table-name-collision.md`). Indexed search is the actual authoring win in this move; it is already on the doing-list. Do not reopen `fn` without the census LLP 1011 §0 required.

**Move four — drop as a program; keep as tickets.** M7 was not run in any lane (`score.md` cross_backend_notes). B8 is 6 points. LLP 1016 already shipped jobs, rehearsal, and expand/fill/contract. Survivor-uniqueness is a precise static finding with no runtime reproduction (`issues/20260906-snapback2-rebuilt-survivor-uniqueness.md`). File it; do not staff “whole-application evolution” until a fresh M7 agent actually hits undocumented surgery.

**Add (thin, not a fifth program):** authored-site diagnosis as an obligation of move three. Opaque `E_OPAQUE` at the module’s first line is why diagnostics is 65. **Do not add:** a React-hook rewrite (`useQuery` in `react-core.tsx` is already the right shape), a new wire, a twin rewrite (LLP 1012: the twin *is* the client), or a public plan algebra (`rules/NOT-DOING.md`).

**Blind spots.** The document under-weights diagnostics and setup/docs relative to their 22- and 15-point Convex leads, and slightly over-weights multi-tab as Clique-critical (see below). Search is mentioned as an example, not as the already-funded closer of the M5 queries_and_live note.

## Ordering and the first slice

Client coherence → certified composition → Quarry hygiene → evolution is the right *confidence* order **if** move one means inbox/resume/subscription identity, not a store rewrite. Do not pause authorized search or the lazy-merge feed work.

**Highest-leverage 1–3 day slice:** make the packaged drain the inbox.

Ship the already-landed clock identity (it is on `main`, not in published 0.0.13). Then, in the client:

1. Reference-count identical `(op, args)` subscriptions. `Client.subscribeRegular` and `createOfflineDrain` use a last-writer-wins `mounted` Map and delete on any close (`client.ts`, `client-offline.ts`). Two inbox hooks, or StrictMode plus a real unmount, can drop the query from resume.
2. Keep the first-recorded drain watermark as the resume log even when no inbox hook is mounted. `tailWatermark` already persists this (`range-store.ts`); resume still walks the live `mounted` set for non-drain queries (`offline.ts` `resumeRequest`). The app must not name the log.
3. Witness: a Clique-shaped app with only `useQuery(api.inbox, { c: null }, { drain: true })` cold-starts offline, reconnects, and predicts a send into a never-opened thread. No app inbox cache, no app-held ascending cursor, no extra `now` query path.

That is the 0.0.8 smoking gun. It removes from the builder’s plate: the inbox cache, the root resume anchor, and clock-query isolation.

If that slice slips past three days, the contained alternative is **cap metering: charge `N` once per distinct cap key (or a maintained count), not per insert**, so `groupCreate` of 50 stays one mutation. Visible at M3; no client rewrite.

Do not spend the first three days on tab leader-election.

## Move one: decomposition

The right primitive set is smaller than the document’s list.

| Proposed | Verdict |
|---|---|
| One transactional ownership boundary | **Already exists.** `StoreSwap` covers rows, answers, receipts, watermarks, outbox, overlays, grants, programs, facts. Do not rebuild it. |
| Delivery identity for clock reevaluation | **Already landed** on `main` (`readTime` in `offline-protocol.ts` / `range-store.ts`; closed ticket). Publish it. |
| Platform-owned tab policy | **Wrong first primitive.** Clique M8 is two *clients* (two stores, two outboxes, server arrival order — LLP 1012 §7). Two tabs sharing IndexedDB is a browser lifecycle. Current policy is one writer, `E_OFFLINE_LOCK` (`store/locks.ts`, `ifAvailable: true`). Leader election is a 1012 amendment, not “completing” it. |
| Shared identical subscriptions | **Keep.** Dedup is real; it is not enough for per-row queries. |
| Enriched pages / query composition | **Keep as the 1012 recipe** (`return page { *, message: messages[.messageId] }`). Not a plan algebra. |

**Would not** decompose as “one versioned log, one reducer.” That is a replica. LLP 1012 forbids it.

**Would not** lead with a leader tab and thin mirrors. Extra copies fight the 66,000-byte gzip ceiling (R8: 72,555 gzip, failed). Clique does not score shared-tab outboxes.

Where the code already has the right shape: range store + swap, twin evaluation, drain-then-tail (`drain.ts`), first-drain watermark as settlement/resume log, SharedSse physical mux (`live.ts`), React `useQuery` default-live.

Where it fights itself: five coordinators (Client, OfflineRuntime, DrainSubscription, ReconnectingSse, React reducer) over one swap; un-refcounted `mounted`; each `useQuery` opens its own logical SSE; resume membership tied to hook lifetime; 0.0.13 still shipping the clock refusal the builder isolated around.

## Biggest risk and what to cut

The plan as written most likely burns effort on **a compiler IR project, a tab-leader runtime, and a store “ownership” rewrite of something that already commits atomically** — none of which a fresh Clique builder will notice if inbox restoration and 50-member creates still need workarounds.

**Cut / defer now:**

- Typed Quarry intermediate representation / compiler replacement.
- Browser leader election / BroadcastChannel mirrors (document refuse-or-wait; don’t build it).
- Move four as a staffed program.
- Reopening `fn`.
- Any extra client copies that push the local runtime further past 66,000 gzip.
- A public query-composition algebra (`NOT-DOING.md`).

**Keep moving:** clock publication, drain/resume independence from the React tree, cap-key metering, name-collision diagnostics, authorized search.

## Corrections

1. **Clock delivery identity is not unlanded.** `issues/closed/20260906-snapback2-clock-query-delivery-identity.md` is Closed: repaired on `main` 2026-09-07, unpublished in 0.0.13. The lane triple was a candidate; an independent repair landed. §3 should say “publish and stop isolating,” not “design delivery identity.”
2. **Transactional ownership is not missing.** It is `StoreSwap` / `commit` in `range-store.ts`. The 0.0.8 workarounds are coordination bugs above that API.
3. **Two-tab shared carrier is not M8.** M8 acceptance 6–7 is two clients; LLP 1012 already specifies two FIFO queues. The ticket is real product friction, not the Clique gap that produced the resume anchor.
4. **LLP 1012 is Implemented**, with residuals as tickets. “Complete the model” means close those residuals, not re-derive local-first v1.
5. **Following-feed 8.496× is a 0.0.8 published fact.** Lazy merge on main certifies 500 follows at 1,025 examined (`issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md`). Do not staff “the feed requires a new engine” from that score row.
6. Weighted-point arithmetic in §2 is correct (O4+B4 = 16; B8+B11 = 11). Original Convex bar 84 vs later rescore 83 is correctly not collapsed. I did not re-read the 2026-09-05 holistic file or `feed-final/final-report.md` beyond the citations.

## Summary for the author

Build the packaged drain so a Clique inbox needs no cache and no resume anchor, and publish the clock identity already on main; next, make a 50-member group one certified mutation. That is the structural program that can show up in the next cold run. Do not start a compiler rewrite, a tab-leader, a new store, or an evolution program. The thesis is right that Snapback’s primitives already beat Convex where Convex is weak; it loses where a builder still has to glue live, held, predicted, and resumed states together. The current client already has the swap, the twin, and the drain recipe — they do not yet agree about subscription lifetime and resume membership, and that disagreement *is* the infrastructure the 0.0.8 builder owned.

## Round 2 (verbatim)

## (a) Tab policy — verdict and the sharpest objection

**Do not ship “online-only follower + wait” as specified.** Keep wait-for-takeover as the *recovery* story; do not let the waiting tab act as a second writer, even online.

Flipping `ifAvailable` in `snapback2/packages/snapback2/src/store/locks.ts` and `store/indexeddb.ts` is not a one-flag change. `createClient` awaits `openOffline` inside `localReady` (`client.ts`), and `query()` awaits `localReady`. A blocking wait hangs every read. Today a lock miss is worse than “no outbox”: `localReady`’s catch calls `authState.failed`, and offline-family errors become auth `refused` with no reconnect (`client-auth.ts`). The follower is not an online client until you invent a **partition-deferred** mode that settles `ready` without opening.

That mode collides with write admission. `submitMutation` sends **plain bytes** whenever `runtime.principal === undefined`, *before* the forced-offline branch (`client-outbox.ts`). `status()` returns `{ ready: true, reason: "ready" }` in that same state; `types.ts` documents it as “today’s bytes.” `useOutbox` / `useMutation` will light the composer. Leader writes carry the replay envelope; follower writes do not. A 503 after commit on the follower can double-send, which LLP 1012 §7 exists to prevent. Offline-only refusal is not enough: **all follower writes must refuse** until takeover, with a code other than “ready.”

Other breaks, if you still build recovery:

- **Account change while waiting.** Logout/wipe calls `deleteDatabase`, which rejects on `onblocked` (`indexeddb.ts`). Login as another principal must abort the Alice waiter; otherwise takeover opens the wrong partition.
- **Crash vs close.** Document destruction releases a Web Lock (close and crash). I did not check bfcache/frozen tabs; a background leader can leave the follower “live-only” indefinitely.
- **StrictMode.** `SnapbackProvider` already keeps one client via a ref and defers `close()` one tick (`react-core.tsx`). That test stays the witness. Headless double-`createClient` still needs `AbortSignal` on the waiter so a discarded wait cannot later steal the lock.
- **SQLite.** Keep immediate `E_OFFLINE_LOCK`. Waiting is a browser-lock policy, not a second native process.

The ticket witness is “two tabs, one offline write in each; both settle” (`issues/20260906-snapback2-second-browser-tab-cannot-share-the-offline-carrier.md`). This policy **cannot** pass it without forwarding. Clique M8 is two clients, not two tabs. “Online-only until takeover” is a trap unless the second tab is honestly **read-only** and the success criterion shrinks to “leader’s durable queue is inherited on close.”

## (b) Cap metering — verdict and the sharpest objection

**Yes: probe the matching `maintain … = count … by <same columns>` row; reserve 1 examined per capped call, not N.** Do not hide an engine count. Do not ship per-distinct-key charging.

In-transaction exactness holds on the owner: `check_constraints` runs **before** the row exists, `maintain` **after** (`runner_ops.rs` `insert`/`replace`). The next insert in the same mutation sees the updated count. Inclusive semantics stay `count >= N` refuse. Missing count on the **server** after a finished rebuild is 0. Successor admission must **keep scanning base rows** (`successor/caps.rs`); never trust the count table during rebuild.

The sharp objection is the **twin**, not successor. Receipt-only `apply_aggregate` skips the increment when the target row is unheld and un-absented (`runner_ops.rs`; `evaluator/src/runner.ts`). If the cap probe then treats missing as 0, `groupCreate` of 49 distinct principals **over-admits** locally. Fallback to today’s scan/partial is mandatory, and “missing” must not mean zero. I did not check how often Clique holds those count rows.

Requiring an explicit `maintain` is a real nick in “one declaration,” but a hidden table adds surprise `write_rows`, twin coverage, and successor rebuild for a 0-loop win the RFC already declined (LLP 1017 §2.4 ticket, §6 non-claim). The chat template already reads `#memberCounts[conversationId]` (`templates/chat/snapback/groups.q`); a principal count is a queryable, not dead weight. **Change the `check` rewrite.** `Cost::cap` still says “reduce the chunk from {calls} to at most {fits} writes” (`certificate/diagnostic.rs`) — that *is* the 7-invitee workaround. Without a paste of the exact `maintain` line, this slice does not close the Clique loop: `cap 1000 by principal` plus 49 distinct keys still will not certify until the builder adds the matching maintain.

## One thing in another panelist's position that is wrong and matters

Claude’s r1 “charge N once per distinct `(table, key)`” does **not** fix the cited case. 49 memberships under `cap 1000 by principal` are 49 keys; 49×1000 still blows 10,240. Shipping that as the move-two slice would have left `groupCreate` chunked.

## Anything that should change my direction (or "nothing")

On (a): wait-and-inherit the leader’s queue, but the waiting tab is **read-only**, lock-wait is **not** inside `localReady`, waiter is abortable, SQLite stays refuse-now, and the two-offline-write witness is **not** closed. If that is more than a thin slice, slip it; Grok was right that this is not the Clique inbox gap.

On (b): keep the maintained-count plan; add the rewrite; twin must not treat an unheld count as 0. Nothing else.
