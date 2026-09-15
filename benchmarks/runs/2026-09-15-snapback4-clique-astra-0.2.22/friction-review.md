# Clique on snapback4@0.2.22 (Astra, medium effort): friction review against the 0.2.21 lane

**Short version.** Holistic score 91, up from 88. The builder logged 13 correction entries: 2 environment, 11 agent-error, 0 snapback4-defect, plus 1 ambiguous scale predicate (`final-report.md:84-98`, run log 1789504209.859). The scorer wrote "no Snapback defect was attributed" (`scores/astra/FINAL.md`, overall note).

Wave 6 closed the three largest 0.2.21 items, and the builder used each fix directly:
- **W6a.** `init --recipe feeds --prefix feed` ran one second after M2 started (`m2-recipe.log:1`, file time 1789499838; run log 1789500078). It was wired into the app's `createPost`, `repost` and `follow` (`snapback/social.q:64-112`). Following 500/5 is now 1.03 / 1.03 / 1.07 across the checkpoints (`scale-degradation.json`); L21 measured 1.257 with `N_SPARSE_FILTER`. queries_and_live rose by 7 points.
- **W6b.** The schema declares `use identity password` (`snapback/schema.q:1`). `API.md:9` says "Signup needs 8+ characters", and the UI has no workaround. Diary M1 says "No password implementation was needed". authorization rose by 5 points.
- **W6c and W6d.** The final check has 2 notes, down from 16 (`m8-check.log:1`), and every check prints the persistent horizon bucket. The replay and seed adapters pass `mutate(op, args, { id })` (`scripts/replay.mjs:9`, `scripts/seed.mjs:16`), and there is no intent ledger. The `dev --replay` banner prints.

**Three new problems, all visible only to the grader:**
- **d-03: ghost feed events.** The prefixed install leaves the recipe's standalone public mutations in place (`snapback/feed.q:110-196`). `feed.feedCreatePost` accepts any post id and puts a `post:null` event at the top of Global (trace §5 P2). **This is a wave-6 regression.** In 0.2.21, `createPost(postId, body)` wrote a self-contained text event (L21 `guide-feeds.txt:191-194`). W6a removed the body (`JOURNAL.md:18674-18676`), so the same public call now inserts a reference to nothing.
- **d-02: the presence grace swallows pushes.** A message that arrives within 35 s of the recipient's last disconnect is never pushed (trace §5 P11). This semantics predates wave 6.
- **Following-recipe costs:**
  - `saveProfile`, `createPost`, `repost` and `follow` queue without prediction (`m2-check.log:6`; `m8-check.log:10`).
  - The builder carries the recipe's 32-pull and 200-event bounds as a "scale risk" (diary M2), and the scorer charged them.

**Other Snapback-attributable friction.**
- Exact Trending is still hand-built on a table with `insert <- allow` and `update <- allow`, and `like` no longer predicts.
- `dev --fresh` turned out to be in-memory, so a finished 631 s replay had to be repeated.
- An `N_WIDE_MERGE` note is left on a 1,000-lane global search.
- The SDK `Read` carries no work meter.
- The "aggregates" guide keyword missed again.

