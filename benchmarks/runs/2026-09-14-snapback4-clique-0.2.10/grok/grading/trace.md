# Grader trace: grok-snapback4 (snapback4-0.2.10)

Sanitized evidence and action trace for the grader session (published artifact). Credentials, bearer and service tokens, and grader throwaway passwords are redacted. Persona data is fixture data. Raw transcripts are not published.

| Field | Value |
|---|---|
| Grader | family `claude`, model `claude-opus-5`, fresh session, not the builder's family |
| Wave | `full-3models-grok` (N=1 calibration run, not claim-eligible) |
| Label | **uncalibrated-grader** (`calibrationPassed=false`), `sameFamilyGraded=false` |
| Session outcome | `completed`, 0 grader re-runs used |
| Contamination | none. The builder's `diary.md`, `essay.md`, `final-report.md`, and `run-log.md` were not opened. The only view of other lanes was a directory listing of `lanes/` (names only); no other lane's files were read. |
| Outputs | `grader-report.json` (101 IDs), `m8-assertion-results.json` (18 IDs), this trace, `DONE` |

## T0. Recorded deviations from the frozen protocol

1. **No holdout probe set was committed for this wave.** Phase 4 was skipped. `wave.probeSetSha256 = "none-uncommitted"` and `probeResults = []`. No probes were invented.
2. **The grader family has not passed the calibration gate.** `calibrationPassed=false`, `sameFamilyGraded=false`, and the grade is labeled `uncalibrated-grader`.
3. **Shared-host timing.** Timing-sensitive checks are judged best-of-3, and the `uptime` load average is recorded beside each timing record (T4). Load averages ran from about 18 to 50 throughout.
4. **No `run-record.json`** exists in the lane. Grading relied on the harness receipts (`receipts/`), the lane's `acceptance/` and `replay/` files, source, and grader re-execution. Because there is no replay record with `o5Inputs`, O5 could not be band-mapped (T5).
5. **Schema/partition limitation.** The frozen `grader-report.schema.json` only admits `m[1-7]-aNN` keys. `grader-report.json` therefore carries exactly the 101 IDs in `GRADER_ASSERTIONS_101.txt` (M1–M7), and the 18 M8 results are in `m8-assertion-results.json`, with no ID in both files. **Prior measurement-coverage gap:** the September 5 and September 12 structured `assertionResults` also carried only those 101 IDs. Their notes could describe M8 observations, but they provided no machine-comparable 18-ID M8 result set. This session is the first to emit a structured result for all 119 manifest assertions (manifest `0.3.0-m8`, sha256 `e15c3952…2d04`).

## T1. Inputs and environment

- Frozen inputs read: `instrument/grader/grader-prompt.md`, `grader-report.schema.json` (sha256 `82d21337…0c30`), `schema/social-messenger/assertions.json`, `applicability.json`, `ENVIRONMENT.md`, and the brief `social-messenger.md` (rulings, scale envelope, milestones, scoring).
- Fixture integrity: the lane's `fixtures/` directory is identical to `instrument/fixtures/` (`diff -rq` shows only the instrument's `.gitignore`). The lane's `config/windows.json` and `config/digest.json` match the shortened-windows (edit 60 s, delete 120 s, TTL 180 s/300 s) and shortened-digest (120 s period) configs.
- Clean checkout: the lane's source, config, fixtures, scripts, and `node_modules` were APFS-cloned into `grading/checkout/`, excluding builder narrative files, logs, prior receipts, and acceptance outputs.
- Host: macOS arm64, Node 24.18.0. Choreography harness copied to `grading/choreography` (with its `../metering` dependency copied to `grading/metering`), `npm install`, `npx playwright install chromium`.

| Role | Port | PIDs started (all stopped at end) |
|---|---|---|
| Lane dev backend (`python3 scripts/sb4.py dev --port 49340`), wrapper / binary / push worker | 49340 | 47027 / 47049 / 47084 |
| Expo web (`EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49340 npx expo start --web --port 49341`) | 49341 | 62601 / 62622 |
| Fresh scale-replay backend (`grading/scale-checkout`) | 49342 | 79978 / 79980 / 80003 |
| Fresh M8 digest/seed backend (`grading/m8-checkout`), first start | 49343 | 63561 / 63566 / 63582 |
| Same, restarted mid-period for m8-a11 | 49343 | 16055 / 16058 / 16062 |

