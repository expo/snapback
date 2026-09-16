# Clique on snapback4@0.2.24 (Astra, medium effort): friction review against the 0.2.23 lane

**Short version.** Holistic score 88, flat against 0.2.23 — but the grade moved and the
run got materially cleaner. **101 of 119 assertions pass, none fails**, every non-pass is
`not-run`, and the whole shortfall is the nine absent simulator proofs plus M7's nine
never-attempted assertions (`grading/trace.md` §9, §10). The 101-ID partition the
machine schema admits is **85 pass / 16 not-run / 0 fail**
(`grading/grader-report.json` `assertionResults`); the M8 partition is 16/18
(`grading/m8-assertion-results.json`). The builder logged **17 correction loops, all
agent-error, 0 snapback4-defect** (`final-report.md:58`), against L23's 19.

**Wave 8 landed four fixes and the builder used three of them, unprompted:**
- **W8a `query … held:` — adopted twice.** `snapback/search.q:34` is
  `query held(q, c) held:` and `snapback/chat.q:187` is `query heldHistory(...) held:`.
  `check` confirms both: "runs: device (held; server refuses E_QUERY_HELD; no server
  fallback)" (`m3-check.txt`, `m5-check.txt`, `m8-check-retry2.log`). **L23's d-01 —
  the run's only major, an unscoped `byAllWords` query served from the server —
  cannot be written this way any more, and `N_NEVER_COMPLETE` appears in no check
  in this lane** (it occurs only in `guide-search.txt`). **L23's H6 and d-01 are closed.**
- **W8b sized recipe caps — used.** `evidence/m2-recipe.txt` prints the caps at install:
  "caps: authors=1100, edges=100000, pulls=35200, pullCounts=35200, sourceEvents=60000,
  broadcast=32000, tombstones=32000; …". The default is 1,000 authors
  (`node_modules/snapback4/README.md:1434-1436`), so **the builder sized it before the
  fixture could refuse**. `snapback/feed.q`'s mtime is 23:32:51 — the install minute —
  and it is **never modified again**, against L23's four hand-patched recipe lines.
  **L23's H2, H3 and rank 2 are closed and exercised.**
- **W8c's dev-clock recipe for a grace-deferred push — used.**
  `scripts/test-m6.mjs:3` does `POST /dev/clock/advance {"duration":"36s"}` *before*
  sending, then polls 50 × 1 s. **L23's d-05 (a 20 s budget shorter than the 35 s
  deferral) is closed**, and M6's wall fell 678 s → **356 s**.
- **W8a's `Read.cut` — shipped, never read.** No `cut` appears anywhere in `src/`,
  `app/` or `scripts/`. The builder nonetheless got the card's *behaviour* right:
  `app/search.tsx:3` renders `emptyText={partial?'Results may be incomplete':'No results'}`,
  which is verbatim what `guide-search.txt:79-80` asks for.

**The one major that is Snapback-shaped is a timing margin, not a regression.** d-01 —
the typing check failing 15/15 under grader execution — is **not** a presence regression
and **not** a wave-8 regression. The decisive number is a direct A/B on the same frozen
check across the two releases: the builder's own receipts measure
`expiresAfterLastKeystrokeMs` at **4,307.4 / 4,314 / 4,325.6 ms on 0.2.24**
(`evidence/m3-choreography.jsonl`) against **4,310 / 4,311.6 / 4,310.6 ms on 0.2.23**
(L23 `evidence/m3-choreo-1789521546470.jsonl`). Identical. See §3.1.

**queries_and_live fell 82 → 78 on one self-authored sentence about a query the app
never calls.** `search.all` (`search.q:36-39`) is the 1,000-lane merge that earns
`N_WIDE_MERGE`; **nothing in `src/`, `app/` or `scripts/` references it**. The builder
wrote it, kept it, disclosed its note in `final-report.md:163`, and the scorer charged
the disclosure. See §3.2.

**Two things wave 8 shipped and nobody in this lane touched:** the default dev read
meter (no `meter` field appears in any evidence file) and `doctor`'s deferral line
(`doctor` was never run). Both are §2.

Lane: `/Users/ccheever/clique-sb4-20260916-astra-cal8/lanes/astra-snapback4/` (**L24**
below). The previous lane is **L23**
(`/Users/ccheever/clique-sb4-20260916-astra-cal7/lanes/astra-snapback4/`).
- **Paths.** Paths without a directory are under L24's `evidence/`.
- **Times.** Run start `1789539727` = 2026-09-16T06:22:07Z (`run-log.md:5`) =
  23:22:07 PDT on 2026-09-15. Run end `1789543947`, total wall 4,220 s
  (`final-report.md:175`). File times are modification times.
- **Release.** Wave 8 is LLP 3000.007 §20.17,
  `snapback-w4b/llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:3686-3711`,
  with journal entries W8a–W8R2 and the two lead fixes at
  `snapback-w4b/snapback4/JOURNAL.md:21440-22089`.
- **Package README.** `node_modules/snapback4/README.md` in L24: 162,262 B,
  2,817 lines (L23: 158,710 B, 2,769 lines) — **+2.2 % bytes**, against L23's +6.9 %.
- **Run record.** L24 wrote **no** `run-record.json` (L23 did; grader-report `lane`
  field: "absent — the lane wrote no run-record.json"). A regression in lane hygiene,
  not in Snapback.
- **Grader.** family `claude`, `calibrationPassed:false`, `rerunsUsed:0`,
  `probeSetSha256: none-uncommitted`, so **O3 is null and O5 = 75 is the band
  function's `otherwise` branch**, not a measurement (trace §0, §8).
- **Grader host.** shared, 18-core, 1-min load **5.68 – 8.88** throughout (trace §0).
  L23's grader host ran at **6.1 – 15.5**.

---

## 1. Friction in the 0.2.24 run

### 1a. Friction the builder hit that Snapback caused