**The grade.** O1 is unchanged: 101/119 (the same count L21's grader reported).
- **The 7 failing assertions** are m6-a01..a07, native simulator checks the prompt waived. L21's grader recorded the same evidence as `not-run`; nothing regressed.
- **O2 fell from 78 to 68**, mainly because d-01 is rated major. It is an app bug, unbound `Linking.openURL`, that L21's app also shipped undetected.
- **O5 fell from 75 to 30** because one literal rule fired: the Trending mid-curve p95 was 1.915 ms against a 1.832 ms line, a 0.083 ms miss on a flat curve. Following, search and the recipe all pass with margin.

**Score drops.**
- **diagnostics −3:** the H3 complaint is gone and a meter complaint replaced it.
- **scale −1:** the sparse-filter charge is gone, and recipe bounds plus search lanes replaced it.
- **background −1:** the builder's full-history digest sweep.

None traces to a wave-6 regression.

**Regression check.** One wave-6 regression is established (d-03, W6a). It should ship in the next wave. W6e is unexercised because this lane runs no worker.

Lane: `/Users/ccheever/clique-sb4-20260915-astra-cal6/lanes/astra-snapback4/` (L22 below). The previous lane is L21 (`/Users/ccheever/clique-sb4-20260915-astra-cal5/lanes/astra-snapback4/`).
- **Paths.** Paths without a directory are under L22's `evidence/`.
- **Times.** File times are modification times; run start 1789499471 is 12:11:11 PDT.
- **Release.** Wave 6 is LLP 3000.007 §20.15, `snapback-w4b/llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:3550-3577`, with journal entries W6a–W6R2 at `snapback-w4b/snapback4/JOURNAL.md:18661-19835`.
- **Package README.** This means `node_modules/snapback4/README.md` in L22: 148,490 B, 2,591 lines.
- **Run record.** `run-record.json` does not exist in L22 (trace §0), so `record.json` was read instead.

---

## 1. Friction in the 0.2.22 run

### 1a. Friction the builder hit that Snapback caused

H-numbers are this review's items. H/V numbers from FRICTION-0.2.21 appear as "0.2.21 H2" and so on.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| H1 | **Wiring the recipe costs prediction** for profile save, post, repost and follow | **Note, verbatim.** `m2-check.log:6-8` (file time 1789499897): "N_NOT_PREDICTABLE: saveProfile is no longer eligible to predict; queued without a row: online-only table feedAuthors (sites: schema.q:26:3)".<br>**Final summary.** `m8-check.log:10`: "14 mutations never predict: … saveProfile (writes online-only table feedAuthors), social.createPost (reads online-only table feedAuthors), social.follow (reads online-only table feedAuthors), … social.repost (reads online-only table feedPosts)".<br>**Cause.** The builder registers inside `saveProfile` and `createPost` (`schema.q:26`, `social.q:64,97`), following "Call `register` during profile creation" (`guide-feeds.txt:263`). The recipe's `feedAuthors` is `online only` (`feed.q:8`). The card states the queueing (`guide-feeds.txt:286-287`).<br>**Builder.** Diary M2: "Integrating the recipe made profile saves queue without prediction; that is acceptable for this milestone but a visible tradeoff." Essay:17. | No loop; a design tradeoff. Scorer writes_and_transactions: "Feed and ranking dependencies made some mutations queue without prediction". | **S14/S15 residual** (new: recipe residency) |
| H2 | **Recipe bounds carried as an unmeasured scale risk** | **Bounds.** `cap 32 by readerId` on pulls (`feed.q:27`), `last 200` follow backfill (`feed.q:128`), and 1,000 follows per account (`feed.q:16-17`).<br>**Builder.** Diary M2: "Its caps and backfill limit are explicit and are retained as a scale risk to check at M6."<br>**Scorer.** scale_and_limits: "feed.q retains 32 shared-author and 200-event backfill bounds".<br>**Fixture reach.** The scale fixture has exactly **1** author with more than 50 followers, and no reader follows more than 1 shared author (computed from `instrument/fixtures/scale.log` follow lines). The bounds are never approached. | No loop. Scorer scale_and_limits −1 (§5). | **S14/S15** (new: recipe envelope) |
| H3 | **Exact Trending still hand-built on a widened table; `like` now never predicts** | **Card.** The feeds card was read at 1789499838; its Trending section says scores "lag by one schedule period (1 minute)" (`guide-feeds.txt:644-651`) and `trendingNow()` is cut at the meter (`:661-668`). The maintains card repeats this (`m8-maintains-guide.txt:102-110`).<br>**Built.** `rankedPosts` with `insert <- allow`, `update <- allow`, `expire at .expiresAt`, `online only` (`analytics.q:20-33`). `like` is `: server` and writes `rankedPosts` (`social.q:81-91`).<br>**Result.** `m8-check.log:10` lists `social.like (reads online-only table rankedPosts)`. The card's recipe promises no `update <- allow` and a predicting like (`guide-feeds.txt:568,638-641`).<br>**Builder.** Diary M8: "Exact-on-load ranking requires server-side like writes, so the offline UI exposes a queued state." | Design only. Scorer: writes note (above); the Trending midpoint was not charged. | **S25** (0.2.21 H4 recurring) |
| H4 | **`E_STRUCTURAL_FANOUT` on a derived push recipient list** | **Refusal.** Run log 1789502040.724: "E_STRUCTURAL_FANOUT required complete roster page for notification fanout; corrected helper to iterate capped members page". The site text was not retained; `m6-fanout-diagnostic.txt:1` is the `why` text ("An accumulated or filtered list may lose the proof that it contains the whole group").<br>**Fix.** `push.q:5-8` iterates `members[msg.conversationId] first 50`.<br>**Builder.** Essay:9: "notification fanout over a derived list. The compiler rejected both." | About 13 s by file times: effects card 1789501385, then `why` text and `push.q` both at 1789501398. Logged as agent-error. | **S08** (0.2.19 G9 recurring) |
| H5 | **Global message search over every membership keeps a 1,000-lane `N_WIDE_MERGE`** | **Note, verbatim.** `m5-check.log:6-8`: "N_WIDE_MERGE: query settings.everywhere: the merge over messages reads up to 1000 lanes, one page of 21 each — up to 21000 rows per read; a read past the 8,192 examined ceiling returns `complete: false` / rewrite: measure with `snapback4 test --cost`; bound lane discovery to the scopes this read needs, and pass a cursor to continue the result". It is still in the final check (`m8-check.log:6-8`).<br>**Card.** The search card's example bounds lanes with `first 50` (`guide-search.txt:38`). The brief's probe user has 100 conversations.<br>**Builder.** Diary M5: "There is a real scale caveat … 1,000 chat search lanes. The named probe has 100 conversations".<br>**Measured.** Search is fine at 100: p95 8–9 ms, mid-curve passes (`scale-degradation.json`). | No loop. Scorer scale_and_limits: "diary.md M5 flags 1,000 search lanes". | **S16/S17** (the W6c advice changed; no paved form past 50 lanes) |
| H6 | **`dev --fresh` is in-memory, so a finished scale replay could not be retained** | **Start.** Run log 1789502464: `dev --port 49363 --fresh --replay --no-watch`.<br>**Discovery.** 1789502850.821: "first fresh instance is in-memory and would not survive mandated cleanup; retain attempt then repeat on empty persistent store".<br>**Docs.** Package README:2055: "`--fresh` uses one in memory that dies with the process".<br>**Banner.** The startup banner does not say where the store lives. `scale-memory-attempt/scale-server.log:1-5` matches the persistent run's banner (`scale-persistent-1789503123450/server.log:1-5`) apart from the types path. | A 631.3 s replay (1789502465.114 → 1789503096.453) repeated as a 729.4 s replay (1789503342.699 → 1789504105.335), plus an interrupted pass that was partly agent error. Logged as agent-error. | **New** (dev ergonomics; S28 neighbourhood) |
| H7 | **An isolated proof store has no service token** | **Error, verbatim.** `m8-suite-1789502370564.json`: "Error: ENOENT: no such file or directory, open '…/evidence/m8-digest-proof-1789502368202/.snapback4/audit-token'".<br>**Fix.** Run log 1789502400.581: "added published token --service setup". The services card documents `snapback4 token --service` (`m8-services-guide.txt:15-17`).<br>**Neighbour.** The same batch guessed a readiness endpoint: "Error: server readiness m8-ranking-proof" (`m8-suite-1789502346100.json`). The package README documents no health or readiness route (no match for "health" as a route). | About 35 s (1789502346 → 1789502405). Logged as agent-error. | **New** (low); related to grader d-05 |
| H8 | **No work meter on the SDK `Read`** | **Type.** `Read<T>` is `{ data, complete, fresh, since?, next? }` (`node_modules/snapback4/dist/contract.d.ts:48-53`).<br>**Builder.** Run log 1789503012.452: "Internal query meters are absent from the public SDK Read card; probes retain latency and completeness only". Also lane `README.md:59` and `final-report.md:54`.<br>**Existing meter paths.** They exist but take personas or derived arguments: `snapback4 run <op> … [--as alice]` (package README:2126-2129) and `snapback4 test` (:2135-2147). **Inference:** neither is documented for a password principal such as u0500 on a replay store. | No loop. Scorer diagnostics: "Public SDK Read cards lacked internal work meters" (−3, §5). | **New** |
| H9 | **The recipe's follow edge has no timestamp; the builder patched the installed recipe** | **Card.** The card's `follows` has no `at` (`guide-feeds.txt:63-73`).<br>**Patch.** The lane adds `at: time default 0` (`feed.q:13`) and `at: now` (`feed.q:118`) for the digest's `periodFollowers` bucket (`digest.q:1`). `evidence/line-counts.json` provenance: "published recipe with two added timestamp lines". | Minutes at most (inference; not separately logged) | **New** (low) |
| H10 | **Guide keyword miss, again** | `m8-first-pass-diagnostics.txt:6`: "`guide aggregates` reported no card named aggregates; nearest: maintains, jobs, residency". `m8-aggregates-guide.txt:1` is the same. | Seconds (run log 1789503189.204) | **S01** (0.2.21 H10 recurring) |
| H11 | **Attribution column with a backfill; digest one profile per chunk plus a full message sweep** | **Attribution.** `posts.parentAuthorId` is stored and then backfilled (`social.q:4,65`; `analytics.q:44-49`; `m8-backfill.log`: `"rowsWritten": 140`). `likes.authorId` is also stored (`social.q:23,84`).<br>**Digest.** `chunk p in profiles first 1 by byId` (`digest.q:36`) and `chunk msg in messages first 10 by byId` (`digest.q:41`). Essay:37: "It does scan message history".<br>**Scorer.** background_work: "Full-history digest sweeping remains an application optimization target". | Proactive design, no loop. Scorer background_work −1. | **S24, S26** (0.2.21 H5, H6 recurring) |

Two smaller Snapback-shaped moments were logged as authoring errors:
- **Principals are not text.** A concatenated DM key was refused (run log 1789500456; `m3-type-diagnostic.txt:1`, "E_QUARRY_TYPE: a value meets a declaration of another type"). The fix became two sorted principal columns (`chat.q:6-7,12`).
- **Online client type.** The online `Client` type lacks `sync` (`typecheck.log:1`, "Property 'sync' does not exist on type 'Client'"). The builder's opener unions both client arms (`src/client.ts:14-15`); the starter narrows by tier first (w4b `apps/chat-expo/src/client.ts`).

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| V1 | **The prefixed install keeps the standalone public mutations, and their references are unvalidated** (grader d-03). **W6a-introduced.** | **Public ops.** `feed.q:110-196` keeps `feedRegister`, `feedFollow`, `feedUnfollow`, `feedCreatePost(postId: id)`, `feedRepost`, `feedDeletePost` and `feedUnrepost`. `src/following.ts:25-27` still exports wrappers; nothing in `src/`, `app/` or `scripts/` imports that file.<br>**Probe.** Trace §5 P2 (`grading/logs/p2-feed.log`): "feed.feedCreatePost on nonexistent post: … state sent", then "global top after spoof: [{… postNull:true …}]". The same log shows an author removing their own original from Global through `feed.feedDeletePost` while "post still readable: true". The app has no post delete.<br>**Card.** It says only "The standalone recipe operations remain useful for a new app; an integrated app calls its own bridged operations" (`guide-feeds.txt:366-367`).<br>**0.2.21 comparison.** `createPost(postId: id, body: text <=500)` stored the body (L21 `guide-feeds.txt:191-194`). | **New** (S14/S15; wave-6 regression) |
| V2 | **The 35 s presence grace suppresses push permanently** (grader d-02) | **Probe.** Trace §5 P11 (`grading/logs/p11-history-push-grace.log`): "push previews queued for b: ["b disconnected 45s","third","second","first"]". The +10 s message is absent.<br>**Suite.** The grader's first M6 suite failed `push-text-and-once` because it ran about 20 s after the M5 suite closed Bob's clients (`grading/suite-receipts/m6-suite-1789504705713.json`).<br>**Docs.** Package README:870-873 ("one that answered a moment ago still counts for 35 seconds"), and the builder's `API.md:58` discloses it. | S29 neighbourhood (0.2.19 G10 related) |
| V3 | **Pull-cap promotion hazard** (inference from code) | Promotion inserts a pull row for each of the first 51 followers (`feed.q:120-125`). Under `cap 32 by readerId` (`feed.q:27`), "reaching a cap refuses the write atomically" (`guide-feeds.txt:325-329`). **Inference:** one follower who already pulls 32 shared authors makes the 51st follow of any author they follow refuse, so that author can never be promoted or gain a 51st follower until the saturated follower unfollows someone. Unexercised: max pulls per reader in the fixture is 1 (H2). | S14/S15 (new) |
| V4 | **Browser cold start grows linearly with the corpus** | `scale-degradation.json` cold-start: 1,910.7 / 8,466.9 / 14,821.3 ms at 10% / 50% / full, against a 30 s limit. **Inference, row counts not captured:** the recipe's inbox syncs in full with no horizon (`guide-feeds.txt:268-270`), up to 50,000 rows per reader, and a follow backfills 200 events per author (`feed.q:128`). For a 500-follow probe user that is plausibly the bulk. Not comparable to L21's 640 ms, which came from a different (process-device) probe (L21 `performance-summary.json` "cold"). | S16 (investigate with `test --residency`) |
| V5 | **The `repost-following-feed-surface` transient recurred** (grader d-04) | **Failures (all "viewer-repost of an unfollowed author was counted as a direct follow-projection hit").** Failed attempts take 205–517 ms, and passing attempts take 1,599–9,094 ms: grader r1 attempts 1 and 3, grader r2 attempt 2, builder `m2-choreography-1789500084900.jsonl` attempt 3, builder `m2-choreography-1789500164435.jsonl` attempt 2. L21 has the same signature (453.5 and 449 ms, L21 `m2-choreo*.jsonl`).<br>**Harness.** The pre-follow sample uses `() => true` (`harness/choreography/choreography.mjs:1532-1539`). `feedProjectionState` over zero cards returns `direct: false` (`:917-933`), and `waitForValue` does not require a card (`:756-767`).<br>**Supporting clue.** `unfollowVisibleMs` of 7.7–37.4 ms (one outlier at 203.7) in `follow-unfollow-live-projection` (builder and grader receipts) is faster than a server-only mutation plus sync. **Inference:** the "not followed" predicate passes on an empty list. | None (instrument) |
| V6 | **The Trending mid-curve miss is a checkpoint effect, not growth** | **Final replay** (Trending p95 at 10% / 50% / full): 1.808 / 1.915 / 1.861 ms.<br>**First, in-memory replay:** 1.837 / 1.982 / 1.811 ms, also above its line. Insights p95 there was 1.640 / 1.625 / 1.586 ms, above its line by 0.009 ms.<br>**Samples.** The final 50% p95 is the first post-warm-up sample (1.9150 ms; `scale-probes-50pct.json`). Full is faster than 50% in both replays. | Instrument predicate (§3); cause of the 50% elevation not established |
| V7 | **Widened recipe rules** | `feedAuthors update <- allow` (`feed.q:7`), `feedPulls insert <- allow` (`feed.q:29`), and the builder's `rankedPosts insert/update <- allow` (`analytics.q:30-31`). These are reachable only through operations, but V1 keeps those operations public. | S25/M2 residual |
| V8 | **Synthetic residency sites** | 104 of 340 sites in `snapback/generated/residency.json` lack a `file:line`, for example "insert if absent feedFeed" ×14 and "insert members rule" ×10. L19 had 57 of 197. No `why` was captured this run. | S08 residual (0.2.21 V8 recurring) |
| V9 | **Digest counts recipe events, not posts** | `periodPosts: count feedPosts by actorId` (`digest.q:4`) counts reposts and V1's ghost events as `newPostsInFollowing`. The grader flagged this as an inference in d-03. The choice is the app's; V1 amplifies it. | App plus V1 |
| V10 | **The docs keep growing, more slowly** | Package README: 148,490 B / 2,591 lines, against 142,262 B / 2,496 lines at 0.2.21 (+4.4%). Feeds card: 27,630 B against 22,204 B (+24.4%). Prediction card: 9,775 B against 8,466 B (+15.5%). Diary M1: "The 2,600-line published README took more orientation". | G12 (0.2.21 V10 recurring) |

### 1c. Friction that was not Snapback's

- **Environment:**
  - The copied harness was read-only and needed `chmod` (run log 1789499578).
  - The harness snapshot lacked `lib/json-schema.mjs`, so the builder added an AJV wrapper (1789499819).
  - PATH had Node v25.9.0 against a declared 24.18.0 (1789499819).
  - The grader's zsh loop did not word-split, producing three startup refusals (`rerunsUsed: 1`, trace §4).
- **Instrument:**
  - The prompt waives simulator proofs ("simulator proofs are not required", `prompts/astra-snapback4.md:12`), so m6-a01..a07 and m8-a17/a18 have no native artifact (§3).
  - M7 is not run, and O3 is null (no probe set).
  - The grader is uncalibrated (`calibrationPassed: false`), and the O5 predicates and ceilings are uncalibrated (trace §7).
  - The `repost-following-feed-surface` race is V5.
  - The harness's feed-tab expectation led to run log 1789500150.
  - The five-minute real-time expiry wait (trace §4, m5 r1, 302 s).
- **The builder's own errors** (`final-report.md:88-98`):
  - The M1 first-green time.
  - Feed tabs.
  - A lazy web-device import that raced the offline step (1789500547). Essay:21 calls it "my integration mistake".
  - Group navigation by name.
  - The media test racing settlement.
  - The kit palette.
  - The suite dispatcher.
  - The reaction pending label (1789503268.764).
  - A no-hit search word.
  - A Playwright `route.fetch` rejection (1789503342.087).
  - Five-following versus five-followers (1789503542.611).
  - The cold-sync reporting value (1789504270.173).
  - Half-shares of H4, H6 and H7.
- **App defects the grader found:**
  - d-01, major: `onPressLink={Linking.openURL}` is unbound (`src/profile.tsx:18`; also `src/posts.tsx` and `src/chat.tsx`).
  - d-05: the lane README omits the token mint command.
  - d-06: empty posts and messages are accepted (`social.q:5` `text <=500`; `chat.q:40`).
  - The latent follow-button default is `{following:false}` until `followState` loads (`src/profile.tsx:18`). This is the same class as L21's d-04.

---

## 2. The 0.2.21 items: recurred, closed, changed, or unexercised

### Explicit checks

- **`init --recipe feeds --prefix`: installed and wired.**
  - **Timing.** The recipe was installed at 1789499838, one second after M2 started (run log 1789499837). The feeds and prediction cards were saved in the same second. Install output: "init: wrote 2 files in . — Following recipe" (`m2-recipe.log:1`).
  - **No app follow table.** The builder uses the recipe's `feedFollows` as the app follow graph. `social.follow` checks `PERSON_NOT_FOUND` and calls `feedAddFollow`/`feedDropFollow` (`social.q:73-80`), and `followState`, `follows` and the counts read `feedFollows` (`social.q:44-49,119-122`).
  - **Post and repost wiring.**
    - `createPost` inserts the app post, then `insert feedPosts { id: postId, … }` and `feedDeliver(event)` (`social.q:65-70`), matching the card's seam (`guide-feeds.txt:425-431`).
    - `repost` uses `feedPosts[viewer, postId, true]` as attribution rather than an app `reposts` table (`social.q:92-105`).
  - **Following** is the card's merge joined to `postCard` (`social.q:108-112`).
  - **Global** reads `feedPosts` by time (`social.q:106-107`). That is the builder's choice, and it surfaces V1's ghosts.
  - **Registration** is folded into `saveProfile` and `createPost` (H1).
  - **Recipe patch.** `feedFollows` was given timestamps (H9).
  - **Standalone operations left** in `feed.q` (V1).
- **`mutate(op, args, { id })`.**
  - **Used in both adapters.** `c.mutate(op,args,{id:receipt.mutationId})` (`scripts/replay.mjs:9,13`) and `c.mutate(op,args,{id})` (`scripts/seed.mjs:16`). Ids come from `stableId`, a 26-digit Crockford hash of the fixture line (`scripts/seed.mjs:7`), which fits W6d's "ids take the `mintId()` form".
  - **No ledger.** There is no intent table.
  - **Resume worked.** The persistent replay "resumes that same originally empty store … with stable IDs and no duplicated source writes" (`final-report.md:44`). Grader P2: "follow same-id replay: … replayed:true".
- **`clock advance`: used, on isolated servers only.**
  - `POST /dev/clock/advance` appears in `scripts/expiry-proof.mjs:3`, `scripts/digest-proof.mjs:2` and `scripts/m8-tests.mjs:5`; the grader cites the 25 h Trending advance (trace §3).
  - `--clock-offset` and `--hold-schedules` run in per-proof stores (`scripts/isolated.mjs:2`).
  - There is no worker (no `runWorker` in `scripts/`), and effects are read from the outbox (`m8-digest-verification.json:18`, `"leaseUntil": null`). **W6e's lease extension is unexercised.**
- **`dev --replay`: used for every scale run.** Run log 1789502464, 1789503123.454 and `scripts/scale-extra-probes.mjs:2`. The banner line prints: "snapback4 dev: replay on — new effects suppressed; schedules held" (`scale-memory-attempt/scale-server.log:4`). `doctor` was not captured.
- **Trending guidance: read and declined for exactness.**
  - **Read.** The feeds card (read at 1789499838) contains the scheduled recipe and `trendingNow()` (`guide-feeds.txt:560-668`). The maintains card (`m8-maintains-guide.txt:102-110`) was saved around 1789502040.
  - **Declined.** The builder built write-path exact ranking (H3). Essay:27 credits the rolling-versus-calendar warning.
- **Password change (W6b): visible, unprobed.**
  - The personas card was saved at 1789499546; lines 43-44 say "at least 8 characters (Unicode scalar values)", and line 55 says "An email-and-password product declares `use identity password`".
  - The app has `use identity password` (`schema.q:1`) and no client-side length check (`src/session.tsx:12`).
  - Neither builder nor grader probed a multi-byte password. The grader's m1-a12 cites the identity line and Argon2 hashes (trace §6).
- **Horizon diagnostics (W6c): visible.**
  - **Persistent bucket.** It prints in every check from M2: `m2-check.log:10` says "1 mutation eligible, but these reads queue without a row past a horizon: social.like (posts[postId] (social.q:79:7))", and `m8-check.log:10` lists 3 mutations.
  - **No `N_NO_HORIZON` after M2.** It fired for `profiles` at `m2-check.log:2-4` and was gone at M3 (`m3-check.log:1`, 1 note), with `profiles` still `sync public` (`schema.q:17`). **Inference:** M3's `exists profiles[principal = otherId]` guard (`chat.q:90`) triggered the whole-partition suppression.
  - **`reactions` keeps its no-horizon membership shape** (`media.q:1-13`) and gets no note. L21's identical shape got one (L21 `m4-check.txt:14-16`).
  - **No `N_HORIZON_GUARD`.** No argument-id guard was written; `chat.send` has none (`chat.q:119-129`). No `why` heading was captured.

### Item by item

| Item | 0.2.21 (L21) | 0.2.22 (L22) | Verdict |
|---|---|---|---|
| H1 password minimum in bytes | Probe plus UI workaround; the builder's only snapback4-defect | Card says characters; `API.md:9` says "8+ characters"; no UI workaround; no grader password defect; not probed | **Closed** (W6b); docs exercised, enforcement unprobed |
| H2 Following recipe not adoptable | Read-time merge 4.31×, then a global filter; `N_SPARSE_FILTER` | `--prefix feed` at M2 start; wired; Following 500/5 1.03–1.07; no sparse or wide-merge note on Following | **Closed** (W6a), adopted. New costs are H1, H2, V1, V3 and V4. |
| H3 "predicts: eligible" hid a horizon guard | 5-minute loop, ledger table | Persistent bucket in every check; no guard written; no loop | **Closed in output** (W6c); the guard case is unexercised |
| H4 exact Trending | Write-path `rankedPosts`, synced; like predicted | Write-path `rankedPosts`, `online only`, `insert/update <- allow`; like never predicts (H3) | **Recurred, worse on like prediction** (builder design; no W6 change targeted it) |
| H5 attribution columns and backfill | 406-row backfill | `parentAuthorId` backfill, 140 rows (`m8-backfill.log`) | **Recurred** (H11) |
| H6 digest one profile per chunk | `digest.q:24` | `digest.q:36`, plus a 10-message chunk full sweep (`digest.q:41`) | **Recurred**; the scorer now charges the sweep |
| H7 app intent ledger | `intents` table | None; `mutate { id }` in replay and seed | **Closed** (W6d), adopted |
| H8 offset rows in the future after restart | 16 s loop | Jobs card: "use a fresh store per offset test" (`m8-jobs-guide.txt:80`); the builder used per-proof stores (`scripts/isolated.mjs:2`); no loop | **Closed** (W6e docs), exercised |
| H9 one asset per owning row | Diary M2 | The replay caches bytes but uploads per row (`scripts/replay.mjs:7`); not narrated; media 97 unchanged | **Recurred silently** |
| H10 guide keyword miss | "aggregates" | "aggregates" (`m8-first-pass-diagnostics.txt:6`) | **Recurred** (identical) |
| V1 `N_NO_HORIZON` contradiction | 7 notes, several contrary to prediction | 0 after M2; `reactions` shape silent | **Closed** (W6c/W6R2), exercised |
| V2 `N_NOT_PREDICTABLE` fired once | Disappeared after one check | Summary bucket persistent through M8 | **Closed** (W6c), exercised |
| V3 guests on by default | `use identity` | `use identity password` (`schema.q:1`); no guest defect | **Closed** (W6b guidance), adopted |
| V4 `clock advance` expired a worker lease | `E_EFFECT_LEASE` in a digest proof | No worker; `leaseUntil: null`. The journal attributes the bug to W3d (`JOURNAL.md:19005-19010`). | **Unexercised** |
| V5 repost transient | Seen in L19 and L21 | Same error and fast-fail signature in builder and grader runs; the grader filed it as d-04 | **Recurred** (instrument, §4) |
| V6 Following server-evaluated | 470–496 ms | Synced `feedFeed`/`feedBroadcast` merge (`social.q:108-112`); `followVisibleMs` 471.7–679.7 ms; follow itself never predicts | **Changed** (local read, server-only write) |
| V7 16 advisory notes | 16 | 2 (`m8-check.log:1`) | **Closed** |
| V8 synthetic residency sites | L19: 57/197 | 104/340 | **Recurred** (unexercised) |
| V9 no replay line at startup | Absent | "replay on — new effects suppressed; schedules held" | **Closed** (W6c) |
| V10 docs growth | README +11.7% | README +4.4%, feeds card +24.4% | **Recurred, slower** |

---

## 3. Grade regressions

### The 7 failing assertions (M1–M7 report)

All seven cite the same evidence: "no iOS simulator recording or structured simulator receipt exists … artifacts/m6-ios is a Hermes bundle export only" (`grader-report.json` m6-a01..a07; trace §8).

| ID | What failed (assertion text) | Cause |
|---|---|---|
| m6-a01 | Cold-start offline (iOS simulator, backend stopped): previously synced chats and message history render | **Harness or grader environment** |
| m6-a02 | Cold-start offline: previously viewed media renders | **Harness or grader environment** |
| m6-a03 | Cold-start offline: search over synced messages works | **Harness or grader environment** |
| m6-a04 | Cold-start offline: a previously viewed view-once photo does not render | **Harness or grader environment** |
| m6-a05 | Two messages composed offline both show a visible pending state | **Harness or grader environment.** The web equivalent passed in grader r1. |
| m6-a06 | On reconnect the queued messages flush and arrive in order | **Harness or grader environment.** The web equivalent passed. |
| m6-a07 | The flushed messages walk the receipt states and reach `read` | **Harness or grader environment.** The web equivalent passed. |

**None is the app, Snapback, or the recipe:**
- **Waived by the prompt.** "simulator proofs are not required" (`prompts/astra-snapback4.md:12`, unchanged from cal5 apart from pins and paths).
- **Same evidence, different label.** L21's grader recorded the identical absence as `not-run` for all seven (L21 `grading/grader-report.json`). This grader chose `fail` ("absence of the simulator artifact cannot support the native claim"). O1 is 75 with 101/119 in both lanes, so the label change moved no score.
- **M8 native checks.** m8-a17/a18 (in `m8-assertion-results.json`) fail for the same reason.
- **A Snapback lever exists but was not in scope.** The published simulator witness (LLP 3000.007 §20.10; trace §8 mentions "No `snapback4 witness ios` receipt exists") would have supplied this evidence.

### O2: 78 → 68

The grader's anchor sentence is "nearer 60 because of one major" (`oDimensionScores.O2`). L21 had no major defect.

| Defect | Cause | New behaviour or new discovery? |
|---|---|---|
| d-01 major: link taps throw | **App**: `onPressLink={Linking.openURL}` is unbound (`src/profile.tsx:18`) | **Discovery.** L21's app had the identical prop at `src/Posts.tsx:80`, `src/Chats.tsx:414` and `app/profile/[handle].tsx:39`, and L21's grader did not find it. |
| d-02 minor: grace swallows push | **Snapback semantics** (§4) | Discovery: a new probe (P11). The semantics predate wave 6. |
| d-03 minor: ghost feed events | **Recipe as shipped in 0.2.22**, plus the builder leaving the standalone operations public (§4) | **New behaviour** (W6a) |
| d-04 minor: Following misprojection | **Harness** race (V5), with a latent app default (§4) | Recurring (L21 V5) |
| d-05 minor: audit-token mint step missing | **App** docs (lane `README.md:57`) (§4) | New: the app added a service-token proof |
| d-06 cosmetic: empty content accepted | **App** (`social.q:5`, `chat.q:40`) | Discovery |

**Builder choices versus product behaviour:**
- **The 10-point drop is mostly d-01's severity.** That is an app bug both independent builders shipped.
- **Snapback's share of O2** is d-02 (unchanged semantics) and d-03 (a W6a regression, partly the builder's wiring choice).
- **Inference:** without d-01, the defect mix is 4 minor plus 1 cosmetic, close to L21's 5 minor plus 1 cosmetic at 78.

