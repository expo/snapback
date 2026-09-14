# Grader evidence and action trace: grok-snapback4 (social-messenger, full run)

Sanitized trace. Credentials, session tokens, and service tokens are never
written here or in `evidence/`. Grader-created accounts use throwaway
`@grader.test` addresses with random passwords that were held in memory
only. Fixture personas are named, but their passwords are not reproduced.
Principal IDs appear only in raw evidence files, where they are opaque
test-instance identifiers. Raw transcripts are not published.

## 0. Session identity and deviations

- Grader: family `claude`, model `claude-opus-5`, a fresh session. The
  builder family is Grok, so this is not same-family grading.
- Frozen protocol: `instrument/grader/grader-prompt.md`, followed in phase
  order. The wrapper's deviations are recorded here:
  1. **No holdout probe set was committed for this wave.** Phase 4 was
     skipped, `wave.probeSetSha256 = "none-uncommitted"`, and
     `probeResults` is empty. No probes were invented. The trust checks I
     made while executing the checklist are reported as defects.
  2. **Uncalibrated grader.** This family has not passed `calibration.md`,
     so `grader.calibrationPassed = false` and
     `grader.sameFamilyGraded = false`. The record labels the grade
     `uncalibrated-grader`. This is an N=1 calibration run, not a
     claim-eligible wave.
  3. **Timing-sensitive checks are judged best-of-3.** Machine load
     (`uptime`) is recorded beside each timing record; see §7. The only
     timing-sensitive measurements are harness receipts from the builder
     session, and those receipts did not capture host load.
- **Contamination: none.** I did not open `diary.md`, `essay.md`,
  `final-report.md`, `FINAL.md`, `run-log.md`, or any other lane. Their
  file names appeared once in a directory listing. `contaminated = false`.
- **Run record:** `run-record.json` is absent from the lane. I graded from
  receipts, source, and independent execution.
- **Assertion manifest:** `instrument/schema/social-messenger/assertions.json`,
  sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
- **Result files:** `grading/grader-report.json` carries the 101 M1–M7
  IDs, which is all the frozen schema admits (its
  `^m[1-7]-a[0-9]{2}$` pattern). `grading/m8-assertion-results.json`
  carries the 18 M8 IDs in the same record shape. Together the two files
  partition all 119 manifest IDs, with no duplicates.
- **Prior measurement-coverage gap:** the September 5 and September 12
  structured `assertionResults` carried only the 101 IDs listed in
  `GRADER_ASSERTIONS_101.txt`. Their notes could describe M8 observations,
  but they provided no machine-comparable 18-ID M8 result set. This
  session grades all 119 IDs, so the harness can report the prior-101
  subtotal, the 18 M8 results, and the 119 total separately.

## 1. Environment and processes

- Host: macOS arm64, Node 24.18.0, shared with other sessions.
  - Load at session start (epoch 1789367477) was `36.33 44.01 31.32`.
  - Load during the grading work was 11–25 (1-minute average).
- Grading instance: an isolated copy of the lane under `grading/work/`.
  - Source, scripts, fixtures, and schema were copied, and `node_modules`
    was APFS-cloned.
  - It has its own empty `.snapback4` store. The lane's own store was only
    read (for §3 m1-a13) and never written.
- Ports: backend `127.0.0.1:49300`, from the lane's documented default in
  `scripts/start-backend.mjs`, `lib/config.ts`, and `API.md`. Expo web on
  `49301`, from the lane's `npm run web`.
- Processes I started (full history in `grading/pids/history.log` and
  `grading/pids/*.pid`):
  - backend `snapback4 dev --port 49300 --no-watch`: PID 42231; its
    restarts are recorded in §3 M8;
  - Expo web: PID 45642;
  - push worker `scripts/push-worker.mjs`: PID 53358. I minted a
    `service:pusher` token for this store; it is kept in
    `grading/pids/.pusher-token.raw` and is never printed.
