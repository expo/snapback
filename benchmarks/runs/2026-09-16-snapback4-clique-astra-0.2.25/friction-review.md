# Clique on snapback4@0.2.25 (Astra, medium effort): friction review against the 0.2.24 lane

**Short version.** Holistic score **91**, up 3 from 0.2.24 — the highest of the
series — and the *assertion* outcome is byte-identical to L24: **101 of 119
pass, 0 fail, 18 not-run** (85/0/16 in the 101-ID prior-comparable set, 16/0/2
in M8; `grading/trace.md` "Result totals"). Everything that moved in the grade
moved on the grader's judgment of the same evidence shape: **O2 75 → 78** (four
minors, no major — L24 had two majors) and **O4 45 → 10** (identical absent
simulator leg, read against the anchor and against a claim the lane made in its
own run record). **O5 is null**, not 75: this grader refused the band function's
`otherwise` branch where L24's took it.

**Wave 9 shipped six things and the builder used four of them, unprompted:**
- **W9c `unique … else CODE` — adopted, and it closed a defect that had been
  filed verbatim in two consecutive lanes.** `snapback/schema.q:12` is
  `unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'`, and the
  grader's browser check reads back `"dupHandleError": "That handle is taken."`
  (`grading/evidence/web-checks.json`, `m1-ui`). L23's d-06 and L24's d-05 —
  "profiles.byHandle already has a row where handle = '…'" reaching a user — are
  **closed**. This was rank 8 in the last review.
- **W9a's reader-expiry client form — adopted twice.** `guide-expire.txt:24-40`
  now says "a live reader that must hide it at its deadline drops it locally by
  `expiresAt`" and ships a two-line renderer. `src/chat.tsx:16` is
  `[...p.items].filter(m=>m.expiresAt===null||m.expiresAt>Date.now())` and
  `app/search.tsx:2` is `if(m.expiresAt!==null&&m.expiresAt<=Date.now())continue`.
  **This was rank 1 in the last review.** It was *not* applied to the one reader
  with a hard UI deadline — the typing indicator (§1b V1).
- **W9b's residency `file:line` — complete.** `snapback/generated/residency.json`
  carries **285 site strings and 0 without a `file:line`**, against L24's
  62/318 = 19.5 % synthetic. **L24's V6 is closed**, and the builder ran
  `check --residency` for the first time in the series (`evidence/m3-residency.txt`,
  264 lines).
- **W9b's `N_MAINTAIN_SYNCED` zero-count drop — verified.** "current store
  measurement: 0 value rows (before adoption)" occurs **14 times** in L24's final
  check and **0 times** anywhere in L25. **L24's H5 is closed.**
- **W9a's held completeness line — printed, and the note it replaced never
  fired.** `evidence/m5-check.txt:18` onward is "horizon-free source coverage —
  all sources sync without a horizon; answer completeness still depends on
  runtime authorization, limits and continuation", with four `Held:` sites each
  carrying `file:line`. `N_WIDE_MERGE` appears in **no check in this lane** (only
  in `guide-search.txt`) — see §3.2 for why that is mostly the builder, not W9a.
- **W9b's `why <CODE>` card sections — shipped, never invoked.** `snapback4 why`
  was run **zero times** this run (no `why-*.txt` in `evidence/`, against L24's
  two). W9b's headline feature has no consumer in this lane (§1b V2).

**setup_and_docs fell 90 → 85, and the cause is main's README split, not wave 9.**
The package docs became two files — `README.md` (§1–3, 81,954 B) plus
`CLIENT-AND-OPERATIONS.md` (§4–8, 86,621 B) — and the only cross-reference is
`README.md:1523-1525`, the last line of the first file, while `README.md:21`
still reads "Everything below is the whole published surface. There is no other
documentation." See §3.1.

**`E_STRUCTURAL_FANOUT` did not fire — for the first time in five lanes** — and
neither did `N_WIDE_MERGE`, `N_NEVER_COMPLETE` or `N_NO_HORIZON`. The final
check is **two notes, 23 lines** (`evidence/final-check.txt`), against L24's
three notes over ~30.

Lane: `/Users/ccheever/clique-sb4-20260916-astra-cal9/lanes/astra-snapback4/`
(**L25** below). The previous lane is **L24**
(`/Users/ccheever/clique-sb4-20260916-astra-cal8/lanes/astra-snapback4/`).
- **Paths.** Paths without a directory are under L25's `evidence/`.
- **Times.** Run start `1789561689` = 2026-09-16T12:28:09Z = 05:28:09 PDT
  (`run-log.md:5`; `CREATED_AT` = 12:27:47Z). Run end `1789566557.517`, total
  lane wall **4,868.5 s** including orientation, replay, verification and
  reporting (`final-report.md:9`). Run-log epochs are *entry* times and file
  times are modification times; the two differ by up to ~10 min.
- **Release.** Wave 9 is LLP 3000.007 §20.18,
  `snapback-w4b/llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:3730-3746`,
  with journal entries W9a, W9c, W9b, W9R1a, W9R1b, W9R2 at
  `snapback-w4b/snapback4/JOURNAL.md:22103-23165`.
- **Package docs.** L25: `README.md` 81,954 B / 1,525 lines **plus**
  `CLIENT-AND-OPERATIONS.md` 86,621 B / 1,388 lines = **168,575 B / 2,913 lines**.
  L24: one `README.md`, 162,262 B / 2,817 lines. **+3.9 % bytes, +3.4 % lines**,
  now across two files (L24 was +2.2 % over L23).
- **Run record.** L25 **wrote** `run-record.json` (L24 did not). Its `notes`
  field carries "Native Hermes exports only; simulator proofs not required by
  ENVIRONMENT", which the grader read and called inaccurate (§3.3).
- **Grader.** family `claude`, model `claude-opus-5`, `calibrationPassed:false`,
  `sameFamilyGraded:false`, `rerunsUsed:1`, `probeSetSha256: none-uncommitted`.
  **O3 is null and O5 is null** (trace §"Deviations", §"Scale replay", §Phase 4).
- **Grader host.** shared, 1-min load **8–14** throughout (trace, Session row),
  against L24's 5.68–8.88.
- **Correction ledger.** **17 agent-error, 2 environment, 0 snapback4-defect**
  (`final-report.md:44`), against L24's 17 agent-error / 0 environment.

---

## 1. Friction in the 0.2.25 run

### 1a. Friction the builder hit that Snapback caused