### O5: 75 → 30

**What fired.** The band function checks first-match in the order 0, 30, 60, 90, 75. Band 30 means "any degradation rule fails" (`instrument/social-messenger.md:926-927`). The rule that failed is "Trending at the full corpus ≤ 3× the 10% checkpoint, under the same mid-curve rule" (`social-messenger.md:257-259`): the 50% p95 must sit on or below the line between 10% and full. Recorded: 10% 1.808 ms, 50% **1.915 ms**, full 1.861 ms, line 1.832 ms, so it fails by 0.083 ms (`scale-degradation.json`, `trending:mid-curve`). Band 0 did not fire: the manifest conforms, 167,243 actions were acknowledged, and the grader re-verified the fixtures (trace §7, P10).

**What did not cause it:**
- **Not the Following recipe.** Following 500/5 is 1.03–1.07, and celebrity read is 1.07–1.23, all passing. L21 had 1.257.
- **Not the search lanes.** The search mid-curve passed, 8.013 ms against an 8.618 ms line.
- **Not Trending growth.** Full over 10% is 1.03×.

**What did:** a strict line predicate on a flat 1.8 ms curve at k=20 on a shared host.
- **L21 was just as close.** It passed the same predicate by 0.013 ms (0.418 against 0.431; L21 `performance-summary.json`). Insights passed here by 0.0005 ms (1.5873 against 1.5878).
- **The 50% elevation repeats.** It appears in both of L22's replays (V6), so it is systematic, not growth. Its cause is not established.
- **No rerun.** The builder did not rerun selectively (run log 1789504209.859).

