# Grader evidence and action trace — lane `astra-snapback4`

Sanitized published artifact (LLP 0197 redaction posture; LLP 0198 — raw transcripts are
never published). Fixture and grader-created passwords, session bearers and service tokens are
redacted throughout as `[REDACTED]`; principal ids appear only as their last six characters.

| | |
|---|---|
| Lane | `astra-snapback4`, backend `snapback4-0.3.0` (+ `snapback4-expo@0.3.0`), carrier web/Expo Router |
| Run scope | `full` (M1–M8 in the denominator) |
| Wave | `full-3models-astra`; probe set `none-uncommitted` |
| Grader | family `claude`, model `claude-opus-5`, fresh session, `sessionOutcome: completed` |
| Grader eligibility | `calibrationPassed: false` — grade labelled **uncalibrated-grader**. `sameFamilyGraded: false` (the lane's harness is a Codex `gpt-6-astra` session, recorded in `run-record.json`) |
| Frozen inputs | assertion manifest `instrument/schema/social-messenger/assertions.json` sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`, version `0.3.0-m8`; `applicability.json` sha256 `b3d45805202375949b657cc30609e9d1de51da6a188469e9bf2c60f8fd1e37a1` |
| Outputs | `grading/grader-report.json` (101 M1–M7 ids), `grading/m8-assertion-results.json` (18 M8 ids), this trace |
| Result | **101 pass / 18 not-run** over the frozen 119. Prior-101 subtotal 85 pass / 16 not-run; M8 subtotal 16 pass / 2 not-run |

## Contamination control

The builder's `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and `run-log.md` were never
opened. `run-record.json` was read structurally (statuses, clocks, replay pointers) as the wrapper
supplies it as an input; it contains no builder self-scores, holistic score or B-dimension values —
its own note says the base record deliberately omits them pending an independent grading session.
No other lane under `lanes/` was listed or read. One incident to disclose: `rsync` of the checkout
into `/tmp/grader-clean` for the m6-a10 clean-checkout run copied those five filenames into the temp
tree; they were deleted immediately and their contents were never read. `contaminated: false`.

## Environment and process custody

macOS arm64, Node 24.18.0 (absolute Volta path used for every spawn). Ports used: **49360** backend,
**49361** static web, **49363** the preserved scale-replay instance — all inside the allotted
49360–49379. No other lane's ports were touched; no `pkill`/`killall`/pattern kill was used at any
point.

PIDs started by this session, and only these, were killed at the end:

| PID | What | Note |
|---|---|---|
| 9085 / 9092 | `snapback4 dev --port 49360` (parent / listener) | SIGTERMed by the grader-owned restart during the m8-a11 proof |
| 12507 | `scripts/serve-web.mjs` on 49361 | static export, as delivered |
| 31293 | grader's own effect worker | replaced the builder's worker for digest measurement |
| 55874 / 55875 | backend after the mid-period restart | |
| 72712 / 72729 | `snapback4 dev --port 49363 --replay` over `replay-full-instance` | read-only audit of the preserved scale store |

The builder's push worker (PID 31439, started by the grader from the documented
`scripts/push-worker.mjs`) was stopped before the digest phase so the grader's non-deduplicating
worker could claim effects; see §m8-digest.

Machine load was high and variable throughout — other sessions share this host. `uptime` 1-minute
load average by phase: setup 21.96 → builder suites 27.5–35.3 → window/expiry probes 22.4–26.9 →
digest 24.9 → API sweep 21.2–28.3 → browser sweep 28.3–36.5 → O5 measurement 32.0–35.4 → close 34.9.
Every timing block below carries its own load reading.

### Lane state the grader touched, and how it was restored

- `node scripts/configure.mjs` was run (documented startup step). Its two generated files were
  backed up first and diffed after: byte-identical, so nothing changed.
- The acceptance entrypoint writes into `evidence/`. Runs used `ACCEPTANCE_RUN_PREFIX=grader-*` so
  receipts landed under grader-prefixed names; `evidence/suite-status.json` is rewritten by the
  script and was backed up to `grading/work/suite-status.json.orig`.
- `scripts/replay.mjs`, `scripts/start-servers.mjs` and `scripts/build-web.mjs` append to
  `run-log.md` unconditionally; the grader's two replay runs therefore appended lines to it. The file
  was written to but never read. Filed as defect d-05.
- The starter DM `d-alice-bob` had been left with disappearing messages enabled by the lane's own M5
  choreography; the grader's window probe set it to `24h`, armed one message, then set it to `off`.
- `evidence/sample-replay-state.json` and `evidence/sample-replay.jsonl` were set aside for the
  forced-replay experiment (§d-03) and restored byte-for-byte afterwards (mode 0600 preserved).
- The preserved scale store in `replay-full-instance/` was served read-only; the grader deliberately
  performed **no writes** against it, which is why one degradation rule is measured read-side only.

---

## Phase 1 — builder suite, re-run from the documented entrypoint

`npm run acceptance -- --milestone mN` against the running backend, one invocation shape per
milestone, exactly as shipped.

| Milestone | Exit | Suite-required covered | Missing | Result |
|---|---|---|---|---|
| m1 | 0 | 7 | none | pass |
| m2 | 0 | 22 | none | pass |
| m3 | 0 | 7 | none | pass |
| m4 | 0 | 5 | none | pass |
| m5 | 0 | 6 | none | pass |
| m6 | 0 (on re-run) | 5 | none | pass |
| m8 | 0 | 6 | none | pass |

**`rerunsUsed: 1`.** The first m6 run failed the push-payload test. Cause: the grader had not started
the push worker, a documented startup step in the lane's README (`node scripts/start-push.mjs`) — the
worker is what materialises `evidence/push.jsonl`. That is a grader environment omission, not a lane
defect, so it was corrected and the phase passed on the single permitted re-run. No other phase
needed a re-run.