Every PID was checked with `ps` before `kill`. No pattern kills were used. A final `lsof` over 49340–49359 showed no listeners.

## T2. Phases 1–2 and choreography artifacts

### Phase 1: builder suite (grader checkout)

Seeded `npm run seed -- --segment m1|m2|m3`, then ran `npm run acceptance -- --milestone mN` for m1, m2, m3, m4, m5, m6, m8 (load avg ≈ 23). **All 58 mapped tests passed** (`grading/logs/suite-m*.log`); every suite-required assertion's `suiteResult` is `pass`.

### Phase 2: coverage spot-verification (verdict: dishonest for M2, M3, M4, M5, M6, M8)

`scripts/acceptance.mjs` is the only test source, and its coverage manifests are generated from the same `coverage` map.

- **Tautological `assert(true)` tests** mapped to m2-a12, m2-a13, m2-a18, m3-a11, m4-a06, m4-a07, m5-a05, m6-a09, m6-a10, and m6-a11 (for example, `assert(true, "kit linkify; no unfurl in schema")`). m2-a17 computes a filter and then asserts `true`. m8-a06 asserts `true`.
- **Tests that exercise a different observable:**
  - m2-a22/a23/a24 read one page and never scroll or pass a cursor.
  - m3-a10 runs an in-chat search, not a quote check.
  - m5-a10 and m8-a05 only check `Array.isArray`.
  - m8-a01 checks `typeof` on the query, never the screen (which crashes).
- **M1:** weak but honest. m1-a02/a03/a11 verify backend state (profile exists, `E_CONSTRAINT`, asset URL) rather than visible UI, yet each test does exercise its assertion's backend observable.
- **Divergence between the suite (pass) and independent results (fail):** m2-a12, a20, a22, a23, a24; m4-a07; m5-a04, a05, a10; m6-a11; m8-a01, a03–a07.

### Choreography receipts

Sources: the lane's receipts under `receipts/`, plus grader-run receipts under `grading/receipts/`.

Execution-time green, from the lane receipts' segment summaries: **M1 green, M2 green**. M3, M4, M5, M6, and M8 are `choreography-failed`. M6 and M8 simulator status is `not-recorded` (no native artifact). After spot-verification, M2 is adjudicated capability-failure for scoring.

The grader re-ran every segment with the frozen harness (default 10 s timeout). It re-ran M1 and M3 a second time with `--timeout 20000`, matching the lane's own timeout, as a tie-breaker.

| Harness assertion | Lane run | Grader 10 s | Grader 20 s |
|---|---|---|---|
| m1 profile-edit-live-visibility | pass (68.6 ms) | **fail 0/3** (form race, d-06) | pass (140.1 ms) |
| m1 session-persists / logout-signed-out | pass / pass | pass / pass | pass / pass |
| m2 text/image/video live, follow projection, author identity, like/unlike, repost toggle, repost Following surface, reply count | all pass | all pass | – |
| m3 dm-live-messages | pass 1/3 | pass 1/3 | **fail 0/3** |
| m3 sender-avatar-identity-when-rendered | skipped (instrument, optional) | skipped | skipped |
| m3 typing ≤2 s / ≤5 s expiry | fail 0/3 | pass 1/3 | pass 1/3 |
| m3 receipt sent→delivered→read | pass | pass | pass |
| m3 group receipt waits for slowest | fail | pass | pass |
| m3 member add/promote/remove/leave + cutoff | fail | pass | pass |
| m3 quoted-reply excerpt and jump | pass | fail | fail |
| m4 photo live render | pass (5.3 s) | pass (5.36 s) | – |
| m4 video playback / reaction replace-remove / edit live / delete tombstone | fail / fail / fail / fail | fail / fail / fail / fail | – |
| m5 color+background / view-once / warm-offline search / disappearing | pass / fail / fail / fail | pass / fail / fail / fail | – |
| m6 offline queue flush (web) | fail (error overlay) | fail (error overlay) | – |
| m8 insights refresh / same-account live / cross-device read / dual offline / dual receipts | fail / pass / fail / fail / fail | fail / pass (4480 ms) / fail / fail / fail | – |

