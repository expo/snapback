# Clique on snapback4@0.2.23 (Astra, medium effort): friction review against the 0.2.22 lane

**Short version.** Holistic score 88, down from 91 — but every graded dimension went
**up**: O1 75→80, O2 68→72, O4 40→50, O5 30→75 (`grading/grader-report.json`
`oDimensionScores`; L22 `grading/grader-report.json`). 104 of 119 assertions pass, **none
fails**, and every non-pass is `not-run` (trace §"Schema limitation", partition table).
The 88 is the builder scoring its own narrative, and that narrative got markedly more
candid: `final-report.md:62-64` now discloses broad synchronisation, unmeasured cold
acquisition, the recipe's finite caps, `N_WIDE_MERGE`, `N_NEVER_COMPLETE` and the
prediction losses — none of which appears in L22's equivalent section
(L22 `final-report.md:102-110`). **Inference:** a substantial part of the −3 is a
disclosure effect, not a capability loss. The builder logged 19 corrections:
14 agent-error, 4 environment, 1 ambiguous, **0 snapback4-defect**
(`final-report.md:55`), against L22's 13.

**Wave 7 closed the 0.2.22 top of the list, and the builder used every fix:**
- **W7a/W7R1b.** The prefixed install emits **no** client-callable recipe mutation:
  every former mutation in `snapback/feed.q` is an `fn` (`feed.q:118-235`), against
  L22's seven public `mutation`s (L22 `feed.q:110,134,148,160,167,185,192`). **L22's
  d-03 ghost-event path is closed**; the grader found no ghost and filed no such defect.
  `saveProfile` and `createPost` predict again through M6 (`m2-check-final.log:2`).
- **W7b.** The grace no longer swallows a push: `m8-doctor.txt` reports
  `effects 2 satisfied, 27 sent` — `satisfied` is W7b's `presence_reconnected` state
  (`JOURNAL.md:20423-20424`). The grader's deferred push arrived at **+23 s** instead of
  never (trace §Phase 1, m6 row). **L22's d-02 is closed.**
- **W7c.** The store banner prints (`scale-server.log:3`), the mint output names its
  owning store (`worker-token-issuance.log:2`), and `guide aggregates` resolves
  (`guide.txt`, aliases line). **L22 H6, H10, d-05 and rank 9 are all closed.**
- **W7d.** The search card grew from 79 to 222 lines with the "Search every chat I'm in"
  section and a measured envelope (`guide-search.txt:81-221`), and `N_WIDE_MERGE` now
  prints that form (`m5-check-2.log:7`). **L22 rank 6 is closed as documentation.**

**Three new problems.**
- **d-01, the only major: `chat.searchLocal` returns 0 rows at the envelope.** The app's
  "All messages" scope is bound to the card's *device-held* form executed on the server
  (`app/search.tsx:2`; `chat.q:255-256`). **Not a W7d regression** (§3.1): the mechanism
  is the `N_NEVER_COMPLETE` the compiler printed at M5 and every check after
  (`m5-check-2.log:2-4`), and the fixture makes it certain — every one of the 99,090
  fixture messages contains "coffee", and 44,100 of them are newer than u0500's newest
  readable row, so the 8,192-examined ceiling is spent before a readable row is reached.
- **d-05: the M6 suite's 20 s push budget is now shorter than the deferral.** This *is*
  W7b's new timing (§3.2), and it is the better failure: in 0.2.22 the same push never
  arrived at all.
- **A silent adoption failure poisoned 195 background operations.** `scale-server.log`
  records one line — `snapback4 dev: the new schema was not adopted: E_STORE: database is
  locked` — then 81 expiry sweeps, 81 jobs, 16 effect-lease, 16 action-lease and 1 asset
  sweep all failing `E_GENERATION: the store adopted another backend; reopen this engine`.
  Nobody noticed until a probe died (`scale-probes.log`). This is the whole of the
  operations drop (§3.5).

**One adoptability regression.** W7a added global metadata caps to the recipe
(`JOURNAL.md:19922-19924`); L22's recipe had none on `feedAuthors`
(L22 `feed.q:1-8`). The shipped `cap 1000` is **below the brief's own 1,008-profile
fixture**, so the builder had to patch the installed recipe before M2 could hold the
corpus (`feed.q:5` `cap 2000` against `evidence/recipe-baseline/snapback/feed.q:5`
`cap 1000`). **This is a wave-7 regression** (§3.3).

**The score drops.** queries −9 and scale −5 are the same story told twice: W7a's
residency flip tripled the recipe's cold acquisition by design, W7d's card invited a
device-held search whose server execution is never complete, and the builder wrote both
facts into `final-report.md`, where the scorer read them. operations −6 is the
`E_GENERATION` incident. None is an engine regression; two are direct consequences of
wave-7 design choices (§3.4, §3.5).

Lane: `/Users/ccheever/clique-sb4-20260916-astra-cal7/lanes/astra-snapback4/` (**L23**
below). The previous lane is **L22**
(`/Users/ccheever/clique-sb4-20260915-astra-cal6/lanes/astra-snapback4/`).
- **Paths.** Paths without a directory are under L23's `evidence/`.
- **Times.** Run start `1789520404` = 2026-09-16T01:00:04Z (`run-record.json`
  `timestamps.startedAt`) = 18:00:04 PDT. File times are modification times.
- **Release.** Wave 7 is LLP 3000.007 §20.16,
  `snapback-w4b/llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:3663-3690`,
  with journal entries W7a–W7R2 at `snapback-w4b/snapback4/JOURNAL.md:19900-21046`.
- **Package README.** `node_modules/snapback4/README.md` in L23: 158,710 B, 2,769 lines
  (L22: 148,490 B, 2,591 lines).