H-numbers are this review's items. H/V numbers from FRICTION-0.2.23 appear as
"0.2.23 H2" and so on.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| H1 | **`social.follow` still never predicts; `chat.createDM` joins it** | **Note, verbatim.** `m2-check.txt`, final line: "1 mutations never predict: social.follow (reads online-only table feedPullCounts); 1 mutation has insert arms that never predict: social.follow (feedPullCounts is online only) — snapback4 why <op>". From M3 it reads "2 mutations never predict: chat.createDM (reads online-only table dmPairs), social.follow (…)" and is unchanged through `m8-check-retry2.log`.<br>**Split.** `feedPullCounts` is W7R1b's online-only slot accounting inside the shipped recipe (`feed.q:36-45`) — **Snapback's**. `dmPairs` is the builder's own `online only` table (`chat.q:19-27`) — **the builder's**.<br>**Better than L23 in one way:** `createPost` and `like` **do** predict this run, because the builder made `trendingEntries` `sync public` with `expire at` instead of `online only` (`insights.q:19-32`). L23's H12 does not recur.<br>**Builder.** No complaint anywhere in `diary.md`, `essay.md` or `final-report.md`. | No loop. Scorer offline_sync: "Prediction eligibility adds authoring constraints" — offline nonetheless rose 91→93. | **S14/S15 residual** (0.2.23 H1, reduced) |
| H2 | **`E_QUARRY_TYPE` on the recipe's repost helper, verbatim from L23 — the recipe and the card's seam still disagree about the id domain** | **Error, verbatim.** `backend.stderr.log:17-20`, in the generation-2 window right after the recipe install: "snapback4 dev: 1 problem in snapback/ ; serving the previous generation / social.q:96:16 — E_QUARRY_TYPE: feedRepost's postId is a feedPosts reference; got a posts reference / rewrite: pass a feedPosts reference for postId / guide: types".<br>**Shipped signature unchanged.** `feed.q:210` is still `fn feedRepost(postId: feedPosts)`; `src/following.ts:20-22` still shows the wired example inlining `insert feedPosts {…}` + `feedDeliver(event)` rather than calling the helper.<br>**Fix, this time app-side.** `social.q:101-102` now reads `original = feedPosts[actorId = p.authorId, postId = postId, repost = false] ! else EVENT_NOT_FOUND` then `feedRepost(original.id)`. **No recipe line was patched** (`feed.q` mtime 23:32:51, never later).<br>**Diagnostic follow-up.** Run log `1789540742` (23:39:02) records `why-type.txt`, whose entire content is 84 bytes: "E_QUARRY_TYPE: a value meets a declaration of another type; the message names both." | Folded into M2 authoring; no separate correction-loop entry. | **0.2.23 H4 recurring** (low) |
| H3 | **`E_STRUCTURAL_FANOUT` on a derived recipient list — fourth consecutive run, and now twice in one compile** | **Error, verbatim, twice.** `m6-check.log:1-8`: "chat.q:170:3 — E_STRUCTURAL_FANOUT: loop over recipients: members by byConversationPrincipal (page bound 50): this list does not preserve one complete page / rewrite: iterate the original group: `for row in members[conversationId] first 50 by byConversationPrincipal:`; put the condition and work inside that loop / guide: programs" and the same at "media.q:34:3".<br>**Fix.** `chat.q:170-172` and `media.q:34-36` both iterate `members[conversationId] first 50 by byConversationPrincipal` and put `if member.principal != viewer and not exists connected[member.principal]: emit notify {…}` inside.<br>**Builder.** Correction loop `1789542456` (00:07:36, the mtime of both files). Essay:11: "The compiler refused it because the list no longer preserved the provenance of one complete, bounded membership page… This was useful feedback, although it interrupted a pattern that would be routine in general-purpose application code." Diary M6 repeats it. `why-structural-fanout.txt` retained at `1789543421`. | ~1 compile round; `m6-check-retry.log` is clean. | **S08** (0.2.23 H5, 0.2.22 H4, 0.2.19 G9 — fourth recurrence) |
| H4 | **A three-round compile chain to express one cross-table ranking upsert** | **Round 1, verbatim.** `m8-check.log:1-8`: "insights.q:40:7 — E_QUARRY_UNKNOWN: trendingEntries has no unique index over 1 column matching this key; its indexes are byId (id), byScore (score, at, id), byExpires (expiresAt) / rewrite: unique byColumn: <column>", and the same at "social.q:94:13".<br>**Round 2, verbatim.** `m8-check-retry.log:1-3`: "insights.q:19:1 — E_QUARRY_TYPE: id is a posts reference; trendingEntries.id is a trendingEntries reference / rewrite: use a trendingEntries reference for id".<br>**Round 3.** `m8-check-retry2.log:1` is clean.<br>**Fix.** `insights.q:21` adds `unique byPost: postId`; `social.q:94-95` becomes `if exists trendingEntries[postId = postId]: update trendingEntries[postId = postId] { score: likeCounts[postId] }`.<br>**Builder.** Correction loop `1789542892` (00:14:52). Essay:9 credits the diagnostic: "an identifier referring to a post is not interchangeable with an identifier referring to a ranking row… The compiler's diagnostic led me to a unique post-reference index". | ~2 compile rounds inside the M8 window. The builder rates it positively; it is still two refusals to say "index this column". | **New** (low; the cost of a read model) |
| H5 | **`N_MAINTAIN_SYNCED` is now a 16-line note over 14 maintains, 9 of them measuring "0 value rows"** | **Note, verbatim head.** `m8-check-retry2.log:14-29`: "note: insights.q:9:1 — N_MAINTAIN_SYNCED: 14 synced maintains:" then one line each, e.g. "maintain dailyOriginals: sync public inherited from posts; one value row per authorId, day reaches every device; **no currently eligible mutation reads it** (site insights.q:9:1); current store measurement: **0 value rows (before adoption**; cold rows per viewer: `snapback4 test --residency`)"; closing "rewrite: keep inherited sync for local readers, or add `online only` to opt out … guide: residency".<br>**Growth.** 5 maintains at M2 (`m2-check.txt`), 6 at M4, **14 at M8**. It is the longest thing `check` prints all run.<br>**Structurally undecidable, again.** 9 of the 14 report "0 value rows (before adoption)" — a number that is 0 for every newly declared maintain. One line is genuinely useful and is new: "maintain likeCounts: … **social.like would stop predicting if likeCounts goes `online only`**".<br>**Pointer unfollowed.** The note prints `guide: residency` **10 times** across the run (`backend.stderr.log`), and `evidence/` contains **no `guide-residency.txt`** and no `test --residency` output. | Seconds each; no loop. It is one of only 3 notes in the final check (down from L23's 4). | **0.2.23 H9 recurring, multiplied** |
| H6 | **`N_WIDE_MERGE` on a query the app never calls, whose rewrite names a flag that does not exist** | **Note, verbatim.** `m8-check-retry2.log:10-12`: "note: search.q:36:1 — N_WIDE_MERGE: query search.all: the merge over messages reads up to 1000 lanes, one page of 21 each — up to 21000 rows per read; a read past the 8,192 examined ceiling returns `complete: false` / rewrite: `snapback4 guide search`, section "Search every chat I'm in": … **Measure with `snapback4 test --cost`** / guide: search". Present from `m5-check.txt` onward.<br>**Unreachable.** `/usr/bin/grep -rn "search\.all" src app scripts` returns **nothing**; `app/search.tsx:3` binds every scope to `api.people`, `api.search.inChat` or `api.search.held`.<br>**The flag does not exist.** `cli-help.txt:14` is "test [--fixture dir] [--as p] [--residency]"; `README.md:2357` is "`snapback4 test [--residency] [--fixture dir] [--as persona]`". `--cost` is a `check` flag (`cli-help.txt:4`). The note is the only place in the corpus that spells `test --cost` (`/usr/bin/grep -rn "test --cost"` hits `m5-check.txt` and nothing else).<br>**Consequence.** The builder wrote this note into `final-report.md:163`, and the scorer quoted it back as a limitation. | No loop — and that is the problem: an unused query cost 4 points (§3.2). | **S16/S17** (0.2.23 H7 recurring; the rewrite text is now *wrong*, not merely unfollowable) |
| H7 | **`N_NO_CURSOR` fires on a query that already declares a cursor it never applies** | **Note, verbatim.** `m8-check-retry2.log:2-4`: "note: insights.q:33:1 — N_NO_CURSOR: query insights.trending returns a page of 10 trendingEntries rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on / rewrite: declare `c: cursor ?` and page with `after c` — insights.trending(.., c: cursor ?): return trendingEntries[..] after c last 10 by <index> / guide: reads".<br>**Shipped as noted.** `insights.q:33-34` is `query trending(c: cursor ?): return trendingEntries last 10 by byScore { … }` — **the parameter is already declared; only `after c` is missing**, so the note's rewrite half-describes code that already exists. Not acted on.<br>**Provenance.** `N_NO_CURSOR` also ships in 0.2.23 (1 occurrence in each lane's package README), so this is **not** a wave-8 addition; it is the compile-time surfacing of L23's d-03, which L23 discovered only by probing. | Seconds; no loop. Nothing in `diary.md` or `final-report.md` mentions it. | **0.2.23 d-03, now caught at compile time** |
| H8 | **`E_SQL_INTERNAL`: `sql` refuses a table inventory with no pointer to what it would allow** | **Refusal, verbatim.** `table-inventory.json`, the whole file: `{"denied":{"code":"E_SQL_INTERNAL","message":"sql reads application views only; internal tables, r, i and SQLite metadata are refused"}}`.<br>**Builder.** Run log `1789542730` (00:12:10), `attribution=agent-error`: "E_SQL_INTERNAL-metadata-refused-use-documented-application-views-only". It recovered by reading the documented views, and `final-report.md:53` says so: "Counts are independently read from documented application SQL views".<br>**The gap.** The refusal names three things it refuses and zero things it admits; it carries no `guide:` line, unlike every `E_QUARRY_*` and `N_*` above. | One lookup; seconds. | **New** (low; observability ergonomics) |
| H9 | **`run --as` rejects an email, which is the identifier every other dev door accepts** | **Failure, verbatim.** `m8-acceptance.log:6`: "FAIL rolling-trending-ranking-and-exclusion Error: Command failed: ./node_modules/.bin/snapback4 run social.createPost {…} **--as alice@example.com** --now 1789452894260".<br>**Documented.** `README.md:2347` is `--as <persona|principal-id>`; `cli-help.txt:12` the same. Meanwhile `dev` "admits loopback personas" and the app's own login is by email (`API.md:5`), so email is the handle the builder had.<br>**Builder.** Correction loop `1789542955` (00:15:15), `attribution=agent-error`: "CLI-as-requires-principal-not-email".<br>**No hint.** The command failed with a bare non-zero exit; nothing in the log suggests the accepted spelling or lists the personas. | One acceptance round inside M8. | **New** (low; shared with the builder) |
| H10 | **Every note names a `guide:` card and no card was opened; `why <CODE>` answers in one sentence** | **Pointers printed.** `guide: residency` ×10, `guide: search` ×3, `guide: types` ×2, `guide: programs` ×2, `guide: language` ×2, `guide: reads` ×1 (`backend.stderr.log` plus the `m*-check` files).<br>**Cards opened.** `evidence/guide-*.txt` is: assets, expire, feeds, jobs, language, personas, prediction, rules, search, sync, writes — **11 of the 27 cards `guide.txt` lists**. Missing: `reads` (where `Read.cut` and the meter live), `residency` (where `test --residency` lives), `effects`, `presence`, `refusals`, `types`, `programs`, `maintains`.<br>**What it reached for instead.** `snapback4 why`, twice — `why-type.txt` (84 bytes, one sentence) and `why-structural-fanout.txt` (707 bytes, genuinely useful).<br>**Consequence.** `Read.cut` and the default dev meter — wave 8's two client-visible fixes — are documented only in `guide reads` and were never seen. | Not a loop; a silent miss that costs two wave-8 features their first use. | **New** (diagnostics/docs routing) |

