# Grader evidence and action trace: astra-snapback4 (social-messenger, full run)

Sanitized, publishable trace. Redactions:
- `<ROOT>` = the benchmark workspace root and `<LANE>` = `<ROOT>/lanes/astra-snapback4`.
- Fixture and grader-created passwords, session and service tokens, and principal IDs are omitted.
- The backend log prints a service-worker token once. It was not copied here.
- Raw tool transcripts are not published.

- Grader: family `claude`, model `claude-opus-5`, a fresh session.
- Label: `uncalibrated-grader`.
- `sameFamilyGraded=false`, `calibrationPassed=false`.
- Session outcome `completed`, 0 grader-abort re-runs.
- Wave `full-3models-astra`, probe set `none-uncommitted`.
- Assertion manifest `<ROOT>/instrument/schema/social-messenger/assertions.json` (0.3.0-m8), sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
- Grading window: epoch 1789425450 to 1789427850 (2026-09-14 22:37–23:17 UTC).

## §0 Contamination statement

I did not open `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`, `run-log.md` or any other lane. I also avoided builder self-report files that could carry self-scores (`final-report-data.json`, `hand-authored-lines.json`, `correction-events.json`).

The permitted `run-record.json` contains one-line summaries of the builder's correction loops that cite run-log line numbers. I read those as part of the run record; they carry no self-scores. The session is not contaminated.

The clean checkout (§1) was built with an explicit allow-list that excluded all of these files. The builder's own start scripts append to a `run-log.md` in the working directory; in the checkout that file was created empty and written only by grader-run scripts.

## §1 Environment and inputs

- Host: macOS arm64 on a shared machine. Node v24.18.0 first on PATH.
- Inputs read:
  - the frozen grader prompt
  - the assertion manifest and `applicability.json`
  - the report schema
  - the brief
  - `ENVIRONMENT.md`
  - the fixture README, personas, starter logs and invariant manifest
  - the probe `rotation-log.md` (no rows) and `categories.md`
- Lane inputs read: `README.md`, `API.md`, `package.json`, `run-record.json`, `milestones.json`, `coverage-manifest.json`, `suite-status*.json`, `native-artifacts.json`, `performance-summary.json`, and the choreography receipts and scale evidence under `<LANE>/evidence`.
- Source reviewed: `snapback/*.q`, `snapback/worker.mjs`, `src/*`, `app/*`, `scripts/acceptance*.mjs`, `scripts/starter.mjs`, `scripts/custom-client-demo.mjs`.
- Clean checkout: `<LANE>/grading/checkout`.
  - Copied from an allow-list: app, src, snapback (without `generated/`), scripts, config, ui, scaffold, public, choreography, `API.md`, `README.md`, `package*.json`, the adapter and setup identity, plus the relative `instrument`/`fixtures`/`schema` symlinks.
  - `node_modules` is an APFS clone of the lane's installed tree, not a fresh `npm ci` (minor deviation; the snapback4 0.2.10 and snapback4-expo 0.2.3 pins are unchanged).
  - No `.snapback4` store, no evidence and no suite status were copied, so the database started empty.
- The copied choreography harness is byte-identical to `<ROOT>/instrument/choreography` for every `.mjs`/`.json`/`.md` file. Only the lane-supplied loader shim for the snapshot's missing `../../lib/json-schema.mjs` was used, as the lane README documents.
- Nothing was written into `<ROOT>/instrument/` or into the lane outside `grading/`.
- Ports and processes:
  - Only 49340 (dev backend), 49341 (Expo web) and 49342 (isolated fresh backend) were used.
  - PIDs are in `grading/evidence/grader-pids.jsonl`: 72433/72436, 73713, 29855/29860 (the restart spawned by the M8 suite), 76165/76172, 5281/5283 and 17714/17720.
  - All were stopped by PID with SIGTERM at the end. No pattern kills. Ports 49340–49359 were free afterwards.
