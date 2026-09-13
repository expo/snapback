# Grader evidence and action trace: astra-snapback4 (social-messenger, full run)

Sanitized trace, and the published companion to `grader-report.json`. Credentials, session tokens, principal IDs, host names and user identifiers are omitted. Only fixture personas appear by handle. Raw session transcripts are not published. Supporting raw artifacts produced by this grader are under `grading/logs/`, `grading/logs/shots/` and `grading/work/`. None of them contains a password or token.

## §0 Session, inputs, deviations

- Grader: family claude, model claude-opus-5. Other family than the builder (a GPT-family Codex harness per the run record). Session outcome: completed.
- Frozen inputs read: `grader/grader-prompt.md` (sha256 97ce0e44…), `schema/social-messenger/assertions.json` (0.3.0-m8, sha256 e15c3952…), `applicability.json` (0.3.0-m8), `grader/grader-report.schema.json` (sha256 82d21337…), the brief `social-messenger.md`, `ENVIRONMENT.md`, `grader/calibration.md`, the fixture pack (README, configs, personas with credentials handled only in memory, starter logs, invariant manifests).
- Lane inputs read: `API.md`, `README.md`, `package.json`, `run-record.json` (present, but without milestone status or O5 input fields), source (`snapback/schema.q`, `src/*`, `scripts/*`), the coverage manifest `evidence/coverage-manifest.json`, the choreography receipts `evidence/m{1..6,8}-choreo.jsonl`, and the scale/digest/native evidence JSON listed below.
- Not opened: `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`, `run-log.md`, `gaps.md`, and any other lane. No contamination.
- Deviations (N=1 calibration wave):
  1. No holdout probe set committed, so phase 4 was skipped. `probeSetSha256 = none-uncommitted`, `probeResults = []`, and O3 is null (its only permitted basis is the rotated probes).
  2. The claude family is uncalibrated (`calibrationPassed=false`, label `uncalibrated-grader`).
  3. Best-of-3 is used for timing-sensitive checks, with `uptime` load recorded (§8).
- M7 is out of this session by `ENVIRONMENT.md`: a fresh session after grading. Its assertions are recorded `not-run`.
- Schema gap: the report schema's `assertionResults` key pattern `^m[1-7]-a[0-9]{2}$` cannot hold M8 IDs, so M8 results are in the report `notes` and §4.4/§4.5.

## §1 Environment and processes

- macOS arm64, Node 24.18.0. Playwright 1.62.1 from the lane's choreography copy, using the already-cached chromium. Nothing was written into `instrument/`.
- Clean checkout: `grading/checkout/` is an APFS clone of the lane's tracked source and installed `node_modules`. It excludes `.snapback4/` (runtime store), `evidence/`, `artifacts/`, builder narrative files, `.expo/` and the scale/digest instance directories, and starts with an empty `evidence/`. `node_modules` was cloned rather than reinstalled with `npm ci`; the lockfile is identical.
- The lane's `choreography/` copy is byte-identical to `instrument/choreography/` for every file. `scripts/instrument-loader.mjs` only redirects the missing `../../lib/json-schema.mjs` import to an AJV-based validator, which changes no assertion logic.
- Ports used (all within 49300–49319):

| Port | Role | Directory | PIDs started by grader (all stopped at end) |
|---|---|---|---|
| 49300 | lane backend `npm run backend` (shortened windows + 2-min digest via `config/active.json`) | grading/checkout | npm 31194 → sh 31277 → 31348 → snapback4 31349 |
| 49301 | lane web client `npm start` (Expo, CI mode) | grading/checkout | npm 31355 → node 31386 |
| 49302 | quiet digest instance (fresh store, starter m1–m3 seeded) | grading/digest-instance | 64220/64276; restarted by grader as 89588/89589, then 46319/46320 |
| 49303 | grader API-probe instance (fresh store, starter m1–m3 seeded) | grading/probe-instance | 65355/65415 |
| 49304 | clone of the lane's final scale store (read-only use) | grading/scale-check | 67845/67852 |

Script PIDs (they exited on their own): suite runner 63400, rerun 25845, digest probe 24163, api probes 24626, web graders 57328/19498/34733, scale check 84248. Every kill targeted a recorded PID only after `lsof` confirmed it was the listener (or its recorded parent). No pattern kills were used.

## §2 Phase 1: builder suite (documented entrypoint)