Two notes on these runs. The disappearing check failed at `sm-chatsettings-disappearing`: the web chat-settings surface never exposes that control. The platform-proof artifacts `dist/ios-hermes-m1…m8` all contain the byte-identical `entry-1d206c4a….hbc` (3,161,955 bytes), a single build copied under every milestone name (d-24).

## T3. Phase 3: independent checklist execution

Scripts are in `grading/checkout/_grader/`; results are in `grading/evidence/`. Probe accounts were `erin`, `frank`, `grace`, `henry`, and throwaway sign-ups (password redacted), so the harness personas were not disturbed.

### T3-M1

| Check | Observation |
|---|---|
| Sign-up (API) | `ok`, kind `user`, 7-day expiry. A 7-byte password is refused (`E_AUTH`). |
| Sign-up (UI) | Lands on the feed tabs with the auth form gone. |
| Duplicate email (UI) | Visible error `E_AUTH: that email already has an account; sign in instead`. |
| Duplicate handle (UI, `grace@…` derives handle `grace`) | Visible `That handle is already taken.` Re-signing up with the same email then returns `E_AUTH`: the account was created without a profile (d-07). |
| Logout revocation | Old token: query `E_AUTH`, mutation `E_AUTH`, `/auth/refresh` HTTP 401. |
| Profile edit / avatar | Persist. Avatar bytes are fetchable by another user (200 image/png) and render as a 256-px `<img>`. |
| Profile form race (d-06) | Debug script: a field filled 32 ms after navigation reverted to the stored display name 1.5 s later, when `me` resolved. |
| Password storage | `use identity` (built-in). Store `_credentials.hash` prefix `$argon2id$v=19$m=19456,t=2,p=1` (hash body not recorded). |
| Plaintext scan | Fixture and grader passwords: 0 hits in `store.sqlite`, the WAL, lane/grader backend and Expo logs, `push-log.jsonl`, the served web bundle, and all Hermes bundles. Hard-coded only in `scripts/acceptance.mjs` and the demo default (d-27). |

### T3-M2

| Check | Observation |
|---|---|
| Post creation | Text, 2-image, and video posts all `sent` and visible in another user's Global feed with author name and avatar. The server also accepts `images` with 0 images and an images+clip mix (d-19). |
| Follow | 8 of 8 of the author's originals, including older ones, appear in the follower's Following feed. |
| Unfollow | 0 of 8 remain in Following, 8 of 8 remain in Global. A same-mutation-ID retry is replayed (`replayed:true`). Self-follow is refused (`SELF_FOLLOW`). |
| Follower count live (UI own profile + API toggles) | 71 / 72 / 60 ms. |
| Likes | 0→1→0 with idempotent double set/clear. |
| Reposts | Row attributed to `Grace Green`, author `henry`. A second set leaves 1 row. A follower who does not follow the author sees the repost in Following. Unrepost removes it everywhere, but `repostsReceived` stays 1 (d-21). |
| Replies | Reply count 0→3. A nested reply is refused (`NOT_TOP_LEVEL`). Replies are absent from both feeds. The thread API and screen order replies **newest-first** (`reply three, two, one`). |
| Implicit self-follow | A fresh user's own post and repost appear in Following; counts stay 0/0; no duplicates. |
| Pagination | API cursors: Global pages 20/20/20/8 (68 rows, no duplicates, sorted), Following 20/1. UI: 20 items before and after scrolling in both tabs, because `app/feed.tsx` never pages. |
| URL in post | Renders as `span[role=link]` with no `href`. Clicking opens no page and navigates nowhere (no `onPressLink`). No preview card. |

### T3-M3