**Builder choice versus product behaviour:**
- **The builder's part.** It chose online-only write-path Trending (H3), which it measures over HTTP at about 1.8 ms. L21's synced table measured about 0.42 ms with a different probe.
- **Snapback's part: none established.** Wave 6 changed no query evaluation. The W6a journal says "No meter ceiling, value serialization, conformance case or engine code changed" (`JOURNAL.md:18685`), and §20.15 lists no engine change.
- **Classification:** harness or grader environment (an uncalibrated predicate with no noise tolerance). Snapback should still check whether a mid-replay checkpoint is slower than both ends (V6).

**O4 moved from 30 to 40** on the same no-simulator basis, by grader judgment (trace §8).

---

## 4. Grader defects d-01 … d-06

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (major) | Link taps call unbound `Linking.openURL`; they throw on web and would not open on native | `src/profile.tsx:18`, `src/posts.tsx`, `src/chat.tsx`; trace §9 | **App bug** (also present, undetected, in L21) |
| d-02 (minor) | No push for a message within about 35 s of the last disconnect; the M6 suite is order-sensitive | Package README:870-873; trace §5 P11 | **Snapback semantics the brief contradicts** (below) |
| d-03 (minor) | `feed.feedCreatePost` accepts a nonexistent postId; ghost events take Global and Following slots and would inflate digests | `feed.q:160-165`; trace §5 P2 | **Recipe as shipped in 0.2.22 (W6a regression)**, plus the builder's wiring (below) |
| d-04 (minor) | Following intermittently shows the unfollowed author's original beside the viewer's repost | Harness V5; latent app default | **Harness transient**, not recipe semantics (below) |
| d-05 (minor) | A clean-checkout M6 run needs `.snapback4/audit-token`, and the README does not say how to mint it | Lane `README.md:57` | **App documentation**, with a small Snapback nudge (below) |
| d-06 (cosmetic) | Empty text post and empty message accepted | `social.q:5` `body: text <=500`; `chat.q:40` `body: text <=2000` | **App** (Quarry `text 1..N` exists: `schema.q:5`) |