README order: `npm run seed -- --segment m1|m2|m3`, then `npm run acceptance -- --milestone mN` for m1, m2, m3, m4, m5, m6, m8 against :49300/:49301.

| Milestone | Run 1 (epoch start, load) | Result | Rerun (standalone) |
|---|---|---|---|
| m1 | 1789263613, 11.97 | FAIL: m1-a04 `waiting for sm-auth-toggle` after Log out; the other 5 tests pass | 1789264025, 20.29: same m1-a04 failure |
| m2 | 1789263633, 15.99 | PASS (11 tests) | n/a |
| m3 | 1789263637, 18.87 | PASS (5 tests) | n/a |
| m4 | 1789263639, 17.76 | PASS (5 tests, incl. uncovered "delete revokes server asset") | n/a |
| m5 | 1789263641, 17.76 | PASS (6 tests) | n/a |
| m6 | 1789263643, 17.76 | FAIL: m6-a08/a09 (no notification row for Bob) | 1789264051, 15.72: PASS |
| m8 | 1789263644, 16.66 | PASS (3 tests) | n/a |

- The m6 run-1 failure was the grader's doing. It started less than 1 s after the m5 suite closed a browser signed in as Bob, and API.md documents a 4 s connection lease for abrupt disconnects. Waiting 8 s passed. This is not a lane defect, though the suite is timing-fragile when chained.
- The m1-a04 failure reproduces and is a product defect (§4.3, d-01).
- Receipts: `grading/logs/suite-run1/*.json`, `grading/logs/suite-run2/m1-suite.json`, `grading/logs/suite-run2/m6-suite.json`, `grading/checkout/evidence/`.

## §3 Phase 2: coverage-manifest spot-verification

I sampled 17 mappings and read each mapped test in `scripts/acceptance.mjs` and `scripts/accept-m{2,3,4,5,6,8}.mjs`: m1-a03, m1-a04, m1-a11, m2-a13, m2-a16, m2-a18, m2-a24, m3-a11, m3-a15, m4-a09, m5-a05, m5-a11, m6-a08, m6-a11, m6-a13, m8-a01, m8-a06.

- **Honest (16):** each test drives the behavior and asserts its observable. Some assert at the data layer only: m2-a16 checks attribution through `actorProfile.handle` rather than the rendered label, which the grader saw rendered separately; m3-a15 checks idempotency through inbox count. m8-a06 seeds an old `hotPosts` row through the dev `/seed` endpoint, a legitimate way to get a >24 h row.
- **Dishonest (1): m3-a11.** The test `quoted excerpt renders and jumps to source` clicks `sm-convo-quote-preview` and then asserts only `sm-convo-bubble` count > 1. That is true in any seeded conversation and never observes a scroll or jump. Independent execution shows the jump does not occur (§4.3). Verdict: `dishonest`, which adjudicates M3 to capability-failure for O1 scoring only (non-retroactive). No claim about intent is made.
- Harness note: the frozen harness's supplemental `quoted-reply-excerpt-and-jump` (required:false) sends the original immediately before the reply. The original is therefore already in the viewport and its check cannot detect a missing jump.

## §4 Phase 3: independent checklist execution

### §4.1 Source inspection (m1-a12, m1-a13)

- `snapback/schema.q:1`: `use identity password`. This is the backend's built-in password identity, documented in `node_modules/snapback4/README.md` §4 "Sign-in". No hand-rolled hashing exists in lane code.
- Server persistence: `_credentials(principal, email, hash)`. All hash values in the lane store and in the grader's stores carry the prefix `$argon2id$v=19$m=19456,t=2,p=1$` (argon2id at OWASP-published parameters). `_sessions` stores `token_digest`, not tokens.
- Plaintext search: each starter fixture password was searched byte-for-byte in the lane's `.snapback4/store.sqlite` and its WAL, `evidence/*.log`, `artifacts/` (iOS Hermes bundles), `src/`, `app/` and `ui/`. The same search covered every grader-run store and log. Result: 0 hits. The web client persists only the session object (token) in localStorage and native uses SecureStore (`src/session.tsx`). Fixture passwords appear only in lane test scripts (the declared fixture exception).

### §4.2 API checks on the fresh probe instance (:49303), no clients connected

Log: `grading/logs/api-probes.jsonl`. All run 1789263990–1789264259, load ≈ 14–20.

