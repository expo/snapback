# social-messenger grader trace — lane `astra-supabase`

Sanitized evidence and action trace. Published artifact; the raw session is
retained privately for audit only (LLP 0197 redaction posture, LLP 0198). All
credentials are redacted: fixture account passwords are referred to as
`<FIXTURE-PASSWORD>`, and the hosted project's URL, keys, database URL and
service-role secret were read only through `scripts/env.mjs` and never printed,
logged or written into any artifact under `grading/`.

| | |
|---|---|
| Lane | `lanes/astra-supabase`, backend `supabase-2.112.4` (`@supabase/supabase-js@2.112.4`, hosted project) |
| Run scope | `full` (M1–M8) |
| Run record | `run-record.json` — present; M1–M6 and M8 `green`, **M7 `not-run`** |
| Grader | family `claude`, model `claude-opus-5`; builder family was `gpt-6-astra`, so not same-family |
| Calibration | **not passed** for this family — this grade is labelled `uncalibrated-grader` |
| Session outcome | `completed`, 1 re-run used |
| Wave | `astra`; probe set `none-uncommitted` |
| Host | macOS arm64, Node v24.18.0 (`/Users/ccheever/.volta/.../24.18.0`), Playwright chromium from the lane's frozen choreography copy |
| Ports I started | **49301** (lane API) and **49300** (Expo web) only |
| Machine load | shared machine; `uptime` load averages at session start `7.76 / 27.62 / 69.73`, mid-session `18.98 / 18.40 / 47.48`, later `9.24 / 14.23 / 20.92` |

I did not open `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` or
`run-log.md`, and I read no other lane. The session is not contaminated.
`scripts/native-controller.mjs` appends to `run-log.md`; I never ran it and
never read that file.

## Deviations from the frozen protocol

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped, `wave.probeSetSha256` is the sentinel `none-uncommitted`, and
   `probeResults` is empty. I invented no probes. `applicability.json` scopes O3
   to "the wave's secret rotated holdout probes only", so **O3 records null**
   even though its predicate (M6 green + M1–M5 attempted) is satisfied — the
   only permitted input does not exist. My own 27 trust-boundary probes below are
   scored under O2, never as O3.
2. **This family has not passed the grader calibration gate**, so
   `calibrationPassed` is false and the grade is labelled `uncalibrated-grader`.
3. **Timing-sensitive checks are judged best-of-3**, with machine load recorded
   above beside each measurement window.

## Two instrument issues I hit

- **`assertionResults` cannot key M8.** The report schema's
  `assertionResults` uses `patternProperties: ^m[1-7]-a[0-9]{2}$` with
  `additionalProperties: false`, so it predates the 2026-08-11 M8 amendment and
  rejects `m8-*` keys — I confirmed this with AJV before working around it. M8 is
  in scope on this full run and all 18 of its assertions pass, so they are
  recorded in the report's `notes`, in `grading/artifacts/m8-assertion-results.json`,
  and in [§M8](#m8) below.
- **`assertions.json`'s own counts are stale.** It declares
  `counts.assertions.M2 = 24` and `total = 116`, but the M2 array enumerates 27
  assertions (`m2-a01`…`m2-a27`, including the implicit-self-follow trio
  `a25`–`a27`) for an actual total of **119**. I graded the real enumeration, so
  O1's denominator is 119.

## Phase 0 — provisioning from a clean state

The lane had already deleted all hosted state, as the brief requires.
`evidence/cleanup.json` records 1,297 auth users, 2 storage buckets (1,086
objects), 24 tables, 2 schemas, 1 procedure, 2 functions and 1 sequence dropped,
with `remaining` all zero. I confirmed the hosted Postgres was reachable and
that zero `clqfa%` relations and zero `clqfa%` schemas existed.

Before running anything I snapshotted `coverage-manifest.json`,
`suite-status.json`, `simulator-status.json`, `run-record.json`,
`choreography-adapter.json` and the whole `evidence/` tree into
`grading/baseline/` — necessary because `scripts/acceptance.mjs` **rewrites**
`coverage-manifest.json`, `suite-status.json` and `evidence/suite-*.json` on
every run. Afterwards I restored the lane's originals byte-for-byte
(`coverage-manifest.json`, `suite-status.json`, and the ten `evidence/` files my
runs had overwritten) and removed the two failure receipts my runs introduced; a
file-by-file comparison against the snapshot now shows no remaining difference.
My re-run copies are archived in `grading/artifacts/suite-receipts/` with a
README saying which are mine and which are the builder's.

One redaction inside my own snapshot: `grading/baseline/evidence/m8-xctest-retry2.log`
has the fixture password replaced with `<REDACTED-FIXTURE-PASSWORD>`, so the
credential is not re-published under my deliverable directory. The lane's own
`evidence/m8-xctest-retry2.log` is untouched — that unredacted occurrence is the
substance of defect **d-05**.

Provisioned strictly from the documented path in `README.md`:

```
node scripts/migrate.mjs                       # → "clqfa_ migration installed"
CLQFA_WINDOWS_CONFIG=config/windows.shortened.json \
CLQFA_DIGEST_CONFIG=config/digest.shortened.json \
  node scripts/server.mjs                      # PID 7835, port 49301
node scripts/seed.mjs --segment m1 | m2 | m3   # all actions settled
CI=1 BROWSER=none npx expo start --web --port 49300   # PID 17241
```

`config/windows.shortened.json` and `config/digest.shortened.json` are
byte-identical to `instrument/fixtures/config/`, so grading ran the fixture
pack's shortened windows throughout (edit 60 s, delete 120 s, disappearing
"24h" → 180 s, digest period 120 s).