H-numbers are this review's items. H/V numbers from FRICTION-0.2.24 appear as
"L24 H2" and so on.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| H1 | **The README split put half the surface behind one link on the last line of the other half** | **Verbatim, `node_modules/snapback4/README.md:21-23`:** "Everything below is the whole published surface. There is no other documentation; the diagnostics carry the rest". That is no longer true: §4 The client, §5 Development, §6 Release, §7 Expo and §8 Not in this release now live in `CLIENT-AND-OPERATIONS.md` (`/usr/bin/grep -n "^## "` on each file). The **only** pointer in README is `README.md:1523-1525`: "## Client and operations reference / Continue with [the client, development, releases and Expo](./CLIENT-AND-OPERATIONS.md)." The "Start here" paragraph at `README.md:28-34` routes the reader to nine `guide` cards and **does not name the second file**.<br>**What it cost in the scorer's words.** `scores/astra/FINAL.md` `setup_and_docs`, verbatim: "Discovering the complete workflow required the README, client reference, keyword cards, and generated API; the application's responsibility for cold-offline shell delivery was easy to miss." That is `essay.md:17` quoted back: "discovering the full practical surface required moving among the README, client reference, keyword cards and generated API."<br>**Provenance.** The split is main's change in this release, not wave 9's; LLP 3000.007 §20.18 does not mention it. | No correction loop. **setup_and_docs 90 → 85** (§3.1). | **New** (docs topology) |
| H2 | **`E_QUARRY_TYPE` on the recipe's repost helper — third consecutive run, the same parameter, verbatim** | **Error, verbatim.** `backend.stderr:17-20`: "snapback4 dev: 1 problem in snapback/; serving the previous generation / social.q:102:23 — E_QUARRY_TYPE: feedRepost's postId is a feedPosts reference; got a posts reference / rewrite: pass a feedPosts reference for postId / guide: types".<br>**The shipped signature is unchanged from L24 and L23.** `feed.q:210` is `fn feedRepost(postId: feedPosts)` — a parameter **named** `postId` and **typed** `feedPosts`. `/usr/bin/diff` of L24's and L25's `feed.q` returns exactly one line, and it is not this one.<br>**Fix, app-side again.** `social.q:106-107` is now `event = feedPosts[p.authorId, postId, false] ! else EVENT_NOT_FOUND` then `feedRepost(event.id)`.<br>**Builder.** Run log `1789562324`, `attribution=agent-error`: "feedRepost expects feedPosts ref, corrected bridge to resolve source event." Diary M2 calls the diagnostic correct. | Folded into M2 authoring; one compile round. | **L24 H2 / L23 H4 recurring — third run** (low) |
| H3 | **Effects are globally named and jobs are module-qualified, and the builder got it wrong in both directions inside one milestone** | **Error, verbatim.** `backend-m6.stderr:23-26`: "snapback4 dev: 1 problem in snapback/; serving the previous generation / digest.q:51:1 — E_QUARRY_UNKNOWN: schedule dailyDigest names bare job daily; digest.q declares it as digest.daily / rewrite: digest.daily — check --fix applies it / guide: jobs".<br>**And the mirror image, minutes later.** Run log `1789564400`, `source=package README/guide attribution=agent-error`: "effect names are global notify, not module-qualified chat.notify. Corrected handler and stopped owned worker 2016 for supervised restart."<br>**Builder names it.** `essay.md:15`, verbatim: "I also confused globally named effects with module-qualified operations when wiring the provider worker. These were my mistakes, not demonstrated platform defects. The diagnostics made the fixes concrete, although **the naming distinction was easier to overlook than I would like in a first encounter**." Diary M6 repeats it: "global effect naming was easy to confuse with module operation names."<br>**Only one half diagnoses.** The schedule half has a precise `E_QUARRY_UNKNOWN` with `--fix`; the effect half produced a **runtime** miss in `snapback/worker.mjs`, found by a failing proof, with no compile-time signal. | Two correction loops inside M6, plus one supervised worker restart. | **New** (naming asymmetry) |
| H4 | **The Following recipe sizes its caps from `--authors` and leaves its backfill bound a literal** | **The whole diff.** `/usr/bin/diff` L24's `snapback/feed.q` against L25's returns exactly one hunk: `162c162 / < if visited = 200: / --- / > if visited = 1000:`. Both lanes installed with identical arguments — `m2-recipe.txt` is byte-identical in the two lanes: "caps: authors=1100, edges=100000, pulls=35200, pullCounts=35200, sourceEvents=60000, broadcast=32000, tombstones=32000; …".<br>**So `--authors 1100` sizes eight caps and not the one loop bound that has to match them.** `feed.q:5` is `cap 1100`; `feed.q:160-164` is `visited = 0` / `if visited = 1000: break`.<br>**Builder.** Diary M2: "expanded backfill to its declared full author cap." `final-report.md:81`: "generated feed recipe contributes only its one manually changed bound."<br>**Trajectory.** L23 deleted the bound outright; L24 left it at 200; L25 raised it to 1000. Three lanes, three different hand treatments of the same literal. | Minutes; no logged loop. It is the only recipe line touched all run. | **S16 residual** (W8b closed the caps half only) |
| H5 | **`N_NO_CURSOR` fires in every check from M3 to the final one, and its rewrite names one of the two available fixes** | **Note, verbatim, 8 checks.** `final-check.txt:2-4`: "note: chat.q:103:1 — N_NO_CURSOR: query chat.typingNow returns a page of 50 typing rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on / rewrite: declare `c: cursor ?` and page with `after c` … / guide: reads". It appears in `m3-check.txt`, `m4-check.txt`, `m5-check.txt`, `m6-check.txt`, `m8-check.txt`, `final-check.txt` and `backend.stderr` (7 distinct sites as line numbers shift).<br>**It is unreachable in this app, and L24 proves the lever.** `chat.q:103-104` is `query typingNow(conversationId) : return typing[conversationId] first 50 by byConversationPrincipal {…}`; `typing` (`chat.q:76-86`) has `unique byConversationPrincipal: conversationId, principal` and `members` has `cap 50 by conversationId` (`chat.q:30`) — so at most 50 rows can exist for a pinned conversation. **L24's identically shaped `query typers` produced no such note, and L24's `typing` table declared `cap 50 by conversationId` (L24 `chat.q:78`), which L25's does not.** *Inference (high confidence): the suppression is cap-driven, the note is correct behaviour given the app's schema, and the rewrite never mentions the `cap` that silences it.*<br>**Not acted on.** `typingNow` still has no cursor; nothing in `diary.md`, `essay.md` or `final-report.md` mentions it. | Seconds each; no loop. It is half the final check's note volume. | **New** (note actionability; not a wave-9 regression) |
| H6 | **`N_MAINTAIN_SYNCED` is shorter and sharper and still carries three lines that decide nothing, and its measurement pointer has now gone unrun for four lanes** | **Note, verbatim head.** `final-check.txt:6-14`: "note: social.q:40:1 — N_MAINTAIN_SYNCED: 6 synced maintains:" with three lines ending "**no currently eligible mutation reads it**" (`followers`, `followingCounts`, `reactionCounts`) and three ending "social.create … would stop predicting if … goes `online only`". Closing: "rewrite: keep inherited sync for local readers, or add `online only` to opt out; **measure cold rows with `snapback4 test --residency`**".<br>**Better than L24 in two ways.** The structurally-zero "current store measurement: 0 value rows (before adoption)" line is **gone** (14 → 0 occurrences), and the count fell 14 → 6 because the builder put every Insights maintain `online only` (`insights.q:1-18`).<br>**The pointer still goes unfollowed.** `snapback4 test` was never run (`/usr/bin/grep -rn "snapback4 test"` over `evidence/*.txt`/`*.log` hits only the note text and `guide-feeds.txt:436,450`). The builder ran `check --residency` instead (`m3-residency.txt`), which prints residency **facts** and no cold rows or bytes. `guide: residency` printed in every check and `evidence/` contains no `guide-residency.txt`. | Seconds; no loop. | **L24 H5 recurring, much reduced** |
| H7 | **`snapback4 why` was never invoked, so wave 9's headline diagnostic change has no consumer** | **Pointer printed, every check.** `final-check.txt:16` ends "— snapback4 why <op>"; every note ends `guide: <card>`. `run-help.txt:15` documents the new shape verbatim: "why <E_CODE \| op \| table \| id>   explain a refusal or note **with its card section**, an operation's cost, a table's rules, or work by id; --release <dir>, --values" — W9b plus main's work-record additions, all on one help line the builder captured at 06:19.<br>**Invocations: zero.** `evidence/` contains no `why-*.txt` (L24 retained two: `why-type.txt`, `why-structural-fanout.txt`).<br>**Cards opened: 13.** `guide-{aggregates,assets,expire,feeds,jobs,language,native,personas,prediction,replay,rules,search,sync}.txt` of the 26 the card index lists (`language.txt:399-402`). Still unopened: **`reads`** (where `Read.cut`, the dev meter and `N_NO_CURSOR`'s own card section live, and where every `N_NO_CURSOR` note pointed 7 times), **`residency`**, `refusals`, `types`, `programs`, `maintains`, `effects`, `presence`, `writes`, `shapes`, `indexes`, `bounds`, `evolution`, `actions`, `services`, `witness`. | Not a loop; the second consecutive run in which `guide reads` goes unopened and `Read.cut`/the meter therefore go unused. | **L24 H10 recurring** (diagnostics routing) |
| H8 | **An indexed `matching` directory cannot answer the empty query, so a person picker needs a second query and a client branch — and the first attempt shipped the wrong one** | **Failure, verbatim.** `m3-regression-first-failure.log:2`: "STRUCTURED CHOREOGRAPHY MISS … assertion":"member-add-promote-remove-leave-and-live-cutoff" … "error":"addable group member did not expose semantic value **dave** within 10000ms"".<br>**Cause and fix.** Run log `1789565396`, `attribution=agent-error`: "member picker empty search sorted only its first page, hiding Dave. **Restored registration-order allPeople list for empty query; indexed search remains for typed queries.**" The two queries are `schema.q:26` `query people(q, c): return profiles matching q after c first 20 by byWords` and `schema.q:33` `query allPeople(c): return profiles after c first 50 by byId`; `src/chat.tsx:19` branches on `memberQ?matchedPeople:allPeople`.<br>**Documented, in a card read at M5.** `guide-search.txt:62`, verbatim: "an empty search matches nothing, not everything". The consequence — that a directory therefore needs two operations and a different index order for each — is stated nowhere. | One correction loop at M8 **plus a full M3 choreography rerun** (`m3-regression-choreo.log`, `1789565476`). | **New** (search ergonomics) |
| H9 | **The one-time service token is still printed onto the stream a harness captures** | `backend-m6.stderr` and `backend-m8.stderr` are the lane's committed worker logs; the grader had to redact "The dev worker's service tokens in `logs/backend*.stderr`" from its own copies (`grading/trace.md`, "Cleanup and redaction"). The lane also wrote `evidence/audit-token-location.txt` (289 B) acknowledging the placement. | None. | **L24 §1a second bullet recurring** |

Two smaller Snapback-shaped moments were absorbed without complaint:
- **Config ingestion, fourth run running.** `scripts/configure.mjs` compiles
  `config/*.json` into `snapback/config.q` and `snapback/digest.q` because Quarry
  does not read a config file; `README.md:35-39` documents the workaround. Not
  named as missing in `diary.md` or `essay.md`.
- **`E_QUARRY_SYNTAX` × 3 in one compile** (`backend.stderr:218-229`):
  "chat.q:104:18 — expected ":", got ")"", "chat.q:119:233 — range reads require
  first N or last N", and a cascade — "chat.q:118:1 — query apiHistory has an
  empty body / rewrite: **fix this Quarry line and rerun snapback4 check**",
  whose rewrite says nothing. The first two are the builder's; the third is a
  derived diagnostic with no content.

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| V1 | **The expiry client form was adopted for messages and search and not for the one reader with a hard UI deadline** | `src/chat.tsx:16` filters history rows at their deadline and `app/search.tsx:2` filters search hits, both in the W9a shape. **Two lines later**, `src/chat.tsx:17` renders `<TypingIndicator visible={'data'in typing&&typing.data.some(t=>t.principal!==viewer)} …/>` — a pure row-presence test, on a query that returns `{*, profile: …}` and therefore already carries `expiresAt` (`chat.q:79,103-104`). The builder also raised the TTL 4,000 → **4,500 ms** (`chat.q:188`) and throttled the mutation to 150 ms (`src/chat.tsx:16`, `if(text&&Date.now()-lastType.current>150)`).<br>**Result: the margin is spent again.** The builder's own receipts measure `expiresAfterLastKeystrokeMs` **4,817.8 / 4,825.5 / 4,941.5** (`m3-choreo.jsonl`) against the 5,000 ms bound — **58.5 ms of headroom on the worst trial**; the grader's three runs read 4,816.9 / 4,817.7 / 4,816.1 and its independent browser probe 4,902 / 4,897 / 4,888 (trace, m3-a06/a07). The delivery-path overhead above the TTL is **~317 ms**, statistically the same as L24's 4,307−4,000 = **307 ms**. `guide-expire.txt:25-40` gives the exact fix and names no case. | **L24 V1 recurring, with the fix in the same file** |
| V2 | **`why <CODE>`, `Read.cut` and the default dev meter all shipped into a lane that touched none of them** | `/usr/bin/grep -rn "\.cut\b\|cut:" src app scripts snapback/*.q` returns **nothing** (second consecutive run). `/usr/bin/grep -rln '"meter"'` over `evidence/*.json` returns **nothing** (second consecutive run); the lane's own metering record is `evidence/metering-unavailable.json`, whose whole content is `{"adapter":"unavailable","reasonCode":"HARNESS_TOKEN_STREAM_NOT_EXPOSED_IN_LANE",…}` — i.e. *token* accounting, not the read meter, so the read meter was never even considered. `why` invoked zero times (H7). All three are documented in `guide reads`, which was not opened, for the second consecutive run. | **L24 V3 recurring; W9b added to the unconsumed set** |
| V3 | **`ranked` is a `sync public` app table with `insert <- allow` and `update <- allow`, and the recipe's widened rules persist unchanged** | `insights.q:35-40`: `public 'Exact like-ranked original posts…'` / `insert <- allow` / `update <- allow` / `delete <- deny` / `expire at .expiresAt` / `sync public`. Reachable only through `social.create` and `social.like`, both of which validate, so the exposure is the same de-fanged shape as L24 V5. The recipe's own widened rules are byte-identical to L24: `feedAuthors update <- allow` (`feed.q:8`), `feedPulls insert <- allow` (`feed.q:32`), `feedPullCounts insert/update <- allow` (`feed.q:42-43`). The grader's adversarial sweep found nothing reachable (trace §3b, 14 refusals). | **L24 V5 / L23 V7 recurring** |
| V4 | **`N_NO_HORIZON` did not fire, on a schema with two uncapped horizon-free public tables** | `social.q:21-32` `likes` is `public` + `sync public` with **no `cap` and no `last N by`**; `chat.q:47-74` `messages` is `sync to members[.conversationId]` with no horizon; `schema.q` `profiles` is `sync public` with no cap. `/usr/bin/grep -rl N_NO_HORIZON evidence/` hits only `guide-search.txt`, `guide-prediction.txt`, `guide-sync.txt` — **no check**. `m3-residency.txt:17-38` lists the same facts neutrally ("likes: sync public", "messages: sync to members[.conversationId]", "profiles: sync public" — three of 21 tables with no cap and no horizon). L23's H10 recorded the mirror-image surprise. **Inference:** silence continues to be readable as approval in both directions. | **L24 V8 recurring, still inverted** |
| V5 | **The unread count is an ordinal difference with no maintained counter, and this run the grader filed it** | `src/chat.tsx:11` and `:12` both compute `unreadCount={(m.latest?.ordinal??0)>m.readOrdinal?1:0}`. `chat.inbox` already returns `latest` as a full `messageCard` including `senderId` (`chat.q:88-90`), so `latest.senderId !== viewer` was one comparison away. The grader filed it as **d-01** (`grading/grader-report.json`; `grading/evidence/screens/own-unread.png`). The approximation is no longer disclosed anywhere in `final-report.md`. | **L23 V10 / L24 V9 recurring, now a filed defect** |
| V6 | **Cold acquisition is measured in wall time and not in rows or bytes, for the fourth lane running** | `evidence/scale-replay/verification-final.json:281-283` is the whole measurement: `"coldInitialSync": {"wallMs": 8290.084207999986}` at the 167,157-action corpus (1,008 users / 50,228 posts / 100,015 messages). `final-report.md:28` reports it and the scorer credits it ("8.29-second cold acquisition"). What is still missing is the row/byte figure the card publishes for its own shape — `guide-feeds.txt:464-466`: "**Total** \| **139,413** \| **17,876,585**" and "**139,413 rows / 17,876,585 bytes is large cold acquisition**" — for an app that adds chat, likes, media and reactions on top. The command that produces it, `snapback4 test --residency`, has now gone unrun in four consecutive lanes. | **L24 V7 partly closed (the builder measured *something*); the row/byte half open** |
| V7 | **The app's write-path prediction gaps are unchanged and unremarked** | `final-check.txt:16`, verbatim: "2 mutations never predict: chat.createDM (reads online-only table dmPairs), social.follow (reads online-only table feedPullCounts); 1 mutation has insert arms that never predict: social.follow (feedPullCounts is online only)". `dmPairs` is the builder's own `online only` table (`chat.q:38-45`); `feedPullCounts` is the shipped recipe's (`feed.q:36-45`). No complaint anywhere; offline_sync nonetheless rose 93 → 95 and writes held at 95. | **L24 H1 residual, unchanged** |
| V8 | **The lane's own run record contains a claim the grader used to score it down 35 points** | `run-record.json` `notes`, verbatim: "Native Hermes exports only; **simulator proofs not required by ENVIRONMENT**." `instrument/ENVIRONMENT.md:26` says the opposite of what that implies — "iOS simulators exist (Xcode, iPhone runtimes)" — and `instrument/choreography/simulator.md` is the native proof contract. `run-help.txt:21-22`, captured by the builder at 06:19, lists `witness ios --bundle-id … --segment … --artifacts …`. The grader quotes the claim and calls it inaccurate (`oDimensionScores.O4`). See §3.3. | **New; lane hygiene, not Snapback** |