| Check | Observation | Verdict |
|---|---|---|
| m1-a07 | Logged-out token: `/q/me` 401 E_AUTH and mutation 401 E_AUTH; the same user's other session still 200; session lifetime 2160 h | pass |
| M1 validation | 7-char password refused; duplicate email refused; handle uppercase/short/long/space refused E_INPUT; duplicate handle E_CONSTRAINT; displayName, bio, location and link bounds enforced | pass |
| Cross-user DM (carol vs d-alice-bob) | history/searchMessages/typingIn/roster return empty; message/conversation null; apiHistory/unread MEMBERSHIP_REQUIRED; receiptState/reactions NOT_FOUND; send/react/edit/delete/ack/configure/typing/removeMember refused; 0 foreign rows in carol's syncedMessages; original intact | no defect |
| Push seam | Text preview = first 80 chars; target, chatId and sender display name correct; captioned photo "Photo", video "Video", view-once "Photo"; carol sees none of Bob's rows | pass (m6-a08/a09) |
| Non-member asset | recipient 200, non-member 404, anonymous 401 | no defect |
| m5-a06 view-once | recipient 200, then 410, 410; sender 200 (not counted); non-member 404; 6 concurrent first fetches: one 200, five 410 | pass |
| Observation: Range | `Range: bytes=0-9` returns 206 and consumes the view (next GET 410) | noted, not filed |
| m4-a12 | photo+video 200 before delete; after delete-for-everyone 404 for recipient and sender; tombstone deleted=true, body empty, media null; non-author delete NOT_AUTHOR | pass |
| Deleted text in seam log | notification row still holds the deleted message's text preview | d-03 |
| Idempotency/validation | two like-set intents → likes 1; same reaction twice stays set; SELF_FOLLOW; 2001-char message and 501-char post E_INPUT; mixed image+video MEDIA_MIX; injected `at` argument E_INPUT; empty text post and empty message accepted; `postStats.reposts` = 2 after one repost | d-05, d-07 |
| Removed member / non-admin | carol saw the pre-removal message; non-admin remove/add/promote/rename/disappearing refused ADMIN_REQUIRED (colour-only change allowed); after removal carol's history is empty, apiHistory MEMBERSHIP_REQUIRED, new message null, send/react refused, no notification; aggregate receipt excludes the removed member (read = 2 after Bob read) | no defect |
| m6-a12 (API.md only) | `/auth/login` → paged `inbox` → conversation titled "Weekend Plans" → `apiHistory {c:null}` → newest row `sm0015`, which is the first row of the page. API.md names neither raw row fields nor page order, but both were evident from one response | pass |
| m4-a10 | edit within window sent (edited flag); non-author edit NOT_AUTHOR; edit at +66 s EDIT_WINDOW; edit with injected `now`/`at` args E_INPUT; body unchanged; delete at +126 s DELETE_WINDOW | pass |
| Dev `/seed` | unauthenticated POST /seed → `{seeded:1}`; the row appears as another user's post | d-04 |
| m5-a01 | DM set to `24h` (TTL 180 000 ms in shortened config); text + photo readable and asset 200 before expiry; at first poll after expiresAt (+11 ms) absent from history/apiHistory/message for both parties and asset 404; pre-change message has no expiry and survives; react/edit on expired message NOT_FOUND; seam log still has the text preview (d-03) | pass |

### §4.3 Web automation (:49301 → :49300)

Logs: `grading/logs/web-grader{,2,3,4}.jsonl`. Screenshots: `grading/logs/shots/`.

- **Logout (d-01, related m1-a04/m1-a06).** Five attempts (3 sign-up with avatar, 1 sign-up without avatar, 1 fixture login as frank) ran at load 8.7–11.8. After clicking `sm-settings-logout` the page body became empty and `sm-auth-toggle` never became usable within 30 s. In one attempt it appeared for 34 ms, then the page blanked. Page error each time: `Cannot read properties of null (reading 'token')`. `shots/logout-fixture-frank-stuck.png` shows the Expo "Uncaught Error" overlay at `src/presence.tsx:15`, called from `close` (line 24) in the effect cleanup (line 34) after `signout` cleared the session. The server token was revoked (401 after UI logout). A manual reload shows the sign-in screen.
- **m1-a04 from a fresh page.** 3/3 attempts at load 10.9: sign-up with an existing email shows `sm-auth-error` "E_AUTH: E_AUTH: that email already has an account; sign in instead" and stays on auth (text quality: d-06). The duplicate-handle error text is "E_CONSTRAINT: profiles already has a row where handle = alice" (`shots/dup-handle.png`).
- **m5-a02/m5-a03 (disappearing on d-alice-bob, 180 s TTL).** Two persistent Bob browser profiles, P (kept connected) and Q (closed before expiry). Load 13.7.
  - The new message appeared live on P in 205 ms. In-chat search found the unique word on both clients before expiry.
  - P purged the bubble 2625 ms after expiresAt, and the server row was absent.
  - Q, relaunched 10 s after expiry, never rendered the expired bubble (93 samples over 10 s, first bubble at 572 ms, still signed in).
  - Both clients went offline after syncing: the expired word returned 0 hits, the seeded control "Coffee after work?" returned 1, and the offline banner was present.
  - Disappearing mode was reset to off afterwards.