| Check | Observation |
|---|---|
| DM reuse | Canonical pairKey from either side returns the same `existing:true` channel. A client-chosen pairKey creates a second DM for the same pair (d-18). |
| Groups | Two "Grader Trio" groups with identical members are distinct. Roles: creator `admin`, others `member`. |
| Non-admin | Remove and add both refused with `NOT_ADMIN`. |
| Member removal | The removed member's `threadMessages` returns 0 rows, the conversation read returns `NOT_MEMBER`, and her send is `NOT_MEMBER`. A non-member reading another pair's DM gets 0 rows, receipts `NOT_MEMBER`, send `NOT_MEMBER`. |
| Receipts (API) | `[false,false]` → markDelivered `[true,false]` → markRead `[true,true]`. |
| Quote | `quoteId` set, and the excerpt renders in the web bubble (`ui-checks2.json`). |
| Sender avatars | DM bubbles render none (`showSender={isGroup && !mine}`). |
| Seed idempotency (fresh instance :49343) | After the first seed: profiles 8, follows 12, posts 28, likes 8, reposts 4, timeline 28, conversations 2, memberships 5, messages 15, receipts 24. These match the starter manifest and are identical after a second run of m1, m2, and m3. The m3 re-run aborts with `group-create: E_CONSTRAINT` (d-22). |
| Web client load | `DeliverySync` polls inbox plus per-conversation receipts every 400 ms; the thread polls messages every 400 ms and typing every 300 ms (d-25). |

### T3-M4

| Check | Observation |
|---|---|
| Photo / video message | Assets serve 200 `image/png` and 200 `video/mp4`; a non-member gets 404. Video `poster` is null. |
| Reactions (server) | 👍 → ❤️ replace → `none` removes. A non-member is refused. In the app, picking the same emoji re-sends it, so a reaction is never removed (d-10). |
| Edit | `sent` with `editedAt` set. Another user's edit is `NOT_AUTHOR`, and caption edits are allowed. The UI shows the new text with an `edited` label. |
| Edit/delete windows (shortened) | Edit 65 s after send fails `EDIT_WINDOW`; delete after 120 s fails `DELETE_WINDOW`. |
| Delete-for-everyone | Asset 200 before, 404 `E_ASSET_UNKNOWN` after for both parties. The row becomes a tombstone (`deleted:true`, body/photo null). Editing a deleted message is `DELETED`. The recipient UI shows "This message was deleted" on load. |
| Conversation UI | Two messages with identical text: 2 rows via the API, **1 bubble rendered** (d-04). Bubble order is newest at the top (d-16). |

### T3-M5

| Check | Observation |
|---|---|
| Disappearing (API) | DM set to `24h` (TTL 180 s). Text and photo sent, both clients closed. About 10 s past `expiresAt`, both members' histories lack both messages, the asset returns 404, in-chat and global search return 0, and edit/react return `NOT_FOUND`. |
| Disappearing (connected UI) | With frank's conversation open, the message was still rendered at expiry +20 s and +60 s (screenshot `m5-connected-after-expiry.png`). After reload it was gone (d-12). |
| View-once (API) | First direct fetch 200; second 410 `E_ASSET_VIEWED`; `client.asset` is then denied. In the app the photo never renders. |
| Group config | Non-admin rename `NOT_ADMIN`. Non-admin accent change and **disappearing change** both `sent` (d-20). An admin background set, followed by an accent-only update, leaves the **background cleared** (d-08). |
| Search | People: `car` and `CAR` → carol; mid-word `arol` → none. In-chat `coffee`/`COF` → "Coffee after work?" (API only; no in-chat search UI exists). All-messages UI groups results under `WEEKEND PLANS` and `DIRECT`. |

### T3-M6

| Check | Observation |
|---|---|
| Push seam | For a recipient with no connected client, `push-log.jsonl` shows the correct `targetUserId`/`chatId`, `senderDisplayName` "Henry Hall", and previews: the first 80 chars of a 103-char text, `Photo`, `Video`, and `Photo` (view-once). A connected (observing) recipient gets 0 pushes. |
| `npm run custom-client-demo` (clean checkout) | Exit 0, `ok:true`. It listed 6 conversations and read `history:0` (one page, no cursor), and its `observed` field was `{loading:true}`: it received no message. |
| API.md-only variation (carol) | `inbox` → row with `conversation.title == "Weekend Plans"` → `threadMessages` → latest by `at`. Succeeded, but the row shape, newest-first ordering, and `next`/cursor semantics had to be inferred (d-17). |
| sample-50 conformance (dev instance, replayed by the suite) | follows a→1 / followers 1; post-01 likes 1, reposts 0, replies 2; post-04 1/1/1; group roster 4 with 6 messages; DM 4 messages with msg-09 view-once; msg-01 reactions cleared, msg-03 🎉×2; msg-04 quote → msg-03; image counts 4 and 2. All 13 verbs are implemented in `scripts/lib/replay-core.mjs`. |

### T3-M8

