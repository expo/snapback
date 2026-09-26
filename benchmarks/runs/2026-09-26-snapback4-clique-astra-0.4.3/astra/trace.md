# Sanitized evidence and action trace — lane `astra-snapback4`

**Artifact class:** published companion to `grader-report.json` (LLP 0197
redaction posture; LLP 0198 — raw grader transcripts are never published).
**Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder
context.
**Lane under grade:** `/Users/ccheever/clique-sb4-20260926-astra-cal22/lanes/astra-snapback4`
(backend `snapback4-0.4.3`; public npm `snapback4@0.4.3`, `snapback4-expo@0.4.3`).
**Run scope:** `full` (M1–M8). **Wave:** `full-3models-astra`.
**Session date:** 2026-09-26. All timestamps below are UTC.

---

## 0. Redaction and integrity statement

- No password, bearer token, session token, push-provider token, or asset
  bearer URL appears in this trace. Persona accounts are named by their
  fixture id (`alice` … `henry`, `u0005`, `u0500`, `u0900`, `u0901`); their
  passwords live in the frozen fixture pack and are not reproduced here.
- Backend-assigned principal ids are opaque ULID-style strings; where one was
  needed to make an observation legible it is abbreviated or replaced by the
  persona id.
- Raw tool transcripts, raw browser recordings and the grader's scratch
  scripts are retained privately under `grading/work/` and are not part of the
  published pair (`grader-report.json`, `trace.md`).
- **Excluded-context compliance.** The lane directory contains `diary.md`,
  `essay.md`, `final-report.md`, `FINAL.md` and `run-log.md`. None of them was
  opened at any point in this session. `README.md` references them in its last
  line; that reference was not followed. No other lane under `lanes/` was
  listed or read. The grading session is therefore **not contaminated**.
- Nothing was written into `instrument/` (verified read-only snapshot). All
  grader output is under `lanes/astra-snapback4/grading/`.

### Instrument pins verified by the grader

| Artifact | SHA-256 / check |
|---|---|
| `instrument/schema/social-messenger/assertions.json` | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` (119 assertions across M1–M8) |
| `instrument/fixtures/scale.log` | `b26bf1ae…0b6abba9`, matches the committed `scale-log.sha256` |
| lane `choreography/` vs `instrument/choreography/` | `choreography.mjs`, `control-lane.mjs`, `setup-identity.mjs`, `receipts.schema.json`, `VERSION`, `package.json` all byte-identical; only `node_modules/` and `package-lock.json` added |
| lane `ui/` vs `instrument/ui/` | `diff -rq` reports **no differences** — the frozen UI kit is unmodified |
| lane `config/windows.json`, `config/digest.json` | byte-equal in content to `instrument/fixtures/config/windows.shortened.json` and `digest.shortened.json` (edit 60 s, delete 120 s, 24h→180 s, 7d→300 s, digest period 120 s) |

### Deviations from the frozen grader protocol (recorded by the wrapper, N=1 calibration run)

1. **No holdout probe set was committed for this wave.** `instrument/grader/probes/rotation-log.md`
   has no rows, confirming the absence independently. Execution-order **phase 4
   was skipped**; `wave.probeSetSha256` is the literal `none-uncommitted` and
   `probeResults` is empty. No probes were invented. Consequence: **O3's only
   admissible evidence base does not exist** (applicability.json: O3 is
   "scored from the wave's secret rotated holdout probes only"), so O3 records
   `null` with a note rather than a fabricated score.
2. **The grader's family has not passed the calibration gate.** `grader.calibrationPassed`
   is `false`, `grader.sameFamilyGraded` is `false`; the grade is labelled
   `uncalibrated-grader` by the record.
3. **Timing-sensitive checks are judged best-of-3**, with machine load (`uptime`)
   recorded beside each timing record. This machine is shared: unrelated
   sessions were running a large Node test matrix throughout, and 1-minute load
   average ranged from **3.99 to 62.10** during the session.

### Schema limitation and the prior measurement-coverage gap

- The frozen `grader-report.schema.json` constrains `assertionResults` keys to
  the pattern `^m[1-7]-a[0-9]{2}$`. It therefore **cannot hold M8 results**,
  even though `assertions.json` (manifestVersion `0.3.0-m8`-era) and
  `applicability.json` both place M8 in the full-run scope and in O1/O2's
  observing set. To keep `grader-report.json` schema-valid while still
  delivering a complete grade, the **101 M1–M7 ids** listed in
  `GRADER_ASSERTIONS_101.txt` are in `grader-report.json` and the remaining
  **18 M8 ids** are in `grading/m8-assertion-results.json`, using the same
  result records and enum values. No id appears in both files; together they
  partition the frozen manifest's 119 ids exactly.
- **Prior measurement-coverage gap.** The September 5 and September 12
  structured `assertionResults` carried only those same 101 ids. Their prose
  notes could describe M8 observations, but they did **not** provide a
  machine-comparable 18-id M8 result set. This run is the first to emit one, so
  the prior-101 subtotal is the only quantity directly comparable across the
  three dates; the 18 M8 results and the 119-result total are new coverage, not
  a change in lane behaviour.
- A second manifest-internal inconsistency worth recording: `assertions.json`'s
  own `counts` block says `M2: 24` and `total: 116`, while the file actually
  carries 27 M2 assertions and 119 in total. Grading followed the **actual
  assertion objects**, which is what the ids key against.

---

## 1. Environment the grader brought up

macOS arm64 (Darwin 25.6.0), Node **v24.18.0** from
`~/.volta/tools/image/node/24.18.0/bin` (first on PATH). Playwright **1.62.1**
from the lane's already-installed `choreography/node_modules`, chromium from the
shared browser cache. Ports restricted to **49360–49379**; nothing outside that
range was touched, and no pattern kill was ever used.

### PID ledger (every process the grader started)

| PID | Command | Port | Started | Ended |
|---|---|---|---|---|
| 97314 → 97387 | `npx snapback4 dev --port 49360` | 49360 | 13:46 | 14:06:38 — terminated deliberately by the m8-a11 mid-period restart probe |
| 3947 → 3976 | `npx expo start --web --port 49361` | 49361 | 13:47 | killed at session end |
| 19431 | `node scripts/push-worker.mjs` | — | 13:52 | killed at session end |
| 46381 → 46384 | `snapback4 dev --port 49362 --replay --no-watch` (in `scale-instance/`) | 49362 | 14:00 | killed at session end |
| 74825 → 74826 | `./node_modules/.bin/snapback4 dev --port 49360` (restarted backend) | 49360 | 14:06:38 | killed at session end |

Unrelated PIDs observed on the machine (a `node --test` matrix and an Xcode
Python suite under another project) were left untouched; they are the source of
the load spikes recorded below.

### Startup facts observed

- `snapback4 dev` on 49360 printed: store `.snapback4/store.sqlite`; *"development
  only — admits loopback personas and an unauthenticated /seed"*; *"Argon2 slots:
  16 on this host"*.
- `snapback4 dev --replay` on 49362 printed: *"replay on — new effects suppressed;
  schedules held"*, i.e. the brief's pinned replay-mode flag.
- The scale instance's store is 2.9 GB plus a 1.4 GB WAL and adopted cleanly.

### Builder receipts were preserved

The lane's acceptance scripts overwrite `evidence/m*-suite.json`,
`coverage*.json` and `suite-status.json` in place. Before running anything, the
grader snapshotted the builder's versions of those files (plus every
`m*-choreo.jsonl` and its `.observations.jsonl`) to
`grading/work/builder-baseline/`, and kept the grader's own post-run copies in
`grading/work/grader-run/`. Both sets are intact; the comparison below uses
them.

---

## 2. Phase 1 — the builder's documented acceptance suite

Invocation, exactly as `README.md` and `package.json` document:
`npm run acceptance -- --milestone mN`, against the running backend on 49360 and
the web client on 49361.

| Milestone | Grader's run | Suite-required assertions reported | Wall | Load (1-min) |
|---|---|---|---|---|
| m1 | **pass** | 7/7 | 2–3 s | 21.2 |
| m2 | **pass** | 22/22, `missing: []` | 9 s | 20.2 |
| m3 | **pass** | 7/7, `missing: []` | 7 s | 19.9 |
| m4 | **pass** | 5/5, `missing: []` | 5 s | 21.8 |
| m5 | **pass** | 6/6, `missing: []` | 1 s | 21.3 |
| m6 | **fail → pass** | 0/5 then 5/5 | 46 s then 2 s | 21.3 |
| m8 | **pass** | 6/6, `missing: []` | 3 s | 14.7 |

**The m6 first-attempt failure was the grader's environment gap, not a lane
defect.** `scripts/acceptance-m6.mjs` asserts `m6-a08` against rows the
provider seam appends to `evidence/push.jsonl`, which only exists while
`node scripts/push-worker.mjs` is running. The README documents that worker in a
later *"Push and scheduled digest"* section, not in *"Verification"*. After
starting the worker the suite passed on the first attempt and every subsequent
one. This is filed as defect **d-03** (documentation/setup, `minor`) rather than
a functional failure, and m6's suite result is recorded as **pass**.

All seven attempted milestones' suites therefore pass under the grader's own
invocation, matching the lane's `suite-status.json`. The grader's re-run
receipts differ from the builder's only in their `at` timestamps.

---

## 3. Phase 2 — coverage-manifest spot-verification

`coverage-manifest.json` maps **58** suite-required assertion ids to test files.
Cross-checked against `assertions.json`: the manifest covers **every**
suite-required assertion of every attempted milestone, with no extras —
M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5, M8 6/6. (M7's six
suite-required assertions are absent, consistent with M7 `not-run`.)

Every mapped test file was then read in full — `scripts/acceptance-m1.mjs`,
`-m2`, `-m3`, `-m4`, `-m5`, `-m6`, `-m8` and the shared `scripts/suite.mjs` —
and each mapping was checked against the assertion's observable. **Verdict:
`honest`.** No mapping points at a test that does not exercise its assertion,
and no milestone is adjudicated `capability-failure`.

Independently, the grader re-executed **all 58** of those assertions by a
*different* mechanism (custom-client API, direct asset fetches, browser
automation, read-only store SQL) and reached the same pass verdict on every
one. There is **zero divergence** between `suiteResult` and the grader's
independent `result` anywhere in the report — the strongest available evidence
that the mappings are honest.

Four mappings are weaker than ideal and are recorded for transparency; none is
dishonest, and the grader's independent check closed each gap:

1. **`m2-a13` ("no preview card renders for the URL")** is asserted as
   `page.locator("iframe").count() === 0`. An unfurl card would normally be a
   `div` with an image and title, not an `iframe`, so this is a thin proxy. The
   grader verified the observable directly: on the thread screen the post's URL
   produced `iframes=0` **and** `images=0` (no card, no thumbnail), and there is
   no unfurl code path anywhere in the lane — `ui/src/FeedCard.tsx:43` documents
   the ruling and `ui/src/linkify.tsx` only wraps `https?://…` matches in a
   tappable span.