Logs: `grading/logs/suite-m{1..6,8}.log`, `grading/logs/suite-m6b.log`; receipts
`evidence/grader-m*-suite.json`.

## Phase 2 — coverage-manifest spot verification → **honest**

`coverage-manifest.json` maps exactly the 58 suite-required assertions of the seven in-scope
milestones — M1 7, M2 22, M3 7, M4 5, M5 6, M6 5, M8 6 — with no gaps and no padding. Every mapped
test module (`scripts/acceptance.mjs`, `scripts/tests-m{2,3,4,5,6,8}.mjs`) was read in full and each
mapping traced to its assertion's observable. The tests perform real writes through the app's own
mutation path and real browser observations against the frozen `sm-*` contract ids; none
short-circuits an assertion.

Sampled ids: `m1-a03 m1-a11 m2-a15 m2-a22 m2-a24 m2-a25 m3-a14 m3-a15 m4-a06 m4-a09 m5-a05 m5-a11
m6-a09 m6-a13`. Beyond the sample, all 58 were independently re-executed in phase 3 and every
`suiteResult` agreed with the grader's own result.

Two mappings are thin but not dishonest — the mapped test does exercise the observable, less
completely than the grader did:

- `m2-a24` — the mapped test checks cursor dedup and a minimum row count but not page-size
  uniformity. Grader closure: 16 Global pages `[20×15, 3]`, 303 rows, **0** duplicate feed-event ids,
  and all 24 grader-seeded posts present, so no gaps.
- `m2-a12` — the mapped test checks for a `role=link` node but not that tapping it reaches the system
  browser. Grader closure: the click called `window.open("https://example.com/cafe","_blank")`.

No milestone is adjudicated `capability-failure` on coverage grounds.

## Phase 3 — independent checklist execution

### <a id="m1"></a>M1 — accounts and profiles

Browser, fresh context, grader-created account (credentials `[REDACTED]`):

- **m1-a01/a02** — signup with a 14-character password landed on the authenticated onboarding
  screen; `sm-auth-submit` was unmounted afterwards, so the state is genuinely authenticated.
- **m1-a03** — handle `alice` rejected with a visible `sm-profile-error`: *"That handle is taken."*
- **m1-a04** — re-signup with the same email surfaced `sm-auth-error`: *"…that email already has an
  account; sign in instead."*
- **m1-a08/a10/a11** — display name and bio, plus a fixture avatar upload, survived a real page
  reload (not optimistic local state); the avatar decoded at 256×256 natural size inside
  `sm-profile`.

### <a id="m1-a07"></a>m1-a07 — server-side session revocation `[grader, full-only]`

A dedicated grader account was used so no persona session was disturbed. Bearers `[REDACTED]`.

| Step | `POST /q/myProfile` |
|---|---|
| fresh session | HTTP 200, data present |
| after `logout(url, token)` | **HTTP 401 `E_AUTH`** |
| two live sessions, both usable | HTTP 200 / HTTP 200 |
| after `logoutAll(url, token1)` | **HTTP 401 `E_AUTH` on both** |

Revocation is server-side, and the app's Settings logout uses `logoutAll` (`src/client.ts`). **Pass.**

### <a id="m1-a12"></a>m1-a12 — password storage `[grader, source inspection]`

`snapback/schema.q` line 1 declares `use identity password` — the platform's built-in auth. No
password column exists anywhere in the schema. `src/client.ts` hands the password straight to
`snapback4/auth`'s `signup`/`login`; `src/session.tsx` clears the field from component state after
submit. Persisted hashes in the store carry the prefix `$argon2id$v=19$m=19456,t=2,p=1` (33
occurrences) — argon2id at standard published parameters. The platform documents Argon2 and prints
its host slot count at startup (`Argon2 slots: 16 on this host`). **Pass** on the built-in-auth
branch, with the named adaptive KDF confirmed. Provider internals were not inspected, as the
assertion directs.

### <a id="m1-a13"></a>m1-a13 — no plaintext or reversible password storage `[grader]`

Occurrences of each fixture/grader password (patterns `[REDACTED]`) searched as literal strings:

| Location | Occurrences |
|---|---|
| `.snapback4/store.sqlite` + `-wal` (server persistence) | **0** |
| `artifacts/web` and `artifacts/m8-ios` client bundles | **0** |
| backend log, push effect log, worker log | **0** |

The fixture pack's credential files and the lane's own test scripts are the declared test-fixture
exception and live outside the app. **Pass.**

### <a id="m2"></a>M2 — posts and the follow graph

Independent API execution with grader-minted ids (`grading/work/g-api-result.json`,
`g-api2-result.json`) plus browser work for the UI clauses (`g-web-result.json`, `g-web2-result.json`).

- Three post kinds created and all three visible in another user's Global feed; the image post
  carried both photo refs, the video post a video ref (duration 5000 ms).
- Follow → all three appear in Following; unfollow → older posts leave Following on the next load
  but **remain in Global**, so unfollow is projection-scoped, not content revocation.
- An unfollowed author's post: in Global, absent from Following.
- Like set-state: three consecutive likes → count 1; three unlikes → count 0.
- Repost attributed to `bob` / *Bob Bennett*; Carol following Bob surfaced Alice's original in
  Carol's Following; reposting again removed the row.
- Thread listed exactly the two direct replies in chronological order, excluded a nested reply, and
  neither reply appeared in Global or Following.
- Pagination: Following `[20, 10]`, Global `[20×15, 3]` — **0** duplicate event ids, all 24 seeded
  posts present. Re-walked with writes injected at pages 1, 3 and 7: still 0 duplicates, still no
  gaps, and posts created mid-walk correctly did not appear in that walk (snapshot-consistent
  cursor). UI: first page exactly 20 items in both tabs, scrolling loaded a second page (20 → 40).