Two smaller Snapback-shaped moments were absorbed without complaint:
- **Config ingestion, third run running.** `scripts/configure.mjs` and
  `scripts/configure-digest.mjs` compile `config/*.json` into `snapback/config.q` and
  `snapback/digest-config.q` because Quarry does not read a config file. `README.md:18`
  documents the workaround; unlike L23, `diary.md` does **not** name it as missing.
- **The one-time service token lands in a committed evidence file.**
  `m5-expiry-backend.log:9` reads "snapback4 dev worker: service:worker token (printed
  once): HIJISE2ahPKWstPcpubJl8VjN8Q6CPya490fIPrRgc8" in cleartext. That line was
  appended at `1789544280` — **after** the lane's `end=1789543947` — so it is the
  grader's Phase-1 re-run of the lane's own `m5` test (trace §0), not builder hygiene.
  The mechanism is Snapback's: the one-time token is printed to the same stderr stream
  a harness redirects into a log it keeps. The grader redacted it in `trace.md`; the
  lane file still carries it.

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| V1 | **The app holds the typing row's own expiry deadline and ignores it** | `chat.q:113-114`: `query typers(conversationId) : return typing[conversationId] first 50 by byConversationPrincipal where .principal != viewer { *, profile: … }` — `*` includes `expiresAt` (`chat.q:76`). `src/Chat.tsx:19` renders `<TypingIndicator visible={'data' in typing && typing.data.length>0} …/>`: **a pure row-count test**. So the client waits for the server sweep plus a live invalidation to hide a row whose exact hide time it already has. **This is the whole of d-01's margin** (§3.1). Nothing in the expire or reads cards tells a live reader it may honour `.expiresAt` locally. | **New; d-01's product residue** |
| V2 | **`chat.type` fires one unthrottled mutation per keystroke** | `src/Chat.tsx:15`, whole function: `function change(t:string){setText(t);void c.mutate(api.chat.type,{conversationId:id,active:!!t})}`. The harness types 45 characters at 25 ms (`instrument/choreography/choreography.mjs:1735-1740`), so one check issues **45 `chat.type` mutations in ~1.1 s**. The lane's own receipt measures `typingActionMs` **1,531.6 ms** for a nominal 1,100 ms of keystrokes (`m3-choreography.jsonl`) — **431 ms already lost inside the typing action**. **Inference:** the last upsert's server `now` therefore trails the harness's `lastKeystrokeAt`, and that drift grows with load. Neither the presence nor the writes card mentions throttling a per-keystroke mutation. | **New; d-01's proximate amplifier** |
| V3 | **Wave 8's `Read.cut` and default dev meter shipped into a lane that never looked at either** | `/usr/bin/grep -rn "\.cut\b\|cut:" src app scripts snapback/*.q` returns **nothing**. `/usr/bin/grep -l '"meter"' evidence/*.json grading/*.json` returns **nothing**. W8c's journal records the change — "Loopback dev now returns read counters without a header, and the online client retains them without `meter: true`" (`JOURNAL.md:21631-21633`) — so the counters were on the wire for every read this lane made and nobody read one. The only surface that would have taught it is `guide reads` (H10). | **New** (0.2.23 rank 8 shipped, still unconsumed) |
| V4 | **`search.all` is dead code that costs a note, a disclosure and four points** | Authored at `search.q:36-39`; referenced by **no** file in `src/`, `app/` or `scripts/`. It produces `N_WIDE_MERGE` from M5 to M8 (H6), the builder wrote that note into `final-report.md:163`, and the scorer's `queries_and_live` note quotes it first (`scores/astra/FINAL.md`). `check` has no way to say "nothing calls this". | **New; §3.2** |
| V5 | **`trendingEntries` is a `sync public` app table with `insert <- allow` and `update <- allow`** | `insights.q:28-32`: `public 'rolling public post ranking'` / `insert <- allow` / `update <- allow` / `expire at .expiresAt` / `sync public`. Reachable only through `social.createPost` and `social.like`, both of which validate — so the exposure is the same de-fanged shape as L23 V7, now on an **app-owned** table rather than the recipe's. The recipe's own widened rules persist unchanged: `feedAuthors update <- allow` (`feed.q:8`), `feedPulls insert <- allow` (`feed.q:32`), `feedPullCounts insert/update <- allow` (`feed.q:42-43`). | **0.2.23 V7 recurring** |
| V6 | **Synthetic residency sites persist, milder for the third run** | 62 of 318 site strings in `snapback/generated/residency.json` carry no `file:line` — "update conversations rule" ×14, "insert members rule" ×10, "after insert" ×9, "upsert feedPullCounts" ×3. **19.5 %**, against L23's 68/287 = 23.7 % and L22's 104/340 = 30.6 %. | **S08 residual** (0.2.23 V6 recurring) |
| V7 | **Cold acquisition is measured upstream, published in the card the builder read, and still unmeasured for this app** | `guide-feeds.txt:464-466` carries W8b's row: "**Total** | **3,095** | **335,403** | **139,413** | **17,876,585**" and "**139,413 rows / 17,876,585 bytes is large cold acquisition**". The builder read that card (run log `1789540846`), sized its caps from `:35`, and then wrote only a qualitative sentence: "Full public/message sync has no horizon and may be expensive at scale; native scale sync was not measured" (`final-report.md:163`). No `test --residency` output exists in `evidence/`. The app adds `posts` (`cap 100000`, `sync public`) and `likes` (**no cap, no horizon**, `sync public`) on top of the recipe. | **S16** (0.2.23 V8 recurring; upstream half now closed) |
| V8 | **No `N_NO_HORIZON` fired, on a schema with an uncapped horizon-free public table** | `social.q:22-32`: `table likes` is `public 'post engagement is public'` + `sync public` with **no `cap` and no `last N by`**. `posts` is capped (`social.q:16`, `cap 100000`). `/usr/bin/grep -l N_NO_HORIZON evidence/*.txt *.log` hits only `guide-prediction.txt`, `guide-search.txt`, `guide-sync.txt` — **no check**. L23's H10 recorded the mirror-image surprise (the note appearing only once a second reader existed). **Inference:** the suppression rule is reader-dependent in a way an author cannot predict, and silence is being read as approval in both directions. | **0.2.23 H10 neighbourhood, inverted** |
| V9 | **The unread count is still an ordinal difference with no maintained counter** | `src/Chat.tsx:3`: `unreadCount={Math.max(0,(m.conversation?.lastOrdinal??0)-m.readOrdinal)}`. `final-report.md` no longer discloses the approximation that L23's did (L23 `final-report.md:65`). Same shape, less disclosure. | **0.2.23 V10 recurring** |
| V10 | **Docs growth slowed sharply, and the feeds card is now 874 lines** | Package README 162,262 B / 2,817 lines against L23's 158,710 / 2,769 (**+2.2 %**, against L23's +6.9 %). `guide-feeds.txt` 874 lines against 820 (+6.6 %); `guide-search.txt` **231 lines against 222** (+4 %, against L23's +181 %). Diary M1 still says "The README is unusually comprehensive, but reading its entire surface is a substantial upfront cost", and `setup_and_docs` fell 92 → 90. | **G12** (0.2.23 V9 recurring, decelerating) |

### 1c. Friction that was not Snapback's

- **Environment** (`final-report.md:78`, run log `1789540179`, `1789541501`):
  - The copied harness's relative support imports were missing, and PATH's default Node
    was **25.9.0** against the declared 24.18.0 (`choreography-startup.txt`,
    `choreography-startup-2.txt`); commands were subsequently pinned.
  - Copied instrument files were read-only and needed a permissions fix
    (`choreography-install.log`, `choreography-install-retry.log`).
  - A tool rejected an `rm -f` before execution; retried with specific unlinks.
  - One empty placeholder was written outside the lane at `/tmp/not-allowed-placeholder`
    — logged as a lane-rule violation, containing no data.
  - `git status` reports no repository, so no commit or PR.
- **Instrument:**
  - **No holdout probe set was committed** (trace §0 deviation 1, §5), so phase 4 was
    skipped, **O3 is null** and **O5 = 75 is the band function's `otherwise` branch**.
    Identical to L23; nothing about the lane moved it.
  - The grader is **uncalibrated** (`calibrationPassed:false`), so this is not a
    claim-eligible wave.
  - **M7 is not run by instruction** (`ENVIRONMENT.md`), costing 9 assertions in O1's
    denominator and capping O1 below its 90 anchor.
  - **No simulator recording of any kind** (`ios-simulator-m6` and `ios-simulator-m8`
    both `not-recorded`), costing `m6-a01..a07`, `m8-a17`, `m8-a18` and capping **O4 at
    45** (trace §7). The only native artifacts are seven Hermes bundles, each labelled
    "Hermes export only; no native runtime claim" (`native-artifacts.json`).
  - **The frozen `grader-report.schema.json` cannot represent M8 at all** (key pattern
    `^m[1-7]-a[0-9]{2}$`), so the 119 IDs ship in two files (trace §10). It also means
    the Sept 5 and Sept 12 runs have **no machine-comparable M8 result set**, so any M8
    comparison to them is prose.
  - The grader's own Phase-1 re-run of `npm run acceptance -- --milestone m5` appended
    server lines to the lane's `run-log.md` (lines 98-99) and an unredacted worker token
    to `m5-expiry-backend.log` (§1a).
- **The builder's own errors** (17 correction loops, all `agent-error`,
  `final-report.md:60-76`): a Metro watch-cache stale UI; a strict locator against 20
  repeated feed cards (`m2-acceptance.log`); feed tabs unreachable from profile/thread;
  a concurrent suite polluting an active choreography timeline (`1789540834`, owned
  pids 64044/64375); a route resolver discarding a retained conversation on membership
  removal; navigating before login settled; reading the server before a predicted write
  settled; a coverage manifest misaligned with the frozen validator; a CLI module running
  on import; a stale display-name assumption and a wrong profile argument; a wrong feed
  testID; a "yesterday" check measured against client rather than server state; an
  `embedded` reference leaking from the inbox-layout edit into `ChatSettings`; a wrong
  attribution location in the previous correction; a history wire-order documentation
  error corrected in `API.md`; and a final mobile-layout pass. Plus the builder's halves
  of H3, H4 and H9.