2. **`m2-a24` ("no duplicates and no gaps")** checks only `Set`-size equality
   for duplicates. The grader added the missing half: a full cursor walk of the
   Global feed (16 pages, 309 entries) with `duplicates=0` **and** ordering
   verified monotone non-increasing by `.at` across every page boundary.
3. **`m4-a03` (video message end-to-end)** registers `check("m4-a03", true)`
   after a caption bubble appears, without asserting the video actually
   attached. The grader asserted the media: the recipient's message card reports
   `type: "video"` with `video.duration = 5000 ms`, and the recipient's asset
   fetch returns HTTP 200 with 49,779 bytes.
4. **`m3-a11` (tapping the quoted excerpt jumps to the original)** is asserted
   as `bubble.isVisible()`, which can be true without any jump. The grader
   re-ran it with 25 filler messages between quote and target and measured the
   target's viewport geometry: the bubble moved from y≈1670 to y≈503 and
   `getBoundingClientRect()` confirmed it inside the viewport after the tap.

One mapping is *stronger* than the assertion requires and deserves note in the
other direction: `m8-a01` computes the six expected totals from read-only store
SQL and compares them against both the `insights` query and the six rendered
`sm-insights-total-*` values.

---

## 4. Phase 3 — independent checklist execution

Three independent execution paths were used, none of them the builder's suite:

- **Custom-client API** (`http://127.0.0.1:49360`), through a client the grader
  wrote from `API.md` alone (`grading/work/lib.mjs`) — envelopes `POST /q/<op>`
  `{args}`, `POST /m/<op>` `{id,args}`, `POST /assets`, `GET /assets/<id>`.
- **Browser automation** on the running web build (Playwright, chromium).
- **Source and store inspection** for the `[grader]` source-inspection
  assertions, plus read-only `snapback4 sql` as an independent ground-truth
  path for aggregate arithmetic.

`[choreo]` assertions were **not** hand-driven. They are scored from the frozen
choreography harness's structured receipts. Because the harness is
byte-identical to the instrument's copy, the grader ran it **itself** to obtain
independent receipts rather than relying on the builder's:

```
node choreography/choreography.mjs <segments> --adapter choreography-adapter.json \
  --suite-status suite-status.json --setup-identity setup-identity.json \
  --lane-run-id grader-independent-astra-snapback4 --receipts grading/work/choreo-*.jsonl
```

### 4.1 M1 — accounts and profiles

| Assertion | Method | Observation |
|---|---|---|
| m1-a01 | api + web | Signup with a 15-char password returned a live session; a 7-char password was refused with `E_AUTH: a password needs at least 8 characters`. Web signup landed authenticated. |
| m1-a02 | web-automation | After submit the auth form is unmounted (`sm-auth-submit` count 0) and the authenticated profile-setup surface is mounted. |
| m1-a03 | web + api | Claiming handle `alice` renders the visible error **"That handle is taken."**; the API mutation returns `state: failed`. |
| m1-a04 | web + api | Duplicate-email signup renders **"E_AUTH: that email already has an account; sign in instead"**. |
| m1-a05, m1-a06 | choreography-artifacts | `session-persists-on-relaunch` passed (531 ms); `logout-remains-signed-out-on-relaunch` passed (782 ms). |
| **m1-a07** (grader, full-only) | api | Pre-logout `myProfile` returned data → `POST /auth/logout` (200) → the *same* bearer returns **HTTP 401** `E_AUTH "this session is not live; sign in again"`. Server-side revocation confirmed. |
| m1-a08 | web + api | Two successive profile saves, then a **full page reload**: the second display name and bio are still rendered on the own-profile screen. |
| m1-a09 | choreography-artifacts | `profile-edit-live-visibility`, best-of-3 `visibleMs` **502.4 / 183.8 / 133.7** → best **133.7 ms**, no manual refresh. |
| m1-a10, m1-a11 | web-automation | Fixture avatar accepted through the profile form; the profile avatar `<img>` decoded at **256×256** with `naturalWidth > 0`. |
| **m1-a12** (grader) | source-inspection | `snapback/schema.q:1` declares `use identity password` — the platform's built-in auth. The vendored provider documentation (`node_modules/snapback4/CLIENT-AND-OPERATIONS.md:1265-1274`) states that an email-and-password product declaring `use identity password` is served by **Argon2**, and the dev server announces its Argon2 slot count at startup. The store confirms the documented path is the one in use: every credential record carries the prefix **`$argon2id$v=19$m=19456,t=2,p=1`** (22 occurrences) — argon2id at standard published parameters. No hand-rolled KDF and no bcrypt/scrypt/PBKDF2 marker exists anywhere in the store. The lane's own code never handles a password beyond passing it to `/auth/signup` / `/auth/login` (`ui/src/AuthForm.tsx` is purely presentational). |
| **m1-a13** (grader) | source-inspection | Searched `.snapback4/store.sqlite`, its `-wal`, the exported `dist/` web bundle, the scale instance's store, and both backend logs for three fixture passwords: **0 hits in every location**. The only plaintext passwords in the tree are the declared test-fixture exception (`instrument/fixtures/personas.json`) and two throwaway passwords for accounts the lane's own tests create. |