- Implicit self-follow: an explicit self-follow is refused `CANNOT_FOLLOW_SELF`, so no explicit edge
  can exist; with `following = 0` the user's own original post **and** own repost are still in his
  own Following feed, and follower/following counts were identical before and after.
- URL rendering: the kit's `linkify` emits a `role="link"` span (react-native-web, so no `<a href>` —
  that is the kit's contract, not a defect) whose tap called `window.open(url, "_blank")` via
  `Linking.openURL`. The full URL text was preserved and there was **no** iframe, **no** non-avatar
  image and **no** preview/unfurl card node in the item.

### <a id="m2-a07"></a>m2-a07 — disclosed protocol deviation

`m2-a07` ("Alice's follower count updates live when Bob follows her") is a `[choreo]` assertion, but
the frozen harness at `0.3.8-m8` **never observes a follower count anywhere** — `choreography.mjs`
mentions `sm-profile-follow` only as a button to click, and its `follow-unfollow-live-projection`
check observes the Following-feed projection, not the count. There is therefore no choreography
artifact to score it from.

Rather than record a working behaviour as unscoreable, the grader executed it directly under phase 3
(browser automation on the web build), which is the deviation disclosed here and in the report's
notes. Alice's profile follower count went **3 → 4 with no manual refresh** in **146 / 140 / 147 ms**
over three trials, best **140 ms** (load average 28.03). **Pass**, `method: web-automation`.

### <a id="m3"></a>M3 — messaging core

- Three `createDM` calls from both directions with three fresh conversation ids all resolved to one
  channel id; Alice's inbox holds exactly one DM channel with Bob.
- Two groups with the identical three-member roster `[alice, bob, carol]` coexist under distinct ids.
- Non-admin `removeMember` refused `NOT_ADMIN`; roster stayed at 3. Non-admin `rename` refused
  `NOT_ADMIN`; name unchanged.
- Quoted reply rendered the excerpt in its bubble, and tapping it scrolled the original into the
  viewport.
- Seed idempotence: all three installed starter segments replayed a second time; the message-id sets
  of `d-alice-bob` and `g-starter` and the Global feed row count were identical.
- **Group aggregate receipt, independently corroborated** — `sent` → (Bob delivered) `sent` →
  (Carol delivered) `delivered` → (Bob read) `delivered` → (Carol read) `read`. It waits for the
  slowest member, and a member added *after* the send did not regress it, so the recipient set is
  membership at send time (`messages.recipients` is declared immutable).
- Watermark monotonicity: an acknowledge pointing backwards after read-through did not regress the
  receipt.

### <a id="m4"></a>M4 — media, reactions, edit/delete

- Photo and video messages end-to-end: `kind` `image`/`video`, media refs on the recipient's query
  result, and the recipient's authorized asset fetch served bytes.
- Reaction set-state: 👍 then ❤️ left exactly `[❤️, 1]` (replace, not accumulate); tapping the same
  emoji again cleared it, and a repeat clear stayed at zero.
- Edited bubble: no `edited` label before the edit, exactly one after.

### <a id="m4-a10"></a>m4-a10 — edit window enforced server-side `[grader]`

Fixture shortened-windows config (identical byte-for-byte to `instrument/fixtures/config/`):
`editWindowSeconds: 60`. Load average 22.36.

| t since send | Path | Outcome |
|---|---|---|
| ~0 s | SDK `chat.edit` | `sent` (in-window control) |
| 70.1 s | SDK `chat.edit` | **`failed` / `EDIT_WINDOW_CLOSED`** at `snapback/chat.q:222:3` |
| 70.1 s | raw `POST /m/chat.edit` | **`failed` / `EDIT_WINDOW_CLOSED`** |

The body was unchanged after the refusals. Server time is authoritative — see the time-seam probe
under §defects. **Pass.**

### <a id="m4-a12"></a>m4-a12 — asset revoked after delete-for-everyone `[grader]`

Before delete, both sender and recipient asset fetches served bytes. Immediately after
`deleteMessage`, both refused **`E_ASSET_UNKNOWN`**, and still refused on re-check minutes later. The
tombstone retains identity with `body: ""` and `photo`/`video`/`oncePhoto` all null. **Pass.**

### <a id="m5-a01"></a>m5-a01 — server-enforced expiry with no client open `[grader]`

DM set to disappearing `24h` = **180 s** under the shortened config. One message armed, then **no
Alice or Bob client was connected across the expiry instant** (every grader client closed; only the
service worker, a non-client principal, remained connected).

At t = 209 s the server served nothing:

| Probe | Result |
|---|---|
| `chat.message` (SDK) | `data: null` |
| raw `POST /q/chat.message` | HTTP 200, `data: null`, `nextExpiry: null` |
| `chat.history` first page | id absent |
| server-side `chat.searchChat` | 0 hits (1 before expiry) |
| mutation against the id | `failed` / `MESSAGE_NOT_FOUND` |

Rule: `expire at .expiresAt` on the `messages` table, evaluated server-side. **Pass.**

### <a id="m5-a02"></a>m5-a02 — client purge on next launch/reconnect `[grader]`

Three signed-in web clients, all having synced the message before expiry (load average 26.91):

| Client | Condition | Observation |
|---|---|---|
| c1 | connected across expiry | bubble gone **56 ms** after the server expiry instant (tolerance 20 s) |
| c2 | taken offline 179.9 s before expiry | already gone while still offline at +61 ms; still gone **2 ms** after reconnect |
| c3 | page closed before expiry | absent on cold relaunch after expiry |

The replica evaluates `expiresAt` locally, so the purge does not wait on a server round-trip.
**Pass.**