- Backend startup:
  - `CLIQUE_WINDOWS_CONFIG=config/windows.shortened.json CLIQUE_DIGEST_CONFIG=config/digest.shortened.json node scripts/configure.mjs`, then `snapback4 dev --port 49340`. This is the documented `npm run backend:grading` sequence.
  - Windows are 60 s edit, 120 s delete, 180 s disappearing (24h); digest periods are 2 minutes.
  - `snapback4 check` compiled with notes N_NEVER_COMPLETE (features.allMessages), N_WIDE_MERGE (social.following) and N_MAINTAIN_SYNCED (likeCounts).
- Seeds: `npm run seed -- --segment m1|m2|m3` settled 16, 52 and 18 actions.

## §2-builder-suite: builder suite (phase 1)

`npm run acceptance -- --milestone mN` was run from the checkout against the grader's backend, in order. Receipts are copied to `grading/evidence/m*-suite.json` and `m*-coverage.json`. The load average (1-min) is at the start of each run.

| Milestone | Result | Cases | Missing coverage | Load at start |
|---|---|---|---|---|
| m1 | pass | 6/6 | none | 18.47 |
| m2 | pass | 10/10 | none | 17.86 |
| m3 | pass | 5/5 | none | 17.86 |
| m4 | pass | 6/6 | none | 17.71 |
| m5 | pass | 7/7 | none | 19.33 |
| m6 | pass | 5/5 | none | 35.93 |
| m8 | pass | 4/4 | none | 26.64 |

Every suite-required assertion is `suiteResult: pass`. The M8 suite restarts the backend with `scripts/restart-backend.mjs`, which targeted the grader's own PID from the checkout's pid file.

## §3 Coverage-manifest spot verification (phase 2)

Verdict: **honest**.

Sampled mappings: m1-a03, m1-a10, m2-a01, m2-a08, m2-a16, m2-a22, m2-a24, m3-a11, m3-a15, m4-a01, m4-a06, m5-a05, m5-a11, m6-a08, m6-a10, m6-a13, m8-a01, m8-a06, m8-a07.

Each mapped test exercises its observable. Some UI-flavored items are tested through the API instead:
- post creation
- repost attribution via the actor field
- reaction set-state
- a backdated Trending fixture via the documented dev `/seed` route

The grader independently exercised those UI paths (§5), and all passed. There is no dishonest mapping.

## §4-api-probes: independent API checks (phase 3)

Scripts: `grading/evidence/g-lib.mjs` (written from API.md), `g-api.mjs`, `g-api2.mjs`, `g-api3.mjs`. Outputs are in `g-api*-output.txt` and `api*-results.json`. Grader-created users were fresh accounts unless a persona is named.

### M1–M3

- **m1-a07:**
  - Before logout, a `me` query works.
  - After `/auth/logout` (200), both the query and a mutation return `E_AUTH`.
  - After `/auth/refresh`, the old token returns `E_AUTH` and the new token works.
  - Unauthenticated and garbage-token reads return `E_AUTH`.
- **M2:**
  - Text, 2-image and video posts are created and readable by another user; image and video assets return 200.
  - Mixed media is refused (`INVALID_IMAGES`).
  - Implicit self-follow holds: own originals and reposts appear in Following, counts stay 0/0, and self-follow is refused (`SELF_FOLLOW`).
  - Follow surfaces the author's posts, including older ones. Unfollow removes all of the author's direct items (0 leaked) while they remain in Global.
  - A stranger's post appears in Global but not Following.
  - Like set-state: the same and new mutation IDs keep the count at 1; clear goes to 0.
  - Repost is attributed to the reposter's display name. A followed user's repost surfaces the post in Following, and removing it clears Following and Global and resets `repostCount` to 0.
  - Thread shows only direct replies, in order (the nested reply is excluded); `replyCount` is 2; replies are absent from both feeds.
  - Pagination in both tabs: 20+20 per page, 0 duplicates, 43/43 posts gapless, strictly ordered.