### 4.2 M2 — posts and the follow graph

Suite-required assertions re-executed through the API; feed/link/pagination
observables re-executed in the browser. All **27** pass. Highlights:

- m2-a02: image post carries 2 images; **both** assets fetch 200 with bytes by
  the *recipient's* bearer. m2-a03: video card references the uploaded asset,
  `duration = 5000 ms`.
- m2-a08/a09/a10/a11: after Bob unfollows Alice, 165 checked Following entries
  contain no Alice-authored item, while the same post remains in the Global
  feed — unfollow is projection-scoped, not content revocation.
- m2-a15: `likeCount` 1 → 0 → 0 across like / unlike / repeated-unlike
  (idempotent set-state).
- m2-a16: repost entry carries `actorProfile.displayName` for the reposter.
- m2-a12: the URL renders as tappable text with accessibility `role="link"`.
  React Native Web emits **no `href` attribute**, so the grader verified the
  real observable instead: clicking the rendered link invoked the browser URL
  opener with exactly the post's URL (`window.open` argument captured and
  compared). Source wires `onPressLink={Linking.openURL}` at
  `src/Social.tsx:132` and `src/Message.tsx:62`.
- m2-a22/a23: API pages of exactly 20 with a cursor, page1∩page2 = 0; and in
  the browser both tabs grew 20 → 40 items on load-more.
- m2-a24: full Global cursor walk, 16 pages / 309 entries, 0 duplicates,
  ordering monotone by `.at`.
- m2-a25/a26/a27: with Bob following **nobody**, his Following feed still holds
  190 entries, all his own posts and reposts, while `socialProfile` reports
  `following = 0` and an unchanged follower count — implicit self-follow with no
  edge.
- Live assertions from the grader's own choreography receipts, best-of-3
  `visibleMs`: feed text **799.1 / 793.5 / 803.5**; follow projection
  **846.2 / 1006 / 799.5**; like count **419 / 424.7 / 454.1**; reply count
  **346.8 / 374.5 / 396.1**.

### 4.3 M3 — messaging core

All **15** pass.

- m3-a03: two independently-issued `createDM` intents for the same pair resolve
  to the **same** channel id; `dmFor` agrees.
- m3-a05: a second group with the same three members **and the same title**
  coexists as a distinct conversation (two different chat ids, identical
  rosters).
- m3-a14: a non-admin's remove (`changeMember` with `promote:false`, which is
  the delete path at `snapback/schema.q:271-277`) returns `state: failed` /
  `NOT_MEMBER`-class refusal and the roster is unchanged.
- m3-a15: the grader re-ran **every installed starter segment** (m1, m2, m3) and
  compared a three-way snapshot (sorted membership list, Global-feed entry
  count, first history page size) before and after: **byte-identical**.
- m3-a06 / m3-a07 (typing indicator). The grader ran the M3 segment three times.
  The reported best-of-3 uses the third run, in which all three harness attempts
  produced metrics: `visibleAfterLastKeystrokeMs` **1557 / 44.5 / 305.6** → best
  **44.5 ms** against the 2 s bound; `expiresAfterLastKeystrokeMs`
  **4637.8 / 4061.1 / 4198.7** → best **4061.1 ms** against the 5 s bound. The
  earlier two runs agree (bests 397.2 ms and 208.8 ms for visibility; 1997.1 ms
  and 4067.6 ms for expiry) but each lost attempt 1 to the harness's own 2000 ms
  visibility wait while 1-minute load was above 30 — which is exactly what
  best-of-3 exists to absorb.
- m3-a08 receipt ticks sent → delivered → read: the harness runs this
  `bestOf: 1`, so the grader obtained three measurements by running the segment
  three times — **7782 / 6482 / 5798 ms**, passed every time.
- m3-a09 group aggregate waits for the slowest member: passed in all three runs
  (4722 / 3865 / 4178 ms).
- m3-a12 / m3-a13 (`member-add-promote-remove-leave-and-live-cutoff`): passed in
  all three runs (11,582 / 9091 / 9603 ms).

### 4.4 M4 — media messages, reactions, edit/delete

All **12** pass.

- m4-a01 / m4-a03: recipient message cards report `type: image` / `type: video`
  with real media references, and the recipient's own asset fetches return 200
  with 2,080 B and 49,779 B — a query result, not a placeholder.
- m4-a06 / m4-a07: 👍 → ❤️ replaces (exactly one reaction row, `count: 1`);
  tapping ❤️ again clears it to `[]`.
- m4-a09: the message card carries `edited: true`, and the bubble renders
  *"grader label edited … **edited** 7:14:52 AM ✓"*.
- **m4-a10** (grader, shortened windows): an edit **inside** the 60 s window
  succeeded; after waiting **66 s** the same edit was refused with
  `EDIT_WINDOW_CLOSED` (`schema.q:349`) and the stored body was unchanged. A
  second attempt that smuggled caller-supplied `now`/`at` fields **also failed**
  — window checks run against server time.
- **m4-a12** (grader): pre-delete the recipient fetched the photo asset (200,
  2,081 B); after `deleteMessage` the **recipient** gets 404, the **sender**
  gets 404, an unauthenticated fetch gets 401, and the message card carries
  `deleted: true` with an empty body.
- Live assertions from grader receipts: photo render best-of-3
  **3401.9 / 4417.9 / 3414.5 ms**; reaction **3383.8 / 1919.2 / 2350.1 ms**;
  edit **3342.1 / 4372.8 / 4374.1 ms**; tombstone passed (3525 ms).

### 4.5 M5 — ephemeral, chat config, search

All **12** pass. Checklist item 1 is `[grader]` in its entirety and was executed
twice (the first pass used a wrong selector for the in-chat search input, so the
client-side search clause was re-executed against the correct
`sm-search-input`; both runs agree on the server and purge clauses).

- The DM's TTL is taken from the **fixture** shortened config: a message sent
  with the `24h` option carries `expiresAt - at = 180000 ms` exactly, matching
  `windows.shortened.json`.
- **m5-a01**: Bob's client rendered the message while online, then **both
  clients were closed**. After expiry the server's point `message` query
  returns `null`, the message is absent from a fresh `history` page, and the
  server-side `searchChat` for its text returns 0 hits. Backend expiry proceeds
  with no client open.
- **m5-a02**: on relaunch, Bob's client rendered 140 bubbles and the expired
  marker was **not** among them (it was among 160 before expiry).
- **m5-a03**: after the relaunch, in-chat search for the expired marker returns
  no result, while the same search **did** hit before expiry — the client
  purged it from offline search once it synced the expiry.
- **m5-a04 / m5-a05**: through the UI, Bob's first open mounted the media viewer
  and decoded a **640×480** image inside it; after a full page reload (clearing
  any in-memory once-guard) the second open mounted **no** media and no decoded
  bytes, while an independent direct asset fetch returned **HTTP 410**.
- **m5-a06** (grader): first direct asset fetch 200 (2,072 B), second **410**,
  third **410**; a non-member persona's fetch of the same asset returns **404**.
- m5-a07 (chat colour/background sync to all members): grader receipt passed,
  `visibleMs 613.5`.
- m5-a08: a non-admin's rename is refused and the title is unchanged.
- m5-a09: `people` search matches word-prefix case-insensitively — `car`, `CAR`,
  `Car` all return carol, and so does the display-name token `chen`.
- m5-a10 / m5-a11: in-chat search finds the seeded string and every hit is
  scoped to the chat; global search returns per-chat groups where every hit
  belongs to its group. The grader additionally probed whether global search
  covers **all** memberships or only the first page: with Alice in 25 chats, a
  unique token planted in both the lowest- and highest-ordered chat was found in
  a single `complete: true` answer with no cursor. No coverage gap.
- m5-a12 (warm-offline search over synced messages): grader receipt passed
  (1396 ms).

### 4.6 M6 — offline writes, push seam, custom-client API

