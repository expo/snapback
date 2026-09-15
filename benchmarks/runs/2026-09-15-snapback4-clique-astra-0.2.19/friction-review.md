# Clique on snapback4@0.2.19 (Astra, medium effort): friction review against the 0.2.16 lane

**Short version.** Holistic score 91, up from 90. The builder grouped 28 correction episodes: 25 its own errors, 2 environment, 1 ambiguous. It recorded "0 demonstrated snapback4 defects" (`final-report.md:57`).

Several 0.2.16 items closed and held:
- the `N_NO_CURSOR` false note
- the missing guide aliases
- the CommonJS import of the generated API
- the internal site path in presence notes

The builder also used the new filtered and calendar maintains directly. Those shipped in 0.2.17 (lane D1), not in wave 3.

Seven problems are still Snapback's:
- **A web write is still lost when the page navigates right after it (S29).** This is the third run with the same error string. The harness navigates the instant after the click, so the documented "await `mutate`" boundary cannot help. 0.2.20's W4a targets exactly this case.
- **Replay: `--hold-effects` holds effects; it does not suppress them.** The cards say "without an app replay flag", but held effects stay durable and become claimable later. The builder wrote an app replay flag again, and the scorer charged both setup_and_docs and background_work.
- **Following: the builder declined the recipe.** It read the 228-line feeds recipe and chose a read-time merge instead. That merge failed the 3× rule at 4.37×. The rebuild filters the global timeline, which the card says not to do, and `N_SPARSE_FILTER` stays in every check.
- **Trending cannot use an ordered maintain over an expiring window.** The builder hand-built an online-only `ranked` table. As a result `like` and `create` never predict, and the app had to build its own pending label.
- **A first reaction chosen offline never predicts (grader d-06).** The `upsert` insert arm targets a table with a horizon and a membership read rule. `check` still counts `react` as eligible; the reason appears only in one self-contradicting residency line.
- **Opening online does not wait for acquisition.** A write made offline right after reopening had no local rows to predict from. The builder's fix was `await client.sync()` in both openers.
- **Smaller costs:** join-attribution columns and a period-anchor column with a backfill; a one-profile digest chunk; parser spellings; a 35-second presence grace that tests have to wait out; a README that grew 11.6%.

One fix shipped but was not used: the development clock (W3d). The builder still waited 185 real seconds for expiry.

The score drops are 1 to 4 points and are within scorer variance. The Snapback causes the scorer actually named are:
- the replay-suppression wording in the docs
- README length
- how dense Following behaves under different workloads
- likes not predicting because Trending is hand-built

Lane: `/Users/ccheever/clique-sb4-20260915-astra-cal4/lanes/astra-snapback4/` (called L19 below). The previous lane is L16. Paths without a directory are under L19's `evidence/`. Clock times are file modification times, in local time; run start 1789457993 is 00:39:53. Between 0.2.16 and 0.2.19, three releases shipped: D1 maintains as 0.2.17 (LLP 3000.007 §20.9, end), store replacement as 0.2.18, and wave 3 as 0.2.19 (§20.12).

---

## 1. Friction in the 0.2.19 run

### 1a. Friction the builder hit that Snapback caused