- **M3:**
  - A DM created from both sides returns the same ID, and there is exactly one DM with that counterpart.
  - Two groups with the same three members are distinct.
  - Non-admin remove and self-promote are refused (`NOT_ADMIN`).
  - Removed-member server cutoff: history returns 0 rows and send returns `NOT_MEMBER`.
  - Cross-user DM access by a non-member: history, in-chat and global search leak 0 rows, send is `NOT_MEMBER`, and the conversation read returns no data.
  - m3-a15: store counts are identical before and after re-seeding m1, m2 and m3 twice more (profiles 23, posts 152, follows 18, likes 25, timelines 142, conversations 12, members 31, messages 55).

### M4–M5

- **M4:**
  - Reaction set-state gives 👍1, then ❤️1, then ❤️1 again (idempotent), then cleared.
  - Non-author edit and delete return `NOT_AUTHOR`. Caption edit on media sets `edited` and keeps the media.
  - **m4-a12:** after delete-for-everyone, video and photo assets return 404 for both recipient and sender, and 401 anonymous. The tombstone has empty text and no media. Re-attaching the deleted asset fails with `E_FIELD`.
  - **m4-a10:** an edit inside the window is accepted. At sent+61.5 s the edit returns `EDIT_WINDOW_CLOSED`. Extra `at`/`now` arguments return `E_INPUT`. At sent+121.5 s delete returns `DELETE_WINDOW_CLOSED`.
- **M5:**
  - **m5-a06:** the first asset GET returns 200 and the second 410, per member (a group member gets 200 then 410 independently). Outsider gets 404, anonymous 401. Re-attaching the consumed view-once asset into another message returns `E_ASSET_UNKNOWN`.
  - Non-admin rename and disappearing change return `NOT_ADMIN`.
  - Color and background sync to members; the background asset returns 200 to a member and 404 to a non-member; an off-palette color returns `E_INPUT`.
  - People search: `car` and `CAR` return carol; the mid-word `rol` returns nothing.
  - In-chat search for `route` returns the seeded line, with `complete:true`.
  - HTTP global search `coffee` returns 3 rows across 2 chats but `complete:false` (d-05).

### M6

- **m6-a08/a09:** two never-connected fresh users.
  - The provider log (`<checkout>/evidence/provider.jsonl`) received exactly 4 payloads for the recipient, and 0 for the sender.
  - Keys are `{chatId, preview, senderDisplayName, targetUserId}`.
  - The text preview is exactly the first 80 chars. View-once and plain photo both preview as `Photo`; video previews as `Video`. The caption did not leak.
  - The first payload was logged 6 ms after send.
- **m6-a10/a11:** `custom-client-demo.mjs` was copied alone into an empty directory and run with the credential path (bob) against the live backend. It printed `pass:true`, authenticated, listed 9 conversations and received by polling. The message object carries the M6 field manifest.
- **Service routes:** `push.dispatch` with a user token returns `SERVICE_ONLY`; calling the digest job returns `E_OP`.
- **Asset re-share and limits (g-api3):**
  - A foreign DM photo cannot be re-attached into a public post or another chat (`E_ASSET_UNKNOWN`).
  - Length and format limits (2001-char message, 501-char post, bad handle, 201-char bio) return `E_INPUT`.
  - A view-once asset returns 404 to non-owners before it is sent.

### M8

- **m8-a01:**
  - Dev-instance Insights (posts 8, likes 17, reposts 1, replies 1, followers 4, following 2) equal independent SQL.
  - A separate fresh starter-only instance on 49342 gives Alice posts 4, likesReceived 2, repostsReceived 1, repliesReceived 1, followers 4, following 2. This matches `starter-m2.log` (3 originals + 1 reply; bob and carol like sp0001; carol reposts sp0001; bob replies to sp0001; bob, carol, erin and grace follow alice; alice follows bob and carol).
  - Seven UTC days are returned; empty days are 0 and today is `[4, 2]`.
- **m8-a05–a07:**
  - Trending order is 4 likes ahead of 3 likes (newer), ahead of 3 likes (older); ties break newest-first.
  - A reply with 4 likes is absent.
  - A post backdated 25 h through the dev `/seed` fixture route and liked by 4 users is absent. The first-pass absolute-index check failed only because suite-residue posts with 5 likes ranked above; the relative re-check passed.