- **m6-a01 … m6-a07 — no qualifying native artifact exists.**
  `instrument/choreography/simulator.md` requires a run directory containing
  `m6-ios-screen.mp4`, `m6-ios-receipts.jsonl` and `m6-ios-run.json`, and states
  that *"a recording without passing structured receipts is not a pass"*.
  `artifacts/m6-ios/` contains only an Expo/Hermes export
  (`_expo/static/js/ios/*.hbc`, `assets/`, `metadata.json`). The lane says so
  itself, accurately, in `README.md` (*"these are Hermes exports, not simulator
  proofs"*) and `run-record.json` (*"simulator behavior is not claimed"*). These
  seven assertions are recorded **`not-run`** with method
  `choreography-artifacts`: the behaviour was never demonstrated by any harness
  recording or structured receipt, and per `assertions.json` they carry
  `greenRequired: false`, so M6's green receipt is unaffected. They count as
  not-passed in O1's denominator. For context, the platform ships a
  `snapback4 witness ios` subcommand for exactly this recording, so the gap is a
  declined proof rather than an impossible one.
- **m6-a08**: the grader sent a 177-char text, a view-once photo and a video to
  Bob with no client of his connected, then read the provider seam's log. The
  text payload carries `targetUserId` = Bob, `chatId = d-alice-bob`,
  `senderDisplayName` equal to the sender's **current** profile display name,
  and `preview` exactly the first **80** characters. (A first grader check
  mis-failed here by hard-coding the seeded display name; Alice's display name
  had been changed by the choreography segment, and the payload was correct.)
- **m6-a09**: the view-once photo previews as **`"Photo"`** and the video as
  **`"Video"`**.
- **m6-a10 / m6-a11**: `scripts/custom-client-demo.mjs` ran green three times
  from the lane as shipped — via `CLIQUE_TOKEN`, via
  `CLIQUE_EMAIL`/`CLIQUE_PASSWORD`, and against a second named conversation —
  reporting all six operations `["authenticate","inbox","history first page",
  "history continuation","send","poll receive"]`, covering every operation the
  brief lists.
- **m6-a12** (grader-written variation, using **only** `API.md`): following the
  documented recipe — log in, page `inbox` until `room.title` matches, retain
  the chat id, then `history` with `c: null` where *"the first item … is the
  latest message"* — the grader fetched the latest message of **"Weekend
  Plans"** in 1 inbox page. The returned row carries the **complete** minimum
  field manifest with **zero** missing fields (id, chat, sender, senderProfile,
  at, type, body, photo, video, oncePhoto, edited, deleted, quote, quoted,
  reactions, receipt) and is the highest-ordinal row on the page. Documentation
  quality is sufficient to do this without reading lane source.
- **m6-a13**: the grader ran the fixture validator (`50 actions, 0 markers, 13
  verbs`) and then `scripts/conformance.mjs`, which replayed the 50-action
  sample green on the dev instance
  (`{"pass":true,"actions":50,"verbs":13,…}`). All 13 verbs are exercised.
- m6's web choreography segment (`offline-message-queue-flush-in-order`) passed
  in the grader's own run, `flushMs 4662.2`.

### 4.7 M8 — insights, digest, multi-device offline

- **m8-a01**: the six lifetime totals were compared against read-only store SQL
  **twice**, before and after controlled activity, and then against the rendered
  UI. Before: `{posts 93, likesReceived 97, repostsReceived 14, repliesReceived
  21, followers 4, following 2}`; after 1 post + 4 likes + 2 reposts + 1 reply:
  `{94, 101, 16, 22, 4, 2}`. Observed deltas exactly
  `{posts 1, likes 4, reposts 2, replies 1, followers 0, following 0}`. The
  Insights screen rendered `94 Posts / 101 Likes received / 16 Reposts received
  / 22 Replies received / 4 Followers / 2 Following`.
- **m8-a02**: grader receipt `m8-a02-insights-like-refresh` passed,
  `beforeLikes 123 → afterLikes 124`, `refreshMs 563.4`.
- **m8-a03**: 7 buckets; the newest bucket's day index **20722** equals
  `floor(Date.now()/86400000)` — a UTC day boundary — and a post created now
  moved today's count 89 → 90.
- **m8-a04**: the screen renders exactly **7** day rows and the payload retains
  **5** all-zero buckets explicitly (`days = [0,0,0,0,0,3,87]`) rather than
  omitting them.
- **m8-a05 / m8-a06 / m8-a07**: the grader built its own fixture — one post
  backdated to `now − 90,000,000 ms` (25.0 h old) liked by all **8** personas,
  and two posts created 25 ms apart each liked by **7**. Trending's head is a
  trailing-24 h post with `likeCount 7`; the 8-like older post is **absent**
  despite having more likes; and the tie breaks **newest-first**
  (`rank1.at 1790432589220` before `rank2.at 1790432589190`). The Trending tab
  rendered 10 ranked rows matching the query's 10 rows.
- **m8-a08 … m8-a12 (the scheduled digest, all `[grader]`)** were executed
  against the fixture's shortened digest config (period 120 s, anchor
  00:00:00) on four fresh accounts with **no client open for any of them**. The
  grader aligned to a real period boundary (`periodStart 1790431560000`,
  `periodEnd 1790431680000`) and wrote: a follow, a post by a followed account,
  one unread message in a shared group, one **tombstoned** message in the same
  group, and one message in a second group the target is **not** a member of.
  - **m8-a08**: exactly **one** digest row per active user with exactly the
    expected counts — `ga {newFollowers 0, newPostsInFollowing 1,
    unreadMessages 1, unreadChats 1}`, `gb {1, 0, 1, 1}`. The tombstoned
    message did not count.
  - **m8-a09**: the idle persona received **0** digest rows.
  - **m8-a10**: the following quiet period (`…680000 … …800000`) emitted **0**
    digest rows for any of the four accounts.
  - **m8-a11**: the backend was **SIGTERM'd and restarted mid-period** at
    14:06:38Z, 35 s after the activity and 82 s before the period closed. Per-user
    digest row counts for that period stayed `ga=1, gb=1, gc=0, gidle=0` — no
    double emission. The provider worker logged one transient
    `UND_ERR_SOCKET "other side closed"` at the restart, survived, and resumed;
    the schema's `once [principal, periodEnd]` guard plus the worker's effect-id
    dedupe are the two layers.
  - **m8-a12**: activity in the chat `ga` is not a member of never reached `ga`
    — its counts stayed at `unreadChats 1, unreadMessages 1`, and the outsider
    who sent that message received no digest.
- **m8-a13 … m8-a16** from the grader's own choreography receipts: same-account
  second-device live delivery (`visibleMs 1323.9`), cross-device read-state
  clearing (`clearVisibleMs 1886.2`), dual-offline convergence
  (`firstFlushMs 2300.6`, `secondFlushMs 2846.1`, no loss, no duplicates), and
  dual-offline receipts advancing (`totalMs 3541.4`). All passed.
- **m8-a17 / m8-a18 — no qualifying native artifact exists**, for the same
  reason as m6-a01…a07 (`simulator.md` extends the same separation to M8's
  durable queue across app termination). Recorded **`not-run`**.

### 4.8 M7 — not run

`milestone-results.json` records `m7: {status: "not-run", reason: "Explicitly
reserved for a separate fresh session."}`, which matches `ENVIRONMENT.md`'s
instruction that M7 is a separate later session and must not be attempted. The
grader confirmed the features are genuinely absent rather than partially built:
**no** poll wiring exists anywhere in `src/`, `app/` or `snapback/schema.q`, and
**no** message-count wiring exists either — the only `messageCount` reference is
an unused optional prop in the frozen UI kit's `ChatSettingsForm.tsx`, and the
kit is byte-identical to the instrument's.

All nine M7 assertions are therefore **`not-run`**. `m7-a09` is the brief's
conditional regression item (`conditionalOn: previously-green-milestones`):
milestones *were* previously green here, so the `not-applicable` trigger the
report schema describes ("where no milestone was previously green") does not
apply; the item is `not-run` because the M7 session that would execute it never
happened. The grader separately confirmed that the previously-green suites still
pass today (§2), so no regression is hidden by the `not-run`.