- **m2-a07 (follower count live).** Not covered by the harness, so the grader measured it. Alice sat on `/profile/alice` while Bob set a follow via the API: `sm-profile-follower-count` incremented without refresh in 31.1 / 32.5 / 29.4 ms (load 9.29). Each follow was cleared between attempts and the starting state restored.
- **m3-a11 (quote jump).** A group was set up with an original, 25 later messages, then a reply quoting the original. Viewport 900×600, load 13.5.
  - The reply's excerpt rendered correctly. Before clicking, the original bubble was off-screen.
  - After clicking `sm-convo-quote-preview` the original was still off-screen: summed scroll offset went 2927 → 3495, moving away from it (`shots/quote-jump4-group-offscreen.png`).
  - The DOM contains 0 `[data-message-id]` nodes (27 bubbles), so `onPressQuote`'s `document.querySelector('[data-message-id=…]')` (`src/chat.tsx:346-351`) cannot find its target.
  - In the builder-suite scenario the original is already on screen, so no jump is observable there.
  - Verdict: fail.
- **Screens (alice).** Feed (Following/Global/Trending), chats, DM, group and group settings, Insights (six totals, seven day rows with zeros), profiles, thread, search, new chat, settings: all rendered. The Global feed shows "↻ Reposted by Sample Cora". The DM header reads "Conversation" (d-08).

### §4.4 M8 digest on the quiet instance (:49302), no clients open

Log: `grading/logs/digest-probe.jsonl`. Shortened config: 120 s periods anchored at 00:00 UTC.