### d-02: is the 35 s grace Snapback semantics that the brief contradicts?

**Yes.**
- **The brief.** "when a message arrives for a user with **no connected client**, the backend emits a notification payload" (`instrument/social-messenger.md:625-627`). Acceptance 3 is "With Bob's clients closed, Alice messages him" (`:656`).
- **Snapback.** `connected[p]` counts a device "that answered a moment ago … for 35 seconds" (package README:870-873). The mutation decides at commit (the effects card: "the server decides who is notified at commit", `guide-effects.txt:54`), and nothing re-evaluates when the grace ends.
- **Probe.** A message at +10 s after disconnect was never queued; one at +45 s was (trace §5 P11).
- **The documented alternative does not help.** "emit unconditionally and have the worker call a service mutation that reads `connected`" (`guide-effects.txt:56`) reads the same grace at claim time. **Inference:** a prompt worker would drop the same message.
- **Disclosed, not charged by the scorer.** The builder disclosed it (`API.md:58`). The semantics predate wave 6: L19's diary paid a 36 s wait (FRICTION-0.2.21 G10), and W5g moved the grace onto the dev clock.

**Smallest product change (no Quarry change).**
- **Mechanism.** When `not exists connected[p]` is false only because of grace (no open poll), queue the effect with its existing `nextAt` set to the grace deadline, and drop it at claim time if `p` has an open connection. `nextAt` is already an effect field (`m8-digest-verification.json:19`).
- **Semantics.** This matches the brief: a user who stays gone is notified about 35 s late, and one who reconnects is not.
- **Tests.** The M6 suite becomes order-independent.
- **Docs.** Add one card sentence stating the delay.
- **Smaller fallback.** A `connected[p] open` spelling that counts only open polls. It would push during brief reconnect gaps.

