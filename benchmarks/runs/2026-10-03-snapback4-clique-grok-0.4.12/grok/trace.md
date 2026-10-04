# social-messenger grader trace — lane `grok-snapback4`

Sanitized evidence and action trace. This is the publishable companion to
`grading/grader-report.json`; the raw grading session is retained privately for
audit only and is never published (LLP 0198). All credentials are redacted:
fixture-pack persona and scale passwords appear as `[REDACTED-FIXTURE-PW]`,
grader-created account passwords as `[REDACTED-GRADER-PW]`, and bearer tokens
and session ids as `[REDACTED-TOKEN]`. Account email addresses are the fixture
pack's own `<persona>@example.com` synthetic addresses and are not personal data.

| | |
|---|---|
| Lane | `grok-snapback4`, backend `snapback4-0.4.12` (public npm `snapback4@0.4.12` + `snapback4-expo@0.4.12`) |
| Wave | `full-3models-grok`, run scope `full` (M1–M8) |
| Grader | family `claude`, model `claude-opus-5`; fresh session, no builder context |
| Assertion manifest | `instrument/schema/social-messenger/assertions.json` v`0.3.8-m8`, sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| Session outcome | `completed`, 0 grader re-runs, not contaminated |
| Result | 119/119 assertions graded: **98 pass, 2 fail, 19 not-run** |
| O-dimensions | O1 72 · O2 55 · O3 **null** (no probe set committed) · O4 45 · O5 band **75** |
| Coverage spot-verification | **dishonest** — M2, M3, M5, M8 |

## Contamination control

The lane directory contains `diary.md`, `essay.md`, `final-report.md` and
`run-log.md`. **I did not open any of them.** No other lane under
`lanes/` was accessed. I made one clean copy of the lane source into a temp
directory to run `m6-a10` "from a clean checkout"; that copy inherited those
four files and they were likewise left unopened, and the copy was deleted at the
end of the session. This session is therefore **not** a contaminated grading
session.

The lane wrote **no `run-record.json`**. This grade therefore rests on the
lane's harness receipts, its coverage manifests, its source, and my own
independent re-execution — recorded in the report as
`lane.runRecordPath = "(absent …)"`.

## Deviations from the frozen grader prompt

Three, all mandated by this run's wrapper. This is an **N=1 uncalibrated
calibration run, not a claim-eligible wave.**

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped in full. `wave.probeSetSha256` is the literal string
   `none-uncommitted`, `probeResults` is empty, and **no probe was invented or
   improvised**. Consequence for **O3**: `applicability.json` makes O3
   applicable here (M6 green, M1–M5 attempted), but its rule scores it *"from
   the wave's secret rotated holdout probes only"*. With no probes there is no
   admissible input, so O3 is recorded **null** — a *missing-input* null, not a
   non-applicability null. Under `nullDimensionRule` this blocks any overall
   weighted total, which is the correct outcome here. Consequence for **O5**: the
   frozen degradation rules and absolute ceilings were never measured; see
   §"O5" below for how the band function still resolves.
2. **My family has not passed the grader calibration gate**
   (`instrument/grader/calibration.md`). `calibrationPassed: false`. This is a
   genuine cross-family grade (Claude grading a Grok-built lane), so
   `sameFamilyGraded: false` — not the abort-fallback case. The grade is
   labelled `uncalibrated-grader`.
3. **Timing-sensitive checks are best-of-3, with machine load recorded.** Every
   `timing-sensitive` assertion in this instrument is `[choreo]`-class, and the
   report schema states those are scored from harness recordings/receipts and
   *never re-driven by the grader* — so the `timingRecords` measurements come
   from the lane's receipts, not from my own re-measurement. This machine is
   shared with other sessions; `uptime` read **load averages 2.43 / 5.25 / 4.26**
   at the start of my session (20:35Z) and **1.87 / 2.12 / 2.23** at the end
   (20:28Z, next day boundary). The harness receipts themselves were recorded
   earlier, by the builder's session, under load I cannot observe.

## Frozen-schema limitation and the prior measurement-coverage gap