G-numbers are this review's items; F- and L-numbers refer to FRICTION-0.2.16.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| G1 | **A web local-client write is lost when navigation follows the click.** This is F1 recurring. The workaround sends admin and settings writes through the online client, bypassing the queue. | `m3-attempt1/m3-choreo.log`: "removed member received a new live group message". That is the same string as L12 and L16. The harness clicks remove, then immediately calls `openGroupConversation` (`choreography/choreography.mjs:1860-1861`), so the app cannot await admission. `m3-member-smoke.log`: when the page is held for 2 s, `/m/chat.remove` returns `"state":"sent"`. The writes card was read at 00:57:53, before the failure, and says "A write whose `mutate` is not awaited can be lost if the page unloads before its admission commits." Run log 1789459540: "Membership controls now use published online client with fetch keepalive". The workaround is in `src/Chat.tsx:280-298` (`change`) and `:325-341` (`act`); diary M5 extends it to settings. The builder logged this as agent-error. | About 3.7 min, from suite pass 1789459447 to M3 green 1789459672, including a probe and a rerun. Membership and settings writes lose queueing and prediction. | **S29**. This is the residual wave 3 descoped (§20.12); 0.2.20 W4a addresses it. |
| G2 | **The documented replay hold is not replay suppression.** The app replay flag is back. | `guide-effects.txt` and `guide-jobs.txt` (01:23:05): "run `snapback4 dev --hold-effects --hold-schedules` to hold effect claims and scheduled jobs without an app replay flag". README.md:1778-1780: "emitted effects remain durable and become claimable after restarting without the flag". The brief disables the push seam "so lanes don't diverge on ~100k notification side effects" (`instrument/social-messenger.md:179-181`). Diary M6: "the effect guide's suggestion to hold effect claims is not equivalent to the brief's requirement to suppress emissions; I used an explicit app replay flag." The flag appears in `config/runtime.json`, `scripts/config.mjs`, `chat.q:187,241` and `digest.q:25-26`. | No loop. The scorer charged it twice: setup_and_docs ("did not provide the replay-emission suppression the brief needed") and background_work ("M6 required an application replay flag"). | **S28**. Changed: the flag exists, but it holds rather than suppresses. |
| G3 | **The Following recipe was declined, and the read-time merge failed at scale.** The rebuild uses the pattern the card warns against. | The builder read the feeds card at 00:48:18 (`guide-feeds.txt`, 16,600 B). Its recipe block, lines 23–228, has seven tables, promotion, tombstones, a purge schedule and null slots. Run log 1789458786: "chose indexed server feed merge with no write fanout, measure wide-merge cost at replay". `N_WIDE_MERGE` ("up to 1001 lanes") appears from `m2-check-fix.log` on. `scale-attempt2/scale-10%-probes.json`: following500 p95 3.8635 ms vs following5 0.8842 ms (4.37×). Run log 1789462220 records the rebuild: readers with more than 50 follows get `events … by byTime where .actorId = viewer or followedByViewer(.actorId)` (`social.q:92-98`). The card says "use this recipe for Following rather than filtering the global timeline" (`guide-feeds.txt:296-298`). The final check keeps "N_SPARSE_FILTER: events by byTime: this unscoped `where` pins no index prefix" (`unread-check.log`). `why-following.txt` shows `runs: server`. The final gates pass at 1.41 / 1.15 / 1.05 (`performance-gates.json`). | Rebuild plus a 5-page equivalence proof (`scripts/feed-optimization-proof.mjs`, 66 lines; servers 1789462299–1789462302). Folded into the third fresh replay (404 s wall), which the verifier bug also required. The scorer's queries_and_live and scale_and_limits notes cite this. | **S14, S15**. Changed: the recipe was rejected up front. **Shared blame:** a design choice the builder logged as agent-error. |
| G4 | **Three spelling refusals inside the dense Following query** | Run log 1789462220: "First syntax attempt nested read consumed outer modifiers; extracted boolean helper" (now `fn followedByViewer`, `social.q:90-91`). Run log 1789462239: "canonical modifier order is after, last, by, where" (`guide-reads.txt:33-34`, read at 01:50:29). Run log 1789462248: "E_QUARRY_TYPE: shape after where needs explicit spread wrapper; applied exactly". The bare `eventCard` is accepted elsewhere in the same file (`social.q:89,98`). The diagnostic texts were not kept. | Three attempts in about 30 s: first logged at 1789462220, final ok at 01:50:48 = 1789462248 (`scale-feed-optimization-check.log`). | **S07** (fast now). **New:** a `by` after a nested read inside `where` binds to that nested read. |
| G5 | **Trending has no ranked order over an expiring window.** This forces a hand-built online-only `ranked` table, and likes stop predicting. | The expire card (01:13:04) says: "Value-order indexes over expiring sources are refused by check (E_QUARRY_MAINTAIN_EXPIRE) … use a live bounded query, or the scheduled ranked-table recipe." The builder wrote `insights.q:20-32` (`insert <- allow`, `update <- allow`, `expire at`, `online only`) plus a `posts.score` column with `update <- allow` (`social.q:21,35,136-143`). Final summary: "social.create (writes online-only table ranked) … social.like (writes online-only table ranked)" (`unread-check.log`). The app then built a pending label (`src/PostCard.tsx:25-47`), and one loop followed at run log 1789462481: "pending social change indicator now clears on the terminal receipt". | 1 post-green loop. Scorer: offline ("Trending likes queue without prediction") and queries ("Exact Trending required expiring ranked candidates"). | **S25**, and S05 as its consequence |
| G6 | **Online open exposes server answers before acquisition.** A write made offline right after reopening could not predict. | Run log 1789463391: "immediate full-route reopen can expose server query content before local acquisition catches up. Openers now await the public client.sync() barrier online". `m8-regression-miss/m8-choreo.log`: m8-a15 "locator.waitFor: Timeout 10000ms exceeded … sm-convo-bubble"; m8-a16 "dual-offline convergence did not yield receipted messages". README.md:1216-1219: "until a snapshot and catch-up finish, partition-dependent reads fall back to the server or return `E_OFFLINE`, and writes queue without invented predictions." The fix is in `src/client.web.ts:19` and `src/client.ts:27`. The starter opener does not await `sync()`: the 0.2.19 binary contains no `await client.sync()` string. Its `createLocalClient({ url, ...(as ? …` opener matches `snapback4/apps/chat-expo/src/client.ts` in 0.2.20, which also has no `sync()` call. | About 6 min, from the preserved receipt `m8-before-final-regression/` (02:04) to the fix (02:09:51), plus two debug scripts. Scorer client_integration: "requires explicit admission, sync-barrier and terminal-receipt handling". | **New** (S13 family) |
| G7 | **Attribution and period-anchor columns still need a backfill.** | The filtered and calendar maintains replaced L16's derived flags (`insights.q:1-18`). Still stored by hand: `posts.parentAuthorId` and `events.originalAuthorId` (join attribution, `social.q:20,42`), and `digestAt` (`social.q:5,22`). `bucket(.col, 2m)` takes no anchor, so `scripts/config.mjs` writes `fn digestStamp(t): t - <anchor>` for the 08:00 production anchor (`config/digest.production.json`). The backfill job is `insights.q:43-51`; `m8-backfill.log` shows 7 chunks, 905 rows written. Essay: "Replies and reposts needed explicit author attribution, followed by a bounded backfill". | Part of the 629 s M8 wall; run log 1789461450. | **S24** (narrowed to join attribution). **New:** calendar anchor. |
| G8 | **The digest runs one profile per chunk**, with a `digestChats` scratch table | `digest.q:16-23,28,41`. No loop. | Proactive design. | **S26** |
| G9 | **Emitting over a filtered recipient list is refused**, so the loop re-iterates the membership page | Run log 1789461056: "E_STRUCTURAL_FANOUT: filtered recipient list cannot preserve complete-page proof; emit while iterating original bounded membership page as diagnostic prescribes." `chat.q:189-191` re-reads `members[…] first 50` right after building `recipients` (`chat.q:180-183`). | 52 s (1789461004 → 1789461056), shared with a text-replacement error. | **S08** (the rewrite worked first time) |
| G10 | **The presence grace can't be shortened in development** | Run log 1789461204: "followed browser close inside documented 35-second presence grace … suite now waits 36 seconds". README.md:801-802: "still counts for 35 seconds". Grader t1: m6 suite takes 40 s "(includes a 36 s presence-grace wait)". No flag in `cli-help.txt`. | A 39 s loop, plus 36 s on every M6 suite run. | **New**, low |
| G11 | **A positional key is ambiguous across two indexes** | `m2-check.log`: "E_QUARRY_AMBIGUOUS: follows has 2 indexes matching this key: byPair, byFollowed; choose one / rewrite: … — check --fix applies it". `m2-check-fix.log`, 6 s later, applies both fixes. | 6 s | **New**, low (the repair path worked) |
| G12 | **A longer README and the residency model** | Diary M1: "Reading the whole long README took effort". The README is 127,362 B / 2,277 lines at 0.2.19, against 114,084 B in L16's `node_modules`. Diary M6: "The difficult part was knowing which local facts are complete"; the builder removed an existence guard on a new message id (S19, no loop). Essay: intuition "was not enough to guess the local evaluator's knowledge model". | Conceptual. The scorer cited it in setup_and_docs and data_modeling. | **S13**. **New:** README size. |

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| M1 | **The first reaction chosen offline never predicts, and `check` calls `react` eligible.** Root cause of grader d-06; see §4. | `m6-check.log:138`: "chat.react: predicts: eligible". `:147-148`: "Horizon: upsert inserts do not predict: the target has a horizon; queue without a row (reactions by byMessagePrincipal) (site chat.q:232:5); may queue without a row past the horizon / rewrite: remove a redundant guard, or read a synced fact without a horizon". That line says "do not" and "may" at once, and there is no guard to remove. The end-of-check summary in every check through `unread-check.log` lists 6 never-predict mutations and omits `chat.react`. | **S20** residual (ruling 19 does not cover a membership rule) |
| M2 | **Hand-built Trending widened write rules.** `posts` and `ranked` both carry `update <- allow`; `ranked` also has `insert <- allow`. | `social.q:35`, `insights.q:29-30`. Grader t10 notes both are reachable only through declared mutations. Inference: forced because `like` updates another author's `score` and `ranked` row as the liker. | S25 consequence |
| M3 | **Following is server-only**, so there is no offline Following page | `why-following.txt`: "social.following: runs: server". The declined recipe answers on the device (`guide-feeds.txt:8`). | S14 |
| M4 | **Stale docs name a batch route that was reverted.** | `guide-jobs.txt` and README.md:1816: "Ordinary and ordered batch mutations both stamp `now` from this dev clock." The `POST /m` batch route was reverted in the wave-3 descope (JOURNAL "Wave 3 descope", W3a2 `4eacb45b6`). The sentence is still in 0.2.20: `packages/snapback4/README.md:1854`, `crates/snapback4-lang/src/guide.rs:1080`. `serve.rs` routes only `/m/<op>`. | New (misleading doc) |
| M5 | **The README's Expo Go session store uses raw SecureStore keys.** The starter normalizes them, and the missing normalization was L16's L6 bug. | README.md:2082: `{ get: SecureStore.getItemAsync, … }`. L19 copied the starter's normalized form (`src/client.ts:7-11`), matching the string in the binary. Still unnormalized in 0.2.20 README.md:2120. | New (L6 residual) |
| M6 | **Residency facts are long and repetitive.** 57 of 197 sites have no `file:line:col` (for example "(site insert pairs)", "(site update members rule)"). 28 horizon sites carry the generic rewrite "remove a redundant guard", including plain reads such as `acknowledge`'s `messages[messageId] !`. | `m6-check.log` (358 lines, `check --residency`), lines 55, 88, 139-140. | S08 residual |
| M7 | **Seven advisories remain on intentional designs in every check.** | `unread-check.log`: `N_SPARSE_FILTER`, `N_NO_HORIZON` ×3 (profiles, likes, views), `N_WIDE_MERGE` ×2 (searchAll, following), `N_MAINTAIN_SYNCED` (reactionCounts). | S16, S17 (as noise); L3 |
| M8 | **The starter's Metro config doesn't exclude the `.snapback4/` store directory.** Inference: this contributed to the M8 Metro crash, which the builder attributed to Node 25. | The binary's metro template contains only the `assetExts` and `unstable_enablePackageExports` lines, and 0.2.20 `crates/snapback4/src/verbs/init/metro.config.js` has no `blockList`. The builder added one after the crash (`metro.config.js:5`, 01:41; run log 1789461679; `m8-metro-crash.txt`). | New, low |
| M9 | **The development clock shipped, was documented where the builder read, and wasn't used.** | The expire card (01:13:04) shows `snapback4 clock advance 185s`. Nine minutes later, `scripts/expiry-proof.mjs:61` waits 185,000 ms (`m5-no-client-expiry.json` noClientsMs 185009), and `scripts/digest-proof.mjs:98` waits for the real period boundary. The grader used `POST /dev/clock/advance 25h` (trace t7). | S27 (adoption) |

