# Grader evidence and action trace — astra-snapback4 (snapback4-0.2.9)

Sanitized trace of one independent grading session. Credentials (fixture passwords, grader-generated passwords,
session bearers, the pusher service token) and account principals are redacted or never printed. Grader-created
accounts use random throwaway handles on the reserved `.invalid` domain. Raw transcripts are not published.

- Grader: family `claude`, model `claude-opus-5`; different family from the builder.
- Wave `full-3models-astra`; run scope `full`; N=1 calibration, not claim-eligible.
- Frozen prompt: `instrument/grader/grader-prompt.md`. Assertions: `instrument/schema/social-messenger/assertions.json`
  (manifestVersion 0.3.0-m8, sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`).
- Session start epoch 1789379079.

## Recorded deviations from the frozen protocol

1. **No holdout probe set was committed for this wave.** Execution-order phase 4 was skipped.
   `wave.probeSetSha256 = "none-uncommitted"` and `probeResults` is empty. No probes were invented. The API and
   browser checks below are checklist re-execution and defect exploration, not holdout probes. They do not feed O3/O5.
2. **This grader family has not passed the calibration gate** (`calibration.md`): `calibrationPassed=false`,
   `sameFamilyGraded=false`. The record carries the label `uncalibrated-grader`.
3. **Timing-sensitive checks are judged best-of-3, with host load recorded.** Other sessions share this host; the
   1-minute load average stayed between about 15 and 27 throughout (79 logged-in users).
4. **The frozen schema holds only 101 IDs, and prior waves only measured those 101.** The frozen
   `grader-report.schema.json` allows only `^m[1-7]-a[0-9]{2}$` IDs. The manifest has 119 unique assertions (101 for
   M1–M7 plus 18 for M8).
   - `grader-report.json` carries exactly the 101 IDs in `GRADER_ASSERTIONS_101.txt`.
   - The 18 M8 results are in `m8-assertion-results.json`, using the same record shape.
   - No ID appears in both files.
   - Measurement-coverage gap: the actual September 5 and September 12 structured `assertionResults` carried only
     those 101 IDs. Their notes could describe M8 observations, but they did not provide a machine-comparable 18-ID
     M8 result set. The M8 file here is therefore the first comparable M8 partition. Prior-101 subtotals remain
     comparable; M8 and 119-result totals have no structured predecessor.
5. **No run record.** `run-record.json` is absent from the lane. Grading used the lane's receipts
   (`evidence/milestones.json`, `evidence/m*-suite.json`, `m*-coverage.json`, `m*-choreo.jsonl`,
   `scale-*.json`) and this session's independent execution.
6. **O3 is recorded null even though its applicability predicate holds** (M6 web-green, M1–M5 attempted).
   `applicability.json` says O3 is scored from the wave's rotated holdout probes only. None exist (deviation 1), so no
   admissible input exists. Checklist trust results are reported per assertion instead.

## Contamination statement

None of the excluded artifacts were opened: `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`, `run-log.md`,
and every other lane. Two lane source files did reach this session incidentally:

- A `grep` for port literals displayed one line of `scripts/write-report.mjs`. That is a lane source file that
  templates builder report prose: a list of limitations, with no scores.
- The allowed lane `README.md` refers to the run log.

No self-scores or transcript reached the grader, and neither exposure was used as evidence. The session is not
treated as contaminated: `grader.contaminated=false`.

## Environment, isolation, and processes

- Host: macOS arm64; Node 24.18.0.
- Ports used: 49320 (backend) and 49321 (web) only. The lane's retained scale store was inspected offline through a
  clone; no server was started for it.
- **Grading workspace.** `grading/work` is an APFS clone of the lane's source tree: app, snapback, src, scripts,
  config, ui, lib, public, tools, node_modules, package files, API.md, README.md, adapter and setup identity. It is
  equivalent to a clean checkout plus installed dependencies. It excludes the builder's `.snapback4` store,
  `.scale-*`, `.proof`, `evidence`, `artifacts`, `.expo`, and all excluded narrative files. `instrument` is a
  symlink to the read-only instrument. A fresh backend store was created.
- **Shortened configs.** Lane `config/*.json` files are byte-identical to `instrument/fixtures/config/*.json`.
  `CLIQUE_WINDOWS_CONFIG=config/windows.shortened.json CLIQUE_DIGEST_CONFIG=config/digest.shortened.json node
  scripts/configure.mjs` generated `editWindow 60000`, `deleteWindow 120000`, `24h→180000`, `7d→300000`,
  `digestPeriod 120000`, and `schedule dailyDigest every 2m`.
- **Processes started by this session** (the only PIDs signalled at the end):
  - backend `node node_modules/snapback4/bin/snapback4.js dev --port 49320`: PID 32109 (listener child 32129)
  - web `CI=1 node node_modules/expo/bin/cli start --web --port 49321`: PID 32114
  - push worker `node scripts/push-worker.mjs`: PID 34491, using a freshly minted `service:pusher` token stored
    mode 0600 in the workspace, redacted
  - backend restarts during the digest probe: see [digest-probe](#digest-probe)
- **Harness.** The frozen `instrument/choreography` (0.3.8-m8) runs from a clone of the whole instrument tree at
  `grading/instrument-copy`, so its relative imports (`../metering`, `../record-validator.mjs`, `../../lib`) resolve.
  The run-root `lib/json-schema.mjs` sits beside `grading/instrument-copy`. `npm install` provided Playwright 1.62.1
  and AJV 8.20.0; cached chromium-1243 was used.
  - The lane's own `tools/choreography` is byte-identical to the frozen harness, apart from node_modules.
  - The lane's `lib/json-schema.mjs` is a 377-byte AJV-2020 portability bridge, not the instrument's 7.7 KB
    validator. It is a real validator, not a no-op, and it only affects the builder's own setup-identity validation.
- **Harness setup failures (grader tooling, not lane defects).** Three choreography launches refused at module
  resolution before any browser, credential or receipt step (`ERR_MODULE_NOT_FOUND`):
  - `../metering/observations.mjs` was missing, twice. The second time a zsh word-splitting bug in my copy loop left
    the sibling directories uncopied.
  - `../../lib/json-schema.mjs` was missing once.

  After the whole-tree clone, a static import walk found 6 modules with 0 missing, and the phase ran once to
  completion. Separately, my first API-probe script invalidated its own fixture session with `logout-all`. It was
  fixed and re-run in full (`rerunsUsed: 1`).

## Phase 1 — builder suite

Command, per milestone, from `grading/work`: `node scripts/acceptance.mjs --milestone mN`, equivalent to
`npm run acceptance -- --milestone mN`. It ran against the fresh shortened-config backend and web client. Each suite
reseeds its installed starter segments through the app's own write path.

| Milestone | Start epoch | Wall | Load (1 min) | Result | Missing coverage |
|---|---|---|---|---|---|
| m1 | 1789379401 | 3 s | 26.96 | pass (6 tests) | none |
| m2 | 1789379404 | 4 s | 26.96 | pass (7 tests) | none |
| m3 | 1789379408 | 3 s | 25.77 | pass (5 tests) | none |
| m4 | 1789379411 | 2 s | 24.50 | pass (5 tests) | none |
| m5 | 1789379413 | 4 s | 24.50 | pass (6 tests) | none |
| m6 | 1789379417 | 40 s | 25.18 | pass (3 tests; includes the 36 s closed-recipient wait) | none |
| m8 | 1789379457 | 112 s | 19.22 | pass (4 tests) | none |

Every suite-required assertion of M1–M6 and M8 maps to a passing test (`suiteResult: pass`). Receipts are under
`grading/work/evidence/m*-suite.json` and `m*-coverage.json`. M7 has no suite; the entrypoint refuses with
`Milestone suite not authored`.

## Coverage spot-verification

I read the mapped test bodies (`scripts/acceptance.mjs`, `scripts/m{2,3,4,5,6,8}-tests.mjs`,
`custom-client-demo.mjs`, `replay.mjs`, `trending-expiry-proof.mjs`) and sampled these mappings:

| ID | Verdict | What the mapped test does |
|---|---|---|
| m1-a03 | honest | UI signup with a duplicate handle; waits for `sm-auth-error` containing `HANDLE_TAKEN`. |
| m1-a11 | honest | Picks the fixture avatar through the file chooser, saves, and waits for a loaded `<img>` inside `sm-profile`. |
| m2-a08 | honest | API follow then unfollow; the post is absent from `social.following`. |
| m2-a24 | honest but weak | Pages both feeds with no duplicate IDs and ≤20 per page; gap-freeness is only implied. |
| m2-a25 | honest but weak | Bob still follows other starter accounts, so "follows no accounts" is not exercised. The grader verified it independently (below). |
| m3-a11 | honest but weak | Clicks `sm-convo-quote-preview` and checks the original is visible, which may already be on screen. The frozen harness's in-viewport jump check passed 3/3. |
| m3-a15 | honest | Snapshot of inbox, history and global feed for three personas; re-runs all installed seeds; compares. |
| m4-a09 | non-discriminating | The edited caption text contains the word "edited", so `/edited/i` would match without a label. The frozen harness has the same property (edit body `…-edited`). The grader verified the label with a neutral body and it renders, so the mapping does not misrepresent the behaviour. |
| m5-a05 | honest | Second open: `GET /assets/ID` returns 410, no viewer image, and the affordance reads `opened`. |
| m6-a08 | honest | Waits 36 s for Bob's sessions to lapse, then checks four logged payloads (text, photo, video, once) by target, chat, sender and preview. |
| m6-a11 | honest | The demo authenticates, lists the inbox, pages history, sends, long-polls `/changes`, and re-queries. |
| m6-a13 | honest | The fixture validator on `sample-50.log`, then replay: 50 settled, 13 verbs, spot-checked entities. |
| m8-a01 | honest | `analytics.insights` totals are compared with independent SQL counts; six total nodes are rendered. |
| m8-a06 | honest (mechanism proof) | An isolated project copy inserts a 48 h-old, 9,999-like ranking plus a fresh post; `analytics.trending` returns only the fresh post, via the same table, query and `expire at` rule. |

Verdict: **honest**. No mapping claims an observable its test does not exercise. The weak or non-discriminating
mappings (m2-a24, m2-a25, m3-a11, m4-a09) were each re-verified independently and the behaviour exists. No milestone
is adjudicated `capability-failure`.

## Phase 3 — choreography

Command: `grading/instrument-copy/choreography/choreography.mjs all --adapter grading/work/choreo-adapter.json
--suite-status grading/work/evidence/suite-status.json --setup-identity grading/work/setup-identity.json
--lane-run-id grader-astra-snapback4-20260914 --receipts grading/receipts/choreo-all.jsonl`.

- Base URL: `http://127.0.0.1:49321`.
- Persona passwords were supplied through environment variables from `personas.json` (redacted).
- Run window: 1789379915 → 1789380257; load 18.8 at start, 19.7 at end.
- Receipts: `grading/receipts/choreo-all.jsonl`, plus `.observations.jsonl`.

| Segment | Green | Checks (attempt pass:duration ms; metrics) |
|---|---|---|
| m1 | yes | profile-edit-live-visibility 1243/1318/1272; session-persists-on-relaunch 742; logout-remains-signed-out-on-relaunch 1065 |
| m2 | yes | feed-text 822/260/137; feed-image 342/282/347; feed-video 274/334/302; follow-unfollow-live-projection 1989/2342/2112 (followVisible 777/899/815); feed-author-avatar-and-display-name; like-unlike-live-count 471/227/202; repost-toggle-live-attribution 200/190/211; repost-following-feed-surface; reply-live-thread-projection 552/525/556 |
| m3 | yes | dm-live-messages visible 385/460/365; sender-avatar-identity-when-rendered (executed, pass); typing visibleAfterLastKeystroke 16.3/13.9/17.6, expiresAfterLastKeystroke 3817/3810/3815 (typing action 1840–1985); receipt-sent-delivered-read-transitions (single attempt, pass); group-receipt-waits-for-slowest-member; member-add-promote-remove-leave-and-live-cutoff; quoted-reply-excerpt-and-jump 3/3 |
| m4 | yes | photo-message-live-render visible 930/911/532; video-message-live-playback; reaction-live-replace-remove visible 534/906 and attempt 3 timed out at 10.7 s; edit-live-visibility visible 296/275/269; delete-live-tombstone |
| m5 | yes | chat-color-background-sync visible 291; view-once-single-view-and-refusal; warm-offline-search-over-synced-messages; disappearing-message-expiry-and-purge (189 s) |
| m6 | **no** | offline-message-queue-flush-in-order (bestOf 1) failed: `locator.waitFor` 10 s timeout waiting for the `…-m6-offline-1` bubble. Re-runs: see [m6-reruns](#m6-reruns). |
| m8 | yes | m8-a02-insights-like-refresh (likes 10→11, refresh 444 ms); m8-a13-same-account-message-live visible 713; m8-a14-cross-device-read-state clear 978; m8-a15-dual-offline-convergence flush 837/810; m8-a16-dual-offline-receipts |

The harness does not observe follower counts (m2-a07). Its m4 edit-label check cannot discriminate the label.
Both were verified separately below.

<a id="m6-reruns"></a>
### M6 web segment re-runs

This is the same frozen command with segment `m6`. Its single check is `bestOf: 1`, so two more independent runs
were made to judge it best-of-3. They ran after the backend was relaunched (see [digest-probe](#digest-probe)).

| Run | Window | Load (1 min) | Result | flushMs |
|---|---|---|---|---|
| all-run m6 | 1789380257 | 19.7 | failed: 10 s timeout waiting for the first queued bubble | — |
| re-run 1 | 1789380844 → 1789380847 | 14.7 | passed, segment green | 1289.4 |
| re-run 2 | 1789380847 → 1789380851 | 15.1 | passed, segment green | 1312.2 |

Receipts: `grading/receipts/choreo-m6-rerun{1,2}.jsonl`. In the passing runs both offline messages exposed `pending`,
flushed in send order, and reached `read`. The lane's own first M6 attempt (`evidence/m6-choreo-attempt1.jsonl`)
failed with the identical timeout. The result is 2 of 3: this web check does not change native M6 scoring, but it is
filed as intermittent defect d-03.

<a id="api-probes"></a>
## API probes (custom-client API per API.md; grader-created accounts)

Script `grading/probes/api-probes.mjs`, output `grading/logs/api-probes.jsonl`. Run window 1789379765 → 1789379892;
load 19.6.

- **m1-a07.** Logout gives 401 on `/probe`, on `/q/me` and on a mutation. A separate session of the same account
  stays 200. `/auth/refresh` returns 200 and the old bearer then gets 401. `logout-all` revokes the sibling session
  (401). Unauthenticated `/changes` and a bogus bearer both get 401. Sessions last 7 days.
- **Auth denials.** A wrong password, a duplicate email and a password under 8 bytes are all denied (`E_AUTH`).
- **Trust exploration (non-scored).**
  - A non-member reading DM history gets 0 rows; sending gets `NOT_MEMBER`; `search.all` and `search.inChat` get 0
    rows; roster gets 0; chat gets null; acknowledge gets `NOT_MEMBER`; configure gets `CHAT_NOT_FOUND`; react gets
    `MESSAGE_NOT_FOUND`.
  - The other DM member gets `NOT_SENDER` when editing or deleting the sender's message.
  - Stealing a handle gets `HANDLE_TAKEN`; self-follow gets `SELF_FOLLOW`; a 2001-character message gets `E_INPUT`.
  - DM start is reused, and the recipient row is untouched.
- **Receipt integrity.** The recipient acknowledged `at = now + 1 h, read:true`. A message the sender sent afterwards
  immediately reported `receipt: "read"`. → defect d-01.
- **Raw search completeness.** `search.all` for a member with one hit returned `complete:false`. → defect d-02.
- **m4-a12.**
  - Photo message: recipient GET 200 before delete; after `media.delete`, 404 for both recipient and sender.
    Non-member 404 and anonymous 401 throughout. The row is a tombstone with its photo cleared.
  - Video message: 200 → 404.
- **m5-a06.**
  - DM view-once: non-member 404; recipient 200 then 410, 410.
  - Group view-once: each of two members gets 200 then 410.
- **Admin rules.** Non-admin rename and remove get `NOT_ADMIN`. An off-palette colour gets `INVALID_COLOR`. A
  removed member's server history returns 0 rows and never includes a post-removal message.
- **m4-a10** (shortened 60 s window).
  - An in-window edit was accepted (`sent`).
  - After 66 s the edit returned `EDIT_WINDOW_CLOSED`.
  - An edit carrying caller-supplied `at`/`now` returned `E_INPUT` (HTTP 400).
  - The body kept the in-window text.
  - Delete after 126 s returned `DELETE_WINDOW_CLOSED`.
- **m2-a25.** A fresh account following nobody (counts 0/0) sees its own post in `social.following`.
- **m6-a12.** Following API.md only: paged `chat.inbox` (1 page) to `chat.name == "Weekend Plans"`. `chat.history`
  `data[0]` has the maximum `at` among 9 rows and carries every M6 field (id, conversationId, senderId, at, type,
  text, media, edited, tombstone, replyToId, reactions, receipt). The inbox `latest` matched.

<a id="push-seam"></a>
## Push seam (workspace `evidence/push.jsonl`)

- 74 lines at the time of inspection, 16 of them digest payloads, with 0 duplicate effect IDs.
- Grader-sent messages to a recipient that never connected a client were each logged exactly once:
  - text previews verbatim (all ≤80 chars)
  - `Photo` for the photo message and for DM and group view-once photos
  - `Video` for the video message
- Every non-digest payload has exactly `{chatId, preview, senderDisplayName, targetUserId}`; no preview exceeds
  80 chars.

<a id="web-expiry-probe"></a>
## Web probe — edited label and disappearing messages

Script `grading/probes/web-expiry-probe.mjs` (persistent Chromium profiles), output `grading/logs/web-expiry.jsonl`.
Run window 1789379768 → 1789379961; load 19.6 → 17.4.

- **m4-a09.** The sender edited `plainbody …` to `rewritten body …` through `sm-convo-edit`; a neutral body with no
  "edited" substring. The recipient saw it live in 57 ms. The recipient bubble text reads `… rewritten body … edited
  2:56:08 AM Reply React`, a separate label; the sender bubble also shows it. Screenshot
  `grading/evidence/m4-a09-edited-label.png`.
- **Setup.** DM `disappearing:'24h'` gives `expiresAt − at = 180000 ms`. The UI shows `Disappearing: 24h`. Before
  expiry, local search found both the expiring and the retained token. Both contexts were closed at 1789379771.8
  (expiry 1789379951.2).
- **m5-a01.** Polling every 5 s, the message left both members' `chat.history` and `search.inChat` by 1789379952.3,
  1.03 s after `expiresAt`, with no client open. The older non-disappearing message was still served.
- **m5-a02.**
  - The sender relaunched online: the expired bubble was absent and the retained message rendered.
  - The recipient relaunched with the backend blocked: the retained message rendered from the durable store and the
    expired one was already absent. It was still absent after reconnect. Screenshot
    `grading/evidence/m5-a02-offline-launch.png`.
- **m5-a03.** Offline (route blocked, context offline, `sm-search-offline` shown), search returned the retained token
  and 0 results for the expired token. Screenshot `grading/evidence/m5-a03-offline-search.png`.

<a id="follower-count-live"></a>
## Web probe — live follower count (m2-a07)

Script `grading/probes/follower-live-probe.mjs`; load 19.3. The followed account's own profile was open in a browser
(`… 0 Followers 0 Following …`). A second account followed and then unfollowed through the API, three times. With no
reload, the count went +1 in 62, 60 and 58 ms and back in 57, 57 and 57 ms. Bound: the 10 s harness observation
timeout. Screenshot `grading/evidence/m2-a07-follower-count.png`.

<a id="validation-probe"></a>
## Validation and asset-placement exploration (non-scored)

Script `grading/probes/validation-probe.mjs`, output `grading/logs/validation-probe.json`.

- **Profile bounds.** Rejected with `E_INPUT`: an uppercase or dashed handle, a 2- or 21-character handle, an empty
  or 51-character display name, a 201-character bio, a 51-character location, a non-URL link, and a `javascript:`
  link. An https link was accepted.
- **Posts.** A 501-character post gets `E_INPUT`; images plus video get `MIXED_MEDIA`.
- **Media type and size.** A PNG as a clip gets `DURATION_UNKNOWN`; an MP4 as a photo gets `E_ASSET_TYPE`; a
  text-file upload gets `E_ASSET_TYPE`; an 11 MB upload gets `E_ASSET_TOO_LARGE`; a 501-character media caption gets
  `CAPTION_TOO_LONG`.
- **Asset placement.**
  - Placing an already-placed asset in a second message gets `E_ASSET_PLACED`.
  - The DM recipient re-homing the sender's private photo asset into a public post gets `E_ASSET_UNKNOWN`.
  - An outsider doing the same gets `E_ASSET_UNKNOWN`, and the outsider's GET returns 404.
- **Groups.** A 51-character name or 201-character description gets `E_INPUT`.
- **Search and social rules.**
  - People search `CAR` finds carol; mid-word `arol` does not, which is allowed.
  - A self-DM gets `SELF_DM`; reposting a reply gets `REPLY_NOT_REPOSTABLE`.
  - Reposting one's own post is accepted, and Following then holds 2 entries for that post. → cosmetic defect d-03.

## UI crawl (O2 exploration)

Script `grading/probes/crawl.mjs`. Signed in as Erin, a starter persona not used by the choreography, and visited
`/`, `/?feed=trending`, `/chats`, `/profile/erin`, `/profile/alice`, `/profile/edit`, `/insights`, `/search` and
`/settings`. Every route rendered, with 0 page errors and 0 console errors. Screenshots are
`grading/evidence/crawl*.png`.

<a id="source-inspection"></a>
## Source inspection

- **m1-a12.** `snapback/schema.q` declares `use identity password`, Snapback's built-in password identity. The
  `snapback4` README documents the identity path with bounded Argon2 work. Password hashes in the builder store
  (20) and the grading store (102) are all `argon2id$v=19$m=19456,t=2,p=1`.
- **m1-a13.** I scanned the following for the fixture passwords (alice, bob, carol, dave, erin), the suite's
  acceptance password, the scale password and grader passwords, and found 0 occurrences:
  - builder `.snapback4/store.sqlite`, `-wal` and `-shm`
  - grading store `.snapback4/store.sqlite`, `-wal` and `-shm`
  - builder `evidence/backend*.txt`, `web.log` and `scale-backend.txt`
  - grading backend, web and worker logs, and `push.jsonl`
  - all seven iOS Hermes bundles

  The web client keeps only the session bearer (`localStorage`, documented opt-in); native uses SecureStore.
  Fixture credentials appear only in lane test scripts, which are a test-fixture exception outside the app.
- **Server-side enforcement read from source.**
  - Edit and delete windows compare `now - msg.at` against generated config.
  - Disappearing TTL is set from `now` at send.
  - `messages`, `typing` and `rankings` use `expire at`.
  - Receipt aggregation uses send-time `recipients` filtered by `member.at <= m.at`.
  - Push emission is skipped under `replayMode()`, and the digest job returns early under it.
  - `chat.acknowledge` takes caller-supplied `at` and applies `max()` without clamping to server time (d-01).

<a id="native-artifacts"></a>
## Native (simulator) artifacts — sole basis for m6-a01..a07, m8-a17/a18 and O4

- Searched the lane (excluding node_modules and the instrument): no `*.mp4` recordings except the fixture copy, no
  `*ios-receipts*`, and no `*ios-run.json`.
- `artifacts/m{1..6,8}-ios` contain only `expo export` Hermes bundles, assets and metadata.
- `.proof/device-preflight` is empty. `evidence/process-device-preflight{,3}.txt` show the native device path
  throwing `TypeError: Cannot read properties of undefined (reading 'replace')` in `snapback4/dist/native.js`.
- The builder's M6 and M8 segment summaries both record `supplementalExternal` `ios-simulator-m6` and
  `ios-simulator-m8` as `pass:null, status:"not-recorded"`.
- `evidence/m8-durable-web-proof.json` is a browser-profile restart proof with `nativeClaim:false`; it is not
  admissible as native evidence.

Result: m6-a01..a07 and m8-a17/a18 are not passed. The absence is disclosed honestly by the lane.

<a id="digest-probe"></a>
## Digest probe (m8-a08..a12)

The shortened digest config uses a 120 s period, scheduled `every 2m`. The probe personas never opened a client.
Payloads were read from the push-seam log `grading/work/evidence/push.jsonl`. Counts below are
`[newFollowers, newPostsInFollowing, unreadMessages, unreadChats]`.

**First probe** (`grading/probes/digest-probe.mjs`, output `grading/logs/digest-probe.jsonl`). Period
P = 1789380480000.

- **Setup, before P.**
  - Personas R, S, O, D, X were created.
  - R follows S.
  - Chats: a DM S–R, a DM S–O, a group S+R+X, and a group S+O+X that R is not in.
- **Activity, 3 s into P.**
  - O follows R.
  - S makes 2 top-level posts.
  - S sends 2 messages in the S–R DM, plus 1 more that was then deleted (tombstone).
  - S sends 1 message in each of the S+R+X group, the S–O DM, and the S+O+X group.
- **Restart 1** at P+60 s, after the activity and before emission. Killed 32129 and 32109; new PID 28221; down
  264 ms.
- **m8-a08.** At P+145 s there was exactly one digest each for R `[1,2,3,2]`, X `[0,0,2,2]` and O `[0,0,2,2]`. This
  equals the expected counts. `periodEnd = P+120000`; first emission came 647 ms after the period ended.
- **m8-a09.** Dormant D got 0 digests. S got 0 for P; S's only digest was the earlier period, for R's follow.
- **m8-a12.** R's unread counts exclude the S–O DM and the S+O+X group, each of which carried one unread message in
  P. The tombstoned message was also excluded.
- **Interruption.** The previous session's teardown killed the probe and its backend (28221) before the P+1 checks.
  The backend was relaunched at 1789380816 (PID 74109). Afterwards, `push.jsonl` showed no re-emission for P and no
  P+1 digests for the probe personas. Because the backend was down for part of P+1, that is not used as quiet-period
  evidence.

**Follow-up probe** (`grading/probes/digest-followup.mjs`, output `grading/logs/digest-followup.jsonl`). Period
Q = 1789380960000.

- **Setup and activity.** R follows S, with a DM S–R. 3 s into Q, S makes one post and sends one message; dormant D
  does nothing. At Q+140 s there was exactly one digest for R `[0,1,1,1]` and none for S or D.
- **Restart 2** at Q+175 s, mid Q+1, after Q had emitted. Killed 74118 and 74109; new PID 24899; down 287 ms.
- **m8-a10.** At Q+265 s, quiet period Q+1 had emitted 0 digests for R, S and D.
- **m8-a11.** After all three relaunches, Q still has exactly 1 digest for R, and P still has exactly 1 each for R, O
  and X (none for S or D). Combined with restart 1, which fell before P's emission, no user's digest was ever emitted
  twice.
- **Worker.** The push worker logged one `fetch failed / other side closed` at the moment of restart 1, then
  reconnected and kept delivering.
- **Scheduler behaviour.** Backend logs show `schedule dailyDigest fired / job daily done` once per period, plus one
  run immediately after each relaunch.

## Scale replay (O5 input)

- **Lane replay record** (`evidence/scale-run.json`): `scale.log` digest `b26bf1ae…abba9` (matches the manifest
  pin), 167,157 actions, 167,243 settles including starters. Wall 801.2 s, of which 43.3 s was excluded probe time
  (replay 758.0 s). `pass:true`, all 13 verbs.
- **Lane checkpoint verification** (`scale-verify-{10,50,100}.json`): at each checkpoint, all entity counts, every
  per-chat count, every user follow count, 100-conversation API paging, the exact 50-member roster, and full paging
  of the busy chat pass.
- **Failed earlier attempts.** `attempt1`/`attempt2` receipts record lost backends during admin CLI overlap. The
  final run completed.
- **Grader re-verification** on an APFS clone of the retained final store (`.scale-1789377083020`), read-only
  `snapback4 sql`:
  - u0500: 500 follows, 100 conversations. u0005: 5 follows.
  - u0900: 900 followers, 200 top-level posts. u0901 follows exactly u0001, u0002, u0003, u0004 and u0900.
  - g0001: 50 members, 10,000 messages.
  - Entity counts: profiles 1008, follows 5921, posts 50228, top-level 48224, likes 5008, reposts 1004,
    conversations 1002, memberships 2053, messages 100015, quoted 2736, reactions 2000, media messages 910. These
    are identical to `invariant-manifest-combined.json`.
- **Degradation rules** from the lane's probes (`evidence/scale-probes.json`; k=20 after warm-up; p95 ms at
  10% / 50% / 100%):

  | Rule | 10% | 50% | 100% | Check | Result |
  |---|---|---|---|---|---|
  | History page 50 vs page 1 | — | — | page 1: 24.1, page 50: 25.6 | ≤3× (72.3) | ok |
  | Following, 500-follow vs 5-follow | — | — | 8.9 vs 4.2 | ≤3× (12.6) | ok |
  | Celebrity-follower feed vs 5-follow | — | — | 4.5 vs 4.2 | ≤3× | ok |
  | Celebrity write vs ordinary write | — | — | 3.7 vs 3.1 | ≤3× | ok |
  | Global search | 64.0 | 39.1 | 36.4 | 100% ≤3×10%; 50% on or below the 10–100 line (≈51.7) | ok |
  | Insights | 3.4 | 3.1 | 2.9 | same rules | ok |
  | Trending | 4.6 | 3.2 | 3.3 | same rules | ok |

  - Cold start for u0500 (web app, 100 conversations): authenticated-ready 10.1 s, snapshot complete, JS heap flat
    at about 19.8 MB, no timeout (`scale-cold-web.json`).
  - No receipt-aggregation stall probe exists for the 50-member group.
  - `globalSearch` returns `complete:false` (bounded).
- **Unevaluable inputs.** The brief's ceiling table and replay wall cap are still placeholders ("pilot-calibrated"),
  and no rotated probe set exists. The ceiling and cap terms of the band function therefore cannot establish the 90
  condition.

<a id="m7"></a>
## M7

`evidence/milestones.json` records M7 `not-run` ("Separate fresh session explicitly excluded"). The snapback sources
have no poll or message-count structures. All 9 M7 assertions are `not-run` and score not-passed in O1. m7-a09's
condition (previously green milestones) holds, but M7 was never attempted.

## Defects (beyond the checklist)

| ID | Severity | Milestone | Summary | Evidence |
|---|---|---|---|---|
| d-01 | minor | M3 | `chat.acknowledge` accepts a caller-supplied future `at`, so later messages report `read` before they are delivered or viewed. | [api-probes](#api-probes) receipt-future-ack; `snapback/chat.q` acknowledge |
| d-02 | minor | M5 | The custom-client `search.all` returns `complete:false` even for a single hit and at scale, so there is no exhaustive cross-chat API search. | [api-probes](#api-probes); `evidence/scale-probes.json` |
| d-03 | minor | M6 | The web offline-queue flush check failed in 1 of 3 runs (10 s timeout); the builder's first attempt failed the same way. | [m6-reruns](#m6-reruns) |
| d-04 | cosmetic | M2 | Reposting one's own post is allowed and shows the post twice in the author's feeds. | [validation-probe](#validation-probe) |

No blocker or major defect was found.

## O-dimension scores

| Dim | Score | Anchor cited | Basis |
|---|---|---|---|
| O1 | 72 | Between 60 ("M1–M4 solid, later milestones patchy or failed on cap") and 90 ("every in-scope milestone green, including platform-proof artifacts") | M1–M5 79/79. M6 6/13, all 7 native assertions not passed. M7 0/9, not-run. M8 16/18, both misses native. Totals: 85/101 on the prior-101 IDs; 101/119 on all 119. |
| O2 | 78 | Between 60 ("a few medium defects off the happy path") and 90 ("only cosmetic nits") | Three minor defects and one cosmetic; no blocker or major. |
| O3 | null | — | Only admissible input is the rotated holdout probe set, which was not committed (deviation 1). |
| O4 | 10 | Below 30 ("cold-start offline shows an empty or broken app") | No simulator artifact at all; the native proof demonstrates nothing; the gap is disclosed honestly; web evidence is inadmissible. |
| O5 | band 75 | Band function, first match 0/30/60/90/75 | Manifest conforms (grader re-verified); no cap exhaustion; all degradation rules pass; no probe errors; ceilings and cap are uncalibrated, so neither 60 nor 90 can be established. |

No weighted total, efficiency statistic or cross-lane comparison is computed.

## Result files

- `grading/grader-report.json` holds the 101 M1–M7 IDs from `GRADER_ASSERTIONS_101.txt`: 85 pass, 7 fail
  (m6-a01..a07, native), 9 not-run (M7). It has 13 best-of-3 timing records. It validates against the frozen
  `grader-report.schema.json` with AJV 2020 (`allErrors`), with 0 errors.
- `grading/m8-assertion-results.json` holds the 18 M8 IDs: 16 pass, 2 fail (m8-a17/a18, native). Its records validate
  against the report's per-assertion record schema. The file pins the manifest path and sha256.
- The two files do not overlap and together cover all 119 manifest assertions. Complete tally: 101 pass, 9 fail,
  9 not-run.
- Built by `grading/probes/build-report.mjs` from the receipts, probe logs and `probes/report-input.json`.

## Cleanup

At epoch 1789381266 I sent SIGTERM to the processes this session started and nothing else: backend 24899 and its
listener child 24904, web 32114, push worker 34491. Earlier backend PIDs 32109/32129, 28221 and 74109/74118 had
already been stopped by the restarts or the session teardown. Afterwards no process remained from `logs/pids.txt` and
nothing listened on 49320–49339. No `pkill` or `killall` was used.

Workspace artifacts are retained under `grading/` for audit: the cloned workspace with its grading store, the
instrument copy, the scale-store clone, logs, receipts, screenshots and browser profiles. The builder's files and
stores were not modified.