### §4a-source-inspection

- **m1-a12:** `snapback/schema.q` declares `use identity password`; the snapback4 README documents Argon2 for built-in password identity. The store's `_credentials.hash` values are `$argon2id$v=19$m=19456,t=2,p=1$…`.
- **m1-a13:** `evidence/pwscan.mjs` byte-scanned for all 10 known passwords (8 starter personas, the scale password, the suite test password). It found 0 hits across:
  - the builder dev and scale stores (sqlite, WAL, assets)
  - `artifacts/` (web and iOS Hermes bundles)
  - `app/`, `src/`, `snapback/`, `public/`
  - builder backend, web and provider logs
  - the grader's checkout and fresh stores and logs (2368 + 110 files)

  A separate grep of the grader stores for grader-created passwords also found 0 hits.

### §4b-api-md-variation (m6-a12)

`evidence/g-apimd-latest.mjs` was written only from API.md:
1. `POST /auth/login`
2. page `POST /q/chat.inbox` with `{args:{c}}` until `conversation.name === "Weekend Plans"`
3. `POST /q/chat.history`, then take `data[0]` (newest first)

As carol, both instances returned text "Locked in. See you Saturday.", kind text, sender alice, and the inbox `latest` matched.

## §5-web-automation: independent web checks (phase 3)

Playwright chromium, from the checkout's harness `node_modules`, against `http://127.0.0.1:49341`. Scripts: `g-web.mjs`, `g-web-avatar.mjs`, `g-web-live.mjs`, `g-web-follow.mjs`, `g-web-removal*.mjs`, `g-web-reload-loss.mjs`. Screenshots are in `evidence/web/`. Load was 18.01 (1-min) at the start of `g-web.mjs`.

### M1

- Signup through the form lands on the feed tabs, and a reload stays signed in.
- Display name and bio edits show on own profile after reload.
- **Avatar:** the first attempt referenced a non-existent fixture filename (grader error). The rerun with `avatar-bob.png` saved the avatar, the asset returns 200, and the avatar renders on the profile.
- **UI logout:** the stored token then returns `E_AUTH` and `localStorage` is cleared; after reload the app is signed out.
- **Duplicate email:** visible error "E_AUTH: … that email already has an account; sign in instead".
- **Duplicate handle:** visible "HANDLE_TAKEN" and a redirect to `/profile/edit`. A login with that new email then succeeds, and that account has no profile (d-03).

### M2

- Compose flows all land server-side: text with URL; 2 images through the attach control (kind `images`, photo1 and photo2); a video.
- The URL renders as a link and opens `https://example.net/page` in a new page; 0 preview nodes.
- **Repost label:** "↻ Reposted by G wb"; toggling it off removes it server-side and in the UI.
- Like and unlike from the card set the count to 1, then 0.
- The thread screen orders parent, reply 1, reply 2.
- Scrolling loads the next page in both tabs until the oldest item appears (Following 20 → 25 loaded; Global 20 → 40).

### M3–M4

- **m3-a02:** the Alice–Bob DM renders 0 `sm-convo-sender-avatar`; a group renders them. The DM header reads "Direct message" (`web/m3-dm.png`).
- **Quoted reply:** the excerpt shows "Quote target …". The original was off-screen before the tap and in view after it.
- **Media:** a photo sent through the conversation attach control is readable by the recipient (asset 200), and so is a video.
- **Edit:** the edit flow shows "edited" on both sender and recipient.
- **Reactions from the recipient UI:** 👍 gives 👍1, switching to ❤️ gives ❤️1, tapping ❤️ again clears it.

### M5 and M8

- **View-once:** Bob opens it once and the image renders. The second tap and a tap after reload render nothing; the API returns 410.
- **Search:**
  - People scope: `car` finds "Carol Chen @carol".
  - In-chat search finds "Corner place?" with 0 out-of-chat results.
  - Global search for `coffee` shows a "Weekend Plans" heading and a "Direct message" heading.