### d-03: is the shipped wiring example unsafe or incomplete?

**Incomplete, not unsafe. The unsafe part is what `init` leaves installed.**
- **The example is safe.** Its `createPost` inserts the app post and the reference event in one transaction, and its `repost` reads `posts[postId] !` (`guide-feeds.txt:425-441`).
- **The install is not.** The prefixed install still writes all standalone public mutations into `feed.q` (`feed.q:110-196`), and the generated `src/following.ts:25-27` wraps three of them.
- **The card never says to remove them.** It says "The standalone recipe operations remain useful for a new app; an integrated app calls its own bridged operations" (`guide-feeds.txt:366-367`). It does not say that they accept any `postId: id`.
- **The builder's share:**
  - Left the operations in place.
  - Used `feedPosts` directly as the Global timeline (`social.q:106-107`), which puts ghosts at the top of Global.
  - Counts `feedPosts` in the digest (`digest.q:4`).
- **Why this is a wave-6 regression.**
  - **Before.** In 0.2.21, `createPost(postId, body)` stored content (L21 `guide-feeds.txt:191-194`), so an arbitrary call was an ordinary text post.
  - **After.** W6a removed the body (`JOURNAL.md:18674-18676`), making the same public call a reference to nothing.
  - **What review covered.** W6R1a checked foreign tombstones and private cards (`JOURNAL.md:19116-19124`), not unvalidated references.