### <a id="m5-a03"></a>m5-a03 — offline search after the client synced the expiry `[grader]`

c1 taken offline; `sm-search-offline` banner shown ("Offline · searching synced history", backed by
`chat.searchHeld` against the local replica). Expired token: **0** results. Control word still in
synced history: **3** results — so offline search is genuinely working and the expired message is
gone from it, rather than search being broken. **Pass.**

### <a id="m5-a06"></a>m5-a06 — asset refused after the single view `[grader]`

Bob's first fetch served bytes; the second refused **`E_ASSET_VIEWED`** server-side. Extended: in a
group, Bob and Carol each got exactly one view, and a non-member got `E_ASSET_UNKNOWN`. After the
owning message expired the asset moved to `E_ASSET_UNKNOWN`. **Pass.**

### <a id="m5"></a>M5 — the rest

People search matched `car`, `CAR`, `Car`, `carol` and the surname prefix `che` → Carol
(case-insensitive word prefix), with the UI showing `sm-search-result` *Carol Chen*. In-chat search
found the seeded *"Coffee after work?"* from `cof` and `COFFEE`, scoped to the selected chat. Global
search rendered 2 `sm-search-group` blocks headed by the owning chat names, and every API result
carried a `conversationId` to group by.

### <a id="m6-a08"></a>m6-a08/a09 — push seam `[suite-required, re-executed]`

Measured through the **grader's own effect worker**, which performs no deduplication, so a repeat
would be visible. With no Bob client connected, three sends produced exactly three payloads whose
field set is exactly `{targetUserId, chatId, senderDisplayName, preview}`:

| Send | `preview` |
|---|---|
| 157-character text | exactly its **first 80 characters** (length verified = 80) |
| view-once photo | `"Photo"` |
| video | `"Video"` |

`chatId` = `d-alice-bob`, `senderDisplayName` = Alice's current display name, `targetUserId` = Bob's
principal (`…PBSEWZ`). **Pass.**

### <a id="m6-a10"></a>m6-a10/a11 — custom-client demo

`scripts/custom-client-demo.mjs` run from a **clean copy of the checkout** (source rsynced to
`/tmp/grader-clean`, the lane's installed `node_modules` linked, the generated `api.ts` retained as
API.md instructs) against the live backend: green, exit 0. Green again on the token-only path with an
issued bearer (`[REDACTED]`).

All five listed operations were independently confirmed to be genuinely exercised, not nominally
listed: authenticate (password **and** issued token), list conversations (paged inbox), page through
message history — the grader walked **2 real pages / 62 distinct messages**, so the single `next` hop
in the demo is not a no-op — send a text message, and receive by the documented 1-second polling.
**Pass.**

### <a id="m6-a12"></a>m6-a12 — grader-written variation from API.md alone `[grader]`

Written using only API.md's *"With only a token and this document"* section — no generated file,
plain `fetch`: `POST /auth/login` → paged `POST /q/chat.inbox` (15 rooms) to locate the **named**
conversation *"Weekend Plans"* → `POST /q/chat.history` → `data[0]` as the latest message. All **18**
documented history manifest fields were present and none was missing. Documentation quality is good;
one gap cost the grader one iteration and is filed as **d-04** (that section never states the raw
`/auth/login` response shape, which lacks the `ok` flag the SDK section documents). **Pass.**

### <a id="m6-a13"></a>m6-a13 — adapter conformance on the dev instance

`node instrument/fixtures/validate.mjs instrument/fixtures/sample-50.log` → *valid: 50 actions, 0
markers, 13 verbs* against action-schema `0.1.0-p1`. `node scripts/replay.mjs` replayed it green on
the dev instance: 50 distinct authoritative intents, every `state: "sent"`, verified by authorized
reads of every named post, message, room and profile. **Pass** — with two adapter weaknesses found
beyond the assertion, filed as d-02 and d-03.

### <a id="m6-native"></a>M6/M8 native simulator assertions — `m6-a01..a07`, `m8-a17`, `m8-a18`: not-run

`simulator.md` is the frozen native-proof contract: a booted iOS simulator running the installed
build, plus `m6-ios-screen.mp4`, a schema-valid `m6-ios-receipts.jsonl` and `m6-ios-run.json` (the
same for `m8-ios`), and *"A recording without passing structured receipts is not a pass."*

Exhaustive search of the lane found **none** of these:

- No `.mp4` anywhere except the fixture `vid-01.mp4`; no `*ios-receipts*`, no `*ios-run*`, no
  `*simulator-status*` file.
- `scripts/choreo.mjs` passes no `--simulator-status`, so no segment summary carries a
  `choreography.supplementalExternal` native entry.
- Each `artifacts/mN-ios/` is an `expo export` output — `_expo/static/js/ios/*.hbc`, `metadata.json`,
  `assets/` — and `native-artifacts.json` lists exactly those `.hbc` digests. The iOS build logs end
  in *"Exported: artifacts/mN-ios"*: bundling, never an install or a `simctl` launch.
- The platform even ships `snapback4 witness ios --bundle-id … --segment … --artifacts …`, which
  records an installed app cold-offline and reconnects its owned backend; it was not used.
- The lane's own cold-offline evidence is `evidence/cold-offline.json`
  `{"platform":"web","restart":"page reload offline",…}` and `evidence/cold-media.json`
  `{"platform":"web",…}` — web-replica probes driven by `scripts/probe-cold-offline.mjs` /
  `probe-cold-media.mjs`. These are builder assertions on the web carrier, which the frozen grader
  prompt excludes as a basis for simulator assertions.

The precondition — an installed native app on a simulator — therefore never existed, which is why
these nine are recorded `not-run` rather than `fail`: the grader observed no native failure, only the
absence of the proof. Both map to *not passed* in O1's denominator.