The frozen report schema constrains `assertionResults` to
`patternProperties: {"^m[1-7]-a[0-9]{2}$"}` with `additionalProperties: false`
— it **cannot represent an M8 result at all**, even though the frozen assertion
manifest is `0.3.8-m8` and carries 18 M8 assertions, and even though
`applicability.json` v`0.3.0-m8` puts M8 in the full-run observing set for
O1, O2 and O4. The schema was frozen before LLP 0201's 2026-08-11 M8 amendment
and was not re-versioned with it.

So this run splits the complete grade across two files, with no id in both:

| File | Ids | Result tally |
|---|---|---|
| `grading/grader-report.json` | the 101 M1–M7 ids | 82 pass, 2 fail, 17 not-run |
| `grading/m8-assertion-results.json` | the 18 M8 ids | 16 pass, 0 fail, 2 not-run |
| **union** | **all 119 manifest ids exactly** | **98 pass, 2 fail, 19 not-run** |

I verified the union equals the manifest's id set exactly, that the 101 match
`GRADER_ASSERTIONS_101.txt` exactly, and that the M8 file reuses the same
`result` and `method` enum values. `grader-report.json` validates against the
frozen schema with AJV 2020 (`grading/validate.mjs`).

**The prior measurement-coverage gap.** The structured `assertionResults` of the
actual September 5 and September 12 runs carried only those same 101 ids. Their
*notes* could and did describe M8 observations in prose, but prose in a note is
not a machine-comparable result: it cannot be tallied, diffed across waves, or
fed to the harness's partition check. Those waves therefore have **no
machine-comparable 18-id M8 result set**, and M8 could not have contributed to
any mechanically computed O1/O2/O4 input for them even though the applicability
manifest says it should. That is a measurement gap in the instrument's own
records, not in the lanes. It is why this run reports three figures separately —
the prior-101 subtotal (comparable with September), the 18 M8 results (new), and
the complete 119 total — rather than a single number that would silently mix the
two régimes.

## Environment and processes

macOS arm64 (Darwin 27.0.0), Node 24.18.0. I used **only** ports 49360–49379, as
instructed, and started every server myself:

| PID | What | Port |
|---|---|---|
| 24709 → 24726 | lane backend, `npx snapback4 dev --port 49361` in the lane dir | 49361 |
| 24730 | its supervised notifications worker (child) | — |
| 27387 → 27403 | web client, `npx expo start --web --port 49360` | 49360 |
| 32166 → 32201 | second **fresh** backend instance (Trending/Insights, dev clock) | 49363 |
| 32886 → 32905, then 37692 → 37708 after the deliberate mid-period restart | third **fresh** backend instance (digest schedule) | 49364 |

Recorded in `grading/evidence/pids.txt`. I killed only these PIDs at the end,
by pid; **no `pkill`, `killall` or pattern kill** was used at any point. Other
lanes' ports were untouched. Playwright chromium was already present in the
shared browser cache; I drove it through the lane's own installed `playwright`
rather than installing another copy, and **wrote nothing into
`instrument/`**.