- **Insights:** the six tiles equal the API values, with 7 day rows ("2026-09-08 Posts 0 Likes received 0", …).
- **Trending tab:** 10 rows; the first row matches the API's first post.

### §5b-live-follower-count (m2-a07, best-of-3)

The target's own profile was open; three different users followed the target through the API, and the follower-count text was polled without refresh.

| Measure | Value |
|---|---|
| Measurements | 30.9 / 30.7 / 29.7 ms |
| Best | 29.7 ms |
| Load (1/5/15-min) | 11.89 / 16.33 / 19.64 |

The frozen harness has no follower-count observation, so this is the grader's measurement.

### §5c-removal-reproduction (m3-a12 / m3-a13, d-01)

- **Human-paced runs (`g-web-removal.mjs`, `g-web-removal-promoted.mjs`, 8 runs):**
  - Removal both through settings UI and through the API, including a promoted-admin member.
  - The removed member's live page never showed the post-removal message.
  - Pre-removal history was retained live and after reload.
- **Harness-speed sequence (`g-web-removal-race.mjs`, 6 runs):** add, promote, remove in settings, then navigate immediately with `page.goto` and send.
  - In 4/6 runs the removed member saw the new message within 4–129 ms.
  - In those runs the server roster still contained the member, and the message's server `recipients` included them.
  - In one run the promote was lost as well.
  - A store query a minute later still showed all 4 memberships, so the writes were lost, not delayed.
- **Same sequence with a wait (`g-web-removal-settled.mjs`, 4 runs):** waiting for the roster row to disappear (~52 ms) plus 1.5 s before navigating: 0/4 lost.
- **Sends are durable (`g-web-reload-loss.mjs`):** messages sent then immediately navigated away from committed 6/6.

Conclusion: a settings action issued within roughly the admission window before a full page navigation is dropped.

### §5d-follow-toggle (d-02)

`g-web-follow.mjs`:
- Six deliberate profile toggles flipped server state correctly.
- Three rapid "tap, leave, return, tap" cycles:
  - rapid0: the button showed stale "Follow" while the server said following; the second tap re-sent follow, ending wrong.
  - rapid1: correct.
  - rapid2: the button showed stale "Following" after an unfollow; ending wrong.
- The unfollow-then-own-repost scenario done at human pace was correct: the Following feed showed 1 repost card and 0 direct cards.

## §6-expiry: disappearing messages (m5-a01..a03)

Script `g-expiry.mjs`. Timeline is in `g-expiry-timeline.txt`, summary in `g-expiry-summary.json`. Load was 20.67 (1-min) at start.

1. Two fresh users X and Y share a DM. A control message was sent before Y set the DM to `24h` (TTL 180 000 ms); the conversation then reads `disappearing: 24h`.
2. X sent a text and a photo containing a unique token.
3. Both web clients (persistent profiles) opened the DM, synced the messages, confirmed the token in search, then closed.
4. A separate pair (U, V) kept V's client connected on a second disappearing DM.
5. After expiry, with all X/Y clients closed:
   - The expired rows left server history by the first poll, 1007 ms after `expiresAt`.
   - The photo asset returns 404 for both members.
   - React and edit return `MESSAGE_NOT_FOUND`; quoting returns `QUOTE_NOT_FOUND`.
   - In-chat and global search returned 1 row: the control message. A store query confirmed only the two control rows remain for the token.
6. V's connected client purged its bubble 97 ms after expiry.
7. Y relaunched offline (backend routes aborted): 0 expired bubbles (the client purged locally by `expiresAt`). After reconnect: 0. Offline again after sync: 0 expired, the control bubble present, offline banner shown. Offline search for the token returns the control message only.
8. X relaunched online: 0 expired bubbles; search shows no expired row, and the control message is still found.

The script's automatic m5-a01 verdict was a false FAIL (it counted the control row). It was adjudicated PASS from the store evidence above.

## §7-digest: scheduled digest (m8-a08..a12)