**PIDs I started and killed:** `7835` (API), `17241` (Expo web), `89480` (the
API again, after the deliberate mid-period restart in the digest probe). No
`pkill`/`killall`; no other lane's ports were touched.

## Phase 1 — the lane's documented acceptance suite

`npm run acceptance -- --milestone mN` against the running backend.

| Milestone | Result | Mapped assertions | Notes |
|---|---|---|---|
| m1 | **PASS** | 7 | 7.9 s; browser signup, avatar upload and duplicate-error flow all real (new profile row + avatar object verified in the DB) |
| m2 | **PASS** | 22 | 22.8 s |
| m3 | **FAIL** ×3 | 5 of 7 recorded | aborts at `m3-a10`; see [§m3-a10](#m3-a10) |
| m4 | FAIL then **PASS** | 5 | attempt 1 timed out waiting for the edited bubble; attempt 2 passed |
| m5 | **PASS** | 6 | |
| m6 | **PASS** | 5 | 23.8 s |
| m8 | **PASS** | 6 | 37.2 s |
| m7 | n/a | — | no suite exists; `scripts/acceptance.mjs` throws "Milestone suite not implemented" |

Receipts: `grading/artifacts/suite-receipts/`, incl. `suite-m3-failure.json`
(m3-a03, a04, a05, a14, a15 recorded pass before the abort).

## Phase 2 — coverage-manifest spot-verification → **honest**

I read every mapped test end to end (`scripts/acceptance.mjs` for M1;
`scripts/test-m{2,3,4,5,6,8}.mjs`) and checked each sampled mapping against its
assertion's observable. Sampled: `m1-a03`, `m1-a11`, `m2-a13`, `m2-a22`,
`m2-a24`, `m2-a27`, `m3-a05`, `m3-a15`, `m4-a06`, `m4-a09`, `m5-a05`, `m5-a11`,
`m6-a11`, `m6-a13`, `m8-a01`, `m8-a06`, `m8-a07`.

- Every suite-required assertion is mapped, at the right per-milestone count
  (M1 7, M2 22, M3 7, M4 5, M5 6, M6 5, M8 6).
- Mappings are **generated from the tests**, not hand-written: re-running the
  suites regenerated a byte-identical assertion→test mapping for every
  milestone that passed.
- The strongest mapping is `m6-a13`: the test replays the 50-action sample and
  then re-derives every expected post, message, reaction, follow, like, repost
  and group membership from the log and asserts them against the database,
  rather than trusting the adapter's own return value.
- Two mappings are **weaker than their assertion text without being dishonest**:
  `m2-a22`/`m2-a23` drive pagination through the sentinel "Load more" control
  rather than a scroll gesture (infinite scroll does exist — I verified it
  independently, see [§m2-pagination](#m2-pagination)), and `m2-a13` proxies "no
  preview card" by the absence of an `iframe` (I checked iframes, videos and
  image count instead).
- `m3-a10`/`m3-a11` are honestly mapped to a test that genuinely drives the
  quoted-reply UI; that test simply loses a race (defect **d-04**). A
  reliability problem, not a mapping-honesty problem.

**No milestone is adjudicated `capability-failure`.**

## Phase 3 — independent checklist execution

Scripts I wrote live in `grading/scripts/`; their machine-readable output is in
`grading/artifacts/`. `[choreo]` assertions are scored from the harness's
receipts and the native artifacts only — I never re-drove the choreography or
the simulator.

### <a id="m1"></a>M1 — accounts and profiles

- `m1-a01` API signup with an 8+ char password returned a session and profile;
  a 6-char password was refused `400 "Password must contain at least 8 characters"`.
- `m1-a02` fresh web signup landed on the authenticated feed (screenshot
  `m1-a02-authenticated.png`).
- `m1-a03`/`m1-a04` visible `sm-auth-error` texts "Handle already exists" and
  "Email already exists" (`m1-a04-duplicate-email.png`).
- `m1-a07` (full-only) pre-logout `GET /chats` → 200; after `POST /logout` the
  same access token → **401**, and the matching refresh token → **400** from the
  provider. Revocation is server-side (a `clqfa_revoked` session row plus a
  provider `signOut`), not a client-side token wipe.
- `m1-a08` display name and bio persisted and re-rendered on own profile, and
  were confirmed independently through `/profiles`.
- `m1-a10`/`m1-a11` fixture `avatar-bob.png` uploaded; the rendered `<img>`
  decoded with `naturalWidth > 0`, i.e. real bytes (`m1-a10-avatar.png`).
- `m1-a05`, `m1-a06`, `m1-a09` from `evidence/choreo-m1.jsonl` — all passed;
  `profile-edit-live-visibility` best-of-3 = **2559 / 2828 / 2304 ms**.

#### <a id="m1-a12"></a>m1-a12 — password storage (source inspection) → pass

Passwords are handed only to the managed provider:
`admin.auth.admin.createUser`, `auth.signInWithPassword`,
`auth.refreshSession`, `auth.admin.signOut`, `auth.admin.deleteUser`,
`auth.getUser`. There is **no lane-side KDF or hash implementation** anywhere in
`scripts|lib|ui|app` (searched bcrypt, argon2, scrypt, pbkdf2, sha*, md5) and
**no password-like column** in `schema.sql` or `scripts/mutations.sql`. Sampled
`auth.users.encrypted_password` values carry the `$2a$` bcrypt prefix at 60
characters. The lane uses the documented provider path, not provider internals.

#### <a id="m1-a13"></a>m1-a13 — no plaintext password storage → pass (with d-05)

I scanned for every fixture password literal (values never printed) across lane
source, `artifacts/` web and Hermes bundles, `public/`, the native test target,
`evidence/`, and 50 lane `text`/`jsonb` columns plus the `auth` password
columns. Also scanned artifacts and evidence for every provider secret value.
All clean **except one hit**: `evidence/m8-xctest-retry2.log:5413` reads
`Type '<FIXTURE-PASSWORD>' into "sm-auth-password"`. That is Apple's XCUITest
framework echoing `typeText`, not application logging — the app stores and logs
no password material, and the other eight XCTest logs are clean. I score the
assertion **pass** and file the retained-artifact hygiene problem as **d-05**;
a reviewer who reads "or logs" literally could reasonably fail it instead, and
this note is here so that disagreement has a documented basis.

### <a id="m2"></a>M2 — posts and the follow graph

All 22 suite-required assertions re-executed independently through the API
(`grading/artifacts/api-m1-m2.json`) — every one passed. Highlights:

- `m2-a24` both tabs: page 1 exactly 20 entries, page 2 disjoint by `entryId`,
  all 25 seeded fixtures present — no duplicates, no gaps.
- `m2-a15` like → 1, unlike → 0, and a **repeated** clear stays 0 (idempotent
  set-state, not a blind toggle).
- `m2-a25`–`a27` with `followingCount` 0, Bob's own original **and** his own
  repost stay in Following, and his follower/following counts are unchanged
  (3/0 before and after) — implicit membership with no synthetic edge.
- `m2-a20` thread = parent then its two direct replies in creation order; the
  nested reply is correctly excluded. `m2-a21` no reply appears in either feed.
- `m2-a12` the URL renders as text with `role=link` and tapping opened a real
  new browser window at the target. `m2-a13` the card contains 0 iframes, 0
  videos and exactly 1 `img` (the author avatar) — no unfurl
  (`m2-a12-a13-link-no-preview.png`).
- `m2-a16` the feed row reads **"↻ Reposted by Bob Bennett"** — display name,
  not handle (`m2-a16-repost-attribution.png`).
- Choreography: `m2-a04` best-of-3 **2329 / 1809 / 1302 ms**; `m2-a07`
  **908 / 898 / 1425 ms**; `m2-a14` **1392 / 1670 / 1579 ms**; `m2-a19`
  **1502 / 609 / 756 ms**; `m2-a05` matched the exact feed-author avatar
  identity plus display name. The image and video live-update receipts each had
  one failed middle attempt, which best-of-3 absorbs.

#### <a id="m2-pagination"></a>m2-a22 / m2-a23 — scrolling really does page

I initially suspected the feed only paged on an explicit tap, because
`lib/Social.tsx` renders a `feed-load-more` control. It does both: there is a
`window` scroll listener plus an `IntersectionObserver` on that sentinel.
Measured, with no click at all: **Following 20 → 72 items**, **Global 20 → 80
items** after scrolling the page to the bottom
(`m2-a22-pagination-following.png`, `m2-a23-pagination-global.png`). Both pass.

### <a id="m3"></a>M3 — messaging core

- `m3-a03` two `/chat` calls from Alice and one from Bob all resolve to the
  single channel `d-alice-bob`.
- `m3-a04`/`m3-a05` `alice:admin bob:member carol:member`; two groups with the
  same name and the same three members coexist under distinct ids.
- `m3-a14` non-admin remove → `400 Conversation access denied`.
- `m3-a15` re-running all three installed starter segments left every row count
  identical (profiles 15, posts 112, messages 44, chats 12, follows 14,
  likes 40, reposts 5, members 36).
- Choreography: `m3-a01` **2312 / 2310 / 1986 ms**; `m3-a06` typing visible
  **86 / 387 / 19 ms** against the 2 s bound; `m3-a07` expiry
  **4378 / 3180 / 4821 ms** against the 5 s bound (server TTL is 3 s);
  `m3-a08` matched exact semantic `sent`/`delivered`/`read` tokens with no glyph
  matching; `m3-a09` group read stays `delivered` until the slowest retained
  member reads; `m3-a12`/`m3-a13` the harness checks the live cutoff only after a
  later direct-message progress marker reaches the removed client, and requires
  **exactly one** retained pre-removal bubble.

#### <a id="m3-a10"></a>m3-a10 / m3-a11 — pass on the product, fail in the lane's suite

The lane's M3 suite failed at `m3-a10` on **all three** attempts, always the
same way: the reply bubble's text was
`"…quoted reply | 7:16:22 PM | ◷ | Reply | React | Edit | Delete"` — the `◷`
glyph is the kit's *pending* receipt. The suite asserts the quoted excerpt on
the still-pending optimistic bubble, and `lib/Messaging.tsx` renders pending
bubbles from the outbox body, which carries the quoted message's **id** but not
the `quoteText`/`quoteName` the server projection supplies. So the quote block
renders empty until the round trip lands.

Independently, with the quoted message settled first, the excerpt appears fast
and reliably — best-of-3 **903 / 918 / 677 ms** to render
(`grading/artifacts/quote-timing.json`, 3/3 runs, load average ~9). The harness
choreography assertion `quoted-reply-excerpt-and-jump` also passed 3/3. For
`m3-a11` I pushed the original out of view with 15 filler messages
(`top = -261`, not in view), tapped the excerpt, and the original came back into
view (`top = 402`) — `m3-a10-a11-quote.png`.

Scored: `m3-a10` **pass** / `m3-a11` **pass**, both with `suiteResult: fail`,
and the race filed as **d-04**.

### <a id="m4"></a>M4 — media messages, reactions, edit/delete

- `m4-a01`/`m4-a03` fixture image and video picked **in the client** and sent;
  the photo bubble renders a decoded image (`naturalWidth 640`), the video
  bubble renders a `<video>` element, and the recipient's asset fetch returns
  `200 video/mp4` (`m4-a01-a03-media.png`).
- `m4-a06` 👍 then ❤️ leaves exactly one reaction (❤️, count 1); `m4-a07`
  re-tapping clears it.
- `m4-a09` the edited bubble reads `"… edited-text | edited | …"`.
- Choreography: `m4-a02` **3614 / 3231 / 3935 ms**; `m4-a05`
  **2369 / 2372 / 2875 ms**; `m4-a08` **823 / 807 / 1303 ms**; `m4-a04` video
  plays on the recipient; `m4-a11` tombstone rendered.

#### <a id="m4-a10"></a>m4-a10 — post-window edit refused server-side → pass

Under `windows.shortened.json` (`editWindowSeconds: 60`) an in-window edit was
accepted and set `edited=true`; 68 s later the identical call was refused
`400 "Edit window expired or message unavailable"` and the stored text was
unchanged. The window is enforced in SQL against `clock_timestamp()`, not by
hiding the affordance.

#### <a id="m4-a12"></a>m4-a12 — asset stops serving after delete → pass

The message media URL returned **200** before `delete-for-everyone` and **403
"Asset unavailable"** after; the storage object is also removed from the private
bucket. The tombstone itself carries `tombstone:true` and empty text — but it
still exposes its `mediaReference` id, which is **d-10** (cosmetic).

### <a id="m5"></a>M5 — ephemeral, chat config, search

- `m5-a04` first `/view-once` returns a transient `data:image/png` URI;
  `m5-a05` the second open is `403 "Photo already opened"`; `m5-a06` a direct
  `GET /asset/<consumed view-once>` is **403 for the recipient and 403 for the
  sender** — view-once assets are never served through the ordinary asset path
  at all.
- `m5-a08` non-admin rename → `400`. `m5-a09` "car" **and** "CAR" both resolve
  Carol. `m5-a10` in-chat "cof" finds the seeded "Coffee after work?".
  `m5-a11` 3 results under per-chat group headers `WEEKEND PLANS` and `BOB`
  (`m5-a11-search-groups.png`).
- Choreography: `m5-a07` accent colour and background synced (4124 ms);
  `m5-a12` warm-offline search over synced messages passed.

**`m5-a01`–`m5-a03` (disappearing, shortened windows).** I set the DM to
disappearing through the **client UI** (the "24h" option = 180 s under the
shortened config; server setting confirmed `"24h"`), sent a uniquely tokenised
message, confirmed both clients rendered it, then closed both browser contexts
and waited 200 s.

- `m5-a01` after expiry with both clients closed: `/history` omits the message,
  a reaction on it is refused `400`, an edit is refused `400`, server search
  returns it in no scope, and `/revocations` lists it.
- `m5-a02` relaunched sender and recipient clients each render **0** bubbles for
  it. Separately, a client that stayed *connected* across expiry also dropped it
  within the polling tolerance.
- `m5-a03` before expiry the token returned **1** warm-offline result (offline
  banner shown, results served from the local cache); after the client synced
  the expiry, warm-offline search for the same token returns **0**
  (`m5-a03-offline-search.png`). The local cache purges expired rows rather than
  keeping a searchable copy. My first attempt at this check was my own error — I
  reloaded the page while offline, which is a cold start against a Metro dev
  server, not the warm-offline condition the assertion describes; I re-ran it
  warm.

### <a id="m6"></a>M6 — offline writes, push seam, custom-client API

- `m6-a08` with **zero** live presence sockets the seam logged
  `{targetUserId, chatId, senderDisplayName, preview}` where `preview` is
  exactly the first 80 characters of a 160-character body; a video message
  logged `preview: "Video"`.
- `m6-a09` a view-once photo logs `preview: "Photo"`, and its private caption
  appears in no payload.
- `m6-a10`/`m6-a11` `node scripts/custom-client-demo.mjs` exited 0 with
  `pass:true` against my freshly migrated and seeded instance, reporting and
  performing all five listed operations (authenticate, list-conversations,
  page-history, send-text, receive-by-polling).
- `m6-a13` `instrument/fixtures/validate.mjs` conformance check exit 0; my own
  replay of `sample-50.log` settled **50/50** actions with 50 settle receipts
  and `sha256 41658c95…dda8`, matching the fixture digest.
- Retry semantics: re-posting the same message id created no duplicate row.

**`m6-a01`–`m6-a07` (native artifacts).** Scored from the lane-native artifacts,
which `choreography/simulator.md` permits in place of a generic driver.
`XCTest CliqueOfflineTests.testColdOfflineMediaAndSearch` — `TEST SUCCEEDED`,
real simulator UDID `87E00D66…`, 7 checkpoint screenshots — cold-launches the
app with the recorded backend **process stopped** and asserts that cached
history renders, a previously viewed photo opens in the media viewer, the cached
video player clock advances past 1.0 s, the previously opened view-once message
reports value `"opened"` with its control disabled and **no** viewer node, and a
cold-offline prefix search returns the named token through the app's own Search
action. `testDurableOfflineRestart` covers the queue: two offline composes
render pending, survive app termination and relaunch while still offline, then
flush **exactly once in order** and reach `read`, with an independent read
through Bob's session (`evidence/native-queue-api-verification.json`) counting
exactly two ordered writes. I read `ios/CliqueUITests/CliqueOfflineTests.swift`
and `scripts/native-controller.mjs` to confirm the offline condition is a real
`SIGTERM` of the recorded API process and that `/verify` is a genuine
independent server-side check. Artifact-form gaps are recorded under O4 below.

#### <a id="m6-a12"></a>m6-a12 — grader-written client from API.md only → pass

`grading/scripts/api-m6-a12.mjs`, written against `API.md` alone:
`POST /auth/signin` → `GET /chats` → `GET /history/<id>`, taking the **last**
element of `messages` as the latest (the document pins server-arrival order).
It resolved the latest message correctly for a DM named by counterpart and for a
named group, both matching server truth.

My **first**, more literal attempt failed: I matched a conversation by
`name === x || counterpart === x`, and `GET /chats` populates `counterpart` for
**group** conversations too (four groups came back with `counterpart:"bob"`), so
I landed on an empty group instead of the DM. The document describes the field
only as "counterpart handle" without scoping it to DMs. Documentation friction,
filed as **d-07**; the assertion itself passes.

### <a id="m7"></a>M7 — day-2 evolution: not run

`run-record.json` records `socialMessenger.milestones.M7.status = "not-run"`
and the record's own notes say "no M7". Source inspection confirms there is no
poll entity, no vote path and no message-count surface anywhere in the lane
(`scripts/mutations.sql`, `scripts/*.mjs`, `lib/*.tsx` contain no poll verb; the
kit's `PollCompose`/`PollDisplay` and `sm-chatsettings-messagecount` are frozen
components that are never wired). All nine M7 assertions record `not-run` and
score as not passed for O1. `m7-a09` is `not-run` rather than `not-applicable`:
milestones *were* green before M7 would have started, so this is not the
"nothing was previously green" exemption — the regression item simply never ran.

### <a id="m8"></a>M8 — insights, digest, multi-device offline (all 18 pass)

Recorded here and in `grading/artifacts/m8-assertion-results.json` because the
report schema cannot key `m8-*`.

| Assertion | Result | Evidence |
|---|---|---|
| m8-a01 | pass | Six lifetime totals rendered on the Insights screen matched `/insights` **and** my own independent SQL counts over the raw tables (`m8-insights.png`) |
| m8-a02 | pass | choreo `m8-a02-insights-like-refresh`: likes 96 → 97, refresh 869 ms |
| m8-a03 | pass | 7 buckets ending on server UTC day `2026-09-07`; a post created during the probe landed in that bucket |
| m8-a04 | pass | all 7 rows render; `2026-09-01` reads "Posts 0 Likes received 0" rather than being omitted |
| m8-a05 | pass | my newest 8-like post ranks #1 in the API and the rendered tab (`m8-trending.png`) |
| m8-a06 | pass | a grader-owned post aged to 25 h with 8 likes is absent from both |
| m8-a07 | pass | two 7-like posts order newest-first (TIE2 index 2, TIE1 index 3) |
| m8-a08 | pass | see the digest probe below |
| m8-a09 | pass | all 12 zero-activity personas received no digest |
| m8-a10 | pass | the following deliberately quiet period emitted 0 digests |
| m8-a11 | pass | backend SIGTERMed mid-period and restarted: exactly one digest for the period's one active user, and no duplicated `(target, period_start)` anywhere in the seam log |
| m8-a12 | pass | Bob has 0 membership rows in a 3-message private chat created inside the period; his digest counted `unreadMessages 2 / unreadChats 1` — only his own conversation |
| m8-a13 | pass | choreo, cross-device live 2897 ms |
| m8-a14 | pass | choreo, cross-device read-state clear 2085 ms |
| m8-a15 | pass | choreo, dual-offline convergence, flushes 3292 / 2815 ms |
| m8-a16 | pass | choreo, receipts advance after the dual-offline reconnect |
| m8-a17 | pass | native `testDurableOfflineRestart`: both queued bodies present exactly once, in order, value `pending`, across process death while offline |
| m8-a18 | pass | same run: both flush in order and both native receipts advance to `read` |

**The digest probe** (`grading/scripts/digest-probe.mjs`,
`grading/artifacts/digest-probe.json`) was the most involved piece. I waited for
a clean 120 s period boundary, then created controlled activity inside the
period 01:08:00–01:10:00Z: two DM messages to Bob; a 3-message private group
containing only Alice and Carol; and a fresh follow of Dave by Grace. I computed
the expected per-user counts myself from the brief's definition, over the raw
tables, and compared:

```
expected active: bob {um 2, uc 1}   carol {um 3, uc 1}   dave {nf 1}
emitted:         bob {um 2, uc 1}   carol {um 3, uc 1}   dave {nf 1}
```

Exactly three digests for exactly the three predicted users, with zero live
presence sockets, each payload carrying `kind`, `targetUserId`, `periodStart`
and `periodEnd`. Bob's counts exclude the private chat he is not a member of —
that is the authorization rule (`m8-a12`) demonstrated positively rather than by
absence. I then let a deliberately quiet period elapse (0 digests), and finally
killed the API mid-period and restarted it (PID 7835 → 89480), after which the
period emitted exactly one digest for its one active user with no duplicates
anywhere in the log. Emission is schedule-driven: it happened while no client
was connected at all.

## Phase 4 — holdout probes: skipped

No probe set was committed for this wave. `probeResults` is empty; nothing was
invented. See deviation 1 for the O3 consequence.

## Phase 5 — defects beyond the checklist

Full list with severities is in the report. The trust-boundary sweep
(`grading/scripts/trust-probe.mjs`, `grading/artifacts/trust-probe.json`) ran 27
adversarial probes and **26 were correctly denied server-side**: cross-user DM
history, chat metadata and message send; cross-user in-chat search (0 rows);
non-member reaction; editing and deleting another user's message; asset fetch by
a non-member and anonymously; removed-member read and write; non-admin member
add and self-promotion; handle takeover; access **and** refresh token after
logout; and — importantly for a backend that exposes a public data API — anon
and signed-in-user PostgREST reads on `clqfa_profiles`, `clqfa_messages` and
`clqfa_media` (all empty via RLS), an anon insert (`42501` RLS violation), and
RPC on `clqfa_mutate` and `clqfa_replay_batch`.

### <a id="d-01"></a>d-01 (major) — group receipt regresses `read` → `sent`

`scripts/messaging.mjs` computes the group aggregate as
`min(receipt state)` over `clqfa_receipts` joined to `clqfa_members` **where
`cm.active`** — i.e. over *currently* active members, recomputed on every read.
The brief pins receipts as per-message monotonic, with the recipient set being
membership **at send time** and members removed before reaching a state
*dropping out* of the aggregate requirement. Recomputing live means a drop-out
can come back. Reproduced (`grading/artifacts/receipt-probe.json`), group of
Alice/Bob/Dave, Alice's message:

```
send                 → sent
Bob reads            → sent      (correct: Dave has not read)
Dave removed         → read      (correct: Dave drops out)
Dave re-added        → sent      ← regression
```

The sender's screen reverts from a coloured double check to a single check for a
message that really was read by everyone still in the conversation. This is
reachable through the ordinary admin remove/re-add flow — the same flow the
harness's own M3 membership choreography drives (it just does not re-check the
aggregate afterwards, which is why the choreo assertion passes).

Related: **d-11** (cosmetic) — the same expression is
`coalesce((select min(r.state) …), 2)`, so a message sent into a group after
every other member has been removed reports `read` immediately, though nobody
received it.

### <a id="d-02"></a>d-02 / d-03 (minor) — replay transport trust surface

`clqfa_mutate(who uuid, op text, b jsonb)` is `SECURITY INVOKER` with
`EXECUTE` granted to `anon` and `authenticated` (`pg_proc.proacl` shows
`anon=X`, `authenticated=X`), and it is reachable on the hosted project's public
PostgREST RPC surface. I called it with the correct argument names using both
the anon key and a real user JWT, for a `message` and an `intent` op. Every call
failed at the function's first statement with `P0001 "Unknown user"`, because
`clqfa_profiles` has RLS enabled and **zero** policies, so the invoking role
sees no rows. Defence in depth holds and nothing is written today.

Two things still make this worth recording. The actor is a **caller-supplied
parameter** rather than `auth.uid()`, so the only thing standing between the
public RPC surface and an anonymous impersonation primitive is the continued
absence of any RLS policy on `clqfa_profiles`. And `API.md` states this
transport "is a trusted replay-adapter facility, not an anonymous browser RPC",
which is inaccurate about *reachability* — it is reachable, it just fails
closed. Separately (**d-03**), `POST /replay/authorize` accepts **any** signed-in
user and durably registers them in `clqfa_replay_principals` with no allow-list
and no replay-mode gate; Carol got `200 {"ok":true}`. `clqfa_replay_batch` is a
`PROCEDURE`, which PostgREST does not expose, so today that row is only usable
from a trusted Postgres session.

### <a id="d-05"></a>d-05 (minor) — fixture password in a retained log

`evidence/m8-xctest-retry2.log:5413` contains
`Type '<FIXTURE-PASSWORD>' into "sm-auth-password"`. XCUITest echoes typed text;
the app does not log it. It would nonetheless ship with the lane's published
evidence. The other eight XCTest logs are clean.

### <a id="d-08"></a>d-08 (minor) — idle polling cost

Measured with request interception on one open conversation, 20 s idle
(`grading/artifacts/poll-load.json`): **46 requests, ≈2.3 req/s** —
`/history/<chat>` ×10, `/chats` ×11, `/profiles` ×12, `/revocations` ×10, on
independent timers. Each `refresh()` tick (450 ms) also calls
`purge(await api('/revocations'))`, which walks **every** cached chat, and
`mergeCache`, which rewrites the whole chat history into local storage — 51,572
bytes per tick for this one conversation. Polling itself is a disclosed design
choice (`README.md`, `API.md`) and delivers the required liveness comfortably;
the per-tick revocation fetch and full-history rewrite are the avoidable part.

### <a id="d-09"></a>d-09 (minor) — unbounded in-process maps

`scripts/server.mjs` keeps `validatedTokens`, which gains an entry per distinct
access token ever presented and only drops one when that same token is
presented again after expiry; `scripts/messaging.mjs` keeps a module-level
`typing` map whose chat keys are never removed. Both grow monotonically for the
process lifetime. `API.md` already flags that the API is not stateless in its
typing/presence transport and that a multi-worker deployment would need shared
coordination.

## Phase 6 — O-dimension scores

Scores, cited anchors and full justifications are in
`grading/grader-report.json`. In brief: **O1 82** (7 of 8 milestones green with
110 of 119 assertions passing; M7 absent and the native artifact form
incomplete keep it under the 90 anchor's "every in-scope milestone green,
including platform-proof artifacts"); **O2 68** (one major correctness defect on
a pinned invariant plus eight minor and two cosmetic, against a clean
authorization surface); **O3 null** (its only permitted input, the wave's secret
holdout probes, was never committed); **O4 78** (the 90 anchor's behaviour is
all present and mechanically asserted, but the frozen artifact set is not — see
below); **O5 band 30**.

### O4 — why 78 and not 90

The three shortfalls are about evidence, not behaviour.
`choreography/simulator.md` requires a qualifying native run to emit an
uninterrupted screen recording, an `m6-ios-receipts.jsonl` validated against
`receipts.schema.json`, and an `m6-ios-run.json` manifest with SHA-256 digests
of both — and states that a recording without structured receipts is not a pass
and receipts without the bound recording and manifest are not a pass. The
**accepted** runs (`m6-native-media-proof-retry2`, `m8-native-proof-retry5`)
carry only PNG screenshots plus a lane-authored summary JSON; screen recordings
exist only in earlier *failed* attempts. The M6 cold-offline sequence and the
queued-write/flush sequence were also demonstrated in two separate XCTest runs
rather than one continuous session as steps 2–7 specify. Both gaps are disclosed
honestly — `m6-native-proof.json` says the queue evidence is "separately
evidenced in M8 proof" and states that offline is a stopped backend rather than
a device network cut (which `simulator.md` permits), and
`simulator-status.json` distinguishes actual native evidence from Hermes
exports. O4 explicitly weighs the honesty of a claim/guarantee gap, which is why
this lands at 78 rather than lower.

### O5 — band 30, and why I could not re-measure

Applied first-match in the order 0, 30, 60, 90, 75.

**Band 0 does not fire.** I checked the retained end state against the committed
`instrument/fixtures/invariant-manifest-combined.json` myself: all 18 expected
entity counts plus `followEdgeCount` match **exactly** at the final checkpoint
(users 1008, followEdges 5921, posts 50228, topLevelPosts 48224, replies 2004,
activeLikes 5008, activeReposts 1004, conversations 1002, dms 901, groups 101,
memberships 2054, messages 100015, textMessages 99105, mediaMessages 910,
quotedReplies 2736, activeReactions 2000, disappearingSettingsEnabled 0), and
the 10% and 50% receipts match their checkpoint manifests. `scripts/scale-verify.mjs`
asserts the per-user following/conversation maps, the per-chat message counts,
the per-group member counts and the named O5 fixtures with `deepEqual` against
that committed manifest — including the celebrity's 900 followers and 200 posts,
the probe user's 500 follows and 100 conversations, the celebrity-follower's
5-account list, and `g0001`'s exact 50-member roster. Receipt accounting is
complete (**167,157 actions / 167,157 receipts**) and `scale.log`'s sha256
matches the fixture digest. The replay wall cap is uncalibrated in this
instrument version (`capSeconds: null`, brief budget table: "pilot-calibrated
(rerun after the M8 scale-log regeneration)"), and `capExhausted` is false.

**Band 30 fires:** two frozen degradation rules fail. I recomputed both from the
raw checkpoint samples rather than taking the lane's own pass/fail flags:

| rule | 10% | 50% | 100% | 3× gate | mid-curve line at 50% | verdict |
|---|---|---|---|---|---|---|
| global message search | 300.1 | **382.3** | 364.7 | 900.4 ✓ | 328.8 | **fail** |
| Insights (probe user) | 635.1 | **2472.1** | 661.9 | 1905.4 ✓ | 647.0 | **fail** (3.8×) |
| Trending | 1214.9 | 534.6 | 210.0 | 3644.8 ✓ | 768.3 | pass |
| deep page vs page 1 | — | — | 766.5 | 2834.0 ✓ | — | pass |
| 500-follow vs 5-follow feed | — | — | 852.9 | 2354.8 ✓ | — | pass |
| celebrity-follower read path | — | — | 316.1 | 2354.8 ✓ | — | pass |

A caveat that matters for reading the number but not for the band: the 50%
checkpoint looks environmentally contaminated. `following-u0901` measured
**3567 ms** at 50% against ~300 ms at both 10% and 100%, `following-u0005`
measured 1293 ms at 50% against 351 ms and 785 ms, and several probes were
*faster* at 100% than at 10% — no genuine superlinear curve produces that shape.
Separately, three frozen rules were never measured at all (the lane's own
`scale-degradation.json` lists "Celebrity write comparison", "Group
send-to-render responsiveness" and "Native full-account cold-sync memory bound"
as omitted), so they cannot be credited as passing either. The frozen band
function contains no noise tolerance and the grader prompt requires applying it
exactly, so the band is 30 either way.

Re-measurement was impossible. The brief requires the lane to delete all owned
hosted state after the final report, and `evidence/cleanup.json` records both
`clqfa_scale` and `clqfa_scale2` schemas dropped — the 100k-message corpus no
longer exists, and re-running a ~3-hour replay against hosted Auth rate limits
was not available to me. O5 is therefore scored from the retained replay record,
as the frozen prompt directs.

## Harness and kit integrity

The lane's frozen choreography copy differs from `instrument/choreography` in
exactly two one-line import-path repairs — `../metering/observations.mjs` →
`../instrument/metering/observations.mjs`, and a missing
`../../lib/json-schema.mjs` helper replaced by an added 3-line AJV equivalent —
with no assertion logic touched. The 20 edits to the frozen `ui/src` kit each
add an `aria-*` DOM attribute beside an existing
`accessibilityValue`/`accessibilityState` prop **with the identical value**,
because the harness's own `semanticValue()` reads `aria-valuetext` from the DOM
and react-native-web does not emit it. Both sets are disclosed in
`copied-source-edits.json`; I diffed and verified every line as
behaviour-neutral. `choreography/VERSION` matches the instrument's `0.3.6-m8`.

## Cleanup

I killed only the PIDs I started — 89480 (the API, successor to 7835), plus
17241 and its listening child 17271 (Expo web); 7835 had already stopped when
the digest probe restarted the API. Ports 49300–49319 are released. No `pkill`/`killall`; no other lane's ports were touched. Nothing
under `instrument/` was written; everything I produced is under `grading/`.

One divergence an auditor should know about: the lane's recorded end state was
*empty* hosted storage (`evidence/cleanup.json`), and my re-provisioning
re-created a starter-sized corpus plus my probe fixtures in that hosted project.
I deliberately left it in place rather than running the lane's
`node scripts/cleanup.mjs`, because deleting hosted state is destructive and
outside what I was asked to do. Whoever owns the project can restore the
recorded clean state with that script; the footprint I left is on the order of
tens of auth identities and the three starter segments, against the 1,297
identities the lane's own cleanup removed.