Two fresh instances were created (`grading/inst2/`, `grading/inst3/`, each a
copy of the lane's `snapback/schema.q` and its worker) so that the 24-hour
Trending window and the 120-second digest period could be exercised
deterministically against known ground truth instead of against a dev store full
of acceptance residue. One incidental environment fact: `xcrun simctl` exits
**72** on this host, so the iOS simulator was not usable from my session either.

## Phase 1 — builder suite, from my own session

`npm run acceptance -- --milestone mN`, the documented entrypoint, for every
milestone the lane shipped, against the backend I started. **All seven pass**
(`grading/evidence/acceptance-run1.log`):

```
m1 pass:true  m2 pass:true  m3 pass:true  m4 pass:true
m5 pass:true  m6 pass:true  m8 pass:true     failures: [] in all seven
```

So the lane's receipts are reproducible and not fabricated. Every suite-required
assertion of each milestone appears in that milestone's coverage manifest
(M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5, M8 6/6 = 58). What that
coverage *means* is phase 2.

## Phase 2 — coverage-manifest spot-verification → **dishonest** (M2, M3, M5, M8)

I sampled **all 58** mapped suite-required assertions and read the body of each
mapped test. The mechanism first: `scripts/acceptance.mjs:366-374` builds
`coverage-<m>.json` by filtering the **frozen** `assertions.json` for
`executor === "suite-required"` and writing that list verbatim — *before any
test runs*. The manifest is therefore identical to the frozen requirement by
construction, whatever the tests do. The suite then passes if every required id
merely has a key in a `results` object, and the test bodies set those keys
unconditionally.

I counted a mapping dishonest only where **the mapped test can pass with the
asserted behaviour wholly broken and nothing else in that test exercises it.**

**Honest:** M1 (7/7) and M4 (5/5) — every mapping asserts its observable.
M6's five are honest too: `m6-a10`/`m6-a11` are backed by actually running the
demo, and while `m6-a08`'s field check is loose (defect d-12) the test does send
the message and read the push log.

**Dishonest:**

- **M8 — 6 of 6 vacuous.** `m8-a01` ("the six lifetime totals *matching the
  seeded content*") is asserted as `ok(insights.posts >= 1)`. `m8-a03`
  ("buckets a post created today under today, server-time UTC boundaries") as
  `ok(insights.posts0 >= 0 && insights.posts1 >= 0)` — a tautology for any
  non-negative number. `m8-a04`, `m8-a05`, `m8-a06`, `m8-a07` have **no
  assertion at all**, only a results string (`"zero days present as numeric
  fields"`, `"trending 10"`, `"window filter in query"`, `"tie break likeCount,
  at"`).
- **M2.** `m2-a10`, `m2-a13`, `m2-a18` have no assertion whatsoever.
  `m2-a11`'s guard is vacuous when the probe post is absent — `carolPost` is
  `undefined`, so `row.post === carolPost?.post` is trivially false and the
  check passes. And `m2-a22`, explicitly an assertion about the **Following**
  tab, is mapped to a test that pages `api.globalFeed` only: Following paging
  could be entirely broken and it would pass.
- **M3.** `m3-a11` — "tapping the quoted excerpt scrolls/jumps to the original",
  whose manifest note says it is *suite-covered by web automation* — is mapped to
  a test that only checks a quote id is present and performs no UI interaction.
- **M5.** `m5-a11` ("global message search groups results by chat") is asserted
  as `ok(titles.size >= 1)`, which passes even if every `chatTitle` were `null`.

**One thing must be said plainly in the lane's favour:** every single one of
these behaviours is in fact **correct in the product**. I independently verified
`m8-a01/a03/a04/a05/a06/a07`, `m2-a10/a13/a18/a22`, `m3-a11` and `m5-a11` and
they *all pass* — several end-to-end in a real browser or via the dev clock. The
finding is about the honesty of the coverage claim, not about the features. Per
the frozen protocol this adjudicates M2, M3, M5 and M8 to `capability-failure`
(scoring-only, non-retroactive; the harness applies the recharge).

## Phase 3 — independent checklist execution

Re-executed assertion by assertion through the custom-client API and browser
automation on the web build, under the fixture pack's **shortened-windows**
config (`editWindowSeconds=60`, `deleteForEveryone=120`, disappearing
24h→180 s / 7d→300 s) and **shortened digest** config (`periodSeconds=120`) —
both of which the lane's `snapback/schema.q` mirrors exactly.

Scripts: `grading/g-m1m2.mjs`, `g-m3m6.mjs`, `g-m5m6.mjs`, `g-m2redo.mjs`,
`g-m8.mjs`, `g-digest.mjs`, `g-digest-restart.mjs`, `web.mjs`…`web6.mjs`,
`dbg1–3.mjs`. Screenshots in `grading/evidence/`.

### My own two false starts, corrected

Reported here so the correction is auditable. Neither was filed against the lane.

- **`m1-a07`** first read as a *fail*: after `logout()` the old bearer still
  worked. The cause was mine — `snapback4/auth`'s `logout(url, token)` takes a
  **token string** and I passed a session object, so the call was a no-op. Re-run
  with the documented signature: the bearer is refused on `whoAmI` and `inbox`
  (`E_AUTH "sign in to continue"`) and on a mutation; `logoutAll` returned
  `{ok:true, revoked:1}`. **Real server-side revocation → pass.**
- **`m5-a03`** first read as a *fail* with a Playwright `page.fill` timeout. Also
  mine — I navigated to the search screen *while already offline*, so the dev
  server could not serve the route and the input never appeared. Re-run loading
  the page first, then cutting connectivity. **Pass**, with the control message
  still found offline.

### Grader-only obligations, all verified end-to-end

- **`m1-a12` / `m1-a13` — password storage.** `snapback/schema.q:6` declares
  `use identity password`, the platform's documented built-in path; no hashing is
  hand-rolled anywhere (`grep` for `createHash|pbkdf2|scrypt|bcrypt|argon|crypto`
  over `src/`, `app/`, `snapback/` returns nothing). Reading the store's
  `_credentials` table directly shows
  `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>` — **argon2id at RFC 9106's
  second-recommended parameters**; the host reports `Argon2 slots: 16`.
  For a13: **0** rows anywhere in `store.sqlite` contain any persona, scale or
  grader password; `_sessions` stores only a `token_digest`, never a token; all
  **208** files under `dist/` (Hermes bundles included) are clean; source and all
  logs (`backend-dev.log`, `web.log`, `data/push-log.jsonl`) are clean. The
  fixture pack's own credential files are the declared exception and live outside
  the app.
- **`m4-a10` — edit window.** In-window edit accepted; after waiting 63 s the
  same edit was **refused server-side with `EDIT_WINDOW`** and the stored text
  was still the in-window value. A real refusal, not a missing UI affordance.
- **`m4-a12` — asset denial after delete.** The recipient could fetch the asset
  before the delete and was refused with `E_ASSET_UNKNOWN` afterwards — on the
  same client *and from a brand-new client and session*, so the denial is
  server-side, not a cache effect.
- **`m5-a01` — expiry with no client open.** Setting the DM to `24h` made the
  server stamp `expiresAt` exactly **180 000 ms** out (the shortened TTL). Both
  clients were then **closed through the expiry instant**. On reconnect the
  expired message is absent from history, a non-expiring control sent in the same
  chat remains, and a point read of the expired id returns `null`. The schema
  enforces this declaratively with `expire at .expiresAt`.
- **`m5-a02` — client purge, both configurations.** *Connected* (page open, no
  reload): visible before, purged in place after, control retained. *Disconnected*
  (synced, then connectivity cut across the expiry instant): gone on reconnect,
  control retained.
- **`m5-a03` — offline search after purge.** Findable by in-chat search before
  expiry; after the client synced the expiry, returned by **neither** offline
  in-chat **nor** offline global search ("No results"), while the non-expiring
  control in the same chat was **still found offline** — proving the purge
  removed it from the searchable retained holdings rather than disabling offline
  search.
- **`m5-a06` — view-once.** `E_ASSET_VIEWED` after the single permitted view,
  both on the viewing client and **from a brand-new client and session**.
- **`m6-a12` — grader-written variation from API.md alone.** I wrote a standalone
  client using only `API.md` and fetched the latest message of a *named*
  conversation: login → page `inbox` for `chat.title === "Weekend Plans"` → page
  `history` following `next` as `c` → take the highest `ordinal` (a field API.md
  documents). Resolved in 1 inbox page, returned `ordinal=16`. API.md was
  sufficient; its one inaccuracy is defect d-04.
- **`m8-a08`…`m8-a12` — the scheduled digest.** On a fresh instance, inside one
  **aligned** 120 s period, with **every client closed before the period ended**:
  1 new follower, 2 posts by a followed author, 3 unread messages in one chat,
  and 5 messages in a chat the target is *not* in. Result — **exactly one**
  digest for the target with `newFollowers=1, newPostsInFollowing=2,
  unreadMessages=3, unreadChats=1`: all four counts correct (a08). A persona with
  no activity received **0** digests (a09). The following period, with no
  activity, emitted **0** (a10). For a11 I seeded a period then **killed and
  relaunched the backend at t+64 s of the 120 s period**: exactly one digest per
  active user, no prior period re-emitted, all idempotency keys distinct —
  `once [p.principal, periodEnd]` plus the worker's durable ledger give
  exactly-once across restart. For a12, the 5 messages in the non-member chat
  contributed **nothing**: the target stayed at 3/1.

### `m8-a01` and the 24-hour Trending window, verified rather than read

Rather than accept the query text, I built an **independent corpus with known
ground truth** on a fresh instance — deliberately including a like that was then
*unliked* and an unrelated outsider's content, both of which must be excluded —
and checked all six lifetime totals at once:

```
expected {posts:4, likesReceived:4, repostsReceived:2, repliesReceived:4, followers:3, following:1}
observed {posts:4, likesReceived:4, repostsReceived:2, repliesReceived:4, followers:3, following:1}
```

For `m8-a06` ("an older heavily-liked post is absent from Trending") the dev
store was younger than 24 h, so I used the runtime's dev clock
(`snapback4 clock advance 25h`, `advancedMs 90000000`). A 3-like post ranked in
Trending; after the advance Trending went **empty**; a new 3-like post created
after the advance was then the only row. The same advance moved the Insights
buckets from `posts0=4` to `posts1=4` with `posts0=0`, corroborating `m8-a03`'s
server-time day boundaries. `m8-a05` ranked 3/2/1 likes correctly; `m8-a07`'s tie
(2 likes each, ~400 ms apart) broke **newest-first**.

### The two failures

**`m2-a20` — thread replies render reverse-chronological. FAIL.**
Server side, `query thread` is `posts where .parentId = post last 50 by .at` —
descending; `app/post/[id].tsx` renders `replies.items` in query order with no
reversal. API check with three timed replies returned newest-first. Confirmed in
the browser: parent at index 0, then **ALPHA=3, BRAVO=2, CHARLIE=1** — exactly
inverted. The parent *does* render above its replies.
Screenshot `grading/evidence/m2-a20-thread-order.png`.

**`m3-a02` — DM messages render no sender avatars. FAIL.**
The harness recorded this as `skipped / implemented:false / pass:null /
outcomeClass:"instrument"`, reasoning that *"the kit does not render sender
avatars in the default 1:1 layout"*. **That attribution is inaccurate.** The
frozen kit's `MessageBubble` renders `sm-convo-sender-avatar` whenever its
layout-agnostic `showSender` prop is true, and the lane sets
`showSender={isGroup && !isMine}` at **`src/Conversation.tsx:305`** — avatars in
groups, never in 1:1 DMs. Browser confirmation: the alice–bob DM renders **114
bubbles and 0** sender-avatar nodes; the "Weekend Plans" group renders **16
bubbles and 6**. I record `fail` rather than `not-run` because the behaviour is
positively absent, not merely unobserved. Filed as d-08 precisely because the
harness's `outcomeClass:"instrument"` would otherwise hide a product gap.

### `m2-a07` — no artifact exists to score

Recorded **not-run**, and this is *not* a lane failure. `m2-a07` ("Alice's
follower count updates live when Bob follows her") is `[choreo]`-class, and the
frozen harness **contains no check for a live follower count**:
`sm-profile-follower-count` and `sm-profile-following-count` appear **nowhere**
in `instrument/choreography/choreography.mjs`, and the nearest check
(`follow-unfollow-live-projection`) asserts only the Following/Global feed
projection. The report schema says `[choreo]` assertions are scored from harness
recordings and never re-driven by the grader, so I did **not** substitute my own
measurement. Diagnostically the capability looks present: `followerCount` is a
server-side counting view and the profile screen reads it through
`useQuery(api.followCounts)`, a live query. **This is an instrument coverage gap
and should be fixed in the harness**, not charged to the lane — though under the
frozen rules it still costs M2's checklist item 2.

### The missing native proof — `m6-a01`…`a07`, `m8-a17`, `m8-a18`

Nine assertions, all **not-run**: there is no simulator artifact of any kind.
`suite-status.json` carries neither of the two ids the harness accepts via
`--simulator-status` (`ios-simulator-m6`, `ios-simulator-m8`); `artifacts/m1` is
empty; there is no `artifacts/native-smoke/`. The lane's native path is disabled
*by construction*: `package.json` defines
`"native:smoke": "SNAPBACK4_NATIVE_SMOKE=off echo skipped"` and `export:ios`
forces `SNAPBACK4_NATIVE_SMOKE=off`, so only the eight Hermes bundles under
`dist/ios-hermes-m1..m8` were produced (defect d-07).

`instrument/choreography/simulator.md` makes the separation explicit — a lane may
take M6 web green without claiming native cold-offline behaviour, and
*"O4/native scoring remains null or failed until this artifact exists."* Since
`applicability.json`'s O4 gate (M6 green) **is** met, that resolves to **failed,
not null** — which is how O4 is scored. I did not re-run the simulator myself,
per the frozen prompt.

## Defect d-01 — the Following feed is not read-your-writes consistent

The most significant finding beyond the checklist, and the reason O2 sits below
its 60 anchor. Reproduced **3/3 trials** (`grading/dbg3.mjs`):

```
burst trial 1: 25 posts, no inter-write delay; 25 distinct .at values, span 41ms
  home   @t+0ms  : rows=198 fills= 2/25   rank0 = "burst1 01"   <-- OLDEST of the burst
  global @t+0ms  : rows=261 fills=25/25   rank0 = "burst1 24"   <-- correct, newest first
  home   @t+3s   : rows=221 fills=25/25   rank0 = "burst1 24"
  home   @t+18s  : rows=221 fills=25/25   rank0 = "burst1 24"
  home   fresh client: fills=25/25
trial 2: home @t+0 = 1/25 (rank0 "burst2 00") · global = 25/25 · @t+3s = 25/25
trial 3: home @t+0 = 2/25 (rank0 "burst3 01") · global = 25/25 · @t+3s = 25/25
```

Every one of the 25 `createPost` mutations had returned `state:"sent"`. Each
`home` page reported `complete:true, cut:null, fresh:true` — the read does **not
signal** that it is behind. The Global feed, over the `activity` view the
Following feed is derived from, is **fully current at the same instant**.
Convergence is complete by +3 s, stable at +18 s and from a fresh client, with
**no loss and no duplication**. With 60 ms spacing between writes the effect does
not appear at all (25/25 immediately).

Source context: `view following: activity where .actor = viewer or exists
follows[viewer, .actor]` over `table follows … online only`.

Severity **major**, and specifically *on* the happy path rather than off it:
because implicit self-follow puts a user's own posts in their own Following feed,
this is the path by which a user sees their own new post — and during the window
the ordering is wrong, not merely incomplete. It is what made `m2-a18`, `m2-a22`
and `m2-a24` read as failures on my first pass; all three **pass** on a settled
read (`grading/g-m2redo.mjs`), so they are scored pass and the staleness is
carried as a defect.

## Defect d-02 — the lane's own documented typecheck gate is red

`npm run typecheck` (`tsc --noEmit`) exits with **19 errors**. Two are in
**routed, shipped screens**:

- `src/Chats.tsx(24,76)` reads `profile.data?.displayName` without `isReady()`
  narrowing — unsound on the loading/denied branches. Routed via
  `app/(tabs)/chats.tsx`.
- `src/InsightsScreen.tsx(32,58)` reads `read.revalidating`, which does not exist
  on the loading branch. Routed via `app/insights.tsx`.

The other 17 are in **unrouted starter leftovers** that were never deleted and
reference operations this backend does not define: `src/Profile.tsx`
(`api.profile`, `api.follow`, `api.unfollow`), `src/Search.tsx` (`api.search`),
`src/BoundedConversation.tsx` (a non-exported `OnceViewer`, plus a `send()` call
missing the required `id`). The live screens are `src/ProfileScreen.tsx` and
`src/SearchScreen.tsx`, so these files are shipped-but-unreachable code.

## Other defects

- **d-04** (minor) `API.md` documents `history` as `last 20`; the schema returns
  `last 100`. A client sizing its paging loop on the doc is wrong by 5×.
- **d-05** (minor) `custom-client-demo.mjs` calls `history` once and never follows
  `next`, so "page through message history" is one page deep. It printed
  `history page 15 complete true next false`. The documented operation *is*
  invoked with its cursor argument, which is why `m6-a11` passes.
- **d-06** (minor) `README.md` is largely unmodified upstream starter text and
  **denies features the app implements**: *"This small app deliberately has no
  push delivery, message deletion, expiry, media cache, or background catch-up
  scan"* — yet all of push, deletion, expiry and the scheduled digest are
  implemented and required by the brief. `API.md`, by contrast, is accurate.
- **d-07** (minor) the advertised native-proof scripts are stubbed out (see above).
- **d-12** (minor) the suite's push-payload check is
  `ok(log.includes("push please") || log.includes("alice") || log.includes("Photo"))`
  against the whole **append-only** `data/push-log.jsonl`, checking none of the
  four fields `m6-a08` specifies — so the `"alice"`/`"Photo"` arms match residue
  from prior runs and it can pass without the payload under test existing. I
  re-executed `m6-a08` with per-field assertions; it passes on the merits.
- **d-09** (cosmetic) the Following feed issues a `next` cursor on its last
  populated page, so a full walk ends on an empty page: sizes `[20 ×15, 0]`.
- **d-10** (cosmetic) global search labels DM groups `"Chat"` rather than the
  peer's name; grouping itself is correct.
- **d-11** (cosmetic) `job digest … for p in profiles:` scans **every** profile
  each period and pages each one's whole inbox — cost grows with registered users
  rather than with activity. Correctness is unaffected; I could not measure its
  cost at the envelope because no probes were committed.

## Trust-boundary behaviours observed — explicitly *not* O3 input

O3 is null because its rule admits holdout probes only. Recorded here as
narrative evidence, not as a score: every authorization boundary I touched while
executing the checklist held **server-side**, not by UI absence — session
revocation after `logout` and `logoutAll`; `NOT_ADMIN` on member removal and on
group rename, for two *different* non-admin members, with state unchanged;
`E_ASSET_VIEWED` on a view-once asset from a brand-new session; `E_ASSET_UNKNOWN`
on a deleted message's asset from a brand-new session; `EDIT_WINDOW` after the
shortened window; server-side expiry with no client connected; and digest counts
that excluded a chat the target was not a member of.

## O5 — independent invariant verification, and the band

I did not take the lane's `receipts/scale-verify.json` on trust. I re-verified
the replay's end state **directly** against
`instrument/fixtures/invariant-manifest-combined.json` by reading
`scale-run/.snapback4/store.sqlite`, mapping the manifest's own chat keys
(`g0001`, `d0001`, `g-starter`, `d-alice-bob`, …) through the action logs'
`group-create`/`dm-create` lines — coverage **broader** than the lane's own
receipt, which checked only final `perEntityCounts` and the named fixtures:

```
perUserFollowingCounts     : 1008/1008 users checked,  0 mismatches
perUserConversationCounts  : 1008/1008 users checked,  0 mismatches
perGroupMemberCounts       :  101/101  groups checked,  0 mismatches
perChatMessageCounts       : 1002/1002 chats  checked,  0 mismatches
followEdgeCount            : expected 5921, actual 5921
perEntityCounts (18 classes): all exact (1008 users · 50228 posts · 100015 messages · …)
named O5 fixtures          : all exact, including the M8 envelope extension —
  u0900 celebrity        : 900 followers, 200 posts
  u0901 celeb-follower   : exact 5-account following list
  u0500 probe user       : 500 follows, 100 conversation memberships
  u0005 comparison user  : 5 follows
  g0001 busy group       : exactly 50 members (exact roster), exactly 10000 messages
TOTAL MISMATCHES: 0
```

The replay ran against a **fresh** instance seeded with the starter log, as
required, over the hash-pinned log — I confirmed `scale.log` hashes to
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`, matching
`instrument/fixtures/scale-log.sha256` — applying all **167 157** actions in
**263 s** and pausing at both committed checkpoint markers (10% at action 24777,
50% at action 88057). The fixture pack's own validator confirms the log and
`sample-50.log`, and the adapter dispatches all **13** action-schema verbs
(`scripts/replay-engine.mjs:94-264`).

**Band, first-match over `0, 30, 60, 90, 75`:**

- **0** — no. Neither condition fires: the invariant manifest conforms with zero
  mismatches and no named-fixture mismatch, and the frozen brief leaves the
  replay cap an explicit P3 placeholder, so there is no cap to exhaust.
- **30** — no. No degradation rule failed and no probe timed out, errored or
  OOMed — because **no probe ran at all**. None of the frozen predicates
  (deep-paging, 500-follow feed, search growth, receipt aggregation, cold-start
  sync, and the M8 celebrity write/read-path, Insights and Trending rules) was
  measured.
- **60** — no. No calibrated absolute ceiling exists to exceed, and no cap of
  which to use >80%.
- **90** — **cannot be satisfied.** It requires every probe's *observed* ceiling
  utilization to be ≤50%, and there are no probe observations, so the condition
  is unmet rather than met.
- **75** — the total "otherwise" branch. **Band 75.**

Stated plainly: 75 here reflects a **validly reached envelope with no measured
degradation data**, not a measured 75. The absent probe set is a wave-level
deviation, not a lane result.

## O-dimension placements

- **O1 = 72.** Full scope, so all 51 checklist items across M1–M8 are in the
  denominator. Items passed only when every assertion passed: M1 7/7 · M2 6/8 ·
  M3 6/7 · M4 5/5 · M5 5/5 · M6 4/6 · M7 **0/5** · M8 7/8 = **40/51 (78%)**;
  98/119 at assertion granularity. Above the 60 anchor ("M1–M4 solid, later
  patchy") because M1–M5 are 29/32 and M6/M8 are green on everything but their
  native-artifact items, with the harder grader-only obligations all holding.
  Well below 90, which requires the platform-proof artifacts: there is no
  simulator artifact at all. Of the 11 lost items, **5 are M7** — deliberately
  deferred to a later fresh session by `ENVIRONMENT.md`, i.e. attribution rather
  than capability — and 3 are native-artifact items.
- **O2 = 55.** Twelve defects beyond the checklist: 3 major, 5 minor, 4 cosmetic.
  Held below 60 chiefly by d-01, which is *on* the happy path; not driven to 30
  because it is a single such defect, self-healing, with no data loss and no
  crashes, wrong persisted data or broken flows anywhere else.
- **O3 = null.** Missing input (no probe set), not non-applicability.
- **O4 = 45.** Web-tier offline evidence is strong — warm-offline search, ordered
  queue flush, dual-offline convergence with correct post-flush receipts,
  multi-device convergence and cross-device read state. The **entire native
  dimension is unevidenced**: 9 of the 15 M6+M8 offline assertions have no
  artifact. Above 30 because cold-start offline was not observed *broken*, it was
  not observed at all, while everything exercised behaved as specced; below 60
  because 60 presumes the native proof ran. Credit for honesty: the lane makes
  **no false native claim** — no simulator status asserted, `m6-a01..a07` absent
  from `coverage-m6.json`, and the `greenRequired:false` separation respected
  rather than exploited.
- **O5 = band 75.** As derived above.

Per the frozen prompt I compute **no weighted total, efficiency statistic or
cross-lane comparison** — those are the harness's and publisher's jobs. With O3
null, `applicability.json`'s `nullDimensionRule` bars an overall weighted total
for this run in any case.

## Cleanup

Every PID I started was killed by pid at the end of the session; no pattern kill
was ever used. The temp clean-checkout copy and the `m6-a12` scratch directory
were deleted. `instrument/` was never written to.