Script `g-digest.mjs`. Timeline is in `g-digest-timeline.txt`, summary in `g-digest-summary.json`.

- **Setup:** an isolated fresh instance on 49342 (same compiled schema, shortened 2-minute config, seeded with the starter log; no web clients ever connected). Load was 35.80 (1-min) at start.
- **Users:** target T, sender S, followers F1 and F2, outsider O, quiet Q.
- **Period P0 (setup):**
  - T follows S.
  - DMs S–T and F1–T.
  - Group G1 {S, T, O}, group G2 {S, O}, group G3 {S, T, O}.
- **Period P1 (1789426320000, activity):**
  - F1 and F2 follow T.
  - S makes 2 original posts.
  - S sends 2 DM messages to T and deletes one.
  - S sends 1 message in G1 and 3 in G2.
  - S removes T from G3, then posts 1 message in G3.
  - F1 messages T, and T marks it read.
- **Restarts:** the backend was SIGTERM-restarted by the grader's PID at P1+50 s and again 8 s after P1's emission.
- **Results:**
  - T got exactly one digest for P1: `{newFollowers 2, newPostsInFollowing 2, unreadMessages 2, unreadChats 2}`, periodEnd P1+120 s, emitted 24 ms after period end.
  - O got exactly one: `{0, 0, 5, 3}`. The script expected 4/2 but forgot O's own G3 membership; G1 1 + G2 3 + G3 1 = 5 messages in 3 chats is correct. Adjudicated PASS.
  - Q, F2, S and F1: no P1 digest.
  - T: no digest in P2 (quiet period).
  - Across both restarts, no user got a second digest.
- **Authorization (m8-a12):** G2 (T not a member), G3 after T's removal, the tombstoned DM message and the read F1 message all contributed nothing to T.

Observation (not filed as a defect): `analytics.digest` scans all profiles, follows and messages every period (`chunk … first 20 by byId`). Its cost grows with the corpus, not with period activity. That is harmless daily and in replay mode, and there is no envelope rule for it.

## §8-choreography-receipts: two-client web choreography ([choreo] scoring basis)

Two sources:
- the builder's final receipts `<LANE>/evidence/mN-choreography.jsonl`, plus earlier `.previous-*` runs
- the grader's own runs of the frozen harness through the lane's documented `node scripts/choreo.mjs mN` against the grader backend, copied to `grading/evidence/grader-mN-choreography*.jsonl`

The best-of-3 rows below come from the grader run. Load (1-min/5-min/15-min) is at segment start:

| Segment | Load |
|---|---|
| m1 | 21.54/23.22/23.03 |
| m2 | 21.26/23.14/23.00 |
| m3 | 20.83/22.93/22.93 |
| m4 | 22.88/23.23/23.04 |
| m5 | 23.69/23.41/23.11 |
| m6 | 15.07/19.56/21.52 |
| m8 | 15.46/19.57/21.51 |
| m3 rerun 2 | 15.21/19.38/21.42 |
| m3 rerun 3 | 17.10/19.07/21.15 |
| m3 rerun 4 | 14.38/17.85/20.52 |

Segment results:

| Segment | Builder final | Grader run | Notes |
|---|---|---|---|
| m1 | green | green | profile-edit-live 95.1/97/96.2 ms; session persists; logout stays signed out |
| m2 | green | green | text 63.7/60/45.4, image 122.4/112.5/122.7, video 124.3/123.3/100 ms; follow projection 558/623/580 ms; like 66/59.4/90.4; repost; reply count 114/234/238 ms; author avatar + name. `repost-following-feed-surface` failed attempts 1 and 3 in **both** runs (best-of-3 pass; d-02) |
| m3 | green (after one failed run on member removal) | **failed** | see below |
| m4 | green | green | photo live 327/365/264 ms; video plays; reaction 410/392/357 ms; edit 245/146/143 ms; tombstone |
| m5 | green | green | color + background sync; view-once single view and refusal; warm-offline search; disappearing expiry and purge |
| m6 | green | green | `offline-message-queue-flush-in-order` (web) flushMs 463 |
| m8 | green | green | a02 17→18 likes after refresh; a13 362 ms; a14 cross-device read clear 494 ms; a15 dual-offline convergence; a16 receipts |