**Insights and Trending (UI).**

- `/insights` shows an uncaught `TypeError: Cannot read properties of undefined (reading 'map')` at `InsightsSummary.tsx:44` (`ui-m8-insights.png`).
- `/feed?tab=trending` shows an uncaught `TypeError … (reading 'trim')` in `Avatar` ← `FeedCard` ← `TrendingRow` (`ui-m8-trending.png`).

**Insights (API, fresh starter seed).**

| Persona | posts | likes rcvd | reposts rcvd | replies rcvd | followers | following |
|---|---|---|---|---|---|---|
| alice | 3 | 2 | 1 | 1 | 4 | 2 |
| bob | 3 | 1 | 1 | 1 | 2 | 2 |

These match the starter log. `days` has 7 UTC buckets, today = 3 posts, the other 6 days zero.

**Trending (API).** Top 4 likes → rank 0; tie at 3 likes: newer rank 1, older rank 2; a reply with 4 likes is excluded. The source caps candidates at the newest 200 posts in the window (d-14).

**Digest schedule (fresh instance :49343, every client closed, 120 s periods).** Principals are abbreviated to persona names.

| Period | Activity | Digests emitted (newFollowers / newPostsInFollowing / unreadMessages / unreadChats) |
|---|---|---|
| P0 (seeding) | starter seed | 8 users |
| **Pb** 1789429320 | none | alice 0/0/9/2, bob 0/0/10/2, carol 0/0/5/1: **should be none** |
| **Pc** 1789429440 | erin follows dave; dave posts; alice sends 2 DMs to bob and deletes one; carol posts in g-starter; frank creates a group with grace (no dave) and posts | erin 0/1/0/0 ✓, dave 1/0/0/0 ✓, grace 0/0/1/1 ✓, bob 0/1/**13**/2 (expected unread 2: 1 surviving DM + 1 group), alice 0/0/**10**/2 (expected 1/1), carol 0/0/**5**/1 (no activity) |
| restart | backend killed and restarted at Pc+60 s | no duplicate for Pc or earlier periods; each user has exactly one digest per period |
| **Pd** 1789429560 | none | bob 13/2, grace 1/1, carol 5/1, alice 10/2: **should be none** |
| Pe 1789429680 | none | (session ended before the Pe boundary) |

Authorization held: dave and erin, who are not members of the active groups, showed unreadMessages 0.

## T4. Timing records (best-of-3) with machine load

| Subject | Measurements (ms) | Best | Bound | Load avg (1/5/15 min at start → end) |
|---|---|---|---|---|
| m1-a09 profile edit live (grader 20 s run) | 140.1, 383.4, 319.8 | 140.1 | – | 22.31 29.38 26.04 → 23.49 29.51 26.11 |
| m2-a04 text post live (grader run) | 109.5, 66.7, 130.1 | 66.7 | – | 17.86 18.57 18.86 → 24.28 20.73 19.67 |
| m2-a07 follower count live | 71, 72, 60 | 60 | – | 37.44 34.57 28.90 |
| m2-a19 reply count live | 91.6, 72.7, 109.9 | 72.7 | – | 17.86 → 24.28 (same run as m2-a04) |
| m4-a02 photo message live | 5359.7, 6174.3, 6373.7 | 5359.7 | – | 23.38 21.60 20.15 → 24.31 22.93 20.95 |
| m2-a14 like live (grader) | fail, 164, 195.7 | 164 | – | same as m2-a04. Lane run: 142.3/194.1/192.2. |
| m3-a01 DM live | grader 10 s: 2036.3, fail, fail; grader 20 s: fail ×3 | 2036.3 | – | 24.28 → 23.38; 23.49 → 33.50 |
| m3-a06 typing appear | 10 s run: 178 (a1); 20 s run: 258.1 (a2); other attempts failed | 178 | 2000 | as m3-a01 |
| m3-a07 typing expiry | 2724.1 (a1); 2036.6 (a2) | 2036.6 | 5000 | as m3-a01 |
| m8-a13 same-account live | 4480.4 (single check) | 4480.4 | – | 22.40 23.02 21.24 → 49.85 29.65 23.77 |

Only the first five rows have three numeric measurements, so only they appear in `timingRecords`. Failed attempts carry no measurement and are listed here instead.