The lane is **honest** about this, which matters for O4: its README states plainly *"Each
`artifacts/mN-ios` is a Hermes export, not an installed simulator proof"*, and its probe receipts
self-label their carrier. No simulator pass is claimed or implied anywhere.

### <a id="m7"></a>M7 — all nine assertions not-run

`ENVIRONMENT.md` makes M7 a separate fresh session run by the orchestrator after this grading
("do not attempt it"); `milestone-records.json` records `m7: {status: "not-run", reason: "Separate
fresh session explicitly excluded by user"}` and `coverage-manifest.json` lists `m7` under `notRun`.
Nothing is `struck-by-environment` in this run, so per `applicability.json` these nine score as not
passed — the status distinction is attribution, not completeness credit. `m7-a09` is recorded
`not-run` rather than `not-applicable`: its "previously green milestones" precondition *did* exist
(M1–M6 and M8 are green), so the not-applicable branch does not apply; the milestone simply was never
attempted.

### <a id="m8"></a>M8 — insights and trending

- All six lifetime totals from `insights.summary` matched the grader's own recomputation from
  `userPosts` / `userReplies` / `counts` field for field. The UI tiles' `aria-label`s matched the
  **same persona's** server summary exactly (`Posts: 91`, `Likes received: 165`, `Reposts received:
  6`, `Replies received: 12`, `Followers: 3`, `Following: 2`).
- `summary.days` has exactly 7 buckets and the day sequence is the contiguous server-UTC range
  `[today-6 … today]` with no gaps; a post created now incremented `days[6].posts` by exactly 1 and
  `days[6].day == floor(server at / 86400000)`.
- 4 of the 7 days had zero posts and zero likes, and all **7** `sm-insights-day-row` rows rendered
  (e.g. *"09-18 Posts 0 Likes received 0"*) — zeroes rendered, not omitted.

### <a id="m8-trending"></a>m8-a05/a06/a07 — trending window and tie-break

First attempt was under-powered (3 likes against a live top-10 cut already at 8) — a grader
probe-construction error, corrected rather than reported as a lane result. With 12 likers:

| Post | Likes | Age | In Trending |
|---|---|---|---|
| tie-newer | 12 | seconds | **rank 1** |
| tie-older (1.5 s earlier) | 12 | seconds | **rank 2** |
| aged, most-liked of all | **13** | **30.0 h** | **absent** |
| rank 3 of the prior field | 8 | <24 h | rank 3 |

So the trailing-24 h window is enforced on server time and is not overridden by like rank, and the
tie broke newest-first. The Trending tab rendered the server's rank-1 post first. **Pass** — with the
kit-surface deviation filed as d-01.

### <a id="m8-digest"></a>m8-a08..a12 — scheduled digest `[grader]`

Shortened digest config `{periodSeconds: 120, periodAnchorUtc: "00:00:00"}` — identical to the
fixture pack's. Four fresh grader personas (A target, B actor, C silent, D outsider-group member;
credentials `[REDACTED]`, principals shown by last six characters). Measurement ran through the
**grader's own non-deduplicating worker**, because the lane's worker deduplicates on
`targetUserId:periodEnd` and would mask a genuine double-emit. Load average 24.90.

Activity aligned into a single period (`periodStart 1790209680000`, `periodEnd 1790209800000`): B
follows A; A follows B; B creates one post; B opens a DM with A and sends two messages; B creates a
group with D that **A is not a member of** and sends five messages there; C does nothing. All clients
closed, then the backend was SIGTERMed and restarted **116 s before the period closed**.

| Assertion | Observation | Verdict |
|---|---|---|
| m8-a08 | exactly **1** digest for A, payload `newFollowers 1, newPostsInFollowing 1, unreadMessages 2, unreadChats 1` — exactly expected. Schedule-driven with no connected client and no client interaction | pass |
| m8-a09 | silent persona C: **0** digests for the period | pass |
| m8-a10 | the following quiet period (`periodEnd + 120000`): **0** digests at all | pass |
| m8-a11 | 3 users received a digest for the period, **max 1 per user, no duplicate**, across a mid-period restart; an explicit `snapback4 run digest.daily` re-run of the same period afterwards still left exactly 1 | pass |
| m8-a12 | the 5 outsider-group messages contributed **nothing**: A's counts stayed `unreadChats 1 / unreadMessages 2`. D, the actual member, received his own separate digest | pass |

Source corroboration: `digestMarkers` is `unique byPrincipalPeriod: principal, periodEnd` and the job
inserts a marker even when it emits nothing, so a rerun cannot admit a duplicate; the job iterates
only `members[p.principal]`, and `unreadIn` excludes `.tombstone` rows while expired rows no longer
exist.

## <a id="choreo"></a>`[choreo]` assertions — scored from harness artifacts

Every segment receipt in `evidence/m{1,2,3,4,5,6,8}-choreo.jsonl` was re-validated by the grader
against the frozen `choreography/receipts.schema.json` (AJV 2020): **41 receipt lines, 0
schema-invalid**. Every assertion line is `implemented: true`, `status: passed`, `pass: true`,
`outcomeClass: null`, and every segment summary is `pass: true`. Harness version `0.3.8-m8`; the M3
typing receipt carries the required `typingObservationBoundaryVersion: "v2"`.

Best-of-3 measurements as retained on disk (all three attempts kept; the harness selects the fastest
passing one). Recorded with the caveat that host load was 21.8–36.5 throughout, so these are upper
bounds on a quiet machine:

| Assertion(s) | Harness check | attempts (ms) | best |
|---|---|---|---|
| m1-a09 | profile-edit-live-visibility | 680 / 634 / 646 | 634 |
| m2-a04 | feed-text-post-live-update | 300 / 109 / 102 | 102 |
| m2-a04 | feed-image-post-live-update | 137 / 137 / 134 | 134 |
| m2-a04 | feed-video-post-live-update | 116 / 118 / 124 | 116 |
| m2-a14 | like-unlike-live-count | 476 / 178 / 161 | 161 |
| m2-a19 | reply-live-thread-projection | 291 / 404 / 311 | 291 |
| m3-a01 | dm-live-messages | 1125 / 966 / 1087 | 966 |
| m3-a06, m3-a07 | typing-indicator-within-2s-expires-within-5s | 11153 / 6332 / 6314 | 6314 |
| m4-a02 | photo-message-live-render | 1181 / 1480 / 1452 | 1181 |
| m4-a05 | reaction-live-replace-remove | 1339 / 1208 / 1159 | 1159 |
| m4-a08 | edit-live-visibility | 1561 / 1596 / 1553 | 1553 |

Notes: the typing durations include the mandated ≥5 s expiry observation window, so they are not the
appearance latency — the harness enforces the brief's 2 s appearance and 5 s expiry ceilings
internally and they are not relaxed by `--timeout`. `m2-a04`'s three checks all passed all three
attempts. `m2-a08`'s `repost-following-feed-surface` had one failing attempt (2 of 3) and passed
best-of-3 as the protocol provides.

`m3-a08` is tagged `timing-sensitive` in the manifest but the harness ran it at `bestOf: 1`
(2373 ms, passed), so only one measurement exists; `bestOf3Ms` is recorded `null` rather than
fabricating two more. The grader corroborated its substance independently (monotonic watermark under
a backward acknowledge).

Assertions verified from these artifacts: m1-a05, m1-a06, m1-a09, m2-a04, m2-a05, m2-a14, m2-a19,
m3-a01, m3-a02, m3-a06..a09, m3-a12, m3-a13, m4-a02, m4-a04, m4-a05, m4-a08, m4-a11, m5-a07, m5-a12,
m8-a02, m8-a13..a16. (m2-a07 is the disclosed exception; the nine native assertions have no
artifact.)

## <a id="defects"></a>Phase 5 — defect hunting beyond the checklist

No holdout probe set exists for this wave, so none of this is a scored probe. These are the grader's
own checks.

### Trust boundaries — all clean

| Check | Result |
|---|---|
| Carol reads Alice↔Bob's DM history | `data` with **0 rows** (row-level filtering, no content, no existence signal) |
| Carol reads a specific message in that DM | `data: null` |
| Carol writes into that DM | `failed` / `NOT_MEMBER` |
| removed member: read post-removal message / history / write | `data: null` / 0 rows / `failed` `NOT_MEMBER` |
| non-sender deletes, non-sender edits | `failed` / `NOT_SENDER` (both) |
| non-member reads group room / renames / self-adds | `data: null` / `NOT_ADMIN` / `NOT_ADMIN` |
| view-once per recipient in a group (Bob, Carol) | each exactly one view, then `E_ASSET_VIEWED`; non-member `E_ASSET_UNKNOWN` |
| 7-character password at signup | refused: *"a password needs at least 8 characters"* (8 accepted) |
| duplicate handle / malformed handle / 300-char bio | `HANDLE_TAKEN` / `E_INPUT` / `E_INPUT` — all server-side |
| tombstoned message in in-chat and global search | 1 hit before delete → **0** after, both scopes |

**Caller-supplied time seam** — the sharpest check, run at t = 75 s on a message whose 60 s edit
window had closed:

| Attempt | Outcome |
|---|---|
| plain late edit | `failed` / `EDIT_WINDOW_CLOSED` |
| backdated top-level `now` field | `failed` / `EDIT_WINDOW_CLOSED` |
| backdated `now` inside `args` | HTTP 400 `E_INPUT` |
| `?now=` query parameter | `failed` / `EDIT_WINDOW_CLOSED` |

Body unchanged, `edited: false`. Server time is authoritative; no caller-supplied timestamp widened
the window.

### Correctness under load-shaped conditions — all clean

Feed cursors are stable (0 duplicate event ids over 19 pages, unchanged with writes injected
mid-walk; posts created after a walk began correctly do not appear in it). An early "cursor
instability" reading was a grader keying error — the probe counted `postId`, and an original plus its
repost legitimately share one `postId`; re-keyed on the feed event id the count is 0 in both the
quiet and concurrent walks. Group aggregate receipts wait for the slowest member and use membership
at send time. Receipt watermarks are monotonic. Tombstones retain identity, empty the body and clear
all three media refs.

### <a id="d-01"></a>d-01 (minor) — Trending does not mount the frozen kit's trending surface

`src/posts.tsx`'s `Trending` renders the generic `<Post>` / `sm-feed-item` card and falls back to a
bare `<Text>No trending posts in the last 24 hours.</Text>`. Measured on the rendered Trending tab:
`sm-trending-row` **0**, `sm-trending-rank` **0**, `sm-trending-empty` **0**, against 10 rendered
`sm-feed-item` cards. The brief's M8 spec says by name that *"an empty trailing window shows the
kit's empty state"*, and the pinned wireframe (`ui/screens.md:313`) shows `#sm-trending-row` with a
`#sm-trending-rank` badge; the kit exports `TrendingRow` and `TrendingEmpty` and neither is used.
Ranking itself is correct, so no M8 assertion fails — but a named brief clause is unmet, the rank
affordance is absent, and three contracted automation ids are missing from the app.