- **App defects the grader found:** d-02 (the composer file-input no-op, §4), d-03
  (`API.md` promising a distinction the platform does not offer, §3.3), d-04 (signup
  before handle validation), d-05 (raw constraint text as a user-visible error).

---

## 2. The 0.2.23 items: recurred, closed, changed, or unexercised

### Explicit checks

- **`Read.cut` (W8a): shipped, never read — but its rendering rule was followed.**
  `/usr/bin/grep -rn "\.cut\b\|cut:" src app scripts snapback/*.q` returns nothing.
  The card's instruction is at `guide-search.txt:79-80`, verbatim: "`null` means 'not
  disclosed here', not 'not cut'. Render **'Results may be incomplete'** for
  `complete: false` with `cut: null`, even when empty; never 'no matches'." And
  `app/search.tsx:3` is `emptyText={partial?'Results may be incomplete':'No results'}`
  with `const partial='data' in r.read && !r.read.complete`. **The behaviour W8a wanted
  shipped; the field it added did not get used.** See §3.2 for why that is not a failure.
- **`query … held:` with `E_QUERY_HELD` (W8a): adopted twice, and it is the run's
  biggest single win.**
  - `search.q:34` — `query held(q: text <=100, c: cursor ?) held:` over
    `messages matching q … by byWords`, the exact shape that produced L23's major.
  - `chat.q:187` — `query heldHistory(conversationId, c) held:`, the app's **only**
    conversation-history reader (`src/Chat.tsx:13` binds `usePage(api.chat.heldHistory, …)`).
  - `check` reports both, verbatim: "chat.heldHistory: runs: device (held; server
    refuses E_QUERY_HELD; no server fallback)" with a per-site held listing
    (`m3-check.txt` onward). **`N_NEVER_COMPLETE` appears in no check in this lane.**
  - `E_QUERY_HELD` was never triggered at runtime — all 12 occurrences in `evidence/`
    are compile output or card text. Nothing ever called a held query on the server.
  - **Cost:** M5's wall fell **827 s → 609 s**.
- **Sized recipe caps (W8b): used, and the recipe was never touched.**
  `m2-recipe.txt`, verbatim: "init: wrote 2 files in . — Following recipe — caps:
  authors=1100, edges=100000, pulls=35200, pullCounts=35200, sourceEvents=60000,
  broadcast=32000, tombstones=32000; follows/reader=1000, followers/author=1000,
  events/actor=1000, tombstones/actor=1000, pulls/reader=32, inbox/reader=50000,
  inbox/reader/actor=1000, inbox/event=1001 — next: `snapback4 check`, then
  `snapback4 dev`". `feed.q:5` is `cap 1100`, above the brief's 1,008 profiles; the
  default is 1,000 (`README.md:1434-1436`). The card's worked example is at
  `guide-feeds.txt:35`. **`feed.q` mtime 23:32:51 — the install minute — and never
  later**, against L23's `cap 2000`, `cap 200000`, a deleted 200-event backfill bound
  and a changed `feedRepost` signature. The scale replay settled **167,157/167,157 with
  0 failures** (`evidence/scale-result.json`), so no cap refused anything.
- **The dev read meter by default (W8c): shipped, unobserved.** No `meter` field
  appears in any JSON under `evidence/` or `grading/`. The builder never ran
  `snapback4 test`, `--residency` or `--cost`, and never opened `guide reads`.
  **Unexercised, for the second run running** (L23 V1 was the opt-in version of the
  same miss).
- **`doctor`'s deferral line (W8c): never run.** `doctor` appears in `cli-help.txt:20`
  and in `guide-jobs.txt`/`guide-personas.txt`, and in **no** command this lane issued.
  There is no `doctor` output in `evidence/`. **Unexercised.**