### 1c. Friction that was not Snapback's

- **Environment** (2 logged events, `final-report.md:46,64`; run log `1789562025`,
  `1789566557`):
  - The copied harness lacked `../../lib/json-schema.mjs`; the lane supplied a real
    AJV2020 validator with no browser assertion changes.
  - PATH resolved Node **25.9.0** against the declared 24.18.0; commands were
    pinned to the absolute 24.18.0.
  - Copied instrument directories were read-only and needed `u+w` before
    `npm install`.
- **Instrument:**
  - **No holdout probe set was committed** (trace, deviation 1), so phase 4 was
    skipped, **O3 is null**, and — unlike L24 — **O5 is null too**, because this
    grader declined the band function's `otherwise` branch (§3.3).
  - The grader is **uncalibrated** (`calibrationPassed:false`); not a
    claim-eligible wave.
  - **M7 is not run by instruction**, costing 9 assertions that stay in O1's
    denominator.
  - **No simulator recording of any kind**; `ios-simulator-m6` and
    `ios-simulator-m8` are `not-recorded`, costing `m6-a01..a07`, `m8-a17`,
    `m8-a18` and capping **O4 at 10** (trace §3g).
  - **The frozen `grader-report.schema.json` still admits only `m[1-7]-aNN`**, so
    the 119 IDs ship in two files (trace, deviation 4).
  - The grader's phase 1 ran **three times**; attempts 1 and 2 failed
    deterministically on the lane suite's seed-age dependence (d-04) and
    corrupted seeded data, which then failed M5 search.