- **Seed period (start 1789263600000).** Exactly one digest per persona. Counts equal the grader's independent computation from `starter-m2.log`/`starter-m3.log` when the target's own posts count toward newPostsInFollowing: alice 4/9/9/2, bob 2/9/10/2, carol 1/6/5/1, dave 1/6/0/0, erin 1/9/0/0, frank 1/6/0/0, grace 2/6/0/0, henry 0/9/0/0 (newFollowers/newPostsInFollowing/unreadMessages/unreadChats). Counting own posts is consistent with the brief's implicit self-follow ruling, so it is not filed as a defect. No duplicates.
- **Controlled period P (1789264080000).** Actions finished 3.2 s into the period: dave follows grace; carol posts once; alice sends 2 DM messages to bob; bob creates a private group with carol, adds dave, sends 3 messages, then removes dave. Digests: alice 0/1/0/0, bob 0/0/2/1, carol 0/1/3/1, grace 1/0/0/0. dave, erin, frank and henry got none (m8-a09, m8-a12, including the removed member's unread being excluded). Stable 20 s later.
- **Quiet period P+1 (1789264200000).** Zero digests (m8-a10).
- **Period P3 (1789264440000).** erin follows bob; alice messages bob; the grader killed and restarted the backend 50 s into the period. Bob received exactly one digest (1/0/1/1), unchanged after the next boundary (m8-a11).
- **Observation, period P4 (1789264800000).** Bob messaged alice; the backend was killed 3 s before the boundary and was back 0.85 s after it. Exactly one digest for alice (0/0/1/1): none lost, none duplicated.

### §4.5 Choreography receipts (builder session, frozen harness v0.3.8-m8)

All segment summaries show `green: true` with suite receipt hashes. Check → assertion mapping and outcomes:

| Assertion(s) | Harness check | Outcome / timings (ms) |
|---|---|---|
| m1-a05 | session-persists-on-relaunch | pass |
| m1-a06 | logout-remains-signed-out-on-relaunch | pass (relaunch; see d-01) |
| m1-a09 | profile-edit-live-visibility | pass, best-of-3 visibleMs 708.4 / 706.9 / 712.3 |
| m2-a04 | feed-{text,image,video}-post-live-update | pass; text 114.8/193.9/104.6, image 122.8/170.5/167.2, video 100.1/132.7/209.5 |
| m2-a05 | feed-author-avatar-and-display-name | pass |
| (m2 follow projection) | follow-unfollow-live-projection | pass (attempts: fail, 385.4, 413.2); does not observe follower count, so m2-a07 was measured by the grader |
| m2-a14 | like-unlike-live-count | pass 61.2/110.2/71 |
| (m2-a16/a18 UI) | repost-toggle-live-attribution, repost-following-feed-surface | pass |
| m2-a19 | reply-live-thread-projection | pass 56.7/60.6/56.1 |
| m3-a01 | dm-live-messages | pass 405.3/1040.7/1605.7 |
| m3-a02 | sender-avatar-identity-when-rendered | pass (implemented) |
| m3-a06/a07 | typing-indicator-within-2s-expires-within-5s | pass; attempts [fail, visible 24.7 / expires 3337.4, visible 14.6 / expires 3313.8] |
| m3-a08 | receipt-sent-delivered-read-transitions | pass (single attempt) |
| m3-a09 | group-receipt-waits-for-slowest-member | pass |
| m3-a12/a13 | member-add-promote-remove-leave-and-live-cutoff | pass (no live delivery after removal; retained pre-removal bubble exactly once) |
| (m3-a11 supplemental) | quoted-reply-excerpt-and-jump (required:false) | pass, but not diagnostic (§3) |
| m4-a02 | photo-message-live-render | pass 586.5/650.6/416.1 |
| m4-a04 | video-message-live-playback | pass |
| m4-a05 | reaction-live-replace-remove | pass 389.6/340.6/497.4 |
| m4-a08 | edit-live-visibility | pass 833.2/823/855.9 |
| m4-a11 | delete-live-tombstone | pass |
| m5-a07 | chat-color-background-sync | pass |
| m5-a12 | warm-offline-search-over-synced-messages | pass |
| (m5 supplemental) | view-once-single-view-and-refusal, disappearing-message-expiry-and-purge | pass |
| m6 web | offline-message-queue-flush-in-order | pass (flushMs 296.7) |
| m6-a01..a07 | ios-simulator-m6 | **not-recorded**: no native artifact |
| m8-a02 | m8-a02-insights-like-refresh | pass (110 → 111) |
| m8-a13 | m8-a13-same-account-message-live | pass (663.2) |
| m8-a14 | m8-a14-cross-device-read-state | pass (345.3) |
| m8-a15 | m8-a15-dual-offline-convergence | pass |
| m8-a16 | m8-a16-dual-offline-receipts | pass |
| m8-a17/a18 | ios-simulator-m8 | **not-recorded**: no native artifact (the lane's web-context restart proofs are not the native artifact class) |

The `artifacts/m{1..6,8}-ios/` directories contain Expo iOS Hermes bundle exports only, with hashes in `evidence/native-artifacts.json`. They are build artifacts, not simulator recordings.

### §4.6 Scale replay and O5 inputs

- Lane replay evidence (`evidence/scale-result.json`, `scale-verify-{10pct,50pct,final}.json`): a fresh instance, 167,157 settled actions, replay wall 512.21 s, push/digest suppression on, every checkpoint `pass` with actual = expected across 18 corpus counts. The builder's verifier (`scripts/verify-scale.mjs`) pages complete API state and checks named spots and O5 fixtures.
- Grader spot-check on a clone of the lane's `scale-final` store (:49304, `grading/logs/scale-check.jsonl`, load 25.7):
  - u0500 follows 500 and belongs to 100 conversations; u0005 follows 5.
  - u0900 has 900 followers and 200 top-level posts; u0901's following list matches exactly (5).
  - g0001's roster matches exactly (50), and full history paging returned 10,000 messages with 0 incomplete pages.
  - All matched.
- Lane performance record (`evidence/scale-performance.json`, k=20 after 3 warm-ups, posture "local persistent Snapback4 dev binary, loopback HTTP"):
  - history page1 p95 1.26 vs page50 0.74 (ratio 0.58): pass.
  - following u0500 39.48 vs u0005 2.06: **19.2× (fails ≤3×)**.
  - celebrity-follower u0901 1.85 vs u0005 (0.90×): pass.
  - Insights p95 1.74 / 0.91 / 0.56 and Trending 1.79 / 0.88 / 0.88 at 10% / 50% / final: pass.
  - Global-search checkpoint and celebrity write were not measured.
  - `evidence/scale-cold-sync.json`: u0500 cold initial sync stopped by the 30 s watchdog at 1.7 GB RSS: **timeout**.
- Grader corroboration (not an O5 input): following u0500/u0005 p95 32.78/3.37 = 9.7×; history page50/page1 0.99×; u0901/u0005 1.01×.

## §5 Phase 4: holdout probes

Skipped. No probe set was committed for wave `astra`, and none was invented. `probeResults` is empty.

## §6 Defects (beyond the checklist)

| ID | Severity | Milestone | Summary | Evidence |
|---|---|---|---|---|
| d-01 | major | M1 | Log out crashes the web client (Presence cleanup dereferences a cleared session) and leaves a blank page until reload; 5/5 | §4.3; `src/presence.tsx:15,24,34`; shots/logout-*-stuck.png |
| d-02 | major | M6 | Public tables sync to every device without a horizon; the probe user's cold initial sync cannot finish in 30 s at the envelope | §4.6; `evidence/scale-cold-sync.json`; schema.q 17/41/59/72 |
| d-03 | minor | M6 | Seam log keeps text previews of deleted/expired messages, readable and synced to the target | §4.2 |
| d-04 | minor | M6 | Only a dev posture is documented; unauthenticated `/seed` bypasses rules | §4.2 |
| d-05 | cosmetic | M2 | Empty text posts/messages accepted server-side | §4.2 |
| d-06 | cosmetic | M1 | Raw engine error strings in user-facing errors (duplicated E_AUTH prefix) | §4.3 |
| d-07 | cosmetic | M2 | API `reposts` count includes the original entry (+1); UI subtracts 1 | §4.2; schema.q:92; feed.tsx:209 |
| d-08 | cosmetic | M3 | DM header shows "Conversation" instead of the counterpart | shots/screen-dm-bob.png |

m3-a11 (quote jump) is a checklist failure, so it is reported in `assertionResults`, not as a defect.

## §7 O-dimension scoring

- **O1 = 62**, interpolated just above ~60 ("M1–M4 solid, later milestones patchy or failed on cap"), well below ~90 ("every in-scope milestone green, including platform-proof artifacts"). 86/119 assertions count as passed after the M3 adjudication (36/51 checklist items; M2 has 27 assertions, not the 24 in the manifest's `counts` block). Without the adjudication, independent execution passes 100/119. The failures are m3-a11, 9 missing native-artifact assertions, and 9 M7 not-run.
- **O2 = 48**, between ~30 ("multiple high-severity defects in core flows") and ~60 ("a few medium defects off the happy path"): 2 major (one in the core logout flow), 2 minor, 4 cosmetic.
- **O3 = null**: applicable by manifest, but its only basis (rotated holdout probes) does not exist for this wave.
- **O4 = 35**, just above ~30, below ~60. Native proof is absent for all M6/M8 simulator assertions, so cold-start reads and the durable restart are undemonstrated. The web choreography shows ordered warm-offline flush, dual-client convergence with receipts, cross-device read state and warm-offline search. The gap is honestly disclosed.
- **O5 = band 30.** First match in order 0, 30, …: 0 does not fire (manifest conformed, named fixtures verified, cap not exhausted). 30 fires (following-feed rule 19.2× > 3×; cold-sync probe timeout).

## §8 Timing records with machine load

| Subject | Measurements (ms) | Best | Bound | Pass | Load (1/5/15 min) | Source |
|---|---|---|---|---|---|---|
| m2-a07 follower count live | 31.1, 32.5, 29.4 | 29.4 | none (live, no manual refresh) | yes | 9.29 11.88 13.16 | grader web |
| m5-a02 connected purge after expiry | 2625 (single) | n/a | "within tolerance" | yes | 13.67 14.65 14.28 | grader web |
| m5-a01 server refusal after expiry | 11 (first poll past expiry) | n/a | ≤300 000 | yes | ≈14 | grader API |
| m3-a06/a07 typing | [fail], 24.7/3337.4, 14.6/3313.8 | 14.6 / 3313.8 | 2000 / 5000 | yes | not recorded (builder session) | harness receipt |
| other choreography timings | see §4.5 | | | | not recorded (builder session) | harness receipts |

Suite runs: load 11.97–18.87 (run 1), 20.29 and 15.72 (reruns).