M3 detail (grader runs):
- **Run 1 checks that passed:**
  - `dm-live-messages`: 348.7/355.6/262.4 ms.
  - Typing: visible after the last keystroke in 32.6/22.4/36 ms; expired in 4839.5/4828.6/4860.8 ms (bound 5000).
  - `receipt-sent-delivered-read-transitions`: 2517.8 ms.
  - `group-receipt-waits-for-slowest-member`: pass.
  - `quoted-reply-excerpt-and-jump`: pass.
  - `sender-avatar-identity-when-rendered`: skipped (instrument class: the kit hides 1:1 sender avatars).
- **Run 1 failure:** `member-add-promote-remove-leave-and-live-cutoff` failed with "removed member received a new live group message".
- **Reruns 2 and 3 are invalid measurements.** Run 1's lost removal left Dave in "Weekend Plans", so "addable group member did not appear" and the group aggregate read never completed. Receipt transitions in those runs took 2530 and 2699.8 ms.
- **State restore:** the grader removed Dave through the API (logged in `m3-state-restore.txt`).
- **Rerun 4 (clean):**
  - The same removal failure repeats.
  - Group receipt passes.
  - Typing attempt 3 exceeded the 5 s bound; attempts 1 and 2 were 4844.6 and 4836.3 ms.
- **After grading:** Dave was removed again to leave the fixture as found.

Timing-sensitive checks are judged best-of-3 on the grader's measurements. Every timing record passed; only m3-a06 (2000 ms) and m3-a07 (5000 ms) have numeric bounds.

## §9-native-artifacts: native (simulator) proofs and O4 basis

- `native-artifacts.json` lists iOS Hermes bundle exports for m1–m6 and m8. The grader re-hashed all 7 and they match (`evidence/hermes-bundle-verify.txt`). These are build artifacts, not simulator proofs.
- Both the M6 and M8 segment summaries carry `supplementalExternal: ios-simulator-m6|m8, status "not-recorded", pass null`.
- No simulator recording or receipt exists anywhere under the lane.
- m6-a01..a07 and m8-a17/a18 are recorded **not-run**: the native proof is absent, and absence cannot pass.
- The grader did not drive a simulator, as the prompt requires.

## §10-scale-and-o5: scale replay and O5

Sources: the lane's `evidence/scale-clock.json`, `scale-verification-{10pct,50pct,final,final-extended}.json`, `scale-probes-{10pct,50pct,final}.json`, `performance-summary.json` and `full-replica-search.json`. The replay record has no `performanceProbes.o5Inputs` block, so the band was evaluated from these files.

**Replay**
- Own clock: 1149.2 s wall (940.9 s replay).
- 167 243 scale actions settled, plus 86 starter actions.
- One verifier-mapping failure at 24 863 actions, followed by a hashed resume.
- Posture: local published dev binary.

**Manifest conformance**
- The lane's counts equal `invariant-manifest-combined.json` expectedState at all three checkpoints.
- The grader cloned `scale-instance` (APFS clone under `grading/scale-copy`) and re-queried it read-only:

| Quantity | Value |
|---|---|
| profiles | 1008 |
| follows | 5921 |
| posts | 50228 |
| messages | 100015 |
| likes | 5008 |
| reactions | 2000 |
| conversations | 1002 |
| u0500 | following 500, 100 conversations |
| u0005 | following 5 |
| u0900 | 900 followers, 200 posts |
| u0901 | follows exactly u0001–u0004 and u0900 |
| g0001 | 50 members, 10000 messages |

All match. The hidden sample seed was not committed, so it could not be run.

**Lane-measured ratios**