- **The grace-deferred push (W7b/W8c): closed by the dev clock, exactly as the review
  asked.** `scripts/test-m6.mjs:3`, verbatim fragment: `await
  fetch('http://127.0.0.1:49360/dev/clock/advance',{method:'POST',…,body:JSON.stringify({duration:'36s'})})`
  before the send, then `for(let i=0;i<50;i++){ … setTimeout(r,1000) }` = a 50 s poll.
  Provenance: `README.md:885-887` ("queues the push for the grace deadline: up to 35
  seconds. `doctor` reports the deferred count and next deadline; `GET /effects` shows
  each deadline as `nextAt`. In tests, close the window with `snapback4 clock advance
  36s`"), plus `guide-expire.txt:21-25` and `guide-jobs.txt:63-67`, both read at
  `1789541636`. `m6-acceptance.log` passes; M6's wall fell **678 s → 356 s**.
  **L23's d-05 and rank 5 are closed on the test-recipe half.** The `doctor`/`/effects`
  inspection half is unexercised.
- **Adoption incidents: none.** `/usr/bin/grep -n "not adopted\|E_GENERATION\|E_STORE"`
  over `backend.stderr.log`, `scale-backend.log`, `digest-backend.log` and
  `m5-expiry-backend.log` returns **zero** matches. Every adoption in the run succeeded:
  "snapback4 dev: schema adopted as generation 2 (Additive) in 1 ms" through
  "generation 9 (RuleChange) in 30 ms" (`backend.stderr.log`). Compile refusals were
  handled the documented way — "snapback4 dev: 2 problems in snapback/; **serving the
  previous generation**" — three times. **L23's H8 does not recur**, and neither
  W8c's sticky-adoption logging nor the lead's orphan-adoption lock fix was exercised.
- **The store banner (W7c): both halves exercised this run.**
  `backend.stderr.log:2` and `scale-backend.log:2` print the store path;
  `m5-expiry-backend.log:2` prints "store: **in memory — dies with this process**".
  L23 never exercised the in-memory half.
- **`mutate(op, args, {id})` (W6d): used throughout.** `API.md:13` documents the
  protocol; `src/Chat.tsx:17` and `src/Posts.tsx:21` pass `mintId()` message ids;
  the replay adapter uses stable hashed intent ids (`README.md:28`). The grader
  confirmed idempotency for `like`/`repost`/`follow`/`react`/`send` on replayed intent
  ids and that `chat.send` retried on the same intent yields one copy reported
  `replayed` (trace §4).
- **Password (W6b):** `schema.q:1` is `use identity password`; `API.md:5` states the
  eight-character minimum; the grader probed it — 7 characters refused `E_AUTH`, a long
  one accepted (`api-verify.json` m1-a01).

### Item by item

| Item | 0.2.23 (L23) | 0.2.24 (L24) | Verdict |
|---|---|---|---|
| H1 `follow`/`unfollow` never predict on `feedPullCounts` | note in every check | same note, verbatim, in every check (`m2-check.txt`) | **Recurred, unchanged** (H1) |
| H2 shipped recipe caps below the brief's fixture | `cap 1000` hand-patched to `cap 2000` | `--authors 1100` at install; caps printed; recipe never edited (`m2-recipe.txt`, `feed.q` mtime) | **Closed** (W8b), exercised |
| H3 200-event backfill bound deleted by hand | three lines removed from the recipe | `feed.q:160-164` retains `visited = 0` / `if visited = 200: break` | **Closed** — no recipe patch was needed |
| H4 `E_QUARRY_TYPE` on `feedRepost`'s id domain | patched the recipe signature | same error verbatim (`backend.stderr.log:18`); fixed app-side instead | **Recurred** (H2); the card/recipe seam is unchanged |
| H5 `E_STRUCTURAL_FANOUT` on a derived recipient list | once, ~1 min | **twice** in one compile (`m6-check.log`), ~1 round | **Recurred, doubled** (H3) |
| H6 `N_NEVER_COMPLETE` device-held search served from the server | the run's only major (d-01) | **the note fires in no check**; `search.q:34` and `chat.q:187` are `held:` | **Closed** (W8a), exercised |
| H7 `N_WIDE_MERGE` on a 1,000-lane merge | shipped and bound to the UI | shipped and bound to **nothing** (V4); rewrite now names a nonexistent flag | **Recurred, and its advice degraded** (H6) |
| H8 silent adoption failure → 195 background failures | 1 line then 195 `E_GENERATION` | zero adoption failures anywhere | **Not reproduced**; W8c's fix unexercised |
| H9 `N_MAINTAIN_SYNCED` with a structurally-zero measurement | 1 maintain | **14 maintains, 16 lines, 9 of them "0 value rows"** (`m8-check-retry2.log`) | **Recurred, multiplied** (H5) |
| H10 `N_NO_HORIZON` appears only once a second reader exists | fired at M8 on `likes` | **never fired**, on a schema with an uncapped `sync public` `likes` (V8) | **Recurred, inverted** |
| H11 attribution backfill + digest sweep | 206-row backfill; period-bounded sweep | `insights.q:35-41` `job backfill()` chunks `posts first 100 by byId`; `digest.q:9` chunks `profiles first 1 by byId` with per-period counts; `m8-backfill.log` | **Recurred, same shape**; `background_work` held at 92 |
| H12 Trending's write-path table costs `createPost`/`like` prediction | `online only` → both queued | `trendingEntries` is `sync public` + `expire at` (`insights.q:19-32`); only `chat.createDM` and `social.follow` queue | **Closed by the builder**; `writes` 91→**95** |
| V1 read meter documented, never enabled | `meter:true` omitted, 10 × `null` | meters now on by default; **no meter observed at all** (V3) | **Changed in product, still unconsumed** |
| V2 builder's own probes show Trending `complete:false`, unflagged | 3 probe rows ignored | **`check` now prints `N_NO_CURSOR`** for it (H7) — and it is still unacted | **Surfaced earlier, still unacted** |
| V3 a meter cut is an empty success with no client signal | unactionable `complete:false` | `cut` exists and is unused; the app renders "Results may be incomplete" from `complete` alone | **Closed in product, partly consumed** |
| V4 push worker logs 201 undiagnosed `fetch failed` | `worker-errors.log`, 201 lines | integrated `dev worker` (`snapback/worker.mjs`, `digest-backend.log:1-2`); no worker errors anywhere | **Not reproduced** |
| V5 `repost-following-feed-surface` fast-fail transient | recurred, unfiled | **does not recur**; the m2 attempt-2 failures are d-02, deterministic and reproduced by the grader | **Closed**; replaced by an app defect |
| V6 synthetic residency sites | 68/287 = 23.7 % | 62/318 = **19.5 %** | **Recurred, milder** (V6) |
| V7 widened recipe rules, de-fanged | recipe only | recipe **plus** the app's own `trendingEntries insert/update <- allow` (V5) | **Recurred, widened by the builder** |
| V8 cold acquisition disclosed and unmeasured | qualitative only | qualitative only (`final-report.md:163`), while the card now publishes 139,413 rows / 17.9 MB (V7) | **Recurred**; the upstream half is closed |
| V9 docs growth | README +6.9 %, search card +181 % | README **+2.2 %**, search card +4 % | **Decelerated** (V10) |
| V10 unread count is an ordinal difference | disclosed as approximate | same code, **no longer disclosed** (V9) | **Recurred, less disclosed** |
| d-01 (major) `chat.searchLocal` empty at the envelope | app query shape + fixture + meter cut | the shape is now a compile-time refusal; L24's d-01 is a different defect entirely | **Closed** (W8a) |
| d-02 (minor) typing headroom under 1 s | 4,869 ms pass / ~4,970 ms fail ×2 | **the same margin, now failing 15/15 under grader execution** — promoted to major (§3.1) | **Recurred, escalated by the grader's instrument** |
| d-03 (minor) Trending `complete:false` with no cursor | found by probing | found by `check` as `N_NO_CURSOR`, unacted (H7); the grader did not refile it | **Recurred as a note** |
| d-04 (minor) `verify-digest.mjs` hard-codes a pid | `livePid=20671` | `scripts/digest-proof.mjs` discovers its own pids (`run-log.md:59-64` records 98345/98359/98422/98425); the grader filed no such defect | **Closed** (builder) |
| d-05 (minor) M6's 20 s push budget vs the 35 s deferral | first attempt failed | dev clock advanced 36 s before the send (`test-m6.mjs:3`) | **Closed** (W8c docs + builder) |
| d-06 (cosmetic) raw constraint text as the duplicate-handle error | `profiles.byHandle already has a row where handle = 'alice'` | **identical**: "profiles.byHandle already has a row where handle = 'wv1789546545748'" (`grading/web-verify.json`), refiled as **d-05** | **Recurred verbatim**; L23's rank-10 `else CODE` ask is unshipped |

---

## 3. Priority questions

### 3.1 d-01 (major): did presence timing regress?

**No. Nothing on this path is presence, and the direct A/B across the two releases is
flat to within 20 ms. This is an app timing margin, magnified by the grader's
instrument and its host.**

First, a correction to the framing. The "~4.87 s against a 5 s bound, ~0.13 s of
headroom" figure is **L23's d-02 on 0.2.23**, not 0.2.22's — L22's d-02 was the
grace-swallowed push (FRICTION-0.2.23 §2, item "V2 the 35 s grace suppresses push
permanently (d-02)"). L23's grader-report records d-02 verbatim as "the server clears
the typing state at ~4.05 s, but the rendered indicator hides at ~4.87 s on a good
trial and was still visible past ~4.97 s on two of three harness trials". So the
comparison below is 0.2.23 → 0.2.24 on the same defect.

**This path contains no presence.** `chat.q:180-186` is the whole typing mutation:

```quarry
mutation type(conversationId: conversations, active: bool):
  require exists members[conversationId, viewer] else NOT_MEMBER
  if active:
    upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 4000 }
  else if exists typing[conversationId, viewer]:
    delete typing[conversationId, viewer]
  return null
```

`typing` (`chat.q:73-86`) is an ordinary table with `by byExpires: expiresAt`,
`expire at .expiresAt` and `sync to members[.conversationId]`. The reader is
`query typers` (`chat.q:113-114`). **`connected[p]` — the presence probe — appears only
at `chat.q:171` and `media.q:35`, both inside `emit notify`**, i.e. the push path.
W5g (presence grace on the dev clock), W7b (grace-only pushes deferred to the grace
deadline) and W8c (deferral visibility) all act on that push path and none of them
touches `expire`, live invalidation or `typers`. W8c states it explicitly: "Neither the
35-second grace nor its reconnect cancellation or delivery rules changed"
(`JOURNAL.md:21628-21629`). W8a states "No ceiling, row selection, ordering, cursor,
value serialization or existing corpus case changed" (`JOURNAL.md:21678-21679`).

**The A/B, on the same frozen check, same app shape, two releases:**

| release | lane's own receipt, `expiresAfterLastKeystrokeMs` |
|---|---|
| 0.2.23 (L23) | **4,310.0 / 4,311.6 / 4,310.6** and, on a second run, 4,336.7 / 4,342.2 / 4,341.3 |
| 0.2.24 (L24) | **4,307.4 / 4,314.0 / 4,325.6** (`evidence/m3-choreography.jsonl`) |

Both apps set `expiresAt: now + 4000` (L23 `chat.q:181`; L24 `chat.q:183`). Both land
**~310-340 ms over the TTL**. **Snapback's timing on this path did not move.**

**What the grader measured directly, on 0.2.24** (`grading/trace.md` §m3-typing,
`typing-ui-probe3.json`, `typing-ui-probe4.json`):

| measurement | result | load |
|---|---|---|
| Server-side: `chat.type` → poll `chat.typers` | row gone at **4,024 / 4,025 / 4,027 ms** | 8.13 |
| Browser, `fill()` shape | expire **4,017 – 4,031 ms** | 7.30 |
| Browser, 26-27 chars at 60/100 ms | expire **3,972 – 4,020 ms** | 6.90 |
| Browser, **the harness's exact shape** (45 chars at 25 ms) | expire **4,218 / 4,230 / 4,404 ms** | 5.79 |
| Browser, 2/3/4/5 signed-in contexts | expire **4,189 – 4,534 ms**, 12/12 within bound | 8.10 |
| **The frozen harness, five grader runs** | **15/15 fail**, "waiting for sm-convo-typing to be hidden" timing out at **4,918 – 4,954 ms** | 5.68 – 8.38 |

So **Snapback's server-side share of the 1,000 ms budget is ~25 ms** (4,024 against
4,000). Eighteen direct observations of the app are inside the bound. Only the frozen
harness is outside it, and only under grader execution.

**Where the remaining ~900 ms lives — two app-side mechanisms, both visible in the
code:**
1. **45 unthrottled mutations per check (V2).** `src/Chat.tsx:15` fires `chat.type` on
   every keystroke; the harness types 45 characters at 25 ms
   (`instrument/choreography/choreography.mjs:1735-1740`), and starts its clock at
   `lastKeystrokeAt`, just before the final `press`. The lane's own receipt shows the
   typing action taking **1,531.6 ms** against a nominal 1,100 ms — 431 ms of backlog
   already accumulated before the clock even starts, which is the last upsert's server
   `now` drifting past the browser's last-keystroke time. That drift is load-sensitive
   in exactly the way the failures are.
2. **The client waits for the server to tell it something it already knows (V1).**
   `typers` returns `expiresAt` on every row; `src/Chat.tsx:19` hides the indicator on
   `typing.data.length > 0` alone. So the hide time is (server sweep) + (live
   invalidation) + (React render) instead of a local timer.

**Is it host load?** Partly, and less than it looks. The grader's L24 host ran at
**5.68-8.88**, *lower* than L23's **6.1-15.5**, and L24 failed 15/15 where L23 failed
2/3. The grader itself could not attribute the overshoot to load ("it failed at load
5.68 as readily as at 8.38") or to context count (2-5 made no difference). **Inference:**
the distinguishing variable is the frozen harness's own session state — five Playwright
contexts, seven prior segments' subscriptions, and by the grader's fifth run a
development store carrying its whole Phase-1 acceptance re-run plus its independent
execution (trace §0) — against a `sync public` `posts`/`likes`/`feedPosts` schema plus
14 synced maintains, where every extra row is extra replica work on every context. That
is an app residency choice interacting with an instrument, not an engine change.

**Verdict, plainly: not a Snapback regression. It is an app timing margin (a 4.0 s TTL
against a 5.0 s ceiling, ~1.0 s for the whole delivery path, of which the app spends
~430 ms on its own keystroke backlog and refuses a free local hide), amplified by the
frozen harness's session weight; host load is a contributing third-order term, not the
cause.** Snapback's share is ~25 ms of sweep latency and an unchanged live-invalidation
path. The one Snapback-attributable gap is documentation: nothing tells a live reader of
an expiring table that it may honour `.expiresAt` locally rather than wait for the
sweep (rank 1, §6).

### 3.2 queries_and_live 82 → 78: is the paved `held:` answer reading as a capability gap?

**Partly, but the larger share is a query nobody calls. Three of the scorer's four
clauses trace to code the app does not execute.**

The scorer's note, verbatim (`scores/astra/FINAL.md`, `queries_and_live`):

> M2/M3/M8 demonstrated paginated feeds and live convergence. However, final-report.md
> records **N_WIDE_MERGE for 1,000-chat search**, **incomplete meter cuts**, and **a UI
> limited to held-message search**; **unrestricted sync** also raises cost concerns.

It is reading exactly one sentence the builder wrote (`final-report.md:163`), verbatim:

> The server multi-chat search operation emits N_WIDE_MERGE for its maximum 1,000-lane
> form; a meter cut is explicitly incomplete. The UI uses the held-message search and
> labels its synced scope. Full public/message sync has no horizon and may be expensive
> at scale; native scale sync was not measured.

Clause by clause:
- **"N_WIDE_MERGE for 1,000-chat search" and "incomplete meter cuts"** are `search.all`
  (`search.q:36-39`), which **no file in `src/`, `app/` or `scripts/` references** (V4).
  The builder authored a server query, never wired it, kept it, and reported its note.
  **Two of four clauses are dead code.**
- **"a UI limited to held-message search"** is the paved answer being read as a limit.
  `app/search.tsx:3` maps the "All messages" scope to `api.search.held`, and the app
  labels the scope honestly (`app/search.tsx:2` renders `sm-search-offline` /
  "Offline · Searching synced messages"). The grader found this scope **correct**:
  tombstoned text disappears from *both* scopes, and `m5-a03` shows offline search
  returning 1 hit for a durable control and 0 for an expired message (trace §4, §M5).
- **"unrestricted sync"** is the builder's own uncapped, horizon-free `likes`
  (`social.q:22-32`) and `posts` at `cap 100000` — a real cost, correctly charged.

**So: yes, the held form is being read as a limitation, and the framing is doing most
of the damage.** The card teaches the author to say "incomplete" about the *server*
form and gives no vocabulary for the *positive* property the held form actually has.
`guide-search.txt:137-145` reads "Cold acquisition costs every live message in every
held chat… calling `searchHeld` on the server refuses E_QUERY_HELD" — every sentence
about the held form is a cost or a refusal. Nothing says *"a held query over a table the
device syncs without a horizon is complete by construction over everything this account
can read."* For this app that statement is **true and provable**: `messages` is
`sync to members[.conversationId]` with no horizon (`chat.q:71`), so the device holds
every message of every chat the viewer is in, and `search.held` over `byWords` is
therefore exhaustive — which is strictly *better* than any server walk, not worse.

**What would make the held form read as a feature:**
1. **A completeness claim the author can quote (smallest, highest value).** Have `check`
   emit a positive line for a held query whose every source is synced without a horizon:
   "`search.held`: complete over held rows — `messages` syncs to `members[.conversationId]`
   with no horizon, so this answers for every chat the viewer is in." Today `check`
   prints only the held *sites* ("Held: scan messages by byWords: held, **no horizon**"
   — `m5-check.txt`), which reads as a warning and is in fact the proof. The author then
   has a sentence to write instead of an absence to disclose.
2. **A device-held search that is complete by construction — it already is; say so on
   the wire.** A held `Read` over horizon-free sources could carry `complete: true` plus
   a scope statement the UI can render ("all 2,113 messages on this device"), so the
   client stops rendering "Results may be incomplete" for an answer that is not
   incomplete. Today the app derives `partial` from `complete` alone and has no way to
   distinguish "cut" from "device horizon" from "complete".
3. **Card framing.** `guide search`'s held section should open with what the form buys
   (offline, exhaustive over holdings, no meter, no cursor games) before what it costs.
   The current order teaches the author to report the cost.
4. **Stop the dead-code tax.** `check` cannot tell that `search.all` is unreachable, but
   the `N_WIDE_MERGE` note can end with the alternative it already knows: "if your app
   answers this from a held query, this one is not needed." That single clause would
   plausibly have removed both of the scorer's first two charges.

**Expected impact: queries +3-5, and it costs one `check` line plus a card reorder.**
Marked inference where it concerns the scorer's reading.

### 3.3 d-03: whose contract is the indistinguishable empty page?

**Snapback's, by design — and `API.md` is the lane overclaiming. `Read.cut` could not
have closed it and should not.**

The grader's finding, verbatim: "`/q/chat.history` returns HTTP 200 with
`{data:[], complete:true}` both for a conversation the caller is not a member of and for
one that simply has no messages" (`grading/grader-report.json` d-03;
`grading/tb-probe.mjs` `nonMemberDmRead`). `API.md:9` says: "Empty pages and membership
refusal must be distinguished."

**The platform says the opposite, in the card the builder read.** `guide-rules.txt`,
verbatim: *"a uniform false page is decided from its pinned prefix and returns **empty
and complete at no charge**."* And for writes: *"Unreadable or absent → `NOT_FOUND` for
rule denial … **no row, index, column or branch detail**."* Non-disclosure is the whole
point: telling Carol that the Alice-Bob DM exists and has messages she may not read is
the leak the design refuses.

`chat.q:99-100` is `query history(conversationId, c): return messages[conversationId]
after c last 50 by byConversationOrdinal messageCard`, and `messages` has
`read <- exists members[.conversationId, viewer]` (`chat.q:66`). The scan pins
`conversationId`, the rule reads `.conversationId`, so one verdict serves the whole
page: uniform-false → empty, complete, `cut: null`. **That is the correct answer, and
`complete: true` is truthful.**

**`Read.cut` would make it worse, and W8a's own ruling says so.** The disclosure ruling
(LLP 3000.007 §20.17, "The disclosure ruling"): "Publishing a cut reason would let a
non-uniform server read disclose hidden-row populations… a non-uniform server read
reports `cut: null`, documented as 'not disclosed here'". A `cut: 'rule'` value would be
exactly the population disclosure the ruling forbids — and here the page is not cut at
all.

**Classification: the lane's `API.md` overclaims.** A custom client *can* distinguish,
using a row it is allowed to ask about: `chat.conversation` (`chat.q:101-102`) returns
`conversations[conversationId]`, and `conversations` is
`read <- exists members[.id, viewer]` (`chat.q:12`), so a non-member gets **null** and
a member of an empty conversation gets **a row**. The lane documented a rule it never
tested; the grader wrote a client from `API.md` alone, on the first attempt, and this
was the only thing it could not do (trace §m6-a12).

**Snapback's residual share is documentation, not contract.** Nothing in `guide reads`
or `guide refusals` gives a client author the sentence "a read you are not allowed to
make returns an empty complete page — to distinguish it, ask for a row whose read rule
you can satisfy." Add that sentence and this class of app-doc overclaim stops. (The
builder never opened either card — H10.)