- **The builder's own errors** (17 `agent-error` events, `final-report.md:47-63`):
  an RN-Web `Image.resolveAssetSource` crash in a successful web export; feed
  tabs unreachable from profiles; write-heavy acceptance run concurrently with
  choreography, displacing a retained witness (PIDs 27983/27988 stopped); a lazy
  web-device JS chunk blocking an offline reload; reading the server before a
  predicted media write settled; an inline video mounting after its URL; JSX
  callback delimiters; a typed-parameter/scalar-predicate Quarry helper; the
  effect-name and schedule-name confusions (H3); a replayed media upload reusing
  a write id with fresh bytes; a missing home inbox surface; the member-picker
  pagination regression (H8); a boundary shell run in the scale workdir; a
  receipt path reused across choreography reruns; a root-relative receipt
  inspection run in the wrong directory. Plus the builder's halves of H2 and H8.
- **App defects the grader found:** d-01 (own-message unread badge), d-02 (empty
  post accepted), d-03 (edit to empty accepted), d-04 (seed-age-dependent
  acceptance entrypoint). All four are app or app-harness; none is Snapback (§4).

---

## 2. The 0.2.24 items: recurred, closed, changed, or unexercised

### Explicit checks the brief asked for

- **`query … held:` — adopted once, and it is again load-bearing.**
  `chat.q:234-235` is `query searchHeld(q: text <=100, c: cursor ?) held:` over
  `messages matching q … by byWords`; `app/search.tsx:2` binds the "All messages"
  scope to `api.chat.searchHeld`. `check` reports it from M5 onward, verbatim
  (`m5-check.txt:17`): "chat.searchHeld: runs: device (held; server refuses
  E_QUERY_HELD; no server fallback)". `N_NEVER_COMPLETE` appears in **no check**.
  L24 used the form twice (`search.held` + `chat.heldHistory`); L25 uses it once
  and reads conversation history through an ordinary server query
  (`chat.q:101-102`). **Benefited: yes** — the grader's disappearing-message and
  cold-offline checks both exercise the held scope and pass (trace §3e; "search
  for 'coffee' returned 3 results" offline).
- **`Read.cut` — shipped, never read, second consecutive run.**
  `/usr/bin/grep -rn "\.cut\b\|cut:" src app scripts snapback/*.q` returns
  nothing. The card's rendering rule at `guide-search.txt:84-85` — "Render
  'Results may be incomplete' for `complete: false` with `cut: null`, even when
  empty; never 'no matches'" — is nonetheless followed: `app/search.tsx:2` ends
  `{'data'in messages.read&&!messages.read.complete&&<Text>Results may be
  incomplete</Text>}`. **Behaviour adopted, field unused. No benefit.**
- **`why <CODE>` card sections (W9b) — unexercised.** Zero invocations (H7).
  The feature's own routing problem is what stopped it: the builder reaches for
  the card only when the error is unfamiliar, and this run's errors
  (`E_QUARRY_TYPE`, `E_QUARRY_SYNTAX`, `E_QUARRY_UNKNOWN`) all carried a
  sufficient `rewrite:` line. **No benefit.**
- **The expiry client form (W9a) — adopted, twice, and it is the clearest
  wave-9 authoring win.** `guide-expire.txt:24-40` → `src/chat.tsx:16` and
  `app/search.tsx:2`. **Benefited: yes** for history and search; **not applied**
  to typing, which is the case that has a deadline (V1). The `Read.nextExpiry`
  watch-reschedule half of the card's advice was also not used: both call sites
  filter at render time rather than scheduling a paint at the deadline.
- **Sized recipe caps (W8b) — used, and the recipe was patched once.**
  `m2-recipe.txt` is byte-identical to L24's; `feed.q:5` is `cap 1100`. The one
  hand edit is the backfill bound (H4). The scale replay settled
  **167,157/167,157 with 0 failures** (`evidence/scale-replay/receipt.json`), so
  no cap refused anything. **Benefited: yes, with one residual.**
- **The dev read meter (W8c) — shipped, unobserved, second consecutive run.**
  No `meter` field in any JSON under `evidence/` or `grading/`. `check --cost`
  never run. **No benefit.**
- **`doctor` (W8c) — run, for the first time in the series.**
  `evidence/scale-doctor.txt` is a full 15-line report on the scale instance,
  including W8c's deferral line verbatim at `:13`: "effects   580024 suppressed,
  0 deferred", plus the worker supervision record at `:5`
  (`{"crashes":0,"mode":"dev","restarts":0,…,"state":"running"}`) and the store
  line at `:6`. Run log `1789566464` records one friction: the first invocation
  ran in the scale workdir and "refused ENOENT; reran in root, no data mutation"
  — a root-relative receipt path, `attribution=agent-error`. **Benefited: yes**
  — it is cited in `final-report.md` as the operations evidence, and
  `operations` rose 86 → 88.
- **`unique … else CODE` (W9c) — adopted, first use, closes a two-lane defect.**
  `schema.q:12`. Confirmed end-to-end in the grader's browser check:
  `"dupHandleError": "That handle is taken."` against L24's
  `"profiles.byHandle already has a row where handle = 'wv1789546545748'"`.
  **Benefited: yes**, and it removes the cosmetic defect that was rank 8 last
  review.
- **Emit-only bounded loops (W9c) — unexercised, and the papercut did not
  recur.** `E_STRUCTURAL_FANOUT` appears **nowhere** in `evidence/`,
  `snapback/`, `src/`, `app/` or `scripts/` — the first clean run in five lanes.
  But the relaxation was not what did it: `/usr/bin/grep -n "for \|emit "` over
  `snapback/*.q` shows **no loop over a derived list with an emit-only body**.
  `chat.q:176-178` iterates the original group (`members[conversationId] first
  50 by byConversationPrincipal`) and emits inside it — the mechanical rewrite
  L24 was forced into, written correctly the first time. *Inference: W9c would
  have admitted the derived form, but this lane never wrote one, so the fix is
  untested in the field.*
- **Adoption incidents: none.** `/usr/bin/grep -n "not adopted\|E_GENERATION\|
  E_STORE"` over `backend.stderr`, `backend-m6.stderr`, `backend-m8.stderr` and
  `scale-backend.stderr` returns **zero** matches. Every compile refusal was
  handled the documented way — "snapback4 dev: N problems in snapback/;
  **serving the previous generation**" — three times.

### Item by item

| Item | 0.2.24 (L24) | 0.2.25 (L25) | Verdict |
|---|---|---|---|
| H1 `follow`/`createDM` never predict | note in every check | same note, verbatim, in every check (`final-check.txt:16`) | **Recurred, unchanged** (V7) |
| H2 `E_QUARRY_TYPE` on `feedRepost`'s id domain | same error; fixed app-side | same error verbatim (`backend.stderr:18`); fixed app-side again | **Recurred — third run** (H2) |
| H3 `E_STRUCTURAL_FANOUT` on a derived recipient list | twice in one compile | **fires nowhere**; no derived emit-only loop was authored | **Not reproduced**; W9c unexercised |
| H4 three-round compile chain for a ranking upsert | `E_QUARRY_UNKNOWN` then `E_QUARRY_TYPE` then clean | `insights.q:31` declares `unique byPost: postId` **up front**; `refreshRank` (`:41-45`) compiles first time | **Closed by the builder** (L24's diagnostic taught it) |
| H5 `N_MAINTAIN_SYNCED`, 16 lines, 9 structurally zero | 14 maintains, "0 value rows" ×14 | 6 maintains, **"current store measurement" ×0** (`final-check.txt:6-14`) | **Closed on the zero-count half** (W9b) + builder's `online only` |
| H6 `N_WIDE_MERGE` on a query nothing calls, rewrite naming a nonexistent flag | fired M5→M8; 4 points | **fires in no check**; the app's global search is `chat.q:238-241` `searchBatch`, a 50-lane batched merge, and it is wired (`API.md`, `final-report.md:74`) | **Closed** — mostly by the builder (§3.2) |
| H7 `N_NO_CURSOR` on a query that already declares a cursor | `insights.trending`, unacted | `insights.q:46` is now `query trending(c: cursor ?) … after c last 10 by byScore` — **acted on**; the note moved to `chat.typingNow` (H5) | **Closed on `trending`; new instance elsewhere** |
| H8 `E_SQL_INTERNAL` with no admitted surface | one lookup | **does not recur**; `final-report.md` and `README.md:51` both reference "documented application SQL views" and the grader used `snapback4 sql` successfully (trace, scale-verify) | **Not reproduced** |
| H9 `run --as` rejects an email | one acceptance round | **does not recur**; `run-help.txt:12` was captured at M8 and `--now`/`--as` used correctly (`m8-rank-backfill.txt`) | **Not reproduced** |
| H10 cards go unread; `why` answers in one sentence | 11/27 cards; `why` ×2 | **13/26 cards; `why` ×0** (H7) | **Recurred, worse on `why`** |
| V1 client ignores the `expiresAt` it holds | typing only | **fixed for history and search** (`src/chat.tsx:16`, `app/search.tsx:2`); **still ignored for typing** (`src/chat.tsx:17`) | **Partly closed** (W9a) |
| V2 unthrottled per-keystroke `chat.type` | 45 mutations / check; `typingActionMs` 1,531-1,565 | throttled to 150 ms (`src/chat.tsx:16`); `typingActionMs` **1,272-1,285** on the quiet run | **Closed by the builder** |
| V3 `Read.cut` and the meter unconsumed | neither observed | neither observed; `why` joins them | **Recurred, widened** (V2) |
| V4 `search.all` dead code costing 4 points | authored, unreferenced | **does not exist**; `searchBatch` is wired | **Closed by the builder** |
| V5 app-owned `sync public` table with `insert/update <- allow` | `trendingEntries` | `ranked` (`insights.q:35-40`), same shape | **Recurred** (V3) |
| V6 synthetic residency sites | 62/318 = **19.5 %** | **0/285 = 0 %** | **Closed** (W9b) |
| V7 cold acquisition disclosed, unmeasured | qualitative only | **8,290.1 ms measured** at the full corpus (`verification-final.json:282`); rows/bytes still unmeasured | **Half closed by the builder** |
| V8 `N_NO_HORIZON` silent on an uncapped `sync public` table | never fired | never fired; three such tables now | **Recurred** (V4) |
| V9 unread count is an ordinal difference | same code, undisclosed | same code, **filed as d-01** | **Recurred, escalated** (V5) |
| V10 docs growth | README +2.2 % | **+3.9 % bytes across two files** (H1) | **Recurred; topology changed** |
| d-01 (major) typing fails 15/15 | 4,918-4,954 ms vs 5,000 | **passes 3/3 on the builder's receipts and 3/3 on the grader's**, worst trial 4,941.5 ms | **Closed** — by the app's 150 ms throttle, not by wave 9; the margin is structurally unchanged (V1) |
| d-02 (major) composer file-input no-op | deterministic attempt-2 failures | **does not recur**; `m2-choreo-attempt2.jsonl` failed on a retained-witness collision instead, then passed in isolation | **Closed by the builder** |
| d-03 (minor) `API.md` promises a distinction the platform withholds | `API.md:9` overclaimed | `API.md:28-29` now says the **correct** thing: "check `'data' in result`; otherwise handle `result.denied` … and do not interpret it as empty data". The grader wrote a client from `API.md` alone and it worked first try (trace, m6-a12) | **Closed** (W9a's card wording + the builder) |
| d-04 (minor) signup before handle validation | account created despite rejection | not refiled; `src/shell.tsx:21` now renders `<ProfileEditor profile={null}/>` when `me.data` is null, so the app recovers. *Inference: the grader did not re-probe it* | **Closed by the builder** (inference) |
| d-05 (cosmetic) raw constraint text as the duplicate-handle error | verbatim from L23 | `schema.q:12` `else HANDLE_TAKEN 'That handle is taken.'`; grader reads back exactly that | **Closed** (W9c) |

---

## 3. Priority questions

### 3.1 setup_and_docs 90 → 85: is the README split fragmenting discovery?

**Yes, and the evidence is specific: the scorer's charge is a *four-surface*
navigation complaint that did not exist in L24, the second surface is main's new
file, and the README's own orientation paragraph does not name it.**

The scorer's note, verbatim (`scores/astra/FINAL.md`, `setup_and_docs`):

> diary.md M1 and essay.md praise substantial, useful semantic documentation.
> **Discovering the complete workflow required the README, client reference,
> keyword cards, and generated API**; the application's responsibility for
> cold-offline shell delivery was easy to miss.

It is reading `essay.md:17`, verbatim:

> On the other hand, discovering the full practical surface required moving
> among the README, client reference, keyword cards and generated API. A reader
> who stopped after the starter example could easily build an online app and
> mistakenly believe that installing the local client alone had solved
> cold-offline startup. The shell still belonged to me, and I had to verify it.

**This is a different complaint from L24's.** L24's charge was *volume* —
`diary.md` M1: "The README is unusually comprehensive, but reading its entire
surface is a substantial upfront cost". L25's `diary.md:2` is milder on volume —
"The long published reference is substantial orientation work, but the needed
primitives were documented" — and the new charge is *navigation*.

**What the builder read, for what, in what order** (`run-log.md`; run-log epochs
are entry times, file mtimes in brackets):

| # | Epoch (PDT) | Surface | For what |
|---|---|---|---|
| 1 | `1789561902` (05:31) | **`README.md` whole, and the "client operations reference"**, plus `guide language`, `guide assets`, `guide personas` [`language.txt` 05:29, `guide-assets.txt` 05:29, `guide-personas.txt` 05:29] | M1: "password identity, profile rules, unique handle and public sync" |
| 2 | `1789562324` (05:38) | `guide feeds` [05:34], `m2-check.txt` | M2: the repost bridge's reference type (H2) |
| 3 | `1789562884` (05:48) | `guide rules`, `guide sync`, `guide prediction` [all 05:40] | M3: "membership sync, retained-history and prediction design" |
| 4 | `1789563900` (06:05) | `guide search` [05:55], `guide expire` [05:48], `guide jobs`, `guide replay`, `guide aggregates` [all 06:03], **`node_modules/snapback4/CLIENT-AND-OPERATIONS.md`** | M5: "expiry/cache and upcoming push/schedule/aggregate APIs" |
| 5 | `1789564904` (06:21) | `guide aggregates`, `guide feeds`, `guide jobs`, `run-help.txt` [06:19] | M8: "exact rank, calendar aggregates, scheduler cursor commits, old-post test via documented `run --now`" |
| 6 | `1789566164` (06:42) | **`node_modules/snapback4/CLIENT-AND-OPERATIONS.md`**, `guide native` [06:28] | Final: "cold-sync probe uses documented `processDevice` from installed package" |

So `CLIENT-AND-OPERATIONS.md` is named as a **discrete, separate lookup twice**
(#4 and #6), once mid-run and once at the very end, for exactly the two things
the scorer's note flags — the client's responsibilities and cold-offline
startup. It is not named in the M1 orientation sweep except as "the client
operations reference" alongside the README.

**The structural cause, quoted.** `README.md:21-23`:

> Everything below is the whole published surface. There is no other
> documentation; the diagnostics carry the rest (every refusal names its code,
> its site and a rewrite, and `snapback4 why <CODE>` explains it).

That sentence is now false. §4–§8 — the client, development, release, Expo —
are in a second file. The README's "Start here" paragraph (`README.md:28-34`)
routes the reader to nine `guide` cards and **names neither the second file nor
its sections**. The only cross-reference is the file's last three lines
(`README.md:1523-1525`). The two files together are **+3.9 % bytes** on L24's
single file, so the split did not reduce the reading burden; it moved a boundary
into the middle of it.

**Smallest fix, in order of cost:**
1. **Repair `README.md:21-23` and fold the second file into "Start here"**
   (two sentences, zero new content). Make the first paragraph say what the two
   files are and what each holds: "This file is the backend — the language,
   rules and sync. `CLIENT-AND-OPERATIONS.md` is the client, development,
   release and Expo." Then add one line to the "Start here" path naming
   §4 The client as the step after `guide prediction`. This directly answers
   both halves of the scorer's charge: the surface inventory and the
   cold-offline shell responsibility, which lives in §4.
2. **A workflow index at the top of README** — a numbered "build an app"
   path across both files. More words, and it duplicates what "Start here"
   already tries to be.
3. **Un-split.** Not recommended: the split is a reasonable topology and the
   volume complaint softened this run.

**Expected impact: setup +3-5, recovering the drop.** Marked inference where it
concerns the scorer's reading. **Wave 9 did not cause this**; main's README
split did.

### 3.2 queries_and_live 78 → 86 and scale_and_limits 80 → 87: attribute it

**Mostly the builder's own design — it wrote the card's *paved* global-search
form instead of the unpaved one, which deleted three of L24's four `queries`
charges at the source. The held form and W9a's completeness line are second-order
here; `Read.cut` contributed nothing.**

The scorer's L25 `queries_and_live` note, verbatim:

> diary.md M1–M5 reports live updates, paginated feeds/history, and indexed
> offline search. final-report.md describes **membership-batched online global
> search** and held UI results with incompleteness labels; essay.md identifies
> acquisition and limited join flexibility as tradeoffs.

Against L24's, verbatim:

> M2/M3/M8 demonstrated paginated feeds and live convergence. However,
> final-report.md records **N_WIDE_MERGE for 1,000-chat search**, **incomplete
> meter cuts**, and **a UI limited to held-message search**; **unrestricted
> sync** also raises cost concerns.

Three of L24's four clauses are gone. Clause by clause:

- **"N_WIDE_MERGE for 1,000-chat search" and "incomplete meter cuts" — gone,
  because the query that produced them was never authored.** L24 wrote
  `search.all` (`search.q:36-39`), an unwired 1,000-lane merge. L25 wrote
  `chat.q:238-241`:

  ```quarry
  query searchBatch(q: text <=100, batch: cursor ?, c: cursor ?):
    result = merge messages matching q after c last 20 by byConversationWords:
      [m.conversationId] for m in members[viewer] after batch first 50 by byPrincipal
    return result messageCard
  ```

  That is the card's own `searchChatBatch` recipe, transcribed
  (`guide-search.txt:127-131`), and its 50-lane batch is exactly the
  `N_WIDE_MERGE` threshold — `guide-search.txt:73-74`: "past 50 lanes `check`
  emits N_WIDE_MERGE". Hence no note, in any check. **The builder's report then
  had a positive sentence to write instead of a disclosure**: `final-report.md:74`,
  verbatim: "Global online search is available as membership-batched API search;
  the app's global message screen searches its held replica and labels incomplete
  results." The scorer quotes that sentence back.
- **Attribution: not wave 9.** `searchChatBatch` is at line **122** of L24's
  `guide-search.txt` and line **127** of L25's; the recipe was available to both
  lanes and both lanes read the card. **This is the builder's design choice.**
  *Inference (low-to-moderate confidence): W9a's reorder of the held section may
  have helped — `/usr/bin/diff` of the two cards shows "Device holdings" now
  opens with "With horizon-free sources, `check` reports horizon-free source
  coverage for `searchHeld`" and the `E_QUERY_HELD` refusal moved from the head
  of that block to `guide-search.txt:157-160`, which is exactly the framing fix
  FRICTION-0.2.24 rank 2 asked for. But nothing in the lane's narrative cites it.*
- **"a UI limited to held-message search" — gone.** L24's held scope read as a
  limit. L25's reads as a deliberate labelled scope: `app/search.tsx:2` renders
  `sm-search-offline` / "Offline · searching saved messages" and the report
  describes both arms. **Here W9a did contribute**: `m5-check.txt:18` onward is
  "horizon-free source coverage — all sources sync without a horizon; answer
  completeness still depends on runtime authorization, limits and continuation",
  with four `Held:` sites each naming `file:line`. That is the positive
  statement the last review asked for, and the builder's honest framing of the
  held scope is consistent with it. *Inference: I cannot prove the line changed
  what the builder wrote; the builder never quotes it.*
- **"unrestricted sync" → "acquisition and limited join flexibility" — softened,
  not removed.** `social.q:21-32` `likes` is still uncapped and horizon-free
  (V4). The charge is now the essay's architectural framing rather than a
  concrete uncapped table.
- **`Read.cut` contributed nothing.** No `cut` anywhere in the lane (§2).

**scale_and_limits 80 → 87 is the builder measuring what L24 only disclosed.**
The scorer's note, verbatim:

> final-report.md records 167,157 settled actions, matching checkpoint/final
> counts, complete busy-chat paging, and **8.29-second cold acquisition**.
> essay.md flags public/history replication cost. Hidden performance and
> celebrity probes were unmeasured, so the evidence supports envelope
> correctness more strongly than performance.

L24's charge — "Wide search merges and horizon-free sync remain concerns" — is
gone with the wide merge (above), and the new positive is
`evidence/scale-replay/verification-final.json:281-283`,
`"coldInitialSync": {"wallMs": 8290.084207999986}`. The residual charge is
**instrument** (no probe set). So: **scale's rise is builder measurement plus
the wide merge's disappearance; wave 9 is not visible in it.**

### 3.3 O4 45 → 10 and O5 with no band: establish why

**Both are instrument, and neither is Snapback-attributable. O4's 35-point drop
is a stricter reading of identical evidence, sharpened by a claim the lane put in
its own run record. O5's null is the honest version of L24's 75.**

**O4 = 10.** `grading/trace.md` §3g is unambiguous about the evidence:

> The lane contains no simulator recording, screenshots or witness receipt for
> M6 or M8. A search of the lane for `*simulator*`, `*witness*`, `.mov` and
> `.mp4` found only the harness's `simulator.md`. … The installed CLI offers
> `snapback4 witness ios`, but it was not used. … Following the rule that native
> proofs are not grader-driven, I did not run a simulator. The nine
> native-artifact assertions are recorded `not-run`.

That is **the same absent leg L24 had** — L24's nine were also `not-recorded`,
and L24 scored 45. The difference is the anchor reading, stated verbatim in
`oDimensionScores.O4`:

> Below the 30 anchor ("cold-start offline shows an empty or broken app") …
> **Nothing native was demonstrated, so the score sits under the 30 anchor.**
> It is not 0 because the lane does not claim a native proof (README: "Hermes
> bundles, not simulator installation proofs"); **the run record's note that
> ENVIRONMENT made simulator proofs unnecessary is inaccurate.**

Two things therefore moved O4 and neither is a product change:
1. **Grader construction.** L24's grader placed absent native evidence
   *between* anchors (45); L25's placed it *below* the lowest anchor (10),
   because O4 scores only from simulator artifacts and there were none. Same
   evidence, different reading. This is the third consecutive lane in which O4
   is a function of a missing artifact rather than of the app.
2. **A lane claim the grader could check.** `run-record.json` `notes`:
   "simulator proofs not required by ENVIRONMENT". `instrument/ENVIRONMENT.md:26`
   says "iOS simulators exist (Xcode, iPhone runtimes)"; nothing says proofs are
   unnecessary, and `instrument/choreography/simulator.md` is the contract.
   `run-help.txt:21-22` — captured by this builder at 06:19 — lists
   `witness ios`. L24 wrote **no** run record, so L24's grader had no such claim
   to mark inaccurate. **Lane hygiene, not Snapback** (V8).

Note the asymmetry this creates: writing a run record (good hygiene, which L24
lacked) cost this lane points, because the record contained an unsupported
sentence.

**O5 = null.** `grading/trace.md`, "Scale replay, used as O5 input (not banded)":

> So O5's 0 branch does not fire. I cannot evaluate the rest of the band
> function, because this wave has **no frozen performance probes with p95
> predicates, no calibrated ceilings and no frozen replay cap**. O5 is therefore
> recorded as null with this explanation.

The 0 branch was actively disproved by the grader's own read-only clone of the
scale store: all 18 per-entity counts, 1,002/1,002 per-chat, 1,008/1,008
following and conversation counts, 101/101 group-member counts, all named O5
fixtures and spot entities matched `invariant-manifest-combined.json`, with
167,157/167,157 settled in 878 s (6.1 % of the 4 h stand-in cap). **L24's O5 = 75
was the band function's `otherwise` branch on the same missing inputs; L25's
grader declined to take that branch.** That is a grader-construction difference
on an unchanged instrument gap — and arguably the more honest of the two, since
75 read as a measurement and was not one.

**Verdict: O4 is instrument plus lane hygiene; O5 is instrument. Neither is
Snapback-attributable, and neither indicates anything about 0.2.25.**

### 3.4 d-02 and d-03: is empty-content acceptance Snapback-shaped?

**No. It is purely the app's schema choice, and the strongest evidence is that
the builder wrote the exact symmetric form one line above the gap.**

The grader's findings, verbatim (`grading/grader-report.json`):
- **d-02:** "The server accepts a top-level post with an empty body and no media
  (`social.create` body is `text <=500` with no content requirement), producing a
  blank feed item." Receipt: `grading/evidence/api-checks.json`
  `exploratory.emptyPost` → `{"state": "sent", "code": null, "result": {… "body": "", …}}`.
- **d-03:** "The server accepts editing a text message to the empty string
  (`edit` takes `text <=2000` while `send` requires `text 1..2000`), leaving a
  blank, non-tombstoned bubble marked edited." Receipt:
  `exploratory.editToEmpty` → `{"state": "sent", "code": null, "result": null}`.

**The language offers both halves, and the builder used them elsewhere:**

| Site | Declaration | Effect |
|---|---|---|
| `chat.q:191` | `mutation send(…, text: text 1..2000, …)` | a lower bound, used |
| `social.q:69` | `mutation create(postId, body: text <=500, …)` | no lower bound — d-02 |
| `chat.q:202` | `mutation edit(messageId: messages, text: text <=2000)` | no lower bound — d-03 |
| `chat.q:207` | `require count(text) <= 500 or m.kind = 'text' else CAPTION_TOO_LONG` | **a conditional *upper* bound, written by hand, inside `edit`** |

So the conditional shape d-03 needed — `require count(text) >= 1 or m.kind != 'text'
else EMPTY_TEXT` — is the mirror of a line the builder wrote **five lines away
in the same mutation**. Nothing in the language invited the asymmetry; the author
simply bounded one end.

The same holds for d-02: `social.create` legitimately cannot use `body: text 1..500`
because a post may be media-only, but the `require` that expresses "body or
media" is the same construct the builder used three times in the same mutation
for `MIXED_MEDIA`, `DURATION_UNKNOWN` and `FIRST_IMAGE_REQUIRED`
(`social.q:73-79`).

**Classification: app, both.**

**Smallest product change, if any — and I would not ship one.** The only
Snapback-shaped residue is that two mutations write the same column with
different value bounds and `check` says nothing. A `N_BOUND_ASYMMETRY`-style note
("`chat.send` declares `text 1..2000` and `chat.edit` declares `text <=2000` for
`messages.text`") would be cheap and would have caught d-03 exactly. It would
also false-positive on every legitimate admin/importer path that deliberately
relaxes a bound, and it cannot catch d-02 at all (no second writer to compare
against). **Recommend: no product change; rank it last (§6 rank 9).**

### 3.5 Wave-9 regression scan

**No wave-9 regression is visible in this lane.** Checked against every W9
surface:

| wave-9 change | exercised? | evidence | regression? |
|---|---|---|---|
| W9a reader-expiry wording + client form | **yes, twice** | `guide-expire.txt:24-40` → `src/chat.tsx:16`, `app/search.tsx:2` | no |
| W9a held completeness line in `check`/`why` | **printed in 5 checks** | `m5-check.txt:18` … `final-check.txt:18`; the claim is accurate for this schema (all four sites horizon-free) | no |
| W9a `N_WIDE_MERGE` rewrite names `check --cost` | **not fired** | the note appears in no check (§3.2) | untested here |
| W9a denied-read-is-an-empty-page wording | **consumed** | `API.md:28-29` now states it correctly; d-03 of L24 is closed | no |
| W9b `why <CODE>` prints the card section | **no** | `why` invoked zero times (H7) | untested here |
| W9b `N_MAINTAIN_SYNCED` drops the zero count | **yes** | 14 → 0 occurrences of "current store measurement" | no |
| W9b residency sites carry `file:line` | **yes** | 285/285 sites carry it; `m3-residency.txt` and every `check` | no |
| W9c emit-only bounded loops admitted | **no derived loop authored** | no `E_STRUCTURAL_FANOUT` anywhere; no derived emit-only loop in `snapback/*.q` | untested here |
| W9c `unique … else CODE` | **yes** | `schema.q:12`; `"That handle is taken."` in the grader's UI check | no |
| W9R1a durable receipts carry no refusal detail | not probed | no receipt inspection in the lane | untested here |
| main: README split | **yes** | §3.1 — **the one negative delta of the release** | **regression in discovery, main's not wave 9's** |
| main: `why … id`, `--release`, `--values` | **no** | `run-help.txt:15` captured; never invoked | untested here |
| main: Postgres access boundary | n/a | not on this path | — |

**`N_NO_CURSOR` on `chat.typingNow` is not a wave-9 regression.** L24's
identically shaped query produced no note because L24's `typing` table declared
`cap 50 by conversationId` (L24 `chat.q:78`) and L25's does not (`chat.q:76-86`).
The suppression rule behaved correctly in both lanes; the app changed
(§1a H5). *Inference, high confidence — the query shape, page bound and index are
otherwise identical.*

**Timing corroboration that nothing on the hot path regressed.** The identical
frozen typing check measures `expiresAfterLastKeystrokeMs` **4,817.8 / 4,825.5 /
4,941.5** on 0.2.25 with a 4,500 ms TTL (`m3-choreo.jsonl`) and **4,307.4 /
4,314.0 / 4,325.6** on 0.2.24 with a 4,000 ms TTL (L24 `m3-choreography.jsonl`)
— an overhead above TTL of ~318-442 ms against ~307-326 ms, on a grader host
running at load 8-14 against L24's 5.68-8.88. The grader's own web probe reads
4,888-4,902 ms and passes 3/3 (trace, m3-a06/a07); its live-delivery records are
m2-a07 **38 ms**, m2-a14 **123.4 ms**, m3-a01 **197.4 ms**, m4-a05 **158.2 ms**
(trace, Timing records). **Inference:** any wave-9 cost on the live path is below
this measurement's noise.

---

## 4. Grader defects d-01 … d-04

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (minor, M8) | A user's own message sent from another device or the API shows an unread badge in that user's web chat list | `src/chat.tsx:11` and `:12`, identically: `unreadCount={(m.latest?.ordinal??0)>m.readOrdinal?1:0}` — no exclusion of the viewer's own sends. `chat.inbox` (`chat.q:88-90`) already returns `latest` as a full `messageCard` **including `senderId`**, so `latest.senderId !== viewer` was one comparison away. Receipt: `grading/evidence/screens/own-unread.png` | **App.** Snapback-shaped only in the weak sense that there is no maintained unread primitive, so every app derives the badge from ordinals — the same shape flagged as L23 V10 and L24 V9 and now filed. No product change indicated. |
| d-02 (minor, M2) | The server accepts a top-level post with an empty body and no media | `social.q:69` `body: text <=500` with no `require` for content, in a mutation that already carries three content `require`s (`social.q:73-79`). `text 1..N` exists and the builder used it at `chat.q:191` | **App.** §3.4. |
| d-03 (minor, M4) | The server accepts editing a text message to `""`; `edit` takes `text <=2000` while `send` requires `1..2000` | `chat.q:202` against `chat.q:191`. The symmetric conditional form is at `chat.q:207` (`require count(text) <= 500 or m.kind = 'text' else CAPTION_TOO_LONG`), written by the same author, five lines away | **App.** §3.4. A `check` note on divergent bounds for one column would have caught it; not recommended (false-positive risk). |
| d-04 (minor, M4) | The documented acceptance entrypoint is seed-age dependent: run within 60 s of seeding, the M4 window probe edits seeded `sm0001`, fails, **and corrupts seed data**, which then fails M5 search. Reproduced twice from a clean checkout | `scripts/acceptance-m4.mjs` probes `EDIT_WINDOW_CLOSED` by editing `sm0001`; the shortened window is 60 s (`README.md:36-38`); nothing in `README.md` forbids running the suite immediately after seeding. The overwrite ("Too late", `edited=1`) is a *legitimate* server acceptance | **Harness (the lane's own).** Not Snapback: the server behaved correctly in all three attempts, and the corruption is the lane's test writing to seeded fixture data. It cost the grader two full phase-1 attempts and is the reason `rerunsUsed: 1`. |

No blocker or major defect was found. Observations the grader recorded and did
**not** file: the typing-expiry margin (~4.8-4.9 s against 5 s); digest
`newPostsInFollowing` counting the viewer's own posts; the documented 35 s
presence grace on push; and the server admitting any group member to change the
group background/accent while the UI restricts it to admins (the brief restricts
only name, description and disappearing).

---

## 5. The score moves

The scorer reads only L25's narrative and record (N=1), so 1-3 point moves are
within variance. Every score below is the builder scoring its own lane, not the
grader.

| Category | 0.2.24 → 0.2.25 | Snapback-attributable cause named in the note | Other causes |
|---|---|---|---|
| overall | 88 → **91** | "Documentation navigation, bounded query composition, and replica acquisition cost kept the experience below ideal" — navigation is §3.1 | "zero Snapback defects"; 17 agent-error corrections |
| setup_and_docs | 90 → **85** | "Discovering the complete workflow required the README, client reference, keyword cards, and generated API" — **the README split** (§3.1, H1) | "the application's responsibility for cold-offline shell delivery was easy to miss" — a content gap in §4, now in the second file |
| data_modeling | 88 → 88 | — | "explicit indexes, bounds, audiences, and typed helpers productive but less flexible than general-purpose code or SQL" (essay.md:11) |
| authorization | 95 → **96** | — | Entirely positive; the grader's 14-refusal adversarial sweep found nothing (trace §3b) |
| queries_and_live | 78 → **86** | The held form's labelled scope; W9a's completeness line present but uncited | **The builder's batched `searchBatch`** removed both `N_WIDE_MERGE` charges at source (§3.2) |
| writes_and_transactions | 95 → 95 | — | "stable mutation identity" enforcement read as a **win**, not a charge |
| offline_sync | 93 → **95** | — | "pending writes and cold search surviving offline reload, ordered replay, and multi-device convergence"; the app still supplies its own web shell |
| media_assets | 96 → **98** | — | Variance on an already-maximal note |
| background_work | 92 → **96** | — | Digest survived a mid-period backend restart with clients closed; effect/schedule naming corrections charged to the agent, not the backend (H3 read as an agent error) |
| client_integration | 88 → **89** | — | Charge is Expo Go's online fallback and unverified native runtime (instrument) |
| diagnostics_dev_loop | 94 → 94 | — | "actionable reference, type, predicate, and schedule diagnostics"; "zero Snapback defects". **Flat despite `why` never being used** — the diagnostics scored on their `rewrite:` lines alone |
| scale_and_limits | 80 → **87** | — | **8.29 s cold acquisition measured** by the builder; the L24 wide-merge charge gone. Residual charge is the missing probe set (instrument) |
| operations | 86 → **88** | — | Fresh-instance replay, persisted retry ledgers, supervised workers, **`doctor`** (first use); charge is "migrations and broader recovery remain unassessed, with M7 intentionally excluded" |

**The grade.** O1 **75 → 75**: 101/119 pass, 0 fail, 18 not-run — identical
totals and identical shortfall (M7 ×9, native ×9). O2 **75 → 78**: L24's two
majors are both closed (one by the app's throttle, one by a DOM fix) and the
four remaining are minors. O4 **45 → 10** and O5 **75 → null**: both grader
construction on unchanged instrument gaps (§3.3). **Inference: the entire grade
delta is grader judgment plus two closed app majors; no assertion changed
state.**

---

## 6. Remaining Snapback-attributable friction, ranked (next-wave candidates)

**A plain statement first: the Snapback-attributable residue in this lane is
small and increasingly noise-dominated.** The run logged **zero**
`snapback4-defect` corrections, zero adoption failures, zero
`E_STRUCTURAL_FANOUT`, zero `N_WIDE_MERGE`, zero `N_NEVER_COMPLETE`, and a final
`check` carrying two notes over 23 lines. Four of the last review's nine ranked
items are closed or not reproduced. Of the nine rows below, **ranks 1-3 are
worth a wave**; ranks 4-6 are one-line fixes with single-digit expected impact;
ranks 7-9 are recurrence bookkeeping and I would not commission them alone.

Expected impacts are inference from the scorer's and grader's notes; nothing here
is measured.

| Rank | Friction | Smallest product change | W9 caused it? | Expected impact |
|---|---|---|---|---|
| 1 | **The README split moved half the surface behind the last line of the other half, while the first page still says there is no other documentation** (H1, §3.1) | Two sentences at `README.md:21-34`: replace "Everything below is the whole published surface. There is no other documentation" with what the two files are and what each holds, and add §4 The client to the "Start here" path after `guide prediction`. The scorer's second clause — "the application's responsibility for cold-offline shell delivery was easy to miss" — is §4 content that a reader following "Start here" now never reaches | **No** — main's split, this release | **setup +3-5**, recovering the only negative delta of 0.2.25; costs two sentences |
| 2 | **Wave 9's `why <CODE>` has no route to a builder who never types `why`** (H7, V2) | The pointers are printed and ignored: `guide: reads` printed in 7 checks into a lane that never opened `guide reads`, and `— snapback4 why <op>` in 8. Print the card section **inline** the second time `check` emits the same note in one session, or add one worked line to a note that has repeated. This is also the only route left to `Read.cut` and the dev meter, which are now unconsumed in **two** consecutive lanes and live only in `guide reads` | **No** — W9b built the content; it did not build the route | diagnostics +1, setup +1; gives `Read.cut`, the meter and `why`'s card sections their first consumer |
| 3 | **The expiry client form was adopted everywhere except the reader with a deadline** (V1, §3.5) | `guide-expire.txt:24-40` is generic ("a live reader that must hide it at its deadline"). Name the canonical case: presence and typing. Better, make it the default — have the React `usePage`/`useQuery` drop rows past `expiresAt` for a table that declares `expire at`, and reschedule at `Read.nextExpiry`, which the card already says the client does. The app now sits **58.5 ms** from its own bound on its worst trial (`m3-choreo.jsonl`, 4,941.5 ms against 5,000) with the correct filter written two lines away in the same file | **No** — W9a shipped the form and the builder used it twice | O2 +2-5 (this margin has produced a filed defect in one of the last two lanes); removes a class rather than an instance |
| 4 | **`fn feedRepost(postId: feedPosts)` — a parameter named for one table and typed as another, third `E_QUARRY_TYPE` in three lanes** (H2) | Rename the recipe parameter to `eventId` (or `sourceEventId`). One identifier in the generated recipe | **No** — shipped in W7's recipe, untouched since | data_modeling +1; removes one compile round from every app that reposts |
| 5 | **The recipe sizes eight caps from `--authors` and leaves the backfill bound a literal** (H4) | Size `feed.q:162`'s `if visited = N` from `--authors` like every `cap`. The evidence is a one-hunk diff between two lanes that installed with byte-identical arguments | **No** — W8b sized the caps only | scale +1; removes the only hand patch of the recipe, and W8b's "the recipe was never edited" claim becomes true |
| 6 | **`N_NO_CURSOR`'s rewrite offers a cursor and not the `cap` that also silences it** (H5) | Append to the rewrite: ", or `cap N by <pinned column>` on the table when the group cannot exceed the page". L24's identical query was silent because its `typing` table declared `cap 50 by conversationId`; L25's is not. Today the note fires 7 times in one run on a page that cannot overflow, and the author is offered only the fix that is wrong here | **No** — the note ships in 0.2.23; the suppression rule is correct | diagnostics +1; removes half the final check's note volume |
| 7 | **Effects are globally named, jobs are module-qualified, and only one half of the mistake compiles** (H3) | `E_QUARRY_UNKNOWN` catches `schedule … : daily` and rewrites it to `digest.daily`. The mirror mistake — `emit chat.notify` for a global `notify` — reached the worker as a runtime miss. Either refuse a module-qualified effect name at `check` with the same rewrite shape, or accept it as an alias. One sentence in `guide effects`/`guide jobs` naming the asymmetry is the cheaper half | **No** | diagnostics +1; removes 1-2 correction loops from every app with a worker (`essay.md:15` names it) |
| 8 | **`N_MAINTAIN_SYNCED`'s measurement pointer names a command builders do not reach for, four lanes running** (H6, V6) | The note says "measure cold rows with `snapback4 test --residency`". This builder ran `snapback4 check --residency` instead (`m3-residency.txt`) — the verb it was already using — and got facts without numbers. Make `check --residency` print the cold row/byte totals, or have the note name both. The card publishes 139,413 rows / 17.9 MB for its own shape (`guide-feeds.txt:464-466`) and no lane has ever produced the equivalent for its app | **No** (ships in 0.2.22) | scale +1, diagnostics +1; turns a four-lane-old unfollowed pointer into a measurement |
| 9 | **Recurring low items** | `matching ''` matches nothing, so a person directory needs two queries with two index orders and a client branch — say so in `guide search` beside `guide-search.txt:62` (H8; cost this lane one loop and a full M3 rerun). The one-time service token still prints on the stream harnesses capture into committed logs — print it on stdout or behind `--print-token` (H9). `N_NO_HORIZON` fired on none of three uncapped horizon-free `sync public` tables — state that its suppression is reader-dependent so silence is not approval (V4). A cascade diagnostic whose rewrite is "fix this Quarry line and rerun snapback4 check" (`backend.stderr:227-228`) should be suppressed when a prior error on the same operation explains it. Two mutations writing one column with different value bounds go unremarked (§3.4) — **not recommended**, false-positive risk exceeds the value | **No** | operations +1; diagnostics +1 |
| — | **Not Snapback (instrument), for the record** | No holdout probe set was committed, so O3 and **O5** are both null (trace, deviation 1 and "Scale replay") and O4 is scored from an artifact class the grader is forbidden to produce (trace §3g) — **O4 has now been a function of a missing simulator recording in three consecutive lanes, and moved 50 → 45 → 10 with no change in the evidence**. The frozen report schema still cannot represent M8. The grader remains uncalibrated. Separately, the lane's own `scripts/acceptance-m4.mjs` corrupts seeded fixture data when run inside the 60 s edit window (d-04), costing two grader phase-1 attempts | Instrument: commit a probe set; make O4 scorable from the web proof or drop it from the weighted view when no simulator is run; extend the schema to M8's 18 IDs; make O5's bands reachable. Lane: make the M4 window probe create its own message instead of editing `sm0001` | — | O3/O4/O5 become measurements rather than artefacts of absence |