- **Smallest product change:**
  - When `--prefix` is given, install the standalone operations as `fn` helpers (or omit them), and generate `src/following.ts` without the wrappers.
  - Add one card sentence: an integrated app deletes or guards `feedCreatePost` and `feedRepost`, because they accept any post id.
  - Optionally, a `check` note when a client-callable mutation inserts a public row whose `id`-typed argument is never read.

### d-04: recipe semantics or the V5 harness transient?

**The harness transient. Not recipe semantics.**
- **The recipe removes the original.** `feedDropFollow` deletes every private entry by that actor and the pull lane (`feed.q:137-146`; card `guide-feeds.txt:33-35,271-274`). The viewer's own repost has `actorId = viewer`, so it stays by design. A broadcast copy is not read after the pull lane is dropped, and a third party's repost carries that party's attribution, which the harness counts as neither `direct` nor `viewerRepost` (`choreography.mjs:926-931`).
- **The API agrees.** Follow → unfollow → viewer repost four times gave "following after unfollow: 0", then only `{"actor":"b","repost":true}`, stable at +300 ms (`grading/logs/p2-feed.log`). A directed UI repro did not reproduce the miss in 18 trials (P7).
- **The timing points at the harness.** Failed attempts run 205–517 ms, while passes run 1,599–9,094 ms and include a follow projection of 503.6 ms or more. **Inference:** the failing path skipped the unfollow branch, so its `() => true` sample (`choreography.mjs:1532-1539`) saw `direct: false`. Alice's new post had not yet reached Bob's Following, or the list was momentarily empty (`:917-947`). Bob was still following when he reposted, and the check threw.
- **The same signature appears with a different implementation.** L21's server-evaluated Following shows it too (V5).
- **The app's latent contribution** is real but does not match these durations: `followState` defaults to `{following:false}` until loaded (`src/profile.tsx:18`), so an early tap re-follows.
- **Snapback's share:** only the 0.5 s class of Following delivery latency to a second client.

### d-05: audit token minting documentation

**App documentation.**
- **The gap.** Lane `README.md:57` says the token is "an explicitly minted service token stored at `.snapback4/audit-token`" but not how to mint it. `scripts/m6-tests.mjs:3` reads the file.
- **Snapback already documents minting.** The services card: "`snapback4 token --service ranker [--days 365]` prints, once, a bearer session" (`m8-services-guide.txt:15-17`). The effects card: `snapback4 token --service pusher` (`guide-effects.txt:61`).
- **The builder hit the same gap itself** in an isolated store (H7).
- **Small Snapback nudge.** The mint output says "printed once; keep it where the worker keeps secrets" (`grading/logs/token-mint.err`). Tokens are per store, and nothing names the store. The smallest change is one line in the mint output and the services card: "this token belongs to `<store path>`; a fresh store needs its own".

---

## 5. The score drops

The scorer reads only L22's narrative and record (N=1), so 1–3 point moves are within variance.