### <a id="d-02"></a>d-02 (minor) — replay receipts cannot be distinguished from a settle log

`scripts/replay.mjs` guards the *write* with `else if(!state.done[intent])` but appends the receipt
line, `state: 'sent'` and a measured `durationMs` **unconditionally**. A grader re-run against the
existing resume state emitted **50 `state:"sent"` lines and `pass: true` in 65 ms with zero
submissions** to the backend — per-action `durationMs` of 0.004–0.007 ms, which is physically
impossible for a round trip. The brief's replay contract defines "settled" as the app's own mutation
path having accepted the write, and the harness's corpus-wide counts come from *settle-receipt
accounting* over "every action acknowledged during replay". Mitigating: the verification pass does
run on every invocation and reads every named entity through authorized reads, so a green re-run is
not vacuous — the final state genuinely is verified. Skipping already-settled idempotent work on
resume is legitimate; recording it as freshly `sent` with a fabricated duration is not.

### <a id="d-03"></a>d-03 (minor) — the adapter is not idempotent across a genuine re-replay

With the resume state file set aside, `scripts/replay.mjs` aborted at **action 2 of 50** with
`E_ID_REUSED`: *"this id already admitted another operation or different arguments"*. Cause:
`profile-set` re-uploads the avatar, producing a new asset id, then reuses the same derived mutation
id `intent+'avatar'` with different arguments. The frozen action schema states that a create verb's
explicit id is a stable idempotency key whose retry behaviour is observable and idempotent, so a
whole-log re-replay should be a no-op, not a hard abort. The lane's separate `scripts/seed.mjs` path
*is* idempotent (m3-a15 verified independently), so this is specific to the replay adapter. Lane
state was restored byte-for-byte afterwards.