### 4.9 Independent choreography runs and best-of-3 accounting

The grader ran the frozen harness itself, five times in total:

| Run | Segments | Outcome | Load at start |
|---|---|---|---|
| `choreo-grader1` | m1,m2,m3,m4,m6,m8 | **all six green** | 4.62 |
| `choreo-grader-m5` | m5 | `chat-color-background-sync` pass, `view-once-single-view-and-refusal` pass, `warm-offline-search…` pass, **`disappearing-message-expiry-and-purge` FAILED** ("expired message remained visible after both clients relaunched") | 6.94, rising past 37 during the run |
| `choreo-grader-m5b` | m5 | **all four checks pass, segment green** — including `disappearing-message-expiry-and-purge` (304,365 ms) | 7.48 |
| `choreo-grader-m3-2`, `-m3-3` | m3 ×2 | green both times (best-of-3 for the `bestOf: 1` receipt check) | 4.32 / ~5 |

Two harness attempts contained a non-reproducing attempt-1 failure that
best-of-3 absorbed and which are recorded rather than hidden:
`feed-image-post-live-update` and `feed-video-post-live-update` each failed
attempt 2 with *"composer image attachment did not expose semantic value image
within 10000ms"* — a composer-attachment stall, not a live-delivery miss; both
passed attempts 1 and 3 with `visibleMs` in the 799–820 ms band.

---

## 5. Phase 4 — holdout probes: skipped

No probe set was committed for this wave. `instrument/grader/probes/rotation-log.md`
carries the header and the sentence *"No rows yet — the first wave's probe set is
authored at wave time"* and **zero** custody rows, which independently confirms
the wrapper's recorded deviation. Phase 4 was therefore skipped in full:
`wave.probeSetSha256` is the literal string `none-uncommitted` and
`probeResults` is an empty array. **No probe was invented, and no
trust-boundary or performance observation made elsewhere in this session is
reported as a probe result.**

Trust-boundary behaviour *was* exercised, but only as part of the frozen
checklist (m1-a07 session revocation, m4-a10 expired-edit window, m4-a12 asset
revocation after delete, m5-a06 view-once refetch, m8-a12 digest authorization)
plus a handful of adjacent grader probes recorded in §6. Those feed **O1 and
O2**. They are deliberately **not** used to score O3, whose applicability rule
restricts it to the wave's secret rotated holdout probes; O3 is `null`.

For the record, every trust boundary the grader did touch held:

| Boundary exercised | Result |
|---|---|
| logged-out bearer against `/q/myProfile` | HTTP **401**, `E_AUTH` |
| edit after the 60 s window, incl. caller-supplied `now`/`at` | refused, `EDIT_WINDOW_CLOSED` (server time authoritative) |
| delete-for-everyone after the 120 s window | refused, `DELETE_WINDOW_CLOSED`; message stays visible and its asset still serves (correct — nothing was revoked) |
| ordinary asset after delete-for-everyone | **404** for recipient and sender; **401** unauthenticated |
| view-once asset, 2nd and 3rd fetch | **410**, **410**; a non-member gets **404** |
| non-member `history` on a DM | 0 rows (`complete: true`, no leak) |
| non-member `searchChat` on a DM | refused, `NOT_MEMBER` (`schema.q:380`) |
| non-member point `message` query | `null` |
| non-admin group remove / non-admin rename | both refused, roster and title unchanged |
| non-member `send` into a DM | refused, `NOT_MEMBER` (`schema.q:281`) |
| digest counting a chat the target cannot read | never counted (m8-a12) |
| handle namespace | `E_INPUT: handle must be a handle: lowercase letters, digits and underscores` — no `alice`/`ALICE` case-collision is possible |

---

## 6. Phase 5 — defect list

Five defects beyond the checklist: **0 blocker, 0 major, 4 minor, 1 cosmetic**.
No defect produced wrong user-visible data; the two that touch correctness do so
through honesty/intermittency rather than a wrong answer.

### d-01 — `minor` — Trending never surfaces `complete: false`, and can render "no results" on an undecided answer (M8)

At the full scale envelope the `trending` query answers **`complete: false`** with
`cut: null`:

```
{ complete: false, cut: null, next: null, n: 10,
  meter: { examined: 62, steps: 1310, outputBytes: 9213 } }
```

The platform's own client contract is explicit that this must be surfaced:
*"For `complete: false` with `cut: null`, render 'Results may be incomplete',
even when empty; never 'no matches'."* The lane honours that for its paged
surfaces — `src/Social.tsx:40-42` renders exactly that string when
`!page.read.complete` — but `Trending()` at `src/Social.tsx:321-335` is a plain
`useQuery` that branches only on `r.data.length`, rendering rows when non-empty
and `<TrendingEmpty />` (the "no trending posts" state) when empty. It never
reads `r.complete`. So at the envelope the Trending tab presents an
explicitly-undecided answer as exhaustive, and on a corpus with no in-window
posts it would present it as "no matches" — the one rendering the contract
forbids.

Mitigating, and verified: the ranking itself is **correct**. The grader compared
the API's top-5 against read-only ground truth over the 48,270 in-window
top-level posts and they match exactly, in order:

| rank | API | SQL `ORDER BY likeCount DESC, at DESC` |
|---|---|---|
| 1 | `p001792` (4 likes) | `p001792` (4 likes) |
| 2 | `p033927` (3) | `p033927` (3) |
| 3 | `p032297` (3) | `p032297` (3) |
| 4 | `p022040` (3) | `p022040` (3) |
| 5 | `p018219` (3) | `p018219` (3) |

**Evidence:** `grading/work/trending-probe.mjs` output; `src/Social.tsx:40-42`
vs `src/Social.tsx:321-335`; `node_modules/snapback4/CLIENT-AND-OPERATIONS.md:819-827`;
read-only SQL comparison in §4.7.
**Related assertions:** m8-a05, m8-a06, m8-a07 (all pass on correctness).

### d-02 — `minor` — the Feed screen stacks the entire unvirtualized Chats list above the feed tabs

`app/[...path].tsx:148-151` renders the root route as
`<View><Chats /><Feed /></View>`. "Feed" and "Chats list" are two *separate*
pinned screens in the brief, and the lane does provide a dedicated `/chats`
route — but the Feed screen still carries the whole chat list above it, with no
virtualization. Measured consequence: the feed tab row sits at **y ≈ 82** on
first paint and moves to **y ≈ 1782** once the chat list hydrates, so the Feed
screen's primary controls end up ~1700 px below the fold and shift under the
user after load. In six controlled trials the grader found that a tab click
issued before the shift lands on the wrong element (0 ms settle: 1 of 3
succeeded; 8 s settle: 3 of 3 succeeded — for *any* tab, not just Trending).
Reaching Trending by URL (`/?tab=trending`) always works.

**Evidence:** `grading/work/dbg-trend3.mjs` trial log (`y 82 -> 1782` /
`y 1782 -> 338`); `app/[...path].tsx:148-151`; screenshots
`grading/work/dbg-trending.png`, `dbg-trending2.png`.
**Note:** the grader initially mistook this for a broken Trending tab; the six
trials above are what disproved that, and no assertion is failed on its account.

### d-03 — `minor` — the documented acceptance entrypoint has an undocumented prerequisite for M6

`npm run acceptance -- --milestone m6` fails at its first assertion (`m6-a08`)
unless `node scripts/push-worker.mjs` is already running, because
`scripts/acceptance-m6.mjs` asserts against rows the provider seam appends to
`evidence/push.jsonl`. `README.md`'s **Verification** section — the section a
grader follows — lists `npm run acceptance`, `scripts/setup.mjs` and
`scripts/choreo.mjs`, and says the wrapper supplies base URL, credentials and
JSONL paths. The worker appears only in a *later* "Push and scheduled digest"
section. A clean-checkout grader following the documented verification path gets
a red M6.