| Rule | Value |
|---|---|
| page50/page1 p95 | 1.21 |
| following500/5 | 1.88 |
| celebrity write | 0.78 |
| celebrity-follower read | 1.18 |
| insights full/10% | 0.83 (midpoint below line) |
| trending full/10% | 1.02 (midpoint below line) |
| busy-group send p95 | 6.8 ms |
| cold web 100-chat p95 | 1676 → 7681 → 13559 ms (d-06) |

**Global search:** the HTTP query returned `complete:false` with 0 rows at every checkpoint. The lane itself marks the curve invalid. Replica search at the full corpus alone works (p95 2.9 ms, 50 rows), but no three-size curve exists.

**Band: 30.**
- Branch 0 does not fire: the manifest conforms and cap exhaustion is not shown (the cap is an uncalibrated placeholder).
- Branch 30 fires: the global-search probe errored, so perf-search-scaling cannot pass.

## §11 Defects (phase 5)

None are blocker or major.

| ID | Severity | Summary |
|---|---|---|
| d-01 | minor | Settings membership action lost on immediate navigation (§5c) |
| d-02 | minor | Stale follow-toggle intent (§5d) |
| d-03 | minor | Non-atomic signup on duplicate handle (§5) |
| d-04 | minor | Thin typing-expiry margin (§8) |
| d-05 | minor | HTTP global message search never complete (§4, §10) |
| d-06 | minor | Steep cold web sync growth (§10) |
| d-07 | cosmetic | DMs titled "Direct message" (§5) |
| d-08 | cosmetic | Binary unread badge (source) |

## §12-deviations-and-scope

1. **No holdout probe set** was committed for this wave (`rotation-log.md` has no rows). Phase 4 was skipped, `wave.probeSetSha256 = "none-uncommitted"` and `probeResults` is empty. No probes were invented. O3 is a provisional placement from grader-authored checks across the seven published trust-boundary categories, labeled as such.
2. **Grader family not calibrated:** `calibrationPassed=false`, `sameFamilyGraded=false`, label `uncalibrated-grader`.
3. **Timing checks** were judged best-of-3 with host load recorded beside each record (§5b, §8). Other sessions share this machine; 1-min load ranged 11.9–35.9 during grading.
4. **M7 not attempted.** Per `ENVIRONMENT.md`, M7 is a separate fresh session run after grading. All 9 M7 assertions record `not-run`. m7-a09 (conditional on previously-green milestones) also records `not-run`, because M7 itself never ran.
5. **Grader script errors** (§5 avatar filename; §6 control-row count; §7 outsider expectation; §4 trending absolute index) were corrected or adjudicated from evidence. They are not lane defects, and none required a grader-abort re-run.
6. **Clean checkout** used a cloned `node_modules` rather than `npm ci` (§1).

### Frozen schema limitation and prior coverage gap (119 = 101 + 18)

- `grader-report.schema.json` restricts `assertionResults` keys to `^m[1-7]-a[0-9]{2}$`. The schema-valid `grader-report.json` therefore carries exactly the 101 M1–M7 IDs listed in `<ROOT>/GRADER_ASSERTIONS_101.txt`.
- The 18 M8 results are in `grading/m8-assertion-results.json`: the same record shape and enums, manifest path and sha256 pinned, no ID duplicated.
- A validation script (`evidence/validate.mjs`, AJV 2020 from the harness copy) confirms:
  - the report is schema-valid
  - the M8 file has exactly the required top-level keys and exactly the 18 M8 IDs, each record valid against the report's result-record schema
  - the two files do not overlap and together cover all 119 manifest IDs
- Earlier waves: the September 5 and September 12 structured `assertionResults` carried only the 101 IDs. Their notes could describe M8 observations, but they never produced a machine-comparable 18-ID M8 result set. That is a measurement-coverage gap in the prior records. This session is the first to grade all 119 in one independent pass.

**Tallies (no weighted totals computed)**

| Scope | pass | fail | not-run | Total |
|---|---|---|---|---|
| M1–M7 | 83 | 2 (m3-a02, m3-a12) | 16 (7 native M6 + 9 M7) | 101 |
| M8 | 16 | 0 | 2 (native) | 18 |
| Combined | 99 | 2 | 18 | 119 |