### 1c. Friction that was not Snapback's

- **Instrument:**
  - The copied harness needed sibling `metering/` directories (run log 1789458484).
  - The default fixture path assumed the original layout (1789458820).
  - The harness's own disappearing-message check waits in real time: the m5 segment took 316,406.6 ms (`m5-choreo.jsonl`).
  - The run prompt waived simulator proofs (`prompts/astra-snapback4.md:12`), so O4 = 40 (grader).
  - The brief itself asks for "a pinned replay-mode flag" (`social-messenger.md:179`). That shares the blame for G2.
  - The scorer is an independent N=1 session reading narrative only (`prompts/astra-snapback4.score.md`).
- **Environment:**
  - Node 25.9.0 was on PATH (run log 1789458484).
  - Metro under Node 25 ran out of memory (`m8-metro-crash.txt`).
- **The builder's own errors** (`final-report.md:59-86`):
  - routing and form hydration
  - feed tabs, and running suites concurrently
  - clearing the wrong draft, and the video viewer's root mounted too late
  - title case, and missing profiles in the isolated expiry test
  - a text replacement put the emit into the wrong mutation
  - JavaScript optional chaining in Quarry (1789461450; the diagnostic's rewrite worked)
  - insights hydration, JSX whitespace
  - the replay transport: `execFileSync('snapback4 sql')` blocked the event loop and a pooled socket reset (`scripts/scale-verify.mjs:15`, `scale-attempt1/scale-replay.log` ECONNRESET). Inference: an undici keep-alive race, not a server fault.
  - the reply/media mapping in the verifier, receipt seats, the unread arithmetic
  - the seed-idempotence count, and a race in the report preview

---

## 2. The 0.2.16 items: recurred, closed, or changed

| Item | 0.2.16 (L16) | 0.2.19 (L19) | Verdict |
|---|---|---|---|
| F1 web write lost on navigation (S29) | `m3-choreo-first.txt`, same string; workaround was a raw keepalive `fetch` | Same string in `m3-attempt1/m3-choreo.log`. Workaround is now the online client with keepalive (`Chat.tsx:280-341`). Wave 3's W3a (oldest-head exit retry) shipped; W3a2 (unawaited pre-admission) was reverted (§20.12). | **Recurred.** 0.2.20 W4a journals admission synchronously; Chromium `navigation-immediate` 10/10 (§20.13). |
| F2 Following trap (S14) | Built the language card's merge, then rebuilt onto the recipe (ratio 1.034) | The language card's `following` is now the inbox plus 32 pulls (`guide-language.txt:229`). The builder read the feeds card and still chose a read-time merge (1789458786). 4.37× at 10%; rebuilt as a global filter; `N_SPARSE_FILTER` remains. | **Changed form:** the recipe was declined, not missed. 0.2.20 W4b removes null slots but keeps the seven-table recipe. |
| F3 no removal path in the recipe | `E_STRUCTURAL_FANOUT`; inboxes made public | `guide-feeds.txt:192-227`: `removeEvent`, owner-checked `removedEvents`, `purgeRemoved` every 1m (W3b2, W3R2). Not exercised: the builder's `repost(set:false)` just deletes its `events` row (`social.q:151-152`). | **Closed in product, not exercised.** Inference: null slots plus a purge job added to the recipe's weight (G3). |
| F4 named shape after `where` (S07) | 80 s; `--fix` did not fire | 1789462248: applied the diagnostic's rewrite, in one of three attempts inside about 30 s. W3c made `--fix` reach unary `not`. The refusal itself stays. | **Recurred, cheaper** |
| F5 no clock control (S27) | Real 185 s and 2-minute waits | `dev --clock-offset`, `clock advance` and `run --now` are on the expire and jobs cards (W3d) and in `cli-help.txt`. Not used (M9). | **Closed in product; not adopted** |
| F6 hand-built replay mode (S28) | `fn replayMode()` | Same flag (`chat.q:187,241`, `digest.q:25`). `--hold-effects` and `--hold-schedules` are now advertised, but they hold rather than suppress (G2). | **Recurred.** The docs now overclaim. |
| F7 derived columns and backfills (S24) | `day`/`period` columns; three backfills | `where` and `day(.at)` maintains used directly (D1, 0.2.17). Join attribution, the anchor column and one 7-chunk backfill remain (G7). | **Mostly closed; narrowed** |
| F8 no maintained top-N (S25) | `rankedPosts` hand-built; `E_QUARRY_UNKNOWN` cursor code | D1 adds value-order indexes for non-expiring groups (`guide-language.txt` `postLikes … by byCount`), but refuses them over expiring sources. `ranked` is still hand-built (G5). No cursor-index error this run. | **Recurred** for trailing-window Trending |
| F9 digest chunked one row at a time (S26) | `chunk m in members first 1` | `chunk p in profiles first 1` plus `digestChats` (G8) | **Recurred** |
| F10 nullable `insert … if absent` (S10) | 1 loop | No bound `if absent` result in L19 source. | Not exercised |
| F11 internal program path (S08) | `programs.chat.send.body.19…` | `why-send-final.txt`: "connected: decides effects only". No internal body paths; 57 rule and write sites still lack a line (M6). | **Closed** (M6 residual) |
| F12 `guide maintain`/`time` missing | nearest-card misses | `guide.txt` aliases: "maintain -> maintains", "time -> language", "clock -> jobs", "replay -> personas", "seed -> personas". All 14 `guide-*.txt` files are real cards. | **Closed** |
| F13 residency slows first use (S13) | Essay "tax on momentum" | G12; scorer data_modeling "meaningful conceptual overhead" | **Recurred** |
| F14 CommonJS generated-API import | `m1-seed.txt` export error | `snapback/generated/package.json` = `{"type":"module"}` (W3R1c). Seeds ran (`m1-seed.jsonl`); no module-type error in the evidence. | **Closed** |
| L1 silent never-predict, duplicated notes (S05, S06) | 7 never; 24 notes | One summary line naming each cause: 6 never-predict (`unread-check.log`); no duplicated notes seen. New gap: `react`'s insert arm is missing from the summary (M1). | **Changed** (M1 residual) |
| L2 `N_NO_CURSOR` on a capped group | every check | `roster`, `inbox` and `typing` read `first 50` against `cap 50`; no `N_NO_CURSOR` in any check `m1`…`unread` | **Closed** |
| L3 advisory noise (S16, S17) | Persisted | 7 notes in the final check (M7) | **Recurred** |
| L4 worker effect dedupe | Hand-built | No worker; effects inspected through `/effects` (`final-report.md:91`) | Not exercised |
| L5 service worker for cold web launch | Hand-built | Not built; grader t5: "web dev build cannot cold-launch offline" | Not exercised; no longer charged by the scorer |
| L6 SecureStore adapter | Normalization dropped | Normalized adapter copied from the starter (`src/client.ts:7-11`); no loop. The README example is still unnormalized (M5). | **Changed** (doc residual) |
| L7 9.2 s schema adoption | `scale-server.log` | No schema change on the scale instance | Not exercised |

---

## 3. The score drops

The scorer is a fresh session that reads only L19's narrative (`prompts/astra-snapback4.score.md`). No earlier score is shown to it, so a 1–4 point change is within N=1 variance.

The brief says queries_and_live went 91→89. That is **−2**, not −3; both FINAL.md files say 91 and 89.

### setup_and_docs 96 → 92 (−4)

- **What changed in the notes.** The L16 note: "M1 diary calls the README unusually comprehensive; M8's published feed recipe supplied a workable scale design … no established misleading documentation." The L19 note: "The long README required attention; M6's effect-claim guidance did not provide the replay-emission suppression the brief needed."
- **Snapback-attributable:**
  1. **Replay wording (G2).** The cards and README.md:1777 say hold works "without an app replay flag". The README's next sentence keeps effects claimable. This is exactly what the rubric charges as "documentation that misled".
  2. **README length (G12).** It grew 13,278 B (+11.6%) since the L16 package; diary M1 calls it "long".
- **Lost credit, shared with the builder.** The feed-recipe credit is gone because the builder declined the recipe (G3).
- **Instrument.** The same README reads as "unusually comprehensive" in one narrative and "long" in the next. The brief's own "pinned replay-mode flag" is what made hold insufficient.
- **Not charged:** the environment and harness-layout problems, which the builder logged as such.

### queries_and_live 91 → 89 (−2)

- **The L19 note:** "Exact Trending required expiring ranked candidates; essay.md identifies workload sensitivity in the dense Following query."
- **Snapback-attributable:**
  1. **Trending (G5).** `E_QUARRY_MAINTAIN_EXPIRE` refuses ordering an expiring maintain, so `ranked` is hand-built.
  2. **The feeds recipe's weight (G3).** The read-time merge it replaces does not scale; the final design carries `N_SPARSE_FILTER`.
- **Agent.** Choosing the merge, then the global filter. The final report logs it as "agent-error … Wide feed merge exceeded measured 500-versus-5 ratio".
- **Instrument.** L16 also hand-built `rankedPosts` (F8) without being charged. The L16 note instead credited "Following500/Following5 at 1.034" from the recipe.

### writes_and_transactions 96 → 95 (−1)

- **The note's only negative:** "the transport retry failure was attributed to client tooling."
- **Cause.** Scale attempt 1 got ECONNRESET after `execFileSync` blocked Node's event loop (`scripts/scale-verify.mjs:15`; run log 1789462085). That is agent tooling, with no Snapback cause established. Inference: the server closed an idle keep-alive socket, and `scale-attempt1/scale-server.log` shows no error.
- **Instrument.** The L16 note named a similar transport failure and still gave 96.

### offline_sync 93 → 92 (−1)

- **The L19 note:** "Completeness horizons require deliberate modeling; Trending likes queue without prediction. Native lifecycle execution remains unmeasured."
- **Snapback-attributable:**
  1. **`like` never predicts** because it writes the online-only `ranked` table (G5; `unread-check.log`).
  2. **Horizon modeling load (G12, S13).**
- **Instrument, narrative visibility.** `like` also never predicted in L16 (L1). The L16 builder didn't narrate it; the L19 builder did (diary M8, essay).
- **Instrument, native proof.** Native execution was unmeasured in both runs because the prompt waived the simulator.
- **Offsets.** L16's "Cold web launch required application-shell caching" charge is gone.
- **Invisible to the scorer.** Grader d-06, the offline reaction, sits in `grading/`, which the scorer may not open.

The gains, for context:
- authorization +9: no public feed projection this run
- data_modeling +3: D1 maintains
- scale_and_limits +3: all 16 gates passed

---

## 4. Grader defects d-01 … d-06

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (minor) | Global search merges different DMs under one "Direct message" header | `chat.q:138` names every DM `'Direct message'`; `src/Search.tsx:43` uses `groupLabel: r.chat?.name` | **App bug.** A counterpart label is ordinary client work. |
| d-02 (minor) | Re-selecting the same file after posting does nothing | The hidden `post-file` input is never reset (`src/Social.tsx:93,137`). The harness attempt-2 misses match. | **App bug** (web input semantics) |
| d-03 (minor) | Every video shows the fixture photo as its poster | `src/PostCard.tsx:12`, `src/Social.tsx:13` and `src/Chat.tsx:236` all require `fixtures/media/img-01.png`. The brief says "no thumbnail generation required (a poster frame is optional)" (`social-messenger.md:47-49`). | **App bug** (shortcut). There is no Snapback poster feature, but the brief doesn't need one. |
| d-04 (cosmetic) | DM header reads "Direct message · off" | `src/Chat.tsx` ChatRoute `title=entry.conversation?.name` | **App bug** |
| d-05 (cosmetic) | Multi-image viewer opens only the first image | `src/PostCard.tsx:47` `MediaViewer id={p.video?.id \|\| p.image1?.id}` | **App bug** |
| d-06 (cosmetic) | An offline reaction shows no pending or optimistic chip | See below | **Primarily Snapback-attributable** (no prediction). The missing pending indicator is the app's. |

**d-06 in detail.**

What the grader did: its probe sends a fresh message (`grading/probes/offline-writes.mjs:29`), goes offline, picks a reaction (`:59-60`), and counts chips (`:62`). The result was `optimisticChipOffline: 0`, and the write settled on reconnect (`grading/evidence/offline-writes.json`). On a fresh message that is the **insert** arm of `upsert reactions[messageId, viewer]` (`chat.q:251`).

Why Snapback did not predict it:
- **The published rule.** LLP 3000.007 §20.5 (ruling 19), and the prediction card as the builder read it at 00:48:18, allow the insert arm only when all three conditions hold:
  1. "the synced group is held with no horizon"
  2. "both the key and the materialized insert image prove readability (public rows, or a viewer-keyed rule)"
  3. "every … affected cap group is fully covered"
- **The table fails the first two.** `reactions` is `sync to members[.conversationId] last 500 by byConversation`, a horizon (`chat.q:216`). Its read rule is `exists members[.conversationId, viewer]`, which is neither public nor keyed by viewer (`chat.q:212`). It also has `cap 50 by messageId` (`chat.q:210`).
- **The check's own output.** `m6-check.log:147` shows the device queues without a row. The same line calls it a "may", attaches a rewrite that doesn't apply, and the summary still counts `react` as eligible (M1).
- **Inference: no published spelling fixes it.** Following the card's advice to "insert when absent and update the held row when present" still fails condition 2 for a membership rule. §20.5's "Likes and reactions keyed by `(post, viewer)` predict their first write offline" holds only for public or viewer-keyed rules, and messenger reactions are membership-scoped.
- **The builder's part.** `reaction()` (`src/Chat.tsx:221-229`) ignores `w.state === 'pending'`, while `PostCard` shows a pending label for likes (`src/PostCard.tsx:25-47`). With a label, d-06 would have been "pending, not optimistic".

**Verdict:** the optimistic-chip gap traces to Snapback's `upsert` insert rule, not a runtime defect. The pending-state gap is the app's own UI.

---

## 5. Remaining Snapback-attributable friction, ranked (next-wave candidates)

Expected impacts are inference from the scorer's notes; nothing here is measured.

| Rank | Friction | Smallest product change | In 0.2.20? | Expected impact |
|---|---|---|---|---|
| 1 | Replay holds effects but can't suppress them; docs claim it replaces the app flag (G2; S28) | Add `dev --suppress-effects` (or `--replay` = suppress plus hold schedules): `emit` records nothing, or records a counted `suppressed` state shown in `doctor`. Change the effects, jobs and personas cards and README.md:1777 to say plain hold keeps effects claimable. | **No.** `guide.rs:1035,1191` keep the "without an app replay flag" text. | setup_and_docs +2–4 (the named M6 doc charge); background_work +1–2 |
| 2 | Web write lost on immediate navigation (G1; S29) | Already built (W4a; the witness already has a builder-shaped admin removal, JOURNAL W3a). Remaining: confirm in the next calibration that `m3` passes through `c.mutate` without the online keepalive client, and add a writes-card sentence saying such navigation is covered when Web Locks and localStorage are available, so builders drop the workaround. | **Yes** (W4a, 10/10 real Chromium) | client_integration +1; removes the admission incident from the authorization and offline narratives |
| 3 | First offline reaction never predicts; `check` says eligible (d-06, M1; S20) | **Diagnostics first:** list insert-arm misses in the end-of-check summary (e.g. "chat.react: first reaction queues without a row — reactions has a horizon; its rule is not viewer-keyed"), and fix `m6-check.log:147`'s "do not … may" wording and wrong rewrite. **Then product:** let a child group ride its parent's horizon (reactions complete wherever their message row is held; `cap 50 by messageId` bounds it), and accept a membership rule whose deciding row is held. | **No** | offline_sync +1; grader O2 (d-06); client_integration |
| 4 | The feeds recipe is too heavy to adopt; read-time merges fail at 500 follows (G3; S14, S15) | Ship the recipe as a file: `snapback4 init --recipe feeds` writes `snapback/feed.q` plus its client page. Make `N_WIDE_MERGE` on a follow-driven merge say the measured consequence (in this lane 4.37× at 500 follows), and name the command. | **Partly** (W4b removes null slots and adds merge `where`; still seven tables and a purge job) | queries_and_live +1–2; scale_and_limits +1; restores setup_and_docs's recipe credit |
| 5 | Trailing-window Trending needs a hand-built online-only `ranked` table, which costs like prediction and widens write rules (G5, M2; S25) | Allow a value-order index on a maintain over an expiring source, ranking live values at read time (currently `E_QUARRY_MAINTAIN_EXPIRE`). Smaller alternative: a card recipe that keeps `like` predictable by scoring `ranked` from a schedule instead of the write path, with its exactness limit stated. | **No** | queries_and_live +1; offline_sync +1; authorization (drops `update <- allow`) |
| 6 | Online open doesn't wait for acquisition (G6) | Have the `init --expo` starter and the README opener `await client.sync()` when online. Add a React `useSynced()` or a `client.acquired` flag, and have a pre-acquisition `mutate` report "queued without a row: not acquired". | **No** (the 0.2.20 `apps/chat-expo/src/client.ts` opener has no `sync()`) | client_integration +1 (its "sync-barrier" phrase); offline_sync |
| 7 | Non-predicting writes need an app-built pending state (G5 loop at 1789462481; d-06's UI half) | A `usePendingWrite(op, args)` hook, or `Write.observe()`, tracking pending until the terminal `sent`/`failed`, replacing the `PostCard.tsx:25-39` ref-plus-`onWrite` pattern | **No** | client_integration +1 ("terminal-receipt handling") |
| 8 | Calendar keys take no anchor; join attribution needs stored columns and a backfill (G7; S24) | `bucket(.at, 1d, at 08:00)` or `day(.at, offset)` in maintain group keys and expressions. Join-key contribution stays out of scope (D1). | **No** | data_modeling +1; operations (one fewer backfill column) |
| 9 | Docs accuracy papercuts (M4, M5, G12) | Delete the "ordered batch mutations" sentence (README.md:1854, `guide.rs:1080`). Normalize the README's SecureStore example (README.md:2120). Put a "start with these cards" index at the top of the README. | **No** (both still present in 0.2.20) | setup_and_docs +1 (the scorer charges misleading docs) |
| 10 | Spelling refusals (G4, G11; S07) | Accept `where pred shapeName` when `shapeName` is a declared shape, matching the bare shape the `by` form already accepts. Make modifiers after a nested read inside `where` a specific refusal with the helper rewrite. Have `--fix` rewrite `a?.b`. Prefer the unique index on an ambiguous positional key. | **No** | diagnostics_dev_loop +0–1; data_modeling |
| 11 | Test controls: the presence grace, and clock adoption (G10, M9; S27) | Add `dev --presence-grace <dur>`, or make `clock advance` expire presence. Put a one-line "tests: `snapback4 clock advance`" pointer on the presence and effects cards. | **No** | diagnostics_dev_loop, operations (small) |
| 12 | Low: digest chunking (G8; S26); advisory noise (M7); synthetic residency sites (M6); Metro watching `.snapback4/` (M8) | A digest continuation recipe with maintained unread counters. A per-note acknowledgement comment. `file:line` for rule sites. A `blockList` entry for `.snapback4/` in the starter's `metro.config.js`. | **No** | background_work, scale_and_limits (small) |