- **Run record.** `run-record.json` exists this time (L22's did not; L22 trace §0).
- **Grader.** family `claude`, `calibrationPassed:false`, `rerunsUsed:1`,
  `probeSetSha256: none-uncommitted`, so **O3 is null and O5 is an evidence-limited
  band** (trace §"Recorded deviations").

---

## 1. Friction in the 0.2.23 run

### 1a. Friction the builder hit that Snapback caused

H-numbers are this review's items. H/V numbers from FRICTION-0.2.22 appear as
"0.2.22 H2" and so on.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| H1 | **`follow`/`unfollow` still never predict; W7a moved the cause rather than removing it** | **Note, verbatim.** `m2-check.log:6`: "1 mutations never predict: follow (reads online-only table feedPullCounts); 1 mutation has insert arms that never predict: follow (feedPullCounts is online only) — snapback4 why <op>". Present unchanged in every later check (`m3-check.log`, `m4-check.log:6`, `m5-check-2.log:14`, `m6-check-2.log`, `m8-check-final.log:18`).<br>**What changed.** L22's cause was `feedAuthors` being `online only` (L22 `feed.q:8`), which cost `saveProfile`, `createPost`, `follow` and `repost` (0.2.22 H1). W7a made `feedAuthors` `sync public` (`feed.q:9`) and **restored `saveProfile` and `createPost`**; W7R1b then made pull routes reader-private again and introduced the online-only `feedPullCounts` (`feed.q:36-45`; `JOURNAL.md:20759-20768`), which keeps `follow`/`unfollow` queued.<br>**Card.** The boundary table says so explicitly: "`follow`, `unfollow` \| Queue without rows: online slot accounting is server state" (`guide-feeds.txt:436-441`).<br>**Builder.** No complaint. Diary M2 records the recipe's tradeoffs without naming prediction. | No loop; the card predicted it. Scorer writes_and_transactions: "online-only ranking dependencies restrict local prediction for posts and likes" — it charges the builder's ranking table, not `follow`. | **S14/S15 residual** (0.2.22 H1, reduced) |
| H2 | **The shipped recipe's new global caps are smaller than the brief's own fixture** | **Baseline.** `evidence/recipe-baseline/snapback/feed.q:5` is `cap 1000` on `feedAuthors` and `:19` is `cap 100000` on `feedFollows`.<br>**Patched.** `snapback/feed.q:5` is `cap 2000`, `:19` is `cap 200000`. `line-counts.json` records `snapback/feed.q` as 247 physical lines with **3 hand-authored**, "published recipe; only inserted/replaced physical lines counted".<br>**Fixture.** 1,008 profiles and 5,921 follow edges (`final-report.md:40`). `register` appears 1,000 times in `instrument/fixtures/scale.log` plus 8 starter personas.<br>**Builder.** Diary M2: "I adjusted its sample author-count cap for 1,008 fixture users". Run log 1789521302.<br>**Origin.** W7a introduced these caps: "global metadata caps of 1,000 authors, 60,000 source events, 100,000 edges and 32,000 pull routes" (`JOURNAL.md:19922-19924`). L22's `feedAuthors` had no table-wide cap at all (L22 `feed.q:1-8`). | Folded into the M2 card read (1789521302); no separate loop. But an unpatched install **refuses the 1,001st `register`** at the brief's own scale. | **New; wave-7 regression** (S14/S15) |
| H3 | **The recipe's 200-event backfill bound was removed by hand to cover the fixture** | **Baseline.** `evidence/recipe-baseline/snapback/feed.q` has `visited = 0` / `if visited = 200: break` inside `feedAddFollow`'s backfill loop.<br>**Patched.** Those three lines are deleted (`snapback/feed.q:160-162`), so a follow now backfills up to the 1,000-event schema cap.<br>**Card.** "Respect the recipe's 200-event backfill and caps" (`guide-feeds.txt:493`), and "A follow backfills 200 events, not an unlimited historical archive" (`:394`).<br>**Builder.** Run log 1789521302: "adapted 200-event recipe backfill to full capped author history". Diary M2 repeats it. | No loop; a 5× increase in per-follow write work that no measurement exercised. | **New** (S14/S15; recipe envelope) |
| H4 | **`E_QUARRY_TYPE`: the recipe's repost helper takes a `feedPosts` reference, the app has a `posts` id** | **Error, verbatim.** `m2-check.log:1-3`: "schema.q:129:16 — E_QUARRY_TYPE: feedRepost's postId is a feedPosts reference; got a posts reference / rewrite: pass a feedPosts reference for postId / guide: types".<br>**Fix.** The builder edited the *installed recipe*: `fn feedRepost(postId: feedPosts)` → `fn feedRepost(postId: id)` (diff against `evidence/recipe-baseline`), the third of its 3 hand-authored recipe lines.<br>**Card.** The wired example never calls `feedRepost`; it inlines `insert feedPosts {…}` + `feedDeliver(event)` (`guide-feeds.txt:584-592`), and the generated `src/following.ts:20-22` says the same. So the shipped helper's signature and the card's own seam disagree about which id domain an app passes. | m2-check.log 18:08 → m2-check-2.log 18:09, about 1 minute. Not logged as a correction loop. | **New** (low) |
| H5 | **`E_STRUCTURAL_FANOUT` on a derived recipient list, third run running** | **Error, verbatim, twice.** `m6-check.log:1-3` and `:5-7`: "chat.q:169:3 — E_STRUCTURAL_FANOUT: loop over recipients: members by byChatPrincipal (page bound 50): this list does not preserve one complete page / rewrite: iterate the original group: `for row in members[conversationId] first 50 by byChatPrincipal:`; put the condition and work inside that loop / guide: programs".<br>**Fix.** `chat.q:170-172` iterates `members[conversationId] first 50 by byChatPrincipal` directly.<br>**Builder.** Diary M6: "Structural fanout initially rejected iterating a filtered recipient list; using the membership group directly made the bound evident." Essay:13 credits it as "a different authoring habit". | m6-check.log 18:41 → m6-check-2.log 18:42, about 1 minute. Not in the correction ledger. | **S08** (0.2.22 H4, 0.2.19 G9 recurring) |
| H6 | **`N_NEVER_COMPLETE` on the card's own device-held search, carried M5→M8 and shipped as "All messages"** | **Note, verbatim.** `m5-check-2.log:2-4`: "note: chat.q:248:1 — N_NEVER_COMPLETE: query chat.searchLocal: the page over messages[..] by byAllWords is never `complete` — the read rule `exists members[.conversationId, viewer]` reads .conversationId, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\" / rewrite: merge messages matching q last 30 by byChatWords: [m.conversationId] for m in members[viewer] first 50 by byPrincipalChat — one verdict per scope and a complete page; or read the page on the device / guide: search". Still present at `m8-check-final.log:6-8`.<br>**Where it came from.** W7d's new card section heads and code-fences the held form (`guide-search.txt:108-117`, `:124-135`); its warning that server execution does not repair it is one prose sentence at `:134-135`.<br>**Built.** `chat.q:255-256`; `app/search.tsx:2` binds the All-messages scope to `api.chat.searchLocal`.<br>**Builder.** Diary M5: "The docs explicitly warned that an unscoped server search cannot claim completeness … The app uses the fully synced device index for its UI." Disclosed in `API.md` §Wire operations and `final-report.md:63`. | No loop. **The grader's only major defect** (d-01). Scorer queries_and_live: "Final-report.md documents N_WIDE_MERGE and N_NEVER_COMPLETE server-search limitations". | **S16/S17** (new; d-01) |
| H7 | **`N_WIDE_MERGE` on a 1,000-lane merge survived W7d's better text** | **Note, verbatim.** `m8-check-final.log:10-12`: "note: chat.q:257:1 — N_WIDE_MERGE: query chat.searchAll: the merge over messages reads up to 1000 lanes, one page of 31 each — up to 31000 rows per read; a read past the 8,192 examined ceiling returns `complete: false` / rewrite: `snapback4 guide search`, section \"Search every chat I'm in\": search held messages with one unscoped words index, or page memberships 50 at a time and exhaust each matching merge with its own result cursor before advancing the membership cursor; a result cursor alone does not continue undiscovered chats or a meter-cut merge. Measure with `snapback4 test --cost` / guide: search".<br>**Built.** `chat.q:257-259` keeps `first 1000 by byPrincipalChat`; the batched two-cursor walk was not adopted.<br>**Card.** The unbatched form is complete **only at 100 chats** (`guide-search.txt:203-208`); the probe user has exactly 100 (trace §Scale-envelope). It measured `complete: true` with a cursor (`gs-out/g-scale2.json`). | No loop. The advice is now actionable and was still not taken; the note text was the L22 ask. | **S16/S17** (0.2.22 H5 recurring, advice improved) |
| H8 | **A failed startup adoption is one stderr line, then 195 silent background failures and a client-visible `E_GENERATION`** | **Startup, verbatim.** `scale-server.log:7-8`: "snapback4 dev: the new schema was not adopted: E_STORE: database is locked" and "snapback4: the expiry sweep failed: E_STORE: database is locked". The server keeps serving.<br>**Aftermath.** The same file then records, by count: 81 × "snapback4: the expiry sweep failed: E_GENERATION: the store adopted another backend; reopen this engine", 81 × "snapback4: job failed: E_GENERATION…", 16 × "the effect lease sweep failed", 16 × "the action lease sweep failed", 1 × "the asset sweep failed".<br>**Surfaced.** `scale-probes.log`: `AssertionError … {"denied":{"code":"E_GENERATION","family":"generation","message":"E_GENERATION: the store adopted another backend; reopen this engine"}}`.<br>**Builder.** Run log 1789524198, `attribution=ambiguous`: "scale supplementary M8 adoption local job changed generation under live host; E_GENERATION asks reopen engine; restart owned PID=64878". Restart at 1789524242 (`scale-server-restart.log`). Essay:25: "I would want that operational boundary to be especially prominent in a production workflow." | 44 s of logged loop plus the discarded probe run. **Scorer operations:** "run-log.md's ambiguous E_GENERATION incident is not charged as a backend defect" — but operations fell 6. | **New** (operations; the whole −6) |
| H9 | **`N_MAINTAIN_SYNCED` on a maintain nothing reads, from M4 to M8** | **Note, verbatim.** `m4-check.log:2-4`: "note: chat.q:203:1 — N_MAINTAIN_SYNCED: maintain reactionCounts: sync to members[.conversationId] inherited from reactions; one value row per conversationId, messageId, emoji reaches every member of the group; **no currently eligible mutation reads it**; current store measurement: 0 value rows (before adoption; cold rows per viewer: `snapback4 test --residency`) / rewrite: keep inherited sync for local readers, or add `online only` to opt out". Unchanged at `m8-check-final.log:14-16` with "1 value rows".<br>**Not wave 7.** `N_MAINTAIN_SYNCED` is in the 0.2.22 README too (1 occurrence in each lane's `node_modules/snapback4/README.md`). L22 declared no maintain over `reactions`.<br>**Unresolvable as printed.** The note's own measurement is "0 value rows … before adoption", so it gives the author no number to decide on, and its `test --residency` pointer was never run (no residency output in `evidence/`). | No loop. One of the 4 surviving notes (`m8-check-final.log:1`), up from L22's 2. | **New** (low) |
| H10 | **`N_NO_HORIZON` on `likes` appears only once a maintain is added** | **Note, verbatim.** `m8-check-final.log:2-4`: "note: schema.q:51:1 — N_NO_HORIZON: table likes: `sync public` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start / rewrite: sync public last 500 by byPostPrincipal / guide: sync".<br>**Timing.** `likes` has been `sync public` since M2 (`schema.q:51-62`) and got no note through `m6-check-2.log`. It fires only after `insights.q:4-6` adds `maintain likedCounts: count likes by authorId`. **Inference:** the whole-partition suppression lifts when a second reader of the table appears — the same class as L22's M2→M3 disappearance, in reverse.<br>**Not acted on.** `schema.q:62` is still unbounded `sync public` in the shipped app. | Seconds; no loop. Feeds the scale narrative (§3.4). | **S16** (0.2.22 V1 neighbourhood) |
| H11 | **Attribution column with a backfill, and a digest that sweeps all message history** | **Attribution.** `posts.parentAuthorId` (`schema.q:36`) is written at insert (`:112`) and backfilled by `insights.q` `job backfill()` — `m8-backfill.log`: `"rowsWritten": 206, "chunks": 2`.<br>**Digest.** `digest.q:31` is `chunk m in messages[at >= periodStart, at < periodEnd] first 100 by byAt` — this run bounds the sweep by period, unlike L22's unbounded `chunk msg in messages first 10 by byId`. `digest.q:36` is still `chunk p in profiles first 1 by byId`, one profile per chunk.<br>**Scorer.** background_work rose 92 from 94's L22 note; the "full-history digest sweeping" charge is **gone**. | Proactive design, no loop. | **S24, S26** (0.2.22 H11; the sweep half is now fixed by the builder) |
| H12 | **Exact Trending still needs a widened write-path table, and now costs `createPost` prediction as well as `like`** | **Card.** `guide-feeds.txt:711-812`: the scheduled recipe's "**Exactness limit:** scores and new candidates lag by one schedule period" (`:795`), with `trendingNow()` as the live alternative (`:784`, `:812`).<br>**Built.** `insights.q:26-39`: `table trendingRanks` with `insert <- allow` and `update <- allow` (`:36-37`), `expire at .expiresAt`, `online only`; `query trending` at `:40-41`. `like` writes it (`schema.q:126-128`) and `createPost` inserts into it (`schema.q:116`).<br>**Result, verbatim.** `m8-check-final.log:18`: "4 mutations never predict: chat.createDM (reads online-only table dmPairs), **createPost (writes online-only table trendingRanks)**, follow (reads online-only table feedPullCounts), **like (reads online-only table trendingRanks)**".<br>**Net effect.** W7a restored `createPost` prediction at M2 (`m2-check-final.log:2` lists only `follow`); the builder's M8 ranking table gave it back.<br>**Builder.** Diary M8: "Current ranking needed an application-owned expiring table; the scheduled recipe's lag would not satisfy immediate refresh. That choice made likes queue without predicted rows". Essay:19. | Design only; no loop. Scorer writes/offline notes name it. | **S25** (0.2.22 H3, 0.2.21 H4 — third recurrence) |

Two smaller Snapback-shaped moments were logged as authoring errors:
- **`once` is a column modifier.** `m5-check.log:1-6`, twice: "chat.q:153:157 —
  E_QUARRY_SYNTAX: once is a column modifier, not an argument constraint; declare it on
  the owning table column / rewrite: oncePhoto: image <=10000000 ? — check --fix applies
  it". `check --fix` applied both mechanically (`m5-check-fix.log:1-2`). Run log
  1789522223. A clean loop, ~seconds.
- **Config ingestion.** Diary M5: "The main missing convenience was configuration-file
  ingestion by Quarry; a small generator reads the JSON windows and emits constants"
  (`scripts/configure.mjs` → `snapback/config.q`). Run log 1789524242 adds "digest config
  compiler requires m/h/d schedule units".

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| V1 | **W7c's read meter shipped, the builder read its card, and still measured `null` ten times** | **Card.** `guide-reads.txt:1-15` opens with the meter: "use the online client `createClient({ url, session, meter: true })` … Successful `query` and `observe` answers include `Read.meter`", and "`snapback4 run <op> '<json args>' --as <principal id> --json` also prints the engine's `metered` counters". Saved at 18:12 (M2).<br>**Used.** `scripts/scale-probes.mjs:2` builds `createClient({url, session})` with **no** `meter` option, then records `meter: read.meter ?? read.stats ?? null`. Every one of the 10 rows in `scale-probes.json` has `"meter": null`.<br>**`run --as` never used.** No `--as` appears in `scripts/`, `src/` or `app/`. `evidence/help-run.txt` is **0 bytes**, created 18:56 — **inference:** a lookup for `run` produced nothing on stdout.<br>**Silent.** Omitting `meter: true` produces an absent field, not a hint. | **New** (0.2.22 H8 shipped but unconsumed) |
| V2 | **The builder's own scale probes report `complete: false` on Trending and never flag it** | `scale-probes.json` rows 3, 6 and 10: `insights.trending` at 10 items, `"complete": false`, `"hasNext": false`, for all three personas. The grader independently filed the same thing as **d-03** and proved the ranking correct (trace §d-03). Nothing in `diary.md`, `essay.md` or `final-report.md` mentions it. | **New** (d-03) |
| V3 | **The 8,192 ceiling turns a correct query into an empty one with no signal a client can use** | At the envelope `chat.searchLocal` returns `rows 0, complete false, next null` (`gs-out/g-scale2.json`). The search card records the operator-side names for exactly this — "operator results name it in `word_cut_at`, separately from a meter cut in `capped_at`" (`guide-search.txt:74-75`) — but `Read` carries neither. `API.md` §Wire operations tells clients only "`complete:false` signals an incomplete answer, not a complete empty result", which is unactionable without a cursor. | **New** (d-01's product residue) |
| V4 | **The push worker logs 201 identical failures with no diagnosis** | `worker-errors.log` is 201 lines, every one `TypeError: fetch failed`, against `evidence/worker.log` at 0 bytes. The worker keeps running and retrying against a stopped backend. Nothing names the URL, the effect, or the backend state. | **New** (low; effects/worker ergonomics) |
| V5 | **The `repost-following-feed-surface` transient recurred in both runs and was not filed** | **Builder.** `m2-choreo-1789521306931.jsonl.observations.jsonl`: attempt 1 `durationMs 228.6, pass:false`; attempts 2 and 3 `1378.1` / `1074.7`, both pass. The earlier receipt `m2-choreo-1789521275923.jsonl` passed all three at 914.1 / 1042.8 / 911.8 ms.<br>**Grader.** trace §Choreography: "`m2 repost-following-feed-surface` (attempt 2 failed, 1 and 3 passed)".<br>**Same fast-fail signature as L22 V5** (failures 205–517 ms, passes 1,599–9,094 ms). This grader did **not** file it as a defect; L22's grader filed it as d-04. | **Instrument** (0.2.22 V5 recurring) |
| V6 | **Synthetic residency sites persist, at a lower rate** | 68 of 287 site entries in `snapback/generated/residency.json` carry no `file:line`, e.g. "update conversations rule" ×12, "insert members rule" ×10, "after insert" ×8. L22 was 104/340 (30.6%); this is 23.7%. No `why` output was captured this run. | **S08 residual** (0.2.22 V8 recurring) |
| V7 | **Widened rules survive, but are now unreachable from a client** | `feedAuthors update <- allow` (`feed.q:8`), `feedPulls insert <- allow` (`feed.q:32`), `feedPullCounts insert/update <- allow` (`feed.q:42-43`), and the builder's `trendingRanks insert/update <- allow` (`insights.q:30-31`). **W7a removed the exposure**: every recipe writer is an `fn`, so no client-callable path reaches the recipe's widened rules. `trendingRanks` is still reachable only through `like`/`createPost`, which validate. | **S25/M2 residual, de-fanged** (0.2.22 V7) |
| V8 | **Cold acquisition is disclosed and still unmeasured** | `final-report.md:62`: "Full cold acquisition at the scale envelope is not measured here and can be expensive." The card publishes the number for its own fixture — 3,095 rows / 335,403 B for a 500-follow reader, "1,055 rows before the prediction change" (`guide-feeds.txt:406-432`) — and the larger recipe envelope at 77,665 rows (`:447-455`). No `test --residency` run appears in `evidence/`. **Inference:** W7a's residency flip is the dominant new term, and nobody in this lane measured it on this app. | **S16** (0.2.22 V4 recurring, now quantified upstream) |
| V9 | **Docs keep growing, faster than L22** | Package README 158,710 B / 2,769 lines against L22's 148,490 B / 2,591 lines (**+6.9%**). Feeds card 820 lines against 669 (**+22.6%**). Search card **222 lines against 79 (+181%)**. Installed recipe 247 lines against 208 (+18.8%). Diary M1: "The README was unusually comprehensive, although long enough to dominate initial orientation." Yet setup_and_docs rose 90→92. | **G12** (0.2.22 V10 recurring) |
| V10 | **The unread count is an ordinal difference, disclosed as approximate** | `final-report.md:65`: "Chat-list unread indication uses the authoritative ordinal minus the account read ordinal. It can count intervening own/tombstoned/expired ordinals until the conversation is opened". `chat.q:174-178` is the `acknowledge` mutation. The app has no maintained live-unread count. **Inference:** a `maintain` over live incoming messages would need a per-reader grouping the language does not offer cheaply here (`guide-search.txt:210-220` makes the analogous copy-cost argument for search). | **New** (low; app design with a Snapback shape) |

### 1c. Friction that was not Snapback's

- **Environment** (4 logged, `final-report.md:55`):
  - The copied harness was read-only and needed `chmod` (run log 1789520543,
    `npm-choreography.log`).
  - The harness snapshot lacked `../../lib/json-schema.mjs`; the builder supplied an AJV
    wrapper in `tools/lib/json-schema.mjs` (1789520804).
  - PATH's default Node was 25.9.0 against a declared 24.18.0 (`run-record.json`
    `harness.environment.nodeDefaultObserved`; visible in `scale-probes.log`'s trailer).
  - Metro died after a directory-to-symlink relocation (1789520841).
  - `git status` reports no repository, so no commit or PR (1789524644;
    `final-report.md:69`).
- **Instrument:**
  - **No holdout probe set was committed** (`instrument/grader/probes/rotation-log.md` has
    no rows), so phase 4 was skipped, **O3 is null**, and **O5 lands on its final branch
    at 75 by construction** (trace §Phase 4, §O5). This is the whole of O5's 30→75 move;
    nothing about the lane changed it.
  - The grader is uncalibrated (`calibrationPassed: false`), so this is not a
    claim-eligible wave (trace §"Recorded deviations" 2).
  - M7 is not run by instruction (`README.md`, "M7 is deliberately absent"), costing 9
    assertions in O1's denominator.
  - Simulator proofs are recorded `not-recorded` in both segment summaries, costing 6
    assertions and capping O4 at 50 (trace §m6-simulator, §O4).
  - The `repost-following-feed-surface` race is V5.
  - The grader's own M3 failure was its skipped seed step, and it says so (trace §Phase 1,
    m3 row).
- **The builder's own errors** (14, `final-report.md:57`):
  duplicate hidden Router screens; missing cross-screen feed navigation; concurrent
  acceptance burying a choreography reference post; a lazy web device import that broke an
  offline navigation path (1789521659); a media draft-clearing race (1789521928); a seed
  ledger that retained fixture credentials, replaced with SHA-256 action keys (1789522269);
  a platform-dependent video poster (1789522321); a wrong fixture filename
  `clip-01.mp4` (`m6-acceptance.log`, 1789523552); JSX/typecheck errors (1789524242); a
  cold-web test racing the login screen (1789524242); identity artifacts hashing package
  metadata instead of registry tarballs (1789524273); a wrong workdir-relative scale copy
  (1789524644); plus half-shares of H4, H5 and H9.
- **App defects the grader found:** d-03 (Trending completeness is the app's query shape,
  §4), d-04 (`scripts/verify-digest.mjs:2` hard-codes `livePid=20671`), d-05's suite
  budget (`scripts/acceptance-m6.mjs:4`, `for(let i=0;i<80;i++)` × 250 ms), d-06 (raw
  constraint text surfaced as the duplicate-handle error).

---

## 2. The 0.2.22 items: recurred, closed, changed, or unexercised

### Explicit checks

- **`init --recipe feeds --prefix`: installed, wired, and now genuinely closed.**
  - **Timing.** `m2-recipe.log:1` — "init: wrote 2 files in . — Following recipe — next:
    `snapback4 check`, then `snapback4 dev`" — at 18:08, one minute into M2 (run log
    1789520880). The feeds card was saved in the same minute.
  - **The prefix is real.** Every former standalone mutation is an `fn`: `feedRegister`
    (`feed.q:125`), `feedTryPull` (`:129`), `feedAddFollow` (`:145`), `feedFollow`
    (`:166`), `feedDropFollow` (`:169`), `feedUnfollow` (`:185`), `feedDeliver` (`:188`),
    `feedCreatePost` (`:199`), `feedRepost` (`:206`), `feedRemoveEvent` (`:216`),
    `feedDeletePost` (`:224`), `feedUnrepost` (`:231`). Only `query feedFollowing`
    (`:237`) and `job feedPurgeRemoved` (`:242`) remain. L22 had **seven public
    mutations** at the same sites.
  - **Generated wrapper.** `src/following.ts` exports exactly one thing — `followingPage`
    — and 0 hand-authored lines (`line-counts.json`). L22's exported three mutation
    wrappers.
  - **Wiring.** `saveProfile` calls `feedRegister()` (`schema.q:27`); `createPost` calls
    `feedRegister()` + `feedCreatePost(p.id)` (`:114-115`); `repost` calls `feedRegister()`
    + `feedRepost/feedUnrepost` (`:134-137`); `follow` bridges
    `feedAddFollow`/`feedDropFollow` (`:98-101`); Following is the card's merge joined to
    `postCard` (`:82-86`); Global still reads `feedPosts` by time (`:80-81`).
  - **Recipe patched** three times: two caps (H2) and the backfill bound (H3), plus the
    repost signature (H4) — four changed lines, three counted.
- **The search card's paved forms: one adopted, one declined, one invented.**
  - **Read.** `guide-search.txt` saved at 18:27 (run log 1789522223), 222 lines including
    the whole W7d section.
  - **`searchHeld` (device holdings) — adopted, and then served from the server.**
    `chat.q:255-256` is the card's `searchHeld` shape verbatim
    (`guide-search.txt:108-109`), and `app/search.tsx:2` binds it. The card's own warning
    at `:134-135` — "Online, use the scoped server walk for complete history; calling
    `searchHeld` on the server does not repair its completeness class" — was not followed.
    This is d-01.
  - **`searchChats` + `searchChatBatch` (the two-cursor server walk) — not adopted.** No
    membership-discovery query exists in `chat.q`; `searchAll` is the older unbatched
    merge at `first 1000` (`:257-259`).
  - **`inRoom` — adopted.** `chat.searchChat` (`chat.q:253-254`) is the scoped form and
    compiles note-free.
- **The dev read meter (W7c): documented, read, never enabled.** See V1. Every probe row
  is `"meter": null`.
- **`run --as` (W7c): never used.** No occurrence in the lane's own code;
  `evidence/help-run.txt` is 0 bytes.
- **`mutate(op, args, { id })` (W6d): used everywhere, and in more places than L22.**
  `scripts/seed.mjs:9`, `scripts/replay.mjs:9`, `scripts/verify-digest.mjs:3`,
  `scripts/custom-client-demo.mjs:3`, `scripts/verify-cold-web.mjs:2`,
  `scripts/acceptance-m{2,3,4,5,6,8}.mjs`, and the **app itself** —
  `src/chats.tsx:17,19,25` pass `{id: mintId()}` on react, delete, send and edit. There is
  no intent ledger. `API.md` documents the protocol: "Use a fresh `mintId()` … retain it
  for retries … A duplicate returns `{state:"sent",id,seq,replayed:true}`".
- **The store banner (W7c): printed, in every server this lane started.**
  `scale-server.log:3`, `scale-server-restart.log:3` and `digest-server.log:3` each carry
  `store: …/.snapback4/store.sqlite`. The builder never ran `--fresh`/`--memory` — its
  scale instance is a persistent `scale-server/` directory (run log 1789523571) — so the
  `store: in memory — dies with this process` half is **unexercised**, but the ambiguity
  that cost L22 a 631 s replay cannot arise: the path is on screen.
- **The service-token store line (W7c): printed and consumed.**
  `worker-token-issuance.log:1-2`, verbatim: "token: a session for service:worker until
  1821058875401 — printed once; keep it where the worker keeps secrets" / "store:
  …/.snapback4/store.sqlite — **this token belongs only to this store; each isolated
  store needs its own**". The README documents the mint step the L22 lane omitted:
  "issue a service token with `npx snapback4 token --service push-worker >
  .snapback4/worker-token`". **L22 d-05 is closed.**
- **`aggregates` (W7c): resolved.** `guide.txt` aliases line includes
  `aggregates -> maintains`. L22's `guide aggregates` "reported no card named aggregates".
- **The grace deferral (W7b): live and observable.** `m8-doctor.txt` reports
  `effects 2 satisfied, 27 sent`. `satisfied` is W7b's cancellation state
  (`JOURNAL.md:20423-20424`); `sent` is ordinary delivery. The builder's own M6 pushes
  were immediate (0.26 s apart at 1789523484, `push.jsonl`) because its recipient had no
  recent client; the grader's back-to-back sequence hit the deferral (d-05).
- **Trending guidance: read and declined again.** `guide-feeds.txt:711-812` (saved at
  18:08 and again at 19:02 as `guide-feeds-m8.txt`, byte-identical); `guide-maintain.txt`
  saved at 18:51. Built the write-path table instead (H12).
- **Password (W6b): visible, unprobed.** `schema.q:1` is `use identity password`;
  `API.md` §Authentication says "at least eight characters are required". The grader
  probed it: 16 characters accepted, 6 refused `E_AUTH`; store holds **argon2id** at
  `v=19, m=19456, t=2, p=1` (trace §m1-source, m1-a12). No multi-byte probe by either party.

### Item by item

| Item | 0.2.22 (L22) | 0.2.23 (L23) | Verdict |
|---|---|---|---|
| H1 recipe wiring costs prediction on 4 mutations | `saveProfile`, `createPost`, `follow`, `repost` all queue | Only `follow`/`unfollow` queue, on `feedPullCounts` (`m2-check.log:6`) | **Mostly closed** (W7a/W7R1b); the residue is documented (H1) |
| H2 recipe bounds as an unmeasured scale risk | 32-pull / 200-event / 1,000-follow, unexercised | Same bounds, **plus** new global caps too small for the fixture (H2) and a backfill bound the builder deleted (H3) | **Recurred and widened** (wave-7 regression) |
| H3 Exact Trending hand-built; `like` never predicts | `rankedPosts`, `online only`, like queues | `trendingRanks`, same shape; **`createPost` now queues too** (`m8-check-final.log:18`) | **Recurred, worse** (H12) |
| H4 `E_STRUCTURAL_FANOUT` on a derived recipient list | ~13 s loop | Same error verbatim, same fix (`m6-check.log:1-3`) | **Recurred** (H5) |
| H5 1,000-lane `N_WIDE_MERGE` with unfollowable advice | advice was "bound lane discovery" | Advice now names the card section (`m8-check-final.log:11`); the note remains | **Advice closed, note recurred** (H7) |
| H6 `dev --fresh` reads as "empty", means "in memory" | 631 s replay repeated | Banner prints the store path every time (`scale-server.log:3`); `--memory` alias exists (README:2227-2228); no loop | **Closed** (W7c); in-memory half unexercised |
| H7 isolated proof store has no service token | ENOENT on `.snapback4/audit-token` | Mint step in `README.md`; mint output names its store (`worker-token-issuance.log:2`) | **Closed** (W7c), exercised |
| H8 no work meter on the SDK `Read` | complaint in run log + report | `Read.meter` ships, card leads with it (`guide-reads.txt:1-15`), builder never opted in (V1); **no complaint this run**, diagnostics +2 | **Closed in product, unconsumed** |
| H9 recipe follow edge has no timestamp | builder patched in `at` | Shipped: `feedFollows.at: time default 0` (`feed.q:14`), `at: now` on insert (`:152`) | **Closed** (W7a) |
| H10 guide keyword miss (`aggregates`) | "no card named aggregates" | `aggregates -> maintains` in `guide.txt` | **Closed** (W7c) |
| H11 attribution backfill + full-history digest sweep | 140-row backfill; unbounded message sweep | 206-row backfill (`m8-backfill.log`); digest sweep now **period-bounded** (`digest.q:31`) | **Half closed by the builder**; background_work charge gone |
| V1 prefixed install keeps public standalone mutations (d-03) | `feed.q:110-196`, 7 public mutations; ghost events | All `fn`; `src/following.ts` has no wrappers; no ghost defect filed | **Closed** (W7a), exercised |
| V2 the 35 s grace suppresses push permanently (d-02) | +10 s message never queued | Deferred and delivered at +23 s (trace §Phase 1); `2 satisfied` in `m8-doctor.txt` | **Closed** (W7b), exercised — and it created d-05 |
| V3 pull-cap promotion hazard | inference from code; 51st follow could refuse | `feedTryPull` returns `false` at 32 and promotion **skips** rather than refusing (`feed.q:137-138`, `:158-159`); `FEED_PULL_CAP` for a new follow (`:151`) | **Closed** (W7a), unexercised at the fixture's scale |
| V4 browser cold start grows with the corpus | 1,910/8,467/14,821 ms | No cold-start curve captured this run; `cold-web-verification.json` records pass/fail only | **Unexercised**; the underlying cost grew (V8) |
| V5 repost transient | 205–517 ms fast-fail | Same signature, builder and grader (`m2-choreo-…observations.jsonl`, 228.6 ms) | **Recurred**, not filed this time |
| V6 the O5 mid-curve miss was a checkpoint effect | 50% p95 above the line twice | No degradation rule fired: 0.93× / 1.16× / 1.10× against 3× (trace §Scale-envelope) | **Not reproduced** — and the predicate itself did not run (no probe set) |
| V7 widened recipe rules | reachable through public operations | Same rules, no client-callable path (V7 above) | **Changed** — rules unchanged, exposure gone |
| V8 synthetic residency sites | 104/340 | 68/287 | **Recurred, milder** (V6) |
| V9 digest counts recipe events, not posts | `count feedPosts by actorId` | `periodPosts: count posts where .parentId = null by authorId, bucket(…)` (`digest.q:5`) — counts **app posts** | **Closed** (builder redesign; V1's amplifier is gone) |
| V10 docs growth | README +4.4% | README +6.9%, search card +181% | **Recurred, faster** (V9) |
| d-01 major: unbound `Linking.openURL` | filed major, −10 on O2 | **Same code shipped** (`src/profile.tsx:20`, `onPressLink={Linking.openURL}`), same byte-identical `ui/` kit (`diff -rq` returns nothing) — and this grader **tested it and passed it**: "I instrumented `window.open` and clicked it: `window.open(\"https://example.com/grader-open\")` fired. **pass**" (trace §m2, m2-a12) | **L22's d-01 does not reproduce.** The kit's own comment names this exact binding as the intended usage (`ui/src/linkify.tsx:4`). **Inference:** L22's major was a false positive |
| d-02 minor: grace swallows push | Snapback semantics | Closed by W7b (above) | **Closed** |
| d-03 minor: ghost feed events (W6a regression) | `feed.feedCreatePost` accepted any id | `E_OP: unknown operation feed.feedCreatePost` is now the shipped behaviour (`JOURNAL.md:20371`); no ghost defect | **Closed** (W7a) |
| d-04 minor: Following misprojection | harness transient | Recurred as V5; not filed | **Recurred, unfiled** |
| d-05 minor: audit-token mint step missing | lane README omitted it | `README.md` gives `npx snapback4 token --service push-worker > .snapback4/worker-token` | **Closed** (app docs + W7c nudge) |
| d-06 cosmetic: empty posts and messages accepted | `text <=500` / `<=2000` | `chat.send` is now `text 1..2000` (`chat.q:183`); `createPost` is still `body: text <=500` (`schema.q:103`) and `sendMedia` `text <=500` (`chat.q:185`) | **Half closed**; not refiled |

---

## 3. Wave-7 regression analysis

### 3.1 d-01 (major): is `chat.searchLocal`'s empty page a W7d regression?

**No. It is the builder's query shape, executed where the card says not to execute it,
against a fixture that guarantees a meter cut. W7d's engine change is not on this path.**

**The query, verbatim** (`chat.q:255-256`):

```quarry
query searchLocal(q: text <=100, c: cursor ?):
  return messages matching q after c last 30 by byAllWords where not .tombstone { *, conversation: conversations[.conversationId] }
```

**The schema it reads** (`chat.q:49-74`): `by byAllWords: words(text), at, id` — unscoped
— under `read <- exists members[.conversationId, viewer]`.

**The measurement** (`gs-out/g-scale2.json`, grader's private clone of the replay store on
port 49365, u0500):

```
chat.searchLocal  q="coffee"  ->  rows 0,  complete false, next null,      p95 33.261 ms
chat.searchAll    q="coffee"  ->  rows 30, complete true,  next <cursor>,  p95  2.880 ms
chat.searchChat   (g0001)     ->  rows 30, complete true,                  p95  2.464 ms
```

**The `N_` note, verbatim and repeated from M5 to M8** (`m8-check-final.log:6-8`):

> note: chat.q:255:1 — N_NEVER_COMPLETE: query chat.searchLocal: the page over
> messages[..] by byAllWords is never `complete` — the read rule
> `exists members[.conversationId, viewer]` reads .conversationId, which the scan does not
> pin, so the server cannot tell "no more" from "more you may not read"
> rewrite: merge messages matching q last 30 by byChatWords: [m.conversationId] for m in
> members[viewer] first 50 by byPrincipalChat — one verdict per scope and a complete page;
> **or read the page on the device**

**Why zero rows and not a partial page — computed from the fixture.**
- Every message in the corpus matches the term: 99,090 of 99,090 `send` actions in
  `instrument/fixtures/scale.log` contain "coffee" (`awk '$3=="send"' … | grep -c -i
  coffee`). So `matching 'coffee'` selects essentially the whole 100,015-message corpus.
- u0500's 100 conversations are exactly `g0001`…`g0100` (100 unique conversation ids
  across its `member-add`/`group-create` lines, first `g0001`, last `g0100`).
- The scan is newest-first. The newest send in **any** `g00xx` group is send-position
  **54,990 of 99,090**; the newest 8,192+ sends are all `d08xx`/`d09xx` DMs (histogram of
  the last 8,192 send lines: 49 each in `d0900`, `d0899`, `d0898`, … — no `g00xx` row).
- **Therefore 44,100 unreadable matching rows sit ahead of u0500's first readable one.**
  The 8,192-examined ceiling is spent roughly 5× before reaching a readable row, and the
  card states that outcome plainly: "hidden rows there still spend the query-wide
  examined/index-entry budget" (`guide-search.txt:72-73`).

**Why W7d is not the cause.**
- W7d's engine change is **cursor validation**: "an eager word lane validated its shared
  merge token as a direct cursor scoped to one word, rejecting page two with `E_INPUT` …
  The minimal core change passes no direct-prefix scope while validating a generated word
  lane" (`JOURNAL.md:20154-20161`). The failing call passes **no cursor**
  (`gs/g-scale2.mjs`: `u0500.query(api.chat.searchLocal, {q:'coffee'})`) and receives
  `next: null`, so no cursor is ever validated.
- W7d changed no meter: "No diagnostic code was added; **no meter ceiling**, value
  serialization or existing corpus case changed" (`JOURNAL.md:20205-20206`). The card
  calls the 8,192 ceiling "unchanged" (`guide-search.txt:206`).
- `bounds` with a word present and no prefix is the *unscoped index the schema declares*
  (`by byAllWords: words(text), at, id`), which the builder wrote and the compiler named.

**Was the card's recommended form used?** Partly, and that is the interesting part.
W7d's new section offers two forms. The builder took the **device** form
(`guide-search.txt:108-109` `searchHeld`) and served it from the server; it did **not**
take the **server batch** walk (`:111-117`). The card's warning against exactly this is
one unheaded prose sentence — "Online, use the scoped server walk for complete history;
calling `searchHeld` on the server does not repair its completeness class"
(`:134-135`) — while the recommendation is a headed, code-fenced block. **Inference:** the
W7d card raised the odds of this shape being written, even though it did not cause the
behaviour.

**Verdict:** builder query shape (primary) + fixture pathology (proximate) + a documented
meter cut (mechanism). **Not a W7d regression.** Snapback's residue is that a correct
refusal is delivered as an empty success (V3): the app renders "no results" and hides
"More results" because `hasMore` is false (`app/search.tsx:2`).

### 3.2 d-05: is the 20 s push timeout W7b's deferral?

**Yes. The delay is W7b's, and it replaced a worse behaviour.**

**The brief's requirement**, quoted through the grader: "with no open client for the
recipient, payloads carried the correct `targetUserId`, `chatId` and `senderDisplayName`"
(trace §m6, m6-a08/a09), and the acceptance case is a message sent while the recipient's
clients are closed.

**The run evidence** (trace §Phase 1, m6 row): "First attempt raised `push missing` after
its 20 s poll. `evidence/push.jsonl` then recorded the exact expected payload at **+23 s**
— the recipient still held a presence grace from the immediately preceding suite. After a
45 s idle gap the suite passed 4/4." With the grace lapsed, "Latency 3–6 ms" (trace §m6).

**The suite's budget** (`scripts/acceptance-m6.mjs:4`): `for(let i=0;i<80;i++){ … await
new Promise(r=>setTimeout(r,250)) }` = **20,000 ms**, against W7b's "up to 35 s" deadline.

**The mechanism is W7b's, verbatim:** "For a mutation whose presence values reach only
effects, grace alone now means a deferred absence decision, with the effect's existing
`next_at` at the grace deadline" (`JOURNAL.md:20412-20414`). Its live counterpart is
visible in this lane: `m8-doctor.txt` reports `effects 2 satisfied, 27 sent`, and
`satisfied` is the `presence_reconnected` cancellation (`JOURNAL.md:20423-20424`).

**What it replaced.** In 0.2.22 the same message produced **no push at all** — L22's d-02,
"push previews queued for b: [\"b disconnected 45s\",\"third\",\"second\",\"first\"]", the
+10 s message absent. W7b turned a silent product defect into a visible timing one. The
grader agrees: "The product behaviour is correct — the suite's budget is the problem"
(trace §d-05).

**The smallest product change.** Not a shorter deferral, and not immediate delivery on
last-disconnect:
- *A shorter push-specific deferral* re-opens L22's d-02 for any recipient who leaves and
  stays gone within the shortened window, and splits presence semantics by effect kind.
- *Immediate delivery when the last client disconnects* is what W7R1a specifically proved
  cannot be done from process-local state: "neither a process-local last-seen time nor a
  claim-time check alone can remember a reconnect that has already ended"
  (`JOURNAL.md:20461-20463`). Delivering at disconnect also pushes to someone who
  reconnects one second later — the exact behaviour the grace exists to prevent.
- **The right change is to make the deferral inspectable and testable.** Two lines:
  1. Report the pending deadline where the author already looks. `doctor` prints
     `effects 2 satisfied, 27 sent`; add `N deferred (next at +Ns)`. Today a deferred push
     is invisible between emit and claim.
  2. Give tests a way to close the window deterministically: the dev clock already moves
     the deadline (`JOURNAL.md:20429-20431`, "Development deadlines follow the dev clock"),
     so document `POST /dev/clock/advance` **in the effects card as the way to test a
     grace-deferred push**, next to the sentence that introduces the deferral. The builder
     already uses `/dev/clock/advance` elsewhere (`scripts/verify-digest.mjs`,
     `scripts/acceptance-m8.mjs`) and did not connect it to pushes.

  A third, cheaper option: have the presence card state the 35 s number *as a test
  budget* — "a suite that polls for a grace-decided push must wait longer than 35 s".
  L23's own `API.md` does not mention the deferral at all.

### 3.3 The recipe's global caps: a wave-7 adoptability regression

**Yes, wave 7 caused this.** W7a's residency flip required global metadata caps to bound
what every device now acquires: "with global metadata caps of 1,000 authors, 60,000 source
events, 100,000 edges and 32,000 pull routes" (`JOURNAL.md:19922-19924`). L22's
`feedAuthors` was `online only` with no table-wide cap (L22 `feed.q:1-8`), so the question
never arose.

The brief's fixture has **1,008 profiles** (`final-report.md:40`). `cap 1000` on
`feedAuthors` refuses the 1,001st `feedRegister()`. The builder raised it to 2,000
(`feed.q:5`) and also doubled the edge cap to 200,000 (`:19`) before M2 would hold the
corpus. This is the single clearest "paved form does not fit the brief it was paved for"
finding in the run, and it cost a recipe patch that `check` cannot detect for you — the
refusal only appears at row 1,001, in a replay, half an hour later.

**Smallest product change:** make the global caps a documented install-time choice rather
than a literal — e.g. `init --recipe feeds --prefix feed --authors 100000`, or state the
caps in the `init` stdout line so an author sizing a corpus sees them at install. The
`init` line today is a single sentence with no numbers (`m2-recipe.log:1`).

### 3.4 queries −9 and scale −5: wave-7 choices or the builder's design?

**Both, in a specific split. Roughly two-thirds traces to wave-7 choices, expressed
through the builder's disclosure; one-third is the builder's own design.**

**queries_and_live 91 → 82.** Scorer's note: "M2/M3 paging and live messaging worked; M5
reused device indexes offline. **Final-report.md documents N_WIDE_MERGE and
N_NEVER_COMPLETE server-search limitations**, while complete UI search relies on acquired
data and **feeds require substantial bounded read models**."
- `N_NEVER_COMPLETE` is **new to this lane** — L22's schema had no unscoped words query
  at all, and its final check carried 2 notes against L23's 4 (`m8-check-final.log:1`).
  The shape came from W7d's card (§3.1). **Wave-7-invited.**
- `N_WIDE_MERGE` recurs unchanged from L22 H5 (**not wave 7**; the text improved).
- "feeds require substantial bounded read models" tracks the recipe growing from 208 to
  247 lines and the feeds card from 669 to 820 (W7a + W7R1b's `feedPullCounts`,
  `feedTryPull`, saturated-promotion logic). **Wave-7-caused.**
- "complete UI search relies on acquired data" is the builder's stated design
  (`final-report.md:63`, diary M5). **Builder.**

**scale_and_limits 84 → 79.** Scorer's note: "167,243 settled actions and matching
checkpoints … Warm probes passed; **finite feed caps**, metered wide searches, and
**potentially expensive, unmeasured cold acquisition** constrain the scale evidence."
- "finite feed caps": L22 was charged for `cap 32` and the 200-event backfill. L23 adds
  the **global** caps that wave 7 introduced, which the builder had to edit (H2) and
  disclosed as "explicit finite author/follow/source/inbox/pull-slot caps; this is not an
  unlimited social network" (`final-report.md:62`). **Wave-7-caused.**
- "potentially expensive, unmeasured cold acquisition": W7a's own measurement is
  **3,095 rows / 335,403 B for a 500-follow reader, up from 1,055 rows**
  (`JOURNAL.md:19956-19959`; `guide-feeds.txt:406-432`) — a ~2.9× increase paid
  deliberately for prediction ("This deliberately pays more public metadata acquisition
  for synchronous prediction and complete backfill. It does not reduce cold sync",
  `JOURNAL.md:19979-19982`). The builder read that card and wrote the consequence into
  `final-report.md:62`. **Wave-7-caused, by design and disclosed.**
- The builder's own additions: `likes sync public` with no horizon (`schema.q:51-62`,
  H10), a 5× larger follow backfill (H3), and `posts sync public` (`schema.q:32-49`).
  **Builder.**
- **Not charged, and measured fine:** every degradation rule passed with margin —
  deep paging 0.93×, Following 500/5 **1.16×**, celebrity 1.10×, all against 3×
  (trace §Scale-envelope). L22 measured 1.03–1.07 on Following; L21 1.257. The
  recipe is *not* getting slower.

**Verdict:** these two drops are narrative, not measurement. Every quantitative scale
predicate improved or held; what changed is that the builder now has more true, costly
things to disclose, and most of them are wave 7's deliberate tradeoff. Marked as
inference where it concerns the scorer's reading.

### 3.5 operations −6: not wave 7

**operations 89 → 83.** Scorer's note: "idempotent seeding, fresh-instance replay,
aggregate backfill, compiled release, and restart-safe digest execution. **M7 was not run
and recovery evidence is limited; run-log.md's ambiguous E_GENERATION incident is not
charged as a backend defect.**"

- M7 not run is identical to L22 (both `not-run` by instruction).
- The `E_GENERATION` incident is H8, and it is new. Its first cause is a **lock**, not a
  generation: `scale-server.log:7` — "snapback4 dev: the new schema was not adopted:
  E_STORE: database is locked" — while the replay was still writing. The server then
  served the old generation, the builder's `insights.backfill` job adopted the new one from
  the CLI, and the long-running host spent 195 background operations failing.
- **No wave-7 entry touches adoption locking.** W7a, W7b, W7c, W7d, W7R1a, W7R1b and W7R2
  each state that no meter, serialized form or engine path outside their scope changed
  (`JOURNAL.md:20205-20207`, `:20418-20419`, `:20806`, `:20913-20914`). The wave-7
  landing's "lead's adoption-timing fix" is about **receipts** — "A closed tab's receipt
  answers `client.write(id)` after the adopting device's first sync"
  (LLP 3000.007 §20.16, "Receipts") — not schema adoption. **Inference:** this predates
  wave 7 and was simply reached for the first time by a lane that ran a CLI job against a
  live scale host.

**Smallest product change:** make the failed adoption sticky and loud. The line should
name the consequence and repeat — "the new schema was not adopted (E_STORE: database is
locked); this engine is serving generation N and will refuse jobs and sweeps until
restarted" — and `doctor` should show the mismatch (it already prints
`store … at seq 1736, generation 12`, `m8-doctor.txt`). Optionally, retry adoption on the
next quiet moment instead of once at startup.

---

## 4. Grader defects d-01 … d-06

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (major) | `chat.searchLocal` returns 0 rows, `complete:false`, `next null` at the 100,015-message envelope while `chat.searchAll` returns 30 correct rows | `chat.q:255-256` unscoped `byAllWords` under a per-row read rule; `app/search.tsx:2` binds it; fixture makes every message a match; 8,192-examined ceiling (§3.1) | **App** (the query shape and its binding), with a **Snapback** residue: a meter cut is indistinguishable from an empty result at the client. **Not recipe-as-shipped, not W7d.** |
| d-02 (minor) | Typing indicator hides at ~4.87 s on a good trial and was still visible past the ~4.97 s ceiling on 2 of 3 trials, against a 5 s bound | `chat.q:181` sets `expiresAt: now + 4000`; the grader measured the **server** clearing at 4053/4055/4047 ms, i.e. ~50 ms after the deadline (trace §d-02) | **App.** The builder chose a 4 s TTL against a 5 s bound, leaving ~950 ms for the whole expiry→invalidate→render path. Snapback's server-side share is ~50 ms; the remaining ~820–920 ms is live-query invalidation plus React render, which is **within** the lane's other live latencies (reaction 934–945 ms, photo 909–978 ms, `timingRecords`). |
| d-03 (minor) | `insights.trending` returns 10 correct rows with `complete:false` and no cursor at the full corpus | `insights.q:34-44` — `trendingRanks after c last 10 by byRank { rankScore, post: posts[.postId] postCard }` over a table with 50,228 candidate posts backfilled into it; the nested `postCard` join is the per-row work | **App** query shape, with the **same Snapback residue as d-01**: a correct answer that cannot be distinguished from a truncated one. The builder's own probes recorded it three times and never flagged it (V2). |
| d-04 (minor) | `scripts/verify-digest.mjs` SIGTERMs hard-coded `livePid=20671` | `scripts/verify-digest.mjs:2`, `let server,livePid=20671`; `run-log.md:63` shows 20671 was that session's digest pid | **App** (committed evidence script). No Snapback contribution — `doctor` and the SIGNAL line both print pids the script could have discovered. |
| d-05 (minor) | The M6 suite's 20 s push poll is shorter than the grace deferral; back-to-back milestones fail | `scripts/acceptance-m6.mjs:4` (80 × 250 ms) against W7b's up-to-35 s `next_at` (§3.2) | **Harness/app** as written (the grader's own call: "the suite's budget is the problem"), with a **Snapback** share: the deferral is new in 0.2.23, undocumented in `API.md`, invisible in `doctor`, and untestable without knowing that the dev clock moves it. |
| d-06 (cosmetic) | Duplicate-handle error surfaces raw constraint text: "Error: profiles.byHandle already has a row where handle = 'alice'" | `schema.q:12` `unique byHandle: handle`; the app renders `w.why.message` directly (`src/profile.tsx:16`) | **App** — but **Snapback-shaped**: `E_CONSTRAINT`'s message names the index, and the app has no `else CODE` hook on a `unique` violation the way `require … else PROFILE_NOT_FOUND` gives one. A named-constraint refusal (`unique byHandle: handle else HANDLE_TAKEN`) would remove the class. |

---

## 5. The score drops

The scorer reads only L23's narrative and record (N=1), so 1–3 point moves are within
variance. Every score below is the builder scoring its own lane, not the grader.

| Category | 0.2.22 → 0.2.23 | Snapback-attributable cause named in the note | Other causes |
|---|---|---|---|
| overall | 91 → 88 | "Broad synchronization, bounded search, and prediction restrictions remain meaningful tradeoffs" (H1, H6, V8) | Disclosure effect (`final-report.md:62-64`); "Agent-error, environment, and ambiguous corrections are uncharged" |
| setup_and_docs | 90 → **92** | — | "comprehensive documentation and a first-check compilation success" (`m1-check.log:1`, "no problems, 1.1 ms"); "feed examples required capacity/backfill adjustments" (H2, H3) is the offsetting charge |
| data_modeling | 89 → 85 | "**the substantial feed recipe added modeling effort**" — recipe 208→247 lines, card 669→820 (W7a/W7R1b) | "bounded iteration, a configuration generator, and an application-owned expiring ranking table" (H5, H12, builder's config generator) |
| authorization | 96 → 95 | — | Variance; the note is entirely positive |
| queries_and_live | 91 → 82 | "N_WIDE_MERGE and N_NEVER_COMPLETE server-search limitations"; "feeds require substantial bounded read models" (§3.4) | "complete UI search relies on acquired data" (builder design) |
| writes_and_transactions | 94 → 91 | "online-only ranking dependencies restrict local prediction for posts and likes" — the builder's `trendingRanks` (H12), **not** the recipe | — |
| offline_sync | 94 → 91 | "some writes queue without prediction" (H1, H12) | "native execution remains unproven" (instrument) |
| media_assets | 97 → 96 | — | Variance; note is fully positive, HTTP 410 verified |
| background_work | 94 → **92** | "notification iteration needed restructuring to expose its bound" (H5) | The L22 "full-history digest sweeping" charge is **gone** (H11) |
| client_integration | 90 → 87 | "Prediction versus settlement required explicit UI handling" (H12's pending-write hook) | "native runtime behavior was not demonstrated" (instrument) |
| diagnostics_dev_loop | 90 → **92** | — | "useful type, index, expiry, and bounded-fanout diagnostics"; **the L22 meter complaint is gone** — W7c shipped it (V1) |
| scale_and_limits | 84 → 79 | "finite feed caps … potentially expensive, unmeasured cold acquisition" (§3.4, H2, V8) | Builder's unbounded `likes`/`posts` sync (H10) |
| operations | 89 → 83 | "the ambiguous E_GENERATION incident" (H8, §3.5) | "M7 was not run and recovery evidence is limited" (instrument, unchanged from L22) |

**The grade moved the other way.** O1 75→80 (104/119 pass, **0 fail**, against L22's
101/119 with 7 fails), O2 68→72 (L22's major does not reproduce, §2), O4 40→50 (same
absent simulator leg, better harness evidence), O5 30→75 (no probe set; the band function
lands on its final branch — an instrument artefact, not a lane result).

---

## 6. Remaining Snapback-attributable friction, ranked (next-wave candidates)

Expected impacts are inference from the scorer's and grader's notes; nothing here is
measured. "W7 regression?" asks whether the evidence suggests wave 7 introduced the
problem.

| Rank | Friction | Smallest product change | W7 regression? | Expected impact |
|---|---|---|---|---|
| 1 | **A meter cut is delivered to the client as an empty success** (d-01, d-03, V3, H6) | Two parts. (a) Put the cut reason in `Read` where the operator names already exist: add a public `cut` field (`'meter' \| 'words' \| null`) alongside `complete`, so a client can render "showing partial results" instead of "no results". The engine already distinguishes `capped_at` from `word_cut_at` (`guide-search.txt:74-75`). (b) Let an author declare a query as device-only — `query searchLocal(...) held:` — so serving it refuses with a named code instead of returning an empty page. The card already says server execution "does not repair its completeness class"; make that a refusal, not prose. | **No.** The mechanism, the ceiling and the note text all predate 0.2.23; W7d changed no meter (`JOURNAL.md:20205-20206`). W7d's new card section did make this shape likelier to be written (inference) | O2 +8–12 (removes the run's only major); queries +3–5 |
| 2 | **The Following recipe's global caps are below the calibration brief's own fixture** (H2) | Make the caps visible and sizeable at install: print them in `init`'s stdout line, and accept `--authors N --edges N` (or a single `--scale` preset). Today `init` prints one sentence with no numbers (`m2-recipe.log:1`), and the refusal appears at row 1,001 in a replay | **Yes (W7a).** `JOURNAL.md:19922-19924` adds them; L22's recipe had none on `feedAuthors` | scale +2–3; data_modeling +1; removes a mandatory hand-patch from every adoption at this scale |
| 3 | **W7a's residency flip tripled recipe cold acquisition, and no lane has measured it on a real app** (V8, H10, §3.4) | Publish a `test --residency` line for the *wired* app at the calibration fixture's shape (1,008 authors / 5,921 edges / 50,228 posts), not only the 502-author card fixture, and put the number in the feeds card's "Cold acquisition" table beside the existing rows. Optionally offer `--recipe feeds --online-metadata` for apps that prefer L22's queued-`saveProfile` tradeoff over the acquisition | **Yes, by design (W7a).** "This deliberately pays more public metadata acquisition … It does not reduce cold sync" (`JOURNAL.md:19979-19982`) | scale +2–4; removes the "unmeasured cold acquisition" charge that the scorer named verbatim |
| 4 | **A failed startup schema adoption is one line, then 195 silent failures** (H8, §3.5) | Make the failure sticky: repeat the refusal with its consequence on the first job/sweep that fails, surface a generation mismatch in `doctor` (which already prints `generation 12`), and retry adoption once the lock clears instead of only at startup | **No** (inference; no wave-7 entry touches adoption locking) | operations +4–6 — the whole of this run's operations drop |
| 5 | **The grace-deferred push is invisible and hard to test** (d-05, §3.2) | `doctor` prints `N deferred (next at +Ns)` beside `satisfied`/`sent`; the effects and presence cards state the up-to-35 s delay **and** name `POST /dev/clock/advance` as the way to close it in a test; `API.md`-class client docs get one sentence. Do **not** shorten the deferral or deliver at disconnect (both re-open L22 d-02 / W7R1a) | **The timing is W7b's**; the invisibility is the gap wave 7 left | O2 +2–3; makes M6 order-independent for any builder |
| 6 | **Exact Trending still needs a widened write-path table, now costing `createPost` prediction too** (H12; 0.2.22 H3 rank 4, 0.2.21 H4) | Unchanged from the last two reviews: a system-owned maintain-like write from a mutation that is not a client-authorized write, predicted as an engine side effect — the card already claims that property for the scheduled form ("The online-only maintain is an engine side effect and does not cost source-write prediction"). Three consecutive lanes have hand-rolled the same table | **No** | writes +1–2; offline_sync +1; `like` and `createPost` predict again |
| 7 | **`N_MAINTAIN_SYNCED` and `N_NO_HORIZON` print measurements that are structurally zero** (H9, H10) | `N_MAINTAIN_SYNCED` says "current store measurement: 0 value rows (before adoption)" — a number that is always 0 for a new maintain and therefore decides nothing. Either run the residency estimate inline (the note already knows the grouping) or drop the count and keep the `test --residency` pointer alone. Also: `N_NO_HORIZON` on `likes` fires only once a second reader exists (H10) — state that the suppression is reader-dependent so an author does not read silence as approval | **No** (both codes ship in 0.2.22) | diagnostics +1; the final check's note count falls from 4 toward L22's 2 |
| 8 | **W7c's read meter is opt-in and fails silently** (V1) | On loopback `dev`, return `Read.meter` **by default** (dev is already development-only and already admits personas and `/seed`), keeping `meter: true` as the explicit form and `serve` unchanged. The builder read the card that leads with the meter and still recorded `null` ten times | **No** (W7c shipped it; nobody used it) | diagnostics +1–2; makes `scale-probes`-style lanes self-documenting |
| 9 | **The recipe's repost helper and the card's wiring seam disagree about the id domain** (H4) | Either declare `fn repost(postId: id)` in the card's recipe (the builder's own patch), or have the wired example call the helper instead of inlining the `insert feedPosts`, so the two forms cannot diverge | **No** (the signature predates wave 7) | setup_and_docs +1; removes one compile loop from every adoption |
| 10 | **Recurring low items:** `E_STRUCTURAL_FANOUT` for emit-only loops over a bounded list (H5, third run); the worker's 201 undiagnosed `TypeError: fetch failed` (V4); synthetic residency sites, 68/287 (V6); a `unique` violation with no `else CODE` hook (d-06); docs growth, README +6.9% / search card +181% (V9) | Admit `for p in <[principal] <=N column>` when the body only emits. Give `runWorker` a one-line reason and backoff notice on repeated transport failure. Emit `file:line` for rule-derived residency sites. Allow `unique byHandle: handle else HANDLE_TAKEN`. Keep the README an index into the cards | **No** | data_modeling +1; diagnostics +1; operations +1; setup_and_docs +1 |
| — | **Not Snapback (instrument), for the record:** no holdout probe set was committed, so O3 is null and O5's band is an artefact of an empty probe set (trace §Phase 4, §O5); the six simulator assertions are `not-recorded` and cap O4 at 50; `repost-following-feed-surface` still fast-fails (V5, unfiled this run); the grader is uncalibrated | Instrument: commit a probe set, or make O5's 90 branch reachable without one; require a card before `direct` projection predicates; decide whether a waived native leg is `not-run` (this grader) or `fail` (L22's) | — | O3 becomes scorable; O4 and O5 become measurements rather than placements |