### 3.4 Wave-8 regression scan

**No wave-8 regression is visible in this lane.** Checked against every W8 surface:

| wave-8 change | exercised? | evidence |
|---|---|---|
| `Read.cut` on every read | shipped, unused | no `cut` in lane code (V3) |
| `query … held:` / `E_QUERY_HELD` | **yes, twice** | `search.q:34`, `chat.q:187`; `check` reports both |
| `snapback4 test` skips held queries (W8R1b) | no | `test` never run |
| sized recipe caps + printed caps (W8b) | **yes** | `m2-recipe.txt`; `feed.q` never edited |
| measured cold-acquisition row (W8b) | read, not reused | `guide-feeds.txt:464-466`; no `--residency` run (V7) |
| sticky adoption failures, bounded logs, `doctor` (W8c) | no | zero adoption failures anywhere |
| deferred pushes in `doctor` / `/effects` (W8c) | no | `doctor` never run |
| dev read meters by default (W8c) | shipped, unobserved | no `meter` in any evidence file |
| Postgres adapter repair | n/a | not on this path |
| orphan adoption waits for a just-closed tab's lock (lead) | no | no adoption incident |

The only wave-8 change on a hot path in this lane is W8c's default dev meter, which adds
counter serialization to every loopback read. **Inference, low confidence and
unmeasured:** if it costs anything on the live-query path it is well under the
20-40 ms of noise in the timing records, and the A/B in §3.1 (4,307-4,326 ms on 0.2.24
against 4,310-4,342 ms on 0.2.23, same check, same app shape) bounds any such cost
below measurement error. Live latencies elsewhere corroborate: DM live delivery
**801.6 ms** best-of-3, photo **1,014.4 ms**, reaction **164.5 ms**
(`grading/grader-report.json` `timingRecords`), against L23's reaction 934-945 ms and
photo 909-978 ms.