- Harness copy: `instrument/choreography` was copied to `grading/choreo/`
  and dependencies were installed there (Playwright 1.62.1, AJV). I used
  it only as a browser driver and for schema validation; I did not re-drive
  the harness segments.
- Seeding: the lane's own `scripts/seed.mjs --segment m1|m2|m3` replays
  the starter logs through the app write path and seeds the shortened
  windows and digest configs. All three segments exited 0.

## 2. Phase 1: builder suite (`npm run acceptance -- --milestone mN`)

Run against the grading backend from the fresh copy, starting at epoch
1789368111 (load `17.66 20.22 23.51`).

| milestone | result as the suite reports it |
|---|---|
| m1 | 7/7 ok (a01 a02 a03 a04 a08 a10 a11) |
| m2 | 22/22 ok |
| m3 | 7/7 ok |
| m4 | 5/5 ok |
| m5 | first run: `m5-a04` **not ok** ("Cannot read properties of undefined (reading 'token')": Bob's login exhausted `E_RATE_LIMIT` retries, 72 s); the other 5 ok. Re-run at 1789368349: 6/6 ok |
| m6 | 5/5 ok (the demo ran; sample-50 replayed) |
| m8 | 6/6 ok |

Logs: `grading/logs/suite-*.log`. The lane's own receipts under
`receipts/` report the same passes, with two exceptions:

- `suite-m2.json` has no results array, only a note ("m1 signups skipped
  due to E_RATE_LIMIT on this run").
- `suite-status.json` was overwritten by the last run (m1–m6
  `pass:false`, m8 `pass:true`).

## 3. Phase 2: coverage-manifest spot verification

The coverage manifest is generated from `assertions.json` itself
(`scripts/acceptance.mjs:550-561`), so every ID is "mapped" by
construction. I read each mapped test.

- **Tautologies** (cannot fail):
  - `m2-a13` `assert(true)`
  - `m2-a25` `assert(own || true)`
  - `m3-a11` `assert(true)`
  - `m4-a09` `assert(msg?.editedAt || true)`
  - `m5-a05` `assert(true)`
  - `m6-a08` `assert(true)`
  - `m6-a09` `assert(true)`
  - `m6-a11` `assert(true)`
  - `m8-a06` `assert(true)`
  - `m8-a07` `assert(true)`
- **Tests that do not exercise the observable:**
  - `m2-a11`: only checks that the payload is truthy.
  - `m2-a18`, `m2-a20`, `m2-a26`, `m8-a05`: only check `Array.isArray`.
  - `m2-a12`: checks the body contains "https://", not that the link is
    tappable.
  - `m2-a22` and `m2-a23`: check page length `<= 20`, not that a next page
    loads.
  - `m2-a27`: checks that the count is a number.
  - `m3-a15`: replays only `starter-m1.log` and compares inbox length.
- **M1:** its tests are API proxies for UI observables, but they exercise
  the underlying behavior, so I recorded M1 as weak but honest.

**Verdict: dishonest** for M2, M3, M4, M5, M6, and M8. Each adjudicates to
`capability-failure` (scoring only), and O1 scores those checklists as not
passed. The IDs I sampled are listed in the report.

## 4. Phase 3: independent checklist execution

Grader scripts, all under `grading/work/`:

- `grader-api-probes.mjs`: API probes; evidence
  `evidence/api-probes.{json,log}`.
- `grader-web.mjs`: Playwright on the web build; evidence
  `evidence/web-probes.{json,log}` (run 1) and
  `evidence/web-probes-2.{json,log}` (run 2). Screenshots are in
  `evidence/screens/`.
- `grader-web-m1a03.mjs`: redo of the m1-a03 web check.
- `grader-web-convo-diag.mjs`: conversation sync diagnostic.
- `grader-repost-recheck.mjs`: repost clear and fan-out recheck.
- `grader-apimd-variation.mjs`: m6-a12.
- `grader-sample50-verify.mjs`: m6-a13.
- `grader-digest.mjs`: the M8 digest experiment.

Scoring rule for UI-shaped assertions: I judged them on the web build,
where interaction proofs run. When the server semantics were correct but
no user-reachable web control existed, the assertion fails and the API
observation goes in the note.

`[choreo]` assertions are scored only from `receipts/choreo-m{1,2,3}.jsonl`.
No M4, M5, M6, M7, or M8 choreography receipts exist, and no simulator or
native artifact exists.

### M1 {#m1}

- **Web sign-up (m1-a02):** a new account lands on the authenticated feed
  tabs.
- **Duplicate email (m1-a04):** shows the visible error "E_AUTH: that
  email already has an account; sign in instead".
- **Duplicate handle, API (m1-a03):** the server refuses it with
  `E_CONSTRAINT`.
- **Duplicate handle, web (m1-a03):** the app derives the handle from the
  email local part (`lib/ids.ts`).
  - Signing up as `carol@<random>.test` signed in with **no error**.
  - Settings showed a bare `@` and the Me screen had no profile.
  - `/profile/edit` rendered nothing, because it requires an existing
    profile.
  - Evidence: `evidence/web-m1a03-redo.json`,
    `screens/m1-a03-redo-signup.png`.
  - The first web attempt was invalid: my script mis-read the toggle label
    and submitted a sign-in. The redo toggles into sign-up mode, which I
    verified by the submit label changing from "Sign in" to "Sign up".
- **Logout revocation (m1-a07):**
  - Before logout, `/q/me` returned 200; after `POST /auth/logout` it
    returned 401 `E_AUTH`.
  - Other sessions stay valid, and `logout-all` revokes them (401).
- **Profile edit (m1-a08) and avatar (m1-a10, m1-a11):** on web the
  display name and bio saved and showed on the profile. The avatar was
  uploaded through the edit screen's file input and renders as a blob
  image.
- **Validation:** a bad handle, a 201-character bio, and a non-URL link
  were all refused with `E_INPUT`.

Source inspection {#m1-source}:

- **m1-a12:** `snapback/schema.q:4` has `use identity`, the built-in
  identity whose README documents Argon2 (lines 821–825). The lane store
  holds 61 rows of `$argon2id$v=19$m=19456,t=2,p=1`. I counted by pattern
  only; no hash values were copied.
- **m1-a13:**
  - No hits for any fixture password string in `.snapback4/store.sqlite`,
    its WAL, `push-log.jsonl`, or `dist/`.
  - The web session store holds only the bearer token
    (`localStorageSessionStore`).
  - Fixture passwords appear only in test scripts: `scripts/acceptance.mjs`,
    `replay-actions.mjs`, `custom-client-demo.mjs`, and `debug-dm.mjs`.
    That is the declared fixture exception.

### M2 {#m2}

**API:** text, image (2 images), and video posts all succeed, and the clip
is served to other users with 200 `video/mp4`. The follow graph and feeds
behave as specified:

- Following a user projects all 28 of their posts into Following
  (20 + 8 pages).
- Unfollowing leaves 0 of their rows in Following, and all of them stay in
  Global.
- An unfollowed author appears in Global but not Following.
- Likes are idempotent: double set gives 1, double clear gives 0.
- A followed user's repost surfaces the original post in Following.
- The thread lists parent, then reply 1, then reply 2; replies are absent
  from both feeds.
- Cursor paging: Global 20/20/20/7, with no duplicates, no gaps, and
  newest first.
- Implicit self-follow: own posts and own reposts appear in Following, and
  the counts stay 0.
- Self-follow is refused with `CANNOT_FOLLOW_SELF`.

**Web:**

- The URL renders as a `role=link` span, and tapping it calls
  `window.open` with the URL. The text post has no media or preview node.
- Cards show "↻ Reposted by {display name}". Alice's own repost toggle
  shows the attribution, then removes it.
- Global scroll goes 20 → 40 items; Following scroll goes 20 → 26, with
  26 unique items, newest first.
- The thread screen shows the parent, then the replies in order.

**m2-a17 fails.** Recheck in `evidence/repost-recheck.json`: after Z
reposts and then clears:

| step | Global repost rows | follower Y's Following repost rows | repostCount |
|---|---|---|---|
| after repost | 1 | 1 | 1 |
| after second set | 1 | 1 | 1 |
| immediately after clear | 0 | **1** | 0 |
| 75 s after clear | 0 | **1** | 0 |
| re-repost | **0** | 1 | **0** |

**Root cause:** in `schema.q:646-657`, the clear loop point-reads
`feed[f.followerId, …]` as the reposter. The `feed` read rule is
`.readerId = viewer`, so each read returns null and the follower's row is
never deleted. The later insert-if-absent then collides with that hidden
row, which returns `E_RULE` and rolls back the whole mutation (per the
snapback4 README's Rules section).

**Server shape validation is missing:**

- kind `images` with a video clip: accepted;
- kind `images` with no image: accepted;
- kind `text` carrying an image: accepted.

**[choreo]** (`choreo-m2.jsonl`, segment passed):

- m2-a04 passed best-of-3. Image and video each failed one attempt on a
  25 s timeout.
- m2-a05, m2-a14, and m2-a19 passed.
- **m2-a07 has no observation**, so it is `not-run`. The harness's
  `follow-unfollow-live-projection` checks the Following projection and
  never reads the follower count (`toggleFollow` in
  `instrument/choreography/choreography.mjs`).

### M3 {#m3}

**API:**

- `createDm` with the same sorted pair returns `reused:true` and the same
  id.
- Two groups with identical members (Alice, Bob, Carol) are distinct.
- A non-admin `removeMember` is refused with `NOT_ADMIN`.
- After removal, the removed member cannot read new messages or send
  (`NOT_MEMBER`).
- A non-member reading a DM gets 0 rows.
- A quoted reply carries `quoteId` and the quote body.

**Extra trust checks:**

- `createDm` with the pair in unsorted order creates a **second channel**
  for the same two users.
- `createDm` by D with pair keys (D, E) and `other = B` is accepted. E's
  later DM to D resolves to that channel (reused) and E's send is refused
  `NOT_MEMBER`, while B is a member.

**Web:**

- The quoted excerpt renders as "Someone: jump origin message". The label
  is wrong; it should be the sender's display name.
- **Tapping the preview does not jump:** `scrollTop` stayed at 1523 and
  the original stayed out of view, in both web runs.
  `WebConvoSurface.tsx:89` has no click handler on the preview.

**Conversation sync diagnostic** (`evidence/web-convo-diag.json`):

- In a fresh DM, text, photo, video, and view-once messages each arrived
  live in about 300 ms.
- After an edit, a delete, and a reaction, the recipient's
  `GET /sync?...&pending=[...]` failed (`net::ERR_FAILED`, reported as a
  CORS block), and the conversation rendered **0 bubbles**.
- Earlier, in a 41-message DM, messages sent while the conversation was
  open never rendered (20 s wait), and after a reload the list stayed
  stale (`screens/m4-m5-web-convo-affordances.png`).
- Cause: `ConversationView.tsx:124-145` re-fires `markDelivered` and
  `markRead` for every message at 0, 0.4, 1.2, and 3 s on each change,
  which fills the durable outbox that is sent as `pending`.

**Overlay persistence** (`grader-web-overlay.mjs`, started 1789370138,
load 18.26; evidence `evidence/web-overlay-nav.json`,
`screens/overlay-after-nav.png`): I opened a DM on web, then left through
in-app navigation (the Following tab calls `router.replace('/')`). On the
feed route, `#clique-web-convo` was still present and visible at top 64 px
with height 836 px, still held the conversation bubble, and covered the
rendered feed items. The overlay is appended to `document.body` and never
removed (`WebConvoSurface.tsx:41-77`); filed as d-14.

**Seed idempotency (m3-a15):** passes.

- Check: `grader-api-probes.mjs m3-a15`, starting at 1789369400 (load
  25.15), with nothing else running.
- Snapshot of all 8 personas: follower and following counts, per-author
  post counts with like/repost/reply counts, and every conversation's
  message and member counts, plus Global row count.
- Then I re-ran every installed starter segment (m1, m2, m3) through
  `scripts/seed.mjs` and took the snapshot again.
- Result: identical (Global rows 103 → 103, empty diff).
- Earlier runs:
  - The first re-run, done after the suite had unfollowed and unliked,
    differed only by restored follow set-state (`alice.followers 3→4`,
    `bob.following 1→2`). There were no duplicates.
  - In both back-to-back re-runs (m2 spawned right after m1, output
    suppressed), the m2 segment exited 1 but left state unchanged.
  - Two standalone m2 re-runs exited 0.

**[choreo]** (`choreo-m3.jsonl`, **segment failed**, 5 required failures):

- `dm-live-messages` failed 3/3.
- `sender-avatar-identity-when-rendered` was skipped because no avatar
  node is rendered.
- `typing-indicator…` failed 3/3: the indicator was not visible within
  2 s.
- `receipt-sent-delivered-read-transitions` failed: "delivered" never
  appeared.
- `group-receipt-waits-for-slowest-member` failed.
- `member-add-promote-remove-leave-and-live-cutoff` **passed** (m3-a12,
  m3-a13).
- `quoted-reply-excerpt-and-jump` (non-required) failed.

### M4 {#m4}

**API:**

- A photo message is fetched by the recipient with 200 `image/png`; a
  video message with 200 `video/mp4`.
- Reactions: 👍 → ❤️ replaces (one row); clearing leaves 0 rows. A
  non-member reacting gets `NOT_FOUND`.
- An edit inside the window sets `editedAt`. A non-author edit is refused
  `NOT_AUTHOR`, and a caption edit is allowed.
- **m4-a10:** an edit 63 s after send was refused `EDIT_WINDOW_CLOSED`.
  Passing extra caller-supplied `at`/`now` arguments gets HTTP 400.
- A delete 123 s after send was refused `DELETE_WINDOW_CLOSED`.
- **m4-a12:** the asset returned 200 before delete-for-everyone and 404
  for both recipient and author afterwards. The row is tombstoned with its
  body and media cleared. A non-author delete is refused `NOT_AUTHOR`.

**Web** (`evidence/web-probes-2.log m4-web-affordances`): Bob's reloaded
conversation had these test-ID counts, all 0:

- `sm-convo-media`, `sm-convo-react`, `sm-convo-reaction-chip`
- `sm-convo-edit`, `sm-convo-delete`, `sm-convo-viewonce`
- `sm-convo-tombstone`, `sm-convo-sender-avatar`
- img/video elements

There is no "edited" label.

**Sender side (m4-a01-web):**

- The `sm-convo-attach` button opens no file chooser (it has no handler).
- The only file input is 1×1 at (0, 98), and the topmost element at that
  point is a message bubble.
- A programmatic `setInputFiles` plus Send did store the photo message.
  A user cannot pick a file.

**[choreo]:** no M4 receipt exists, so m4-a02, a04, a05, a08, and a11 are
`not-run`.

### M5 {#m5}

**Disappearing messages (m5-a01–a03)** (`evidence/web-probes-2.log`,
disappearing-message flow):

- Setup: a DM between two grader users, with a control message sent
  before enabling disappearing. The "24h" option is a 180 s TTL under the
  shortened config.
- Messages: a text and a photo sent after the change.
- Before expiry: the recipient's persistent browser profile synced the
  messages, and warm-offline search (network cut) found both the control
  and vanishing words. The client was closed 155.6 s before expiry.
- 15 s after expiry, with all clients closed (m5-a01):
  - neither history shows the expired messages;
  - global and in-chat search return 0 hits;
  - the photo asset returns 404;
  - the control message is kept.
- Relaunching the same browser profile online (m5-a02): the control bubble
  synced and 0 expired bubbles rendered.
- Offline search after that sync (m5-a03): the expired word returns 0
  results and the control word is found.

**View-once (API):**

- A Range request before viewing gets 416 and does not consume the view.
- First GET is 200, the second is 410; a non-member gets 404.
- In a group: B and C each get one 200, then 410.
- Web has no view-once control (m5-a04 fails).

**Chat config:**

- A member rename or disappearing change is refused `NOT_ADMIN`; the admin
  rename and color change succeed.
- In a DM, any member can change the disappearing setting.

**Search:**

- People search for "car" and "CAR" returns Carol, on API and web.
- `inChatSearch` for "noodles" works on the API, but **no chat-scoped
  search surface exists** in the app. The search screen scopes are
  All/People/Messages across all chats, and the conversation has no
  search input.
- Global search for "coffee" is grouped under "WEEKEND PLANS" and "DIRECT"
  headers on web.
- Erin gets 0 hits for messages in chats she is not in.

**[choreo]:** no M5 receipt exists, so m5-a07 and m5-a12 are `not-run`.
The warm-offline search above is recorded as a diagnostic only.

### M6 {#m6}

- **Push seam (m6-a08, m6-a09):** Bob had no client connected, and
  grader user A sent a 110-character text, a photo, a video, and a
  view-once photo. The worker logged 5 payloads for Bob, with keys
  `targetUserId, chatId, senderDisplayName, preview, kind`.
  - The text preview equals the first 80 characters.
  - Media previews are "Photo" and "Video", and the view-once photo is
    "Photo".
  - Nothing was sent to the sender.
- **Demo (m6-a10):** `scripts/custom-client-demo.mjs` exited 0.
- **m6-a11 fails:** the demo fetches one page without following the
  cursor, and it calls `/changes` once without reading new messages
  (`scripts/custom-client-demo.mjs:14-31`).
- **m6-a12 passes:** `grader-apimd-variation.mjs` used only API.md (plain
  `fetch`: login, `/q/inbox`, `/q/threadMessages` with cursor `c`). It got
  the latest "Weekend Plans" message (id sm0015, 9 messages paged, newest
  first).
  - API.md gaps: inbox row fields and ordering are undocumented.
  - History objects lack a type field, reaction aggregates, and receipt
    state.
- **m6-a13 passes:** after the adapter replayed `sample-50.log` on the
  grading instance, all 50 actions were verified across 13 verbs with 0
  failures (`evidence/sample50-verify.json`). No harness-validation
  receipt exists in the lane.

Native {#m6-native}:

- No simulator recording, native receipt, or `.xcresult` exists in the
  lane, so m6-a01..a07 (and m8-a17/a18) are `not-run`.
- Platform proof {#platform-proof}: `find dist -type f` shows only
  `dist/ios-m1` and `dist/ios-m8`, each holding `clique-logo.png`,
  `video-poster.png`, and `snapback4_device_bg.wasm`. There is no
  Hermes/JS bundle.

### M7 {#m7}

M7 has not been attempted: the fresh day-2 session runs after grading, and
`ENVIRONMENT.md` forbids attempting it earlier. All nine M7 assertions are
`not-run`. m7-a09 is `not-run` rather than `not-applicable`, because
milestones that were green before M7 exist (M1, and M2 by receipt).

### M8 {#m8}

- **Insights (m8-a01):** before any suite writes, Alice's API Insights
  exactly matched the counts I derived from `starter-m2.log`: posts 3,
  likes received 2, reposts received 1, replies received 1, followers 4,
  following 2. Later, the web tiles matched the API at load time: posts 6,
  likes 2, reposts 0 (a suite test had removed Carol's repost), replies 1,
  followers 4, following 2.
- **7-day breakdown (m8-a03, m8-a04):** a new post increments `p0`, and
  `today` equals the UTC day index 20710. Web shows 7 day rows with zeros.
- **Trending (m8-a05–a07):**
  - The most-liked post in the trailing 24 h ranks first (2 likes against
    a seeded maximum of 1).
  - A post row backdated 25 h, inserted with dev `/seed` on the grading
    instance as the precondition and liked by 8 users, is absent.
  - Tied posts order newest first.
  - The web Trending tab shows the same 10 rows in the same order.
- **Digest experiment (m8-a08..a12):** `grader-digest.mjs`, starting at
  1789369475 (load 17.72; 13.8–21.4 during the run). Evidence:
  `evidence/digest-experiment.{json,log}`. Periods are 120 s, aligned to
  the epoch per the shortened config, and no client was connected.
  - **Setup:** five fresh users.
    - U1 is the target and follows U2.
    - Group G1 contains U2 and U1; group G5 contains U2 and U5.
    - A DM connects U3 and U2; U1 is not a member.
    - U4 is inactive.
  - **Period P** (start 1789369560000; activity done 3 s in):
    - U2 and U3 follow U1.
    - U2 posts once and sends 3 messages in G1.
    - U3 sends 2 messages in the DM.
    - U2 sends 2 messages in G5 and deletes one for everyone.
  - **Results for P:**
    - U1 got exactly 1 digest, `{newFollowers 2, newPostsInFollowing 1,
      unreadMessages 3, unreadChats 1}`, which is exact. The 2 DM messages
      it cannot read did not count (m8-a12).
    - U2 got exactly 1, `{0, 0, 2, 1}`, which is exact.
    - U3 and U4 got none (m8-a09).
    - **U5 got `unreadMessages 2`** when 1 was expected: the
      deleted-for-everyone message was counted. m8-a08 fails on this and
      d-12 is filed.
  - **Period P+1** (no activity): no digest for U1, and U1 has 1 digest in
    total (m8-a10).
  - **Period P+2:**
    - Activity: U4 follows U1, and U2 sends 1 message in G1.
    - 60 s in, I killed my own backend PID 42231 and restarted it as 94836
      (down 207 ms; the worker survived).
    - Result: U1 got exactly 1 digest for P+2, `{1, 0, 1, 1}`.
    - 30 s into P+3, I restarted again (94836 → 8006).
    - Checked after P+4: still exactly 1 digest for P+2 (m8-a11).
  - **Period P+3, late-post race:** U2 posted 112 s into the period.
    - U1 got no digest for P+3 and none for P+4.
    - Cause: the minute-level fan-out job attributes the post to P+3 after
      P+3's digest has already run (d-13).
- **[choreo]:** no M8 receipt exists, so m8-a02 and a13–a16 are
  `not-run`. There is no native artifact, so a17 and a18 are `not-run`.

## 5. Phase 4: holdout probes

Skipped. No probe set was committed for this wave (deviation 1).

## 6. Phases 5 and 6: defects and O-dimensions

Both are in `grader-report.json`.

Defect IDs d-01..d-11 are always present; d-12..d-14 appear only when
their evidence shows the fault.

O-dimensions:

- **O1 = 10**, below the ~30 anchor. After the coverage adjudication, only
  M1's checklist is credited.
- **O2 = 25**, near the ~30 anchor: multiple major defects in core flows.
- **O3 = null** and **O4 = null**: M6 is not green.
- **O5 = null**: the replay was never attempted.

Tallies from independent execution (pass / fail / not-run):

| scope | pass | fail | not-run | total |
|---|---|---|---|---|
| M1 | 12 | 1 | 0 | 13 |
| M2 | 25 | 1 | 1 | 27 |
| M3 | 8 | 7 | 0 | 15 |
| M4 | 2 | 5 | 5 | 12 |
| M5 | 8 | 2 | 2 | 12 |
| M6 | 5 | 1 | 7 | 13 |
| M7 | 0 | 0 | 9 | 9 |
| **Prior-101 subtotal (M1–M7, `grader-report.json`)** | **60** | 17 | 24 | 101 |
| **M8 (`m8-assertion-results.json`)** | **10** | 1 | 7 | 18 |
| **Complete 119** | **70** | 18 | 31 | 119 |

O1 credits only M1's 12 passes: the dishonest coverage mappings adjudicate
M2–M6 and M8 to not-passed, and M7 was never attempted.

Defects: 8 major and 6 minor (d-01..d-14).

Validation: `grader-report.json` validates against
`grader-report.schema.json` (AJV 2020-12, from the harness copy).

Partition:
- the report's 101 IDs exactly equal `GRADER_ASSERTIONS_101.txt`;
- the 18 M8 IDs exactly equal the manifest's M8 list;
- the union is 119 unique IDs with no overlap.

## 7. Timing and load records

| record | measurements (ms) | best | bound | passed | load |
|---|---|---|---|---|---|
| m1-a09 profile edit live (receipt) | 79.1 / 76.6 / 79.8 | 76.6 | none | yes | not captured by receipt |
| m2-a04 text post live (receipt) | 213.3 / 220.9 / 121.5 | 121.5 | none | yes | not captured |
| m2-a04 image post live (receipt) | 238.8 / 25090.3 (timeout) / 223.8 | 223.8 | none | yes | not captured |
| m2-a04 video post live (receipt) | 204.3 / 25100.5 (timeout) / 222.6 | 204.3 | none | yes | not captured |
| m2-a14 like live (receipt) | 120.1 / 144.3 / 89 | 89 | none | yes | not captured |
| m2-a19 reply count live (receipt) | 401 / 323.9 / 328.1 | 323.9 | none | yes | not captured |
| m3-a01 DM live (receipt, attempt durations) | 25264.3 / 26135.2 / 26555 | 25264.3 | 25000 | no | not captured |
| m3-a06/a07 typing (receipt, attempt durations) | 14209.7 / 15836 / 16907.7 | n/a | 2000 / 5000 | no | not captured |
| grader m4-a10 edit window | refused at 63006 after send | n/a | 60000 | yes | 13.81–14.01 |
| grader delete window | refused at 123003 after send | n/a | 120000 | yes | 13.81–14.01 |
| grader m5-a01 expiry refusal | checked 15014 after expiry | n/a | refuse within 300000 | yes | 15.4–25.2 |
| grader conversation live diagnostic | ~221–428 per step until the sync failure | n/a | none | n/a | 18.11 |

Load at the digest experiment and the other grader-run steps is logged in
§3 and in `grading/logs/*.stdout`.

## 8. Teardown

At epoch 1789370206 (load 13.64), I stopped only the processes I started,
reading their PIDs from `grading/pids/`:

- push worker 53358;
- Expo web 45642, whose child processes 46280–46290 exited with it;
- backend 8006, the third incarnation. The earlier backends 42231 and
  94836 had already been stopped by my own restarts, recorded in
  `pids/history.log`.

I used no pattern kills (no pkill or killall). Afterwards nothing was
listening on 49300–49319.

Cleanup:

- Deleted the minted `service:pusher` token file and the persistent
  browser profile used for the disappearing-message relaunch.
- The grading instance's store (`grading/work/.snapback4/`) is retained
  for audit. It belongs to a stopped local dev instance and holds grader
  test accounts only.

Credential scan of `trace.md`, both result files, `evidence/`, and
`logs/`: no fixture password strings and no bearer or token values.