**Evidence:** `grading/work/m6-acceptance-grader.txt` (`AssertionError … m6-a08`,
`missing: [m6-a08, m6-a09, m6-a10, m6-a11, m6-a13]`) vs
`grading/work/m6-acceptance-grader2.txt` (`pass: true`, all five) after starting
the worker; `README.md` "Verification" vs "Push and scheduled digest";
`scripts/acceptance-m6.mjs:30-47`.

### d-04 — `cosmetic` — `API.md` never names the field carrying a failed mutation's refusal reason

`API.md` says *"A successful authoritative receipt has `state: "sent"` and
`result`"* and *"A failed receipt or `denied` must be surfaced"*, and documents
`denied` for queries — but it never says where a **failed mutation's** reason
lives. The backend puts it in **`why`**:

```
{ "state": "failed",
  "why": { "code": "EDIT_WINDOW_CLOSED", "family": "rule",
           "message": "the program refused with EDIT_WINDOW_CLOSED",
           "rule": "EDIT_WINDOW_CLOSED", "site": "schema.q:357:3" } }
```

A third-party client written from `API.md` alone can detect the failure but
cannot surface its reason, which is what the same paragraph asks it to do. The
diagnostics themselves are good (code, family, human message, source site) —
this is purely the documentation gap. The grader hit it directly: a first probe
looked for `failure` and found `null`.

**Evidence:** `grading/work/g-refusal.mjs` output (four refusal envelopes:
`NOT_AUTHOR`, `NOT_MEMBER`, `E_INPUT`, `MIXED_MEDIA`); `API.md` §"Request and
response envelopes".
**Related assertions:** m6-a12 (passes — the *read* path documented for that
assertion is complete).

### d-05 — `minor` — an expired disappearing message can still be rendered at the instant a relaunched client opens the conversation, intermittently under load

In the grader's first independent run of the frozen M5 choreography segment,
`disappearing-message-expiry-and-purge` **failed** with *"expired message
remained visible after both clients relaunched"* after the harness's 300 s wait
against a 180 s TTL. On the grader's second run of the same segment it **passed**
(304,365 ms). The grader then built a faithful instrumented reproduction of the
harness's exact sequence and it **passed**, isolating every step:

| Step | Observation |
|---|---|
| set `24h` via the chat-settings control | control exposes `["off","24h","7d"]`; server `chat.disappearing = 24h` |
| send through the UI | server TTL = **180000 ms** exactly |
| both clients closed, 210 s | server point query returns **null** |
| relaunch both, +4 s | Alice **0** matching bubbles, Bob **0** |
| +20 s more | Alice **0**, Bob **0** |

So: not a configuration fault, not a server fault, and not deterministic.
Tally across observed attempts: **1 failure in 3 grader-driven harness attempts**
(the failing one ran while 1-minute load climbed past 37), plus the grader's own
passing reproduction and two passing direct verifications of m5-a02. The most
consistent explanation is a race between the relaunched client's local-replica
read and its reconciliation of the expiry, which the harness — checking as soon
as the conversation opens, with no tolerance window — can catch.