## T5. Scale replay: re-execution and O5

The lane's replay record (`replay/scale-result.json`, `scale-verification.json`) reports 453 s wall, 167,157 actions, and 1008 actors. It checked only four named fixtures (u0500, u0005, u0900, u0901): not corpus counts, not the g0001 roster, and not at checkpoints. The lane's action parser treats `# checkpoint 10%` / `# checkpoint 50%` as comments (d-23), so replay never paused. That store no longer exists.

The grader re-executed the lane's own adapter (`scripts/scale-replay.mjs`, unmodified) against a fresh instance on :49342. Wall time was **1229 s** (load 20.5 → 18.0/29.0), exit 0, with every action settled. Verification used read-only admin `snapback4 sql` against `invariant-manifest-combined.json` (`evidence/scale-manifest-verification.json`):

- perEntityCounts all match: users/profiles 1008, followEdges 5921, posts 50228 (top-level 48224, replies 2004), likes 5008, reposts 1004, conversations 1002 (901 DMs, 101 groups), memberships 2053, messages 100015 (text 99105, media 910), quoted replies 2736, reactions 2000, disappearing 0.
- 1002 of 1002 per-chat message counts, 101 of 101 group rosters, 1008 per-user following counts, and 1008 per-user conversation counts all match.
- Named fixtures: u0500 500 following / 100 conversations; u0005 5; u0900 900 followers / 200 posts; u0901 → {u0001–u0004, u0900}; g0001 50 exact members / 10,000 messages.
- **Final-state conformance: true.**

**O5 is recorded null.** The band function evaluates first-match in the order 0, 30, 60, 90, 75:

1. The 0-branch does not fire on the final state (the manifest conforms). Cap exhaustion cannot be evaluated because the replay wall cap is an uncalibrated placeholder.
2. The 30-branch needs degradation-rule p95s or probe timeouts. None exist: no probe set was committed for this wave, and the adapter skips the checkpoints where probes run.
3. The 60, 90, and 75 branches need calibrated ceilings and a cap. Neither exists.

Assigning any band would require inventing probe results, which deviation 1 forbids. The harness or orchestrator must adjudicate O5.

## T6. O-dimension placement

- **O1 = 18.** Placed below the ~30 anchor. Completeness credit comes only from green, honestly mapped milestones, which leaves M1 alone: 13 of 13 passed. M2 was execution-green but is adjudicated capability-failure (dishonest mapping); M3, M4, M5, M6, and M8 were non-green; M7 is not-run. Independent quality evidence (71 of 119 results pass) keeps the score near the top of the sub-30 band.
- **O2 = 20.** Placed below the ~30 anchor, "multiple high-severity defects in core flows": 2 blockers (Insights and Trending crash), 13 majors, 10 minors, 2 cosmetics.
- **O3 = null.** M6 is not green.
- **O4 = null.** M6 is not green. There is also no simulator artifact for M6 or M8.
- **O5 = null.** See T5.
- **Independent result tally (all 119):**

| Milestone | Pass | Fail | Not-run |
|---|---|---|---|
| M1 | 13 | 0 | 0 |
| M2 | 22 | 5 | 0 |
| M3 | 14 | 1 | 0 |
| M4 | 8 | 4 | 0 |
| M5 | 6 | 6 | 0 |
| M6 | 5 | 1 | 7 (native) |
| M7 | 0 | 0 | 9 |
| M8 | 3 | 13 | 2 (native) |

  Across the prior-101 set (M1–M7) this is 68 pass, 17 fail, 16 not-run. The 18 M8 results are 3 pass, 13 fail, 2 not-run. No weighted total or cross-lane statistic is computed.

## T7. Redaction and retention

- The dev service-worker tokens printed by `snapback4 dev` were replaced with `<redacted>` in `grading/logs/*backend.log`. Grader throwaway-account passwords appear only in the private probe scripts and are not reproduced here. The demo output's principal is redacted in `evidence/custom-client-demo.txt`.
- Private working state is retained for audit only and is not part of the published artifact: `grading/checkout`, `scale-checkout`, and `m8-checkout` (APFS clones, including local `.snapback4` stores with argon2id hashes and expired local sessions, plus copies of the fixture pack's declared credential file), and the harness copies.
- Session start `1789428344`; `DONE` written at the end of the session.