### <a id="d-04"></a>d-04 (cosmetic) — API.md's HTTP section omits the login response shape

The *"With only a token and this document"* section says to `POST /auth/login` with
`{email, password}` but never gives the response shape. The raw route answers
`{session:{principal, kind, token, expiresAt}}` with **no `ok` flag**, while the SDK section above
documents success as `{ok: true, session: …}`. A client written strictly from the HTTP section fails
its own success check on a successful login — which is exactly what happened on the grader's first
m6-a12 attempt, costing one iteration. Everything else in that section, including the 18-field
history manifest, was accurate.

### <a id="d-05"></a>d-05 (cosmetic) — operational scripts are unsafe for a second operator

`start-servers.mjs`, `build-web.mjs`, `replay.mjs` and `restart-backend.mjs` append to `run-log.md`
and overwrite `evidence/*.pid` unconditionally, and `restart-backend.mjs` kills whatever pid sits in
`evidence/backend.pid`. An independent operator running the documented entrypoints therefore mutates
the delivered record and cannot restart a backend they started themselves — the grader had to write
a grader-owned restart to avoid SIGTERMing a foreign pid. Operational, not a product defect.

## Phase 4 — holdout probes: skipped

No probe set was committed for wave `full-3models-astra`; `instrument/grader/probes/` contains only
the published category registry, the custody tool and an empty rotation log, and
`probes/README.md` states that no actual probe set is committed there. `wave.probeSetSha256` is
therefore the sentinel `none-uncommitted` and `probeResults` is empty. **No probes were invented.**

Consequence for **O3**: `applicability.json`'s predicate (`m6-green-and-m1-m5-attempted`) is
satisfied, so O3 would ordinarily be scored — but its rule restricts it to *"the wave's secret
rotated holdout probes only"*, and that evidence base does not exist. Scoring O3 from the grader's own
trust-boundary sweep would substitute unauthorized evidence for the dimension's defined basis, and
assigning a number without evidence would be invention. O3 is therefore recorded **null**, with the
sweep's results reported above and in the defect list instead. This is a recorded consequence of the
N=1 calibration deviation, not a lane shortfall — every trust-boundary check the grader ran came back
clean.

## Phase 6 — O-dimension scores

Applicability resolved from `applicability.json` for `runScope: full` with M1–M6 and M8 green and M7
not-run: O1 and O2 apply (grading phase ran), O3's predicate holds, O4's predicate holds (M6 green),
O5 applies (replay attempted).

| | Score | Basis |
|---|---|---|
| **O1** Functional completeness | **72** | 101/119 assertions pass; 7 of 8 milestones green. Past the 60 anchor (M1–M5 *complete*, not merely solid — all 79 assertions — plus M6 and M8 green); held below 90 by exactly the two things that anchor names: not every in-scope milestone is green (M7), and the platform-proof artifacts are absent. |
| **O2** Correctness under grading | **84** | No blocker or major defect beyond the checklist; no wrong data, broken flow or crash. Trust boundaries, time-seam, cursor stability, receipt aggregation and monotonicity, tombstone shape all clean. Three minor findings (one named-brief-clause UI deviation, two replay-tooling integrity issues) keep it just short of "only cosmetic nits". |
| **O3** Trust boundaries | **null** | No committed holdout probe set; the dimension's sole permitted evidence basis does not exist for this wave. See phase 4. |
| **O4** Observed offline behavior | **20** | The permitted evidence base — mechanically checkable simulator recordings plus structured receipts — is **empty**. None of the nine native assertions is demonstrated, which sits below even the 30 anchor (that anchor presupposes a native cold-start observation, however bad). Lifted off the floor entirely by the dimension's honesty clause, on which the lane is exemplary. Admissible web evidence (M6 web queue/flush/receipts, M8 dual-offline convergence, M5 warm-offline search) is recorded but is not this dimension's artifact, and `simulator.md` forbids inferring the native pass from it. |
| **O5** Performance at the scale envelope | **band 75** | Exact band function, first-match over 0, 30, 60, 90, 75. See below. |

### O5 band derivation

**Band 0 — does not fire.** The grader independently verified conformance against the *preserved
scale instance* (served read-only on 49363 from `replay-full-instance`, never the dev instance). All
18 `perEntityCounts` match `invariant-manifest-combined.json` exactly — 1008 users, 5921 follow
edges, 50228 posts (48224 top-level + 2004 replies), 100015 messages, 2053 memberships, 2000 active
reactions, 0 disappearing settings. Every **named O5 fixture** is exact, checked through authorized
application reads:

| Fixture | Manifest | Observed |
|---|---|---|
| u0500 | 500 follows, 100 conversations | **500 / 100** |
| u0005 | 5 follows | **5** |
| u0900 celebrity | 900 followers, 200 posts | **900 / 200** (paged and via insights) |
| u0901 celebrity-follower | follows exactly u0001–u0004 + u0900 | **5, all five resolved** |
| g0001 busy group | 50 members (exact list), 10000 messages | **50, roster matches the manifest list; 10000 counted by full paging, 10000 distinct ids, ordinals monotonic** |

No replay wall cap could be exhausted: the frozen brief leaves that cap a *"pilot-calibrated"*
placeholder. The lane's recorded `scale-final` clock is 1079.5 s over 167 243 actions.

**Band 30 — does not fire.** Every evaluable published degradation rule passes with wide margin,
under the frozen protocol (k=20 after 3 warm-ups, sequential, 30 s timeout; load average 32.00):

| Rule | Predicate | Observed | Margin |
|---|---|---|---|
| perf-deep-paging | p95(page 50) ≤ 3× p95(page 1) of the 10k chat | 1.15× | wide |
| perf-feed-follow-scaling | p95(u0500 Following) ≤ 3× p95(u0005) | 1.01× | wide |
| perf-cold-start-sync | 100-conversation probe user syncs without timeout or unbounded memory | 188 ms, +0.9 MiB RSS | wide |
| perf-envelope-stability | no probe times out, errors or OOMs | 0 errors across every measurement | — |
| perf-search-scaling | full corpus ≤ 3× the 10% checkpoint | **not re-measurable** — the 10%/50% checkpoint states were not preserved. Full-corpus arm measured: p95 2.37 ms | — |
| perf-receipt-aggregation | must not visibly stall send/render in g0001 | **read side only** — the grader declined to write into the preserved audit store. Room read p95 2.30 ms, newest page with receipts p95 16.15 ms | — |

**Band 60 — cannot fire.** The brief's absolute p95 ceiling table is an uncalibrated placeholder
(*"per rotated probe set — pilot-calibrated"*), so no ceiling exists to exceed, and there is no cap
to have used more than 80% of.

**Band 90 — not met.** Its condition requires every probe's observed *ceiling utilization* to be
≤50%, which is undefined without calibrated ceilings, and ≤50% of a cap that does not exist. It
cannot be established, so first-match falls through.

**Band 75** is therefore the residual branch. These are the instrument's published degradation rules,
measured by the grader — not scored probe instances, of which there are none this wave.

## Deviations from the frozen protocol, in full

1. **Phase 4 skipped** — no holdout probe set committed for this wave; `probeSetSha256:
   "none-uncommitted"`, `probeResults: []`, no probes invented. Knock-on: **O3 null** (§phase 4).
2. **Uncalibrated grader** — `calibrationPassed: false`, `sameFamilyGraded: false`; graded anyway per
   the wrapper, and the grade is labelled **uncalibrated-grader**.
3. **Timing best-of-3 with load recorded** — done; host load 21.8–36.5 throughout because other
   sessions share this machine, recorded beside each timing block. One timing-sensitive assertion
   (`m3-a08`) has only one harness measurement; `bestOf3Ms` is `null` rather than padded.
4. **m2-a07 executed by the grader** — the frozen harness has no follower-count observation, so this
   `[choreo]` assertion has no artifact; executed by browser automation under phase 3 instead of
   being recorded unscoreable. Disclosed in the report notes (§m2-a07).
5. **Result files split by schema limitation** — the frozen `grader-report.schema.json` constrains
   `assertionResults` to `^m[1-7]-a[0-9]{2}$` with `additionalProperties: false`, so it admits only
   the 101 M1–M7 ids. All 119 assertions were graded in this one session; the 18 M8 results are
   written to `grading/m8-assertion-results.json` with the same result records and enum values. The
   partition was machine-checked: 101 + 18 = 119, zero overlap, exactly the frozen id set, and the
   M1–M7 set is identical to `GRADER_ASSERTIONS_101.txt`.
6. **Prior measurement-coverage gap, recorded as required** — the September 5 and September 12
   structured `assertionResults` carried only those 101 ids. Their prose notes could describe M8
   observations, but they did not provide a machine-comparable 18-id M8 result set, so no prior run
   is comparable to this one on M8 at assertion granularity. This session is the first to emit all
   18 M8 ids as structured results.
7. **Stale manifest counts block** — `assertions.json`'s own `counts` declares 116 assertions with M2
   at 24, while the M2 array holds 27 (`m2-a25`..`m2-a27` are additive) for 119 total. The arrays
   were treated as authoritative, matching the wrapper's 119.

No weighted total, efficiency statistic or cross-lane comparison is computed here — those are the
harness's and publisher's jobs.

## Schema validation

`grading/grader-report.json` validates against
`instrument/grader/grader-report.schema.json` with AJV 2020 (`allErrors`, formats): **valid**.
Partition and enum checks: 101 / 18 / 119 ids, 0 overlap, 0 records with a bad `result` enum or a
missing `method`, all 18 M8 ids matching `^m8-a[0-9]{2}$`.

## Tallies

| Set | pass | not-run | total |
|---|---|---|---|
| Prior-101 subtotal (M1–M7, `grader-report.json`) | 85 | 16 | 101 |
| M8 (`m8-assertion-results.json`) | 16 | 2 | 18 |
| **Complete** | **101** | **18** | **119** |

Not-passed, itemised: M6 `a01`–`a07` and M8 `a17`, `a18` (nine native simulator proofs, no artifact);
M7 `a01`–`a09` (milestone never attempted, instructed).