Why it still matters: the lane's own green bar (`ENVIRONMENT.md`) is *"the
matching two-client choreography segment passes for **every** check"*, so on that
attempt M5 would not have been green. The brief's m5-a02 does allow a tolerance
for connected clients (*"connected: within tolerance; disconnected: immediately
on reconnect"*), no data is wrong, and the server correctly refuses the expired
message throughout — which is why this is `minor` rather than `major`. m5-a02 is
scored **pass** on the grader's own direct verification.

**Evidence:** `grading/work/choreo-grader-m5.jsonl` (STRUCTURED CHOREOGRAPHY
MISS, attempt duration 303,940.8 ms) vs `grading/work/choreo-grader-m5b.jsonl`
(passed, 304,365 ms); `grading/work/g-disappear-repro.mjs` step log;
`instrument/choreography/choreography.mjs:2290-2333` (the check, and the default
adapter's `optionValue: "24h"` / `waitMs: 300_000` at lines 65-67).
**Related assertions:** m5-a01, m5-a02, m5-a03 (all pass).

### Things that looked like defects and were not

Recorded so the absence is auditable:

- **Handle case collisions** — cannot happen; `saveProfile` rejects non-lowercase
  handles at input validation.
- **Global message search missing chats beyond the first membership page** —
  probed with a unique token planted in Alice's lowest- and highest-ordered
  chats out of 25 memberships; both found in one `complete: true` answer.
- **A non-member learning a DM is "definitively empty"** — `history` answers 0
  rows with `complete: true` rather than refusing. No content leaks and
  `searchChat` does refuse with `NOT_MEMBER`, so this is a design choice, not a
  boundary failure.
- **Insights paging the corpus to the client** — the structural failure mode the
  brief names explicitly. It does not occur: the `insights` payload is **840
  bytes** with `complete: true`, backed by server-side `count … by` views
  (`schema.q:388-398`), and its meter reports `examined: 20`.

---

## 7. Phase 6 — O-dimension scores

Scored exactly the dimensions `applicability.json` makes applicable for a
`full`-scope run with M1–M6 and M8 green, M7 `not-run`, and the scale replay
attempted and completed.

### Assertion tally behind O1

| Milestone | pass | fail | not-run | total |
|---|---|---|---|---|
| M1 | 13 | 0 | 0 | 13 |
| M2 | 27 | 0 | 0 | 27 |
| M3 | 15 | 0 | 0 | 15 |
| M4 | 12 | 0 | 0 | 12 |
| M5 | 12 | 0 | 0 | 12 |
| M6 | 6 | 0 | **7** (native artifact absent) | 13 |
| M7 | 0 | 0 | **9** (milestone not attempted) | 9 |
| M8 | 16 | 0 | **2** (native artifact absent) | 18 |
| **total** | **101** | **0** | **18** | **119** |

Prior-101 subtotal (the M1–M7 ids in `GRADER_ASSERTIONS_101.txt`, i.e. the only
set the September 5 and September 12 structured results carried): **85 pass,
0 fail, 16 not-run**. The 18 M8 ids add **16 pass, 0 fail, 2 not-run**.

### O1 — Functional completeness — **74**

Anchors interpolated: *60 — "M1–M4 solid, later milestones patchy or failed on
cap"*; *90 — "every in-scope milestone green, including platform-proof
artifacts"*.

Above 60 by a clear margin: it is M1–**M5** that are solid here, not M1–M4, and
they are solid under independent re-execution rather than only under the
builder's suite — 101 of 119 atomic assertions pass with **zero** failures, and
M6 and M8 pass everything their gated (web/API) scope can demonstrate.
Below 90 on exactly the two things that anchor names: one in-scope milestone
(M7) has its entire nine-assertion checklist unpassed, and the **platform-proof
artifacts are absent** for all nine native-artifact assertions
(m6-a01…a07, m8-a17, m8-a18) — `artifacts/m*-ios/` holds Hermes bundle exports,
not the `*-ios-screen.mp4` + `*-ios-receipts.jsonl` + `*-ios-run.json` triple
`simulator.md` requires. 74 places it between the two, nearer 90 than 60, with
the residual gap being precisely the 18 unpassed assertions.

### O2 — Correctness under grading — **84**

Anchors: *60 — "a few medium defects off the happy path"*; *90 — "only cosmetic
nits"*.

Zero blocker and zero major defects; four minor and one cosmetic. Nothing the
grader found produces wrong data: every one of the 58 independently re-executed
suite-required assertions agreed with the suite, every trust boundary in §5 held,
Trending's ranking matched read-only ground truth exactly at 48,270 in-window
posts, digest counts were exact to the unit across five separate assertions
including a mid-period backend restart, and the invariant manifest conformed
exactly. That is better than the 60 anchor. It is short of "only cosmetic nits"
because three findings are genuinely more than nits: d-03 actually reddened the
documented M6 entrypoint on a clean grader run, d-05 intermittently failed a
frozen green-gate check, and d-01 defeats an explicit platform contract about
presenting undecided results at the scale envelope. 84.

### O3 — Trust boundaries — **null**

Applicability predicate `m6-green-and-m1-m5-attempted` is **satisfied** (M6
green; M1–M5 all attempted and green). But the rule attached to it is
categorical: *"Scored from the wave's secret rotated holdout probes only; anchor
probes are non-scored continuity diagnostics and never bear on O3."* Per the
wrapper's recorded deviation 1 — independently confirmed by the empty
`rotation-log.md` — **no probe set exists for this wave**, so the dimension has
no admissible evidence. Recording `null` with this note is the faithful outcome;
scoring it from the checklist's trust-boundary assertions or from the grader's
own §5 probes would substitute inadmissible evidence for the missing holdout
set. Everything the grader did observe about trust boundaries is published in §5
as narrative, and feeds O1/O2 only.

### O4 — Observed offline behavior — **65**

Gate: M6 green → applicable. Admissible basis, per the wrapper: **the
choreography receipts and any simulator artifacts, and nothing else.** Simulator
artifacts: **none exist**. So the basis is the harness's structured receipts,
which the grader generated itself.

Demonstrated by admissible artifacts:

| Specced behaviour | Evidence |
|---|---|
| offline writes show pending, flush **in order** | `offline-message-queue-flush-in-order` passed, `flushMs 4662.2` |
| receipt states walk normally after flush | same check, plus `m8-a16-dual-offline-receipts` (`totalMs 3541.4`) |
| offline search over synced messages (**warm**) | `warm-offline-search-over-synced-messages` passed (1396 ms, both grader runs) |
| M8 multi-device convergence | `m8-a15-dual-offline-convergence` — both clients offline, both settle in server-arrival order, no loss, no duplicates (`firstFlushMs 2300.6`, `secondFlushMs 2846.1`) |

Not demonstrated by any admissible artifact:

- **cold-start offline** in its entirety — synced history rendering, previously
  viewed media rendering, cold-offline search, and the view-once photo *not*
  rendering (m6-a01…a04);
- **pending state and ordered flush on the native carrier** (m6-a05…a07);
- **M8's durable queue across app termination** (m8-a17, m8-a18).

Honesty of the gap — which this dimension scores explicitly — is **exemplary and
verified**: `README.md` states *"Native artifacts are under `artifacts/mN-ios`;
these are Hermes exports, not simulator proofs"* and `run-record.json` states
*"simulator behavior is not claimed"*. Both are accurate; the grader inspected
the artifacts and found exactly what the lane says they are. No overclaim
anywhere. (Neutral context: the platform ships `snapback4 witness ios` for this
recording, so the proof was declined, not unavailable.)

Anchors: *30 — "cold-start offline shows an empty or broken app"*; *60 — "reads
work; offline writes lost or mis-ordered, or receipts wrong after flush"*;
*90 — "reads, ordered queued writes, receipt transitions, and offline search all
behave as specced **on the native proof** — on full runs including M8's
durable-queue restart and multi-device convergence evidence"*.

Every behaviour the admissible artifacts cover behaves as specced, which is
strictly better than the 60 anchor's broken-write picture — ordered flush,
correct receipts, warm-offline search and multi-device convergence all hold. But
roughly the cold-start half of the dimension, and the 90 anchor's "on the native
proof" requirement, are undemonstrated. **65** — just above 60 on demonstrated
behaviour, held well short of 90 by the absent native proof, with no penalty for
dishonesty because there is none.

### O5 — Performance at the scale envelope — band **75**

O5 is band-mapped by its exact function, first-match in the order
**0, 30, 60, 90, 75**. It is not interpolated.

**Replay evidence (from the lane's receipts, cross-checked by the grader).**
`evidence/scale-final-receipt.json`: `pass: true`, action log
`sha256 b26bf1ae…` (matching the grader's own hash of the committed `scale.log`),
`actionCount 167157`, `settledPrefix 167157`, `failedActions 0`, checkpoint
pauses at `10% → 24777` and `50% → 88057` with prefix hashes. Scale actions ran
1,142 s on their own clock (`scaleActionsStart 1790427860 → actionsEnd
1790429002`), verification to 1790429082.

**Invariant-manifest conformance — verified, and verified independently.** The
lane's `scale-final-full-verification.json` actual counts equal
`invariant-manifest-combined.json`'s `expectedState.perEntityCounts` field for
field (users 1008, followEdges 5921, posts 50228, topLevelPosts 48224, replies
2004, activeLikes 5008, activeReposts 1004, conversations 1002, dms 901,
groups 101, memberships 2053, messages 100015, textMessages 99105,
mediaMessages 910, quotedReplies 2736, activeReactions 2000,
disappearingSettingsEnabled 0), across the 10%, 50% and final states. Because a
named-fixture mismatch alone caps O5 at 0, the grader re-verified the **named O5
fixtures at the final state through the custom-client API** — not through the
lane's SQL path — before running any probe:

| Fixture | Manifest expects | Grader observed via API |
|---|---|---|
| `u0500` | following 500, conversations 100 | **500**, **100** (full `inbox` paging) |
| `u0005` | following 5 | **5** |
| `u0900` (celebrity) | followers 900, posts 200 | **900**, **200** (full `userPosts` paging) |
| `u0901` (celebrity-follower) | following exactly `u0001..u0004, u0900` | **exactly that set**, count 5 |
| `g0001` (busy group) | 50 members, 10,000 messages | **50**; **10,000** counted exactly by full paging — 500 pages, every page `complete: true` |

**Degradation rules — grader-measured, k=20 after 3 warm-ups, sequential, 30 s
timeout.** These are the brief's *published* hardware-independent rules, not
holdout instances; they are recorded here as O5 band inputs and deliberately
**not** entered in `probeResults`. Two full sweeps were run; the table reports
the second (1-minute load 56.5 → 62.1, i.e. the more adverse of the two), with
the first in parentheses.

| Rule | Measurement | Bound | Verdict |
|---|---|---|---|
| deep paging: p95 page 50 ≤ 3× p95 page 1 in `g0001` | **16.48 ms** vs 3 × **14.22 ms** = 42.66 (14.83 vs 41.43) | ≤3× | **pass** |
| following-feed: p95 `u0500` (500 follows) ≤ 3× `u0005` (5 follows) | **8.83 ms** vs 3 × **7.08** = 21.24 (6.98 vs 25.92) | ≤3× | **pass** |
| celebrity **read** path: p95 `u0901` feed ≤ 3× `u0005` feed | **6.82 ms** vs 21.24 (7.24 vs 25.92) | ≤3× | **pass** |
| celebrity **write** path: p95 `u0900` post-create ack ≤ 3× a 5-follower author's | **70.66 ms** vs 3 × **60.25** = 180.75 (109.64 vs 191.97) | ≤3× | **pass** |
| receipt aggregation must not visibly stall send/render in the 50-member group | send ack **56.39 ms** vs **52.10 ms** in a small chat (1.08×); history render **66.58 ms** vs **48.65 ms** (1.37×) | no visible stall | **pass** |
| cold-start sync of the 100-conversation probe user | full `inbox` paging **99.8 ms**, first history page of every conversation **499.3 ms**, RSS **119.1 MB**, no timeout, no unbounded growth | completes | **pass** |
| global message search at the full corpus ≤ 3× at the 10% checkpoint, 50% on/below the line | grader p95 at full **5.75 ms**; lane-recorded checkpoint samples 10% **2.248 ms**, 50% **3.678 ms** → 2.56× ≤ 3, and 3.678 ≤ the 4.00 midpoint of the line | ≤3×, mid-curve | **pass** (see limitation) |
| Insights must not transfer the corpus to the client | payload **840 bytes**, `complete: true`, meter `examined: 20`, server-side aggregate views | structural | **pass** |
| Insights / Trending full ≤ 3× 10% | grader p95 at full: Insights **4.96 ms**, Trending **5.92 ms**; **no 10% or 50% checkpoint measurement exists** for either | ≤3×, mid-curve | **not evaluable** (see limitation) |
| no probe may time out, error or OOM | **0** timeouts, **0** errors, **0** OOMs across every probe in both sweeps | none | **pass** |

*Limitation, recorded rather than papered over:* the 10% and 50% checkpoint
states no longer exist (the replay ran to completion, and re-running 167,157
actions was out of scope once deviation 1 removed phase 4). The three
checkpoint-curve rules therefore had to lean on the lane's own recorded
checkpoint probes, which are **single-sample**, not k=20 p95. For global search
that baseline exists and the ratio (2.56×) is far enough inside the 3× bound to
be robust to the difference. For Insights and Trending **no checkpoint baseline
was ever recorded**, so the curve clause is unevaluable; their absolute p95s at
the full corpus are ~5 ms and their meters show index-backed scans
(`examined: 62` for Trending over 48,270 in-window posts), so there is no
evidence of superlinear growth — but that is an absence of evidence, not a pass.
Also relevant: `run-record.json` is the base protocol record and deliberately
carries no `performanceProbes.o5Inputs` (it says so: *"The composed
social-messenger grading/metering extension is not fabricated"*), so the band
below is derived from the receipts and the grader's own measurements rather than
from the field `applicability.json` names.

**Band function, evaluated first-match:**

- **0** — *"invariant manifest does not conform (including a named-fixture
  mismatch) OR replay's wall cap was exhausted."* The manifest **conforms**
  (exact counts at all three states; all five named O5 fixtures re-verified
  independently through the API; `scale.log` hash matches its pin;
  `settledPrefix == actionCount == 167157` with `failedActions 0`). The replay
  **wall cap is a P3 placeholder** in the frozen instrument
  (`social-messenger.md` §"Budget caps and performance ceilings": *pilot-calibrated*),
  so there is no cap to exhaust. → **does not fire.**
- **30** — *"any degradation rule fails OR any probe times out/errors/OOMs."*
  Every evaluable rule passes; zero timeouts, errors or OOMs in 2 × 15 probe
  sets. → **does not fire.**
- **60** — *"all rules pass but any absolute ceiling is exceeded OR replay used
  >80% of its cap."* Absolute p95 ceilings are **also** P3 placeholders
  (`probes/categories.md`: *"Absolute p95 ceilings per rotated probe are
  calibrated at P3 from the pilot"*; the brief's ceiling table reads
  *pilot-calibrated*), and the cap is undefined. Neither clause can fire. →
  **does not fire.**
- **90** — *"every probe's observed ceiling utilization is ≤50% AND replay used
  ≤50% of its cap."* This is an affirmative condition over the same undefined
  ceilings and cap, so it **cannot be established**. → **does not fire.**
- **75** — *"otherwise (all rules and ceilings pass, 90's condition not met)."*
  → **fires. O5 = 75.**

The only path to 90 would require the pilot-calibrated ceilings and replay cap
that this instrument version does not carry. Measured latencies (5–70 ms p95 at
a 100,015-message / 50,228-post / 5,921-edge envelope) publish as diagnostics
only, per the brief's instruction that O5 is a scale-safety gate and never a
cross-backend speed statistic.

**Note on state mutation.** The brief's replay contract puts probes *after*
fixture verification, and the celebrity-write-path and receipt-aggregation rules
are inherently mutating. The grader followed that order: named-fixture
conformance was verified first and is recorded above, then the probes added 46
posts and 40 messages to the scale instance. The conformance receipt therefore
predates the grader's mutations, and the scale store is left mutated by them.

---

## 8. Reproducibility and reruns used

- One phase was re-run: the M5 choreography segment, after its first
  independent run failed a `required: false` check (§4.9, d-05). The re-run
  passed. The failure was diagnosed as a lane-side intermittency under load, not
  a grader tooling failure, so it is filed as a defect and **`rerunsUsed` is
  recorded as 0** — no grader-environment failure consumed the abort protocol's
  allowance.
- Three grader mistakes were caught and corrected in-session; each correction is
  visible above so the record cannot be mistaken for a lane failure: a wrong
  in-chat-search selector (m5-a03), a hard-coded display name (m6-a08), and a
  sign-in race plus a blob-image counting error in the grader's own browser
  scripts (m5-a05). In every case the corrected check passed, and the corrected
  method is what §4 reports.
- `sessionOutcome` is **`completed`**.

## 9. Process cleanup

Every PID the grader started was terminated at session end, individually, by
PID: `3947`, `3976` (expo web, 49361), `19431` (push worker), `46381`, `46384`
(scale instance, 49362), `74825`, `74826` (backend, 49360). PIDs `97314`/`97387`
had already ended as part of the m8-a11 restart probe. **No `pkill`, `killall`
or pattern kill was used at any point**, and no process outside this ledger was
signalled. Each of the seven was `kill -0`-checked before being sent a single
`SIGTERM`, and all seven were confirmed gone afterwards; ports 49360–49379 were
verified released. The unrelated Node test matrix and Xcode suite that shared
this machine were never signalled and had finished on their own by the time
cleanup ran.

## 10. Lane-state changes the grading session made

Recorded so the lane's record stays auditable:

- **Builder receipts restored.** The lane's acceptance scripts overwrite
  `evidence/m*-suite.json`, `coverage*.json` and `suite-status.json` in place,
  and `milestone-results.json` pins their SHA-256s. The grader snapshotted the
  builder's versions before running anything, kept its own post-run copies under
  `grading/work/grader-run/`, and then **restored** the builder's files. Verified
  afterwards: all seven suite receipts and all seven choreography receipts hash
  exactly to the values recorded in `milestone-results.json`. (The snapshot was
  confirmed authentic before restoring — every baseline hash already matched the
  recorded value.)
- **Dev instance (`.snapback4/store.sqlite`) is mutated**, unavoidably: the seven
  acceptance suites, five choreography runs, the 50-action conformance replay and
  the grader's own API/browser probes all write through the app's real mutation
  path, as the lane's README warns ("Suites and choreography must run
  sequentially on the starter instance because they deliberately mutate it").
  Grader-created rows are marked with `grader`-prefixed bodies, handles and
  emails so they are distinguishable. Three posts were created through the
  platform's dev time seam (`snapback4 run … --now <past>`) to build the
  >24 h-old Trending fixture, which is the only way to age content.
- **Scale instance (`scale-instance/`) is mutated by the O5 probes**: 46 posts
  and 40 messages, added *after* invariant conformance was independently
  verified, per the brief's ordering. The conformance receipt therefore predates
  the mutation.
- **`evidence/push.jsonl` was appended to** by the running provider worker
  throughout, including 5 grader-observed digest periods.
- `grading/work/` holds the grader's scratch scripts, logs, 20 screenshots and
  raw probe JSON. It is retained for audit and is **not** part of the published
  pair.

## 11. Output pair and where the numbers live

| File | Contents |
|---|---|
| `grading/grader-report.json` | schema-valid against the frozen `grader-report.schema.json` (AJV 8.20.0, draft 2020-12: **valid**). The **101** M1–M7 assertion results, the severity-bucketed defect list, the empty `probeResults`, the coverage spot-verification verdict, the 12 best-of-3 timing records, and O1/O2/O3/O4/O5. |
| `grading/m8-assertion-results.json` | the remaining **18** M8 assertion results, same record shape and same enum values, with `reportVersion`, `lane`, `grader` and the `assertionManifest` pin. |
| `grading/trace.md` | this document — the published sanitized evidence and action trace. |
| `grading/DONE` | `end=<epoch>`. |

Partition check, run as part of report generation: manifest 119 ids; 101 in the
report; 18 in the sidecar; union **119**; **zero** overlap, zero missing, zero
extra. Result tallies — prior-101 set: **85 pass / 0 fail / 16 not-run**; M8 set:
**16 pass / 0 fail / 2 not-run**; complete 119 total: **101 pass / 0 fail /
18 not-run**.

Per the frozen grader prompt, **no weighted total, efficiency statistic or
cross-lane comparison is computed here** — those are the harness's and
publisher's jobs under LLP 0197/0198 gating. Note independently that a weighted
total is blocked twice over for this lane in any case: O3 is `null` (deviation 1)
and B8 is `null` (M7 `not-run`), and `applicability.json`'s `nullDimensionRule`
bars averaging over a null dimension.