| Category | 0.2.21 → 0.2.22 | Snapback-attributable cause named in the note | Other causes |
|---|---|---|---|
| overall | 88 → 91 | "Quarry's learning cost, prediction boundaries and recipe ceilings" (H1, H2) | No defect attributed |
| setup_and_docs | 90 → 90 | "The 2,600-line README required orientation" (V10) | — |
| data_modeling | 88 → 89 | None | — |
| authorization | 91 → 96 | The H1 byte charge is gone (W6b) | Hidden trust grading unrun |
| queries_and_live | 84 → 91 | "feed merging added concepts" (recipe) | The sparse-filter charge is gone (W6a) |
| writes_and_transactions | 92 → 94 | "Feed and ranking dependencies made some mutations queue without prediction" (H1, H3) | The ledger charge is gone (W6d) |
| offline_sync | 90 → 94 | None | Native interaction untested (instrument) |
| media_assets | 97 → 97 | None | — |
| background_work | 95 → 94 | None | "Full-history digest sweeping" (H11, the builder's design) |
| client_integration | 89 → 90 | "Prediction/completeness states needed deliberate UI handling" | — |
| diagnostics_dev_loop | 93 → 90 | "Public SDK Read cards lacked internal work meters" (H8) | The H3 complaint is gone; variance |
| scale_and_limits | 85 → 84 | "feed.q retains 32 shared-author and 200-event backfill bounds; diary.md M5 flags 1,000 search lanes" (H2, H5) | The sparse-filter charge is gone; Trending midpoint "not charged" |
| operations | 88 → 89 | None | M7 not exercised |

### diagnostics_dev_loop 93 → 90 (−3): a complaint swapped, not a regression

- **Notes.**
  - L21: "'Predicts: eligible' alone omits essential per-read conditions" (0.2.21 H3).
  - L22: "Principal typing, E_STRUCTURAL_FANOUT and expiry-index diagnostics led to concrete corrections … Public SDK Read cards lacked internal work meters (final-report.md)".
- **W6c closed the old charge.** No builder text complains about prediction headings.
- **Snapback-attributable part.** `Read<T>` has no meter (`dist/contract.d.ts:48-53`).
  - Meters exist through `snapback4 run … [--as alice]`, which prints "the result, the meter" (package README:2126-2129), and `snapback4 test`, which prints meters with derived arguments (:2135-2147).
  - The builder's lookup (run log 1789503012.452) read the wire, services and stopped-store sections, not the CLI ones.
  - **Inference:** neither tool is documented for a real account principal on a replay store, which is what an O5 probe needs.
- **Not a regression.** The Read shape and the meter tools are unchanged by wave 6.
- **The newly visible diagnostics were positive in the note.** The `E_STRUCTURAL_FANOUT` example (`m6-fanout-diagnostic.txt:1`) and the expire-index rewrite (`m8-first-pass-diagnostics.txt:2-4`) are credited.

### scale_and_limits 85 → 84 (−1): recipe bounds replaced the sparse filter

- **Notes.**
  - L21: "sparse-filter incompleteness remains".
  - L22: "Replay verified 500 follows and busy-chat/celebrity fixtures. feed.q retains 32 shared-author and 200-event backfill bounds; diary.md M5 flags 1,000 search lanes, while measurements cover 100 conversations. The ambiguous Trending midpoint failure is not charged."
- **The bounds are the recipe's.**
  - `cap 32 by readerId` (`feed.q:27`) and `last 200 by byActorTime` (`feed.q:128`), documented at `guide-feeds.txt:325-331`.
  - The fixture never approaches them (one shared author; H2), so they are real envelope limits that no measurement exercised.
  - V3 records a latent hazard beyond what the scorer saw.
- **The 1,000 lanes are the builder's search query** (`settings.q:28-31`, `first 1000`). Snapback's part is that the search card only paves 50 lanes (`guide-search.txt:38,68-69`) and the note's rewrite cannot be followed without dropping chats (H5).
- **Measured.** Every scale predicate except the Trending midpoint passes. Search at 100 conversations is 8–9 ms and flat.
- **Not a wave-6 regression.** The bounds predate W6a (W5d recipe), and the search note text is W6c's improved form.

---

## 6. Remaining Snapback-attributable friction, ranked (next-wave candidates)

Expected impacts are inference from the scorer's and grader's notes; nothing here is measured. "W6 regression?" asks whether the evidence suggests wave 6 introduced the problem.

| Rank | Friction | Smallest product change | W6 regression? | Expected impact |
|---|---|---|---|---|
| 1 | **Prefixed recipe installs public standalone mutations with unvalidated post references** (d-03, V1, V7) | With `--prefix`, emit `feedCreatePost`, `feedRepost`, `feedFollow`, `feedUnfollow`, `feedRegister`, `feedDeletePost` and `feedUnrepost` as `fn` helpers (or omit them). Generate `src/following.ts` without wrappers. Add one card line under "Wire into an app": delete or guard any remaining standalone operations. | **Yes (W6a):** removing `body` turned a public content post into a public reference to nothing | O2 +3–5 (the grader's "only integrity gap", trace §11); authorization +1 |
| 2 | **Presence grace permanently suppresses the push** for a recipient who just left (d-02, V2) | Defer a grace-only `connected` decision to the grace deadline using the effect's existing `nextAt`, and drop it at claim if the recipient reconnected. Card sentence on the up-to-35 s delay. | No (unchanged semantics; W5g only moved grace to the dev clock) | O2 +3–5; background_work +1; M6 suite order-independent |
| 3 | **Recipe residency: registration and delivery cost prediction; the private inbox syncs in full** (H1, V4) | Make `feedAuthors` `sync public` (a small, bounded, public table), or let the helpers treat an absent author as `shared: false` so `saveProfile`, `createPost` and `follow` stop reading an online-only table. Publish `test --residency` cold rows for a 500-follow reader on the card. | No (the W5d residency choice; W6a's card line "Call `register` during profile creation" invites the saveProfile fold) | writes_and_transactions +1; offline_sync +1; cold start (V4) quantified |
| 4 | **Exact Trending still needs a widened write-path table, now costing `like` prediction** (H3, V7; 0.2.21 H4, rank 5) | A system-owned write from a mutation that is not a client-authorized write: for example `system upsert rankedPosts[…]` with principal rules left at `deny`, predicted like a maintain side effect (card: "The online-only maintain is an engine side effect and does not cost source-write prediction", `guide-feeds.txt:640-641`). | No | authorization +1; writes_and_transactions/offline_sync +1; like predicts again |
| 5 | **No work meter reachable for a real account's read** (H8) | A dev-only opt-in meter on `Read` (for example `createClient({ meter: true })`, or a response field when `dev` receives `x-snapback-meter: 1`). Extend `snapback4 run --as` to take a principal id. | No | diagnostics_dev_loop +1–3 |
| 6 | **Global search across more than 50 memberships has no complete paved form** (H5) | Add a search-card section for "every chat I'm in" at 100–1,000 memberships, with measured examined counts and the device-held alternative. Have the note print that form instead of "bound lane discovery". | No (W6c improved the text only) | scale_and_limits +1–2 |
| 7 | **`dev --fresh` reads as "empty", means "in memory"** (H6) | Print `store: in memory — dies with this process` (or the SQLite path) in the dev banner, and add a `--memory` alias. | No | operations +0–1; saves about 10–25 min per affected run |
| 8 | **Recipe pull-cap promotion hazard and unmeasured bounds** (H2, V3) | Skip, or defer to a job, pull insertion for followers at their cap so promotion never refuses, and refuse with a named code (`FEED_PULL_CAP`) instead of a generic cap. Add a test with a saturated follower. | No (W5d recipe) | scale_and_limits +1; removes a latent availability bug |
| 9 | **Per-store service tokens surprise isolated proofs; no documented readiness route** (H7, d-05) | Make the mint output and services card name the owning store. Document the first stdout line or a `GET /health` as readiness. | No | operations +0–1; O2 (d-05 is app docs, but this removes the trap) |
| 10 | **Recurring low items:** fanout refusal for emit-only loops over a bounded list column (H4); "aggregates" alias (H10); attribution backfill and digest recipe (H11); follow timestamp absent from the recipe (H9); synthetic residency sites (V8); docs growth (V10) | Admit `for p in <[principal] <=N column>` when the body only emits. Alias `aggregates` → maintains. Allow maintain keys through an immutable reference and publish a multi-row digest recipe. Add `at: time` to the recipe's follows. Site rule probes at `file:line`. Keep the README as an index. | No | data_modeling +1; background_work +1; setup_and_docs +1; diagnostics +0–1 |
| — | **Not Snapback (instrument), for the record:** the O5 mid-curve predicate has no noise tolerance (§3, V6); the `repost-following-feed-surface` sample is vacuous (V5); native assertions are waived by the prompt but scored as fail (§3) | Instrument: an absolute or percentage tolerance on mid-curve lines; require card presence before `direct` predicates; align `not-run` versus `fail` for waived native checks | — | O5 75 on the same data; O2 +3 (d-04) |