---

## 4. Grader defects d-01 … d-05

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (major) | M3's typing segment fails 15/15 across five grader runs: "waiting for `sm-convo-typing` to be hidden" times out at 4,918-4,954 ms; the app leaves ~0.6-0.8 s of slack against the brief's 5 s ceiling | `chat.q:183` `expiresAt: now + 4000`; `src/Chat.tsx:15` fires one unthrottled `chat.type` per keystroke (45 per check); `src/Chat.tsx:19` ignores the `expiresAt` it already receives; server-side removal measured at 4,024-4,027 ms (§3.1) | **App** (the TTL choice, the per-keystroke mutation, the ignored local deadline) — **harness** for the 15/15 shape, since 18 direct measurements of the same app are inside the bound and only the frozen harness's own session is not. **Not Snapback**: the identical check measures 4,307-4,326 ms on 0.2.24 and 4,310-4,342 ms on 0.2.23. Snapback's residue is documentary (V1, rank 1). |
| d-02 (major) | Re-selecting the same media file in either composer is a silent no-op: `send()` clears React state but never resets the hidden `<input type="file">`, so no `change` event fires and no attachment appears, with no error | `src/Posts.tsx:21` — `setText('');setFiles([])` with no `fileInput.current.value=''`; `src/Chat.tsx:17` — `setFile(null)` likewise, against the `<input type='file' ref={fileInput}>` created at `src/Chat.tsx:19`. Deterministically causes attempt 2 of 3 to fail for `feed-image-post-live-update` and `feed-video-post-live-update` in **both** the lane's receipt and the grader's re-run (10,025 / 10,068 ms timeouts, attempts 1 and 3 passing) | **App.** A plain React/DOM bug with no Snapback surface involved. Note it displaced L22/L23's `repost-following-feed-surface` transient as the m2 attempt-2 failure, so the harness race did **not** recur. |
| d-03 (minor) | The custom-client API cannot distinguish an empty page from a membership refusal, although `API.md` says it must | `chat.q:99-100` + `messages read <- exists members[.conversationId, viewer]`: a uniform-false page is empty, complete and free, exactly as `guide-rules.txt` specifies. `API.md:9` promises a distinction the platform deliberately withholds (§3.3) | **App** (the lane's `API.md` overclaiming), on **Snapback's deliberate contract**. Not a `Read.cut` gap — W8a's disclosure ruling forbids exactly this disclosure. Snapback's share is one missing sentence in `guide reads`/`guide refusals`. |
| d-04 (minor) | Signup creates the auth account before the handle is validated, so a duplicate-handle signup leaves the user authenticated with no profile row | `src/Auth.tsx:12` awaits `signup(url,email,password)`, then `:14` calls `api.saveProfile` and only surfaces the refusal. The `unique byHandle` violation arrives after the account exists (`grading/defect-hunt.json` `duplicateHandleRecovery`: `accountCreatedDespiteRejection: true`, `profileAfterRejection: null`, retry succeeds) | **App.** The app could have queried `api.profile({handle})` first, or done the whole thing in one mutation. Snapback-shaped only in that identity creation and the first app write are necessarily two operations. |
| d-05 (cosmetic) | The user-visible duplicate-handle error is raw datastore constraint text: "profiles.byHandle already has a row where handle = '…'", where the duplicate-email path renders a human sentence | `schema.q:12` `unique byHandle: handle`; the app renders `w.why.message` directly. The contrast the grader names is telling: `E_AUTH`'s message *is* human — "that email already has an account; sign in instead" (`api-verify.json` m1-a04) — because auth owns its wording, while a `unique` violation has no `else CODE` hook the way `require … else PROFILE_NOT_FOUND` does | **App**, but **Snapback-shaped and recurring verbatim** from L23's d-06. `unique byHandle: handle else HANDLE_TAKEN` would remove the class; it was rank 10 in the last review and did not ship. |

---

## 5. The score moves

The scorer reads only L24's narrative and record (N=1), so 1-3 point moves are within
variance. Every score below is the builder scoring its own lane, not the grader.

| Category | 0.2.23 → 0.2.24 | Snapback-attributable cause named in the note | Other causes |
|---|---|---|---|
| overall | 88 → 88 | "search completeness and sync scalability remain material reservations" (§3.2, V7) | "no confirmed backend defects"; 17 corrections all agent-error |
| setup_and_docs | 92 → **90** | "Reading the extensive surface imposed substantial upfront learning" — README 162 KB / 2,817 lines; the builder opened 11 of 27 cards (H10) | "M2's feed recipe supplied architecture and explicit limits" (W8b's printed caps) is the offsetting credit |
| data_modeling | 85 → **88** | — | "concise membership models, expiry, and maintained aggregates"; the charge is "deliberate indexing, typed references, and bounded-work reasoning" (H3, H4) and "rolling Trending still needed an explicit projection" (H12's successor) |
| authorization | 95 → 95 | — | Entirely positive; the grader's adversarial sweep found nothing (trace §4) |
| queries_and_live | 82 → **78** | "N_WIDE_MERGE for 1,000-chat search, incomplete meter cuts" — **both from a query the app never calls** (V4, H6) | "a UI limited to held-message search" is the paved `held:` form read as a limit (§3.2); "unrestricted sync" is the builder's uncapped `likes` |
| writes_and_transactions | 91 → **95** | — | "167,157 scale actions settling with invariant verification"; the L23 charge "online-only ranking dependencies restrict local prediction" is **gone** — `trendingEntries` is `sync public` (H12 closed) |
| offline_sync | 91 → **93** | "Prediction eligibility adds authoring constraints" (H1) | "cold web media/search, and queued writes surviving offline reload before ordered replay" (`m8-web-cold-media.json`, `m8-web-durable-queue.json`); "native restart behavior remains unverified, **without evidence of backend failure**" |
| media_assets | 96 → 96 | — | Variance; note fully positive |
| background_work | 92 → 92 | "explicit job bounds as an author responsibility" (H11) | Closed-client digest proof; "scale replay held schedules" (instrument) |
| client_integration | 87 → **88** | — | "session persistence, web/native device adapters, reconnect, and durable local clients"; charge is Expo Go's online fallback (instrument/native) |
| diagnostics_dev_loop | 92 → **94** | — | "typed-reference diagnostics guided correct relationships; M6's E_STRUCTURAL_FANOUT explained the bounded-page requirement" (H3, H4 read as **wins**); "no confirmed Snapback defect" |
| scale_and_limits | 79 → **80** | "Wide search merges and horizon-free sync remain concerns" (H6, V7, V8) | The L23 charge "potentially expensive, **unmeasured cold acquisition**" is **gone** — W8b published the number (V7) |
| operations | 83 → **86** | — | "persistent restart recovery… fresh-instance replay and inspection through documented SQL views"; the L23 `E_GENERATION` incident does not recur; charge is seed-ledger reset coordination and un-exercised M7 |

**The grade.** O1 80 → **75**: **101/119 pass, 0 fail, 18 not-run**, against L23's
104/119 pass with 15 not-run. The three-assertion difference and the placement are both
about evidence categories, not behaviour — L24's grader holds O1 at 75 because "the
90 anchor is unreachable because it names platform-proof artifacts explicitly and this
lane has none, and because M7 contributes nothing", with the entire shortfall being
`m6-a01..a07`, `m8-a17`, `m8-a18` (no simulator recording) and M7's nine
(`grading/grader-report.json` `oDimensionScores.O1`). O2 72 → **75**
(L23's major is closed by W8a; two new majors, one app-DOM and one harness-shaped).
O4 50 → **45** (identical absent simulator leg; a stricter read of the same evidence).
O5 75 → **75** (both the `otherwise` branch of a band function with no probe set).
**Inference:** O1 and O4 moved on grader construction, not on the lane.

---

## 6. Remaining Snapback-attributable friction, ranked (next-wave candidates)

Expected impacts are inference from the scorer's and grader's notes; nothing here is
measured. "W8 regression?" asks whether the evidence suggests wave 8 introduced the
problem — **for every row below, the answer is no.**

| Rank | Friction | Smallest product change | W8 regression? | Expected impact |
|---|---|---|---|---|
| 1 | **A live reader of an expiring table has no way to hide a row at its own deadline, and no card tells it to** (d-01, V1, V2) | Two sentences and one optional field. (a) `guide expire` and `guide reads` state: *"a live reader that selects `.expiresAt` may hide the row locally at that instant; the sweep's invalidation is a data event, not a rendering deadline."* The lane already receives the field (`chat.q:113-114` `{*, …}`) and ignores it (`src/Chat.tsx:19`). (b) Optionally, have the React reader drop expired rows from a live page client-side when the table declares `expire at`, so the default is right. This converts every "thin margin against a UI deadline" defect into an app-clock problem with zero round trips | **No.** Server-side removal measures 4,024-4,027 ms against a 4,000 ms TTL on 0.2.24, and the same frozen check measures 4,307-4,326 ms on 0.2.24 against 4,310-4,342 ms on 0.2.23 | O2 +5-8 (removes the run's only Snapback-shaped major); removes a defect class that has now appeared in two consecutive lanes |
| 2 | **The paved `held:` answer has no vocabulary for the completeness it actually has** (§3.2, H6, V4) | Have `check` print a positive completeness line for a held query whose every source syncs without a horizon — it already computes exactly this and prints it as a warning-shaped fact ("Held: scan messages by byWords: held, **no horizon**", `m5-check.txt`). Turn it into: *"`search.held`: complete over held rows — `messages` syncs to `members[.conversationId]` with no horizon."* Reorder `guide search`'s held section to lead with what the form buys. Optionally carry a held scope statement on the `Read` so a UI stops printing "Results may be incomplete" for a complete answer | **No** — W8a created the form; wave 8 simply did not supply the language for it | queries +3-5; changes what a builder writes in its own report, which is what the scorer reads |
| 3 | **`N_WIDE_MERGE`'s rewrite names a flag that does not exist, on a query nothing calls** (H6, V4) | One-line text fix: "Measure with `snapback4 test --cost`" → `snapback4 check --cost` (`cli-help.txt:4`; `snapback4 test` takes only `[--residency] [--fixture] [--as]`, `README.md:2357`). Then add the alternative the note already knows: "if your app answers this from a `held:` query, delete this one." Two of the scorer's four `queries` charges are this note quoted through the report | **No** — W7d wrote the text; wave 8 did not revisit it | queries +1-2; diagnostics +1; removes a wrong instruction from the compiler |
| 4 | **`N_MAINTAIN_SYNCED` is a 16-line note whose per-maintain measurement is structurally zero** (H5) | Collapse it: one line naming the count and one real number — total synced value rows per viewer at the current store — instead of 14 lines of "0 value rows (before adoption)". Keep the one clause that decides something ("`social.like` would stop predicting if `likeCounts` goes `online only`") and apply it to every entry. The note's `test --residency` pointer has now gone unrun in three consecutive lanes, and its `guide: residency` pointer printed 10 times into a lane that never opened that card | **No** (ships in 0.2.22) | diagnostics +1; the final check's note volume falls by ~14 lines |
| 5 | **A client author has no documented way to distinguish a refusal from an empty page, so app docs promise one** (d-03, §3.3) | One sentence in `guide reads` and `guide refusals`: *"a read whose rule you do not satisfy returns an empty, complete page — by design, so a hidden population is not disclosed. To distinguish, ask for a row whose read rule you can satisfy (here, the conversation itself)."* Do **not** add a `cut: 'rule'` value; W8a's own disclosure ruling forbids it | **No** — this is the contract `guide-rules.txt` already states for uniform-false pages | O2 +2 (removes a minor); stops a recurring class of app-doc overclaim |
| 6 | **Every diagnostic names a `guide:` card and `why <CODE>` answers in one sentence, so the cards go unread** (H10, V3) | Make `why <E_CODE>` print the card section the note points at, not a gloss. `why-type.txt` is 84 bytes — "E_QUARRY_TYPE: a value meets a declaration of another type; the message names both" — which adds nothing over the error the author just read; `why-structural-fanout.txt` (707 bytes, with a worked example) is what the shape should be. This is the cheapest route to wave 8's two unconsumed features: `Read.cut` and the default meter live only in `guide reads`, which this lane never opened despite `guide: reads` printing in its own final check | **No** | diagnostics +1; setup +1; gives `Read.cut` and the dev meter their first consumer |
| 7 | **`E_STRUCTURAL_FANOUT` for emit-only loops over a bounded list, fourth run running and now twice per run** (H3) | Unchanged from the last two reviews: admit `for p in <derived list from one complete capped page>` when the body only emits, or let the author assert the provenance. Four consecutive lanes have written the same rejected shape and applied the same mechanical rewrite; the essay calls it "useful feedback" *and* "interrupted a pattern that would be routine" | **No** | data_modeling +1; removes one compile round from every messaging app |
| 8 | **A `unique` violation has no `else CODE` hook, so raw index text reaches users** (d-05, L23 d-06 verbatim) | `unique byHandle: handle else HANDLE_TAKEN`, matching `require … else CODE`. The contrast is already in the evidence: `E_AUTH` renders "that email already has an account; sign in instead" because auth owns its wording, while `E_CONSTRAINT` renders "profiles.byHandle already has a row where handle = 'wv1789546545748'" | **No** — this was rank 10 last review and did not ship | O2 +1 (removes the cosmetic); the same defect has now been filed twice |
| 9 | **Recurring low items** | `E_SQL_INTERNAL` names three refusals and no admitted surface and carries no `guide:` line (H8) — add "application views: `snapback4 sql` on your declared tables; `snapback4 data <table>` for rows". `run --as` rejects an email with no hint, where `dev`'s persona door and the app's own login both use email (H9) — accept an email on loopback, or say "expected a persona name or `user:` id; try `--as alice`". The one-time service token prints on the stderr stream harnesses capture into committed logs (`m5-expiry-backend.log:9`) — print it on stdout, or behind `--print-token`. Synthetic residency sites, 62/318 (V6) — emit `file:line` for rule-derived sites. `N_NO_HORIZON` did not fire on an uncapped `sync public` table this run and fired on one last run (V8) — state that the suppression is reader-dependent, so silence is not approval | **No** | operations +1; diagnostics +1; setup +1 |
| — | **Not Snapback (instrument), for the record:** no holdout probe set was committed, so O3 is null and O5's 75 is a band artefact (trace §0, §5, §8); the nine simulator assertions are `not-recorded` and cap O4 at 45 (trace §7); the frozen grader schema cannot represent M8 at all, so the Sept 5 and Sept 12 comparisons are prose only (trace §10); the grader is uncalibrated; the frozen typing check is the only measurement of the app that disagrees with eighteen others (§3.1) | Instrument: commit a probe set; extend the report schema to M8's 18 IDs; make O5's 90 branch reachable; either loosen the typing check's clock to the *first* keystroke that should have shown an indicator or publish the harness's own overhead so a builder can size its TTL against it | — | O3 becomes scorable; O4 and O5 become measurements; d-01's class stops being ambiguous |
