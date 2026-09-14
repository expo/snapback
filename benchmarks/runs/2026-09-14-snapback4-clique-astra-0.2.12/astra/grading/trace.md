# Grader trace — social-messenger lane `astra-snapback4` (sanitized)

Grader: family `claude`, model `claude-opus-5`, fresh session. Frozen protocol:
`instrument/grader/grader-prompt.md`. Wave `full-3models-astra`, run scope `full`,
backend `snapback4-0.2.12` (public npm `snapback4@0.2.12`, `snapback4-expo@0.2.4`).
Session wall clock: epoch 1789413613 to about 1789415500 (2026-09-14, UTC-7 local).

**Redaction.** This trace contains no credentials. Fixture passwords were read from the
fixture pack in memory only. Grader-created throwaway accounts used random in-memory
passwords. No bearer token was printed or persisted. Host identifiers and account emails
are omitted. Raw console output, receipts, and screenshots stay under `grading/evidence/`
as the private audit set; this file is the published artifact.

## 0. Contamination statement and recorded deviations

- **Not contaminated.** I did not open the builder's `diary.md`, `essay.md`,
  `final-report.md`, `FINAL.md`, or `run-log.md`, and I did not open any other lane.
  `README.md` mentions those files by name; none of them were read. No self-scores reached
  me. (A directory listing of `lanes/` shows other lane names; nothing inside them was
  read.)
- **Deviation 1: no holdout probe set was committed.** `probes/rotation-log.md` has no
  rows. Execution phase 4 was skipped. `wave.probeSetSha256` is `none-uncommitted` and
  `probeResults` is `[]`. No probes were invented. O3, whose only admissible input is the
  rotated probe set, is therefore `null` (§7).
- **Deviation 2: this grader family has not passed calibration.**
  `calibrationPassed=false` and `sameFamilyGraded=false`, so the grade is labelled
  `uncalibrated-grader`.
- **Deviation 3: shared-machine timing.** Timing checks are judged best-of-3. The 1-minute
  load average is recorded beside each timing record (§4.1, §4.3). Load during grading ran
  from 9.8 to 25.5 on 18 cores, because other sessions share this machine.
- **No run record.** `run-record.json` is absent, so grading used the lane receipts
  (`evidence/`), the coverage manifests (`evidence/mN-coverage.json`), and artifacts
  (`artifacts/`), plus my own execution.
- Nothing is `struck-by-environment` (`ENVIRONMENT.md`).

## 1. Environment, clean checkout, processes

- Clean checkout: I copied the lane's source files into `grading/checkout/` (API.md,
  README.md, app, config, public, scripts, snapback, src, ui, package manifests,
  choreography, metering). I left out `node_modules`, `.snapback4` state, `.expo`,
  evidence, artifacts, scale stores, and narrative files. `npm ci` (exit 0) ran in the
  checkout and in `checkout/choreography`. `instrument` is a symlink to the read-only
  instrument. `npx snapback4 check` passed with 14 notes. `config/active.json` selects
  `windows.shortened` and `digest.shortened`, and both are byte-identical to the fixture
  pack's shortened configs.
- The grader instance started with a fresh store. I seeded it with the lane's documented
  `npm run seed -- --segment m1|m2|m3` (16, 52, and 18 actions).
- Processes I started, all recorded in `grading/evidence/grader-pids.jsonl`, all on ports
  in 49360–49379, all stopped by PID at the end with no listeners left in the range:

| Name | PID (child) | Port | Started / stopped |
|---|---|---|---|
| backend (`snapback4 dev`) | 51499 (51501) | 49360 | 1789413810 / killed 1789415091 for the M8 restart test |
| push-worker | 53233 | — | 1789413819 / 1789415483 |
| web (`expo start --web`) | 53261 | 49361 | 1789413819 / 1789415483 |
| scale-clone backend | 99157 (99162) | 49366 | 1789414831 / about 1789414925 |
| backend-restart | 38944 (38954) | 49360 | 1789415091 / 1789415483 |

- No pkill or killall was used. The children exited with their parents, which I verified
  with `ps` and `lsof`.
- Harness support: the frozen choreography copy imports `../../lib/json-schema.mjs`, so I
  copied the instrument root's `lib/json-schema.mjs` into `grading/lib/`. I also wrote a
  grader setup identity (`grading/evidence/setup-identity.json`: the lane's closure with
  the runner's Node 24.18.0 toolchain) because the harness refuses a Node-version mismatch.
  The fixture adapter points at the absolute instrument fixture directory. Harness source
  is unmodified: `diff -rq` against `instrument/choreography` shows only the lockfile.

## 2. Phase 1 — builder suite (`npm run acceptance -- --milestone mN`)

I ran the suite from `grading/checkout` against the grader backend. Receipts are
`grading/evidence/suite-mN-run1.{txt,json}`.

| Milestone | Result | Tests |
|---|---|---|
| M1 | pass | 6/6 (seed idempotency, signup, profile edit, avatar, duplicate handle, duplicate email) |
| M2 | pass | 8/8 |
| M3 | pass | 5/5 |
| M4 | pass | 6/6 |
| M5 | pass | 5/5 |
| M6 | run 1 **fail**, run 2 **pass** | run 1: `disconnected-recipient-push` found no push row. Run 2 (1789413933): 3/3 |
| M8 | pass | 3/3 |

**M6 run-1 analysis.** I started M6 three seconds after the M5 suite, which had Bob signed
in through a browser. The engine counts a principal as connected for 35 s after its last
long-poll (snapback4 README §2 Presence). The seam therefore correctly suppressed Bob's
push. My chained invocation caused this, not a lane defect. Waiting past the window, the
re-run passed. That was the one phase re-run (`rerunsUsed=1`). Note that the suite test
never establishes that Bob's clients are closed.

All coverage manifests map every suite-required assertion; `missing` is `[]` in every
receipt.

## 3. Phase 2 — coverage-manifest spot verification

I compared `evidence/m{1,2,3,4,5,6,8}-coverage.json` (identical in shape to the manifests
regenerated in my checkout) with `scripts/acceptance*.mjs`. I sampled 16 mappings: m1-a03,
m1-a08, m1-a11, m2-a16, m2-a24, m2-a25, m3-a11, m3-a15, m4-a07, m5-a05, m5-a11, m6-a09,
m6-a13, m8-a01, m8-a06, m8-a07.

**Verdict: honest.** Every sampled test exercises the assertion's observable or its
server-enforced core. For every suite-required ID, my independent result matched the
suite's result. Five mappings are weaker than the assertion wording; none shows a sham or
unrelated test:

- m1-a03: tests the duplicate handle through profile edit (`sm-profile-error`), not
  sign-up. I re-ran it through sign-up: pass, but see d-01.
- m2-a16: checks attribution through the API `actor.handle`, not the visible label. The UI
  label verified: "↻ Reposted by …".
- m2-a25: does not cover the follows-nobody case. Verified via API.
- m5-a05: relies on the `opened` state plus the server's asset refusal rather than a second
  open. The harness did re-activate the view-once affordance: it showed `opened` and the
  viewer did not render. My API second fetch returned 410 E_ASSET_VIEWED (§4.2).
- m8-a06: backdates the post through the lane's CLI-only job `test-fixtures.ancientPost`,
  and that post never enters the `ranked` table. Verified with the same seam plus source
  inspection.

No milestone is adjudicated `capability-failure`.

## 4. Phase 3 — independent checklist execution

### 4.1 Frozen choreography harness, grader-run (two to four browser contexts, web build)

Receipts: `grading/evidence/choreo-<seg>-run1.jsonl` and `choreo-m2m8-run2.jsonl`. I cross-checked them against the lane's own
receipts `evidence/mN-choreography.jsonl`; those also pass every web check.

| Segment (start epoch, load) | Outcome | Checks → assertions |
|---|---|---|
| m1 (1789414166, 16.70) | green | profile-edit-live-visibility → m1-a09 (visibleMs 174.1/140.6/144.9); session-persists-on-relaunch → m1-a05; logout-remains-signed-out-on-relaunch → m1-a06 |
| m2 (1789414181, 21.55) | green | feed-text/image/video-post-live-update → m2-a04, m2-a01, m2-a03 (text 823.3/95.8/141.8; image 186.1/172.9/171.2; video 161.9/164.9/165.6); feed-author-avatar-and-display-name → m2-a05; follow-unfollow-live-projection → m2-a06/a08/a09; like-unlike-live-count → m2-a14/a15 (389.1/61.5/59.1); repost-toggle-live-attribution → m2-a16/a17; repost-following-feed-surface → m2-a10/a11/a26; reply-live-thread-projection → m2-a19/a21 (403/178.7/170.7) |
| m3 (1789414202, 23.38) | green | dm-live-messages → m3-a01 (417.6/526.2/292.5); sender-avatar-identity-when-rendered (implemented) → m3-a02; typing → m3-a06 (visible 12.4/28.6/24.9 ms, bound 2000) and m3-a07 (expiry 4309/4331.4/4318.5 ms, bound 5000); receipt-sent-delivered-read-transitions → m3-a08; group-receipt-waits-for-slowest-member → m3-a09; member-add-promote-remove-leave-and-live-cutoff → m3-a12/a13; quoted-reply-excerpt-and-jump 3/3 → m3-a10/a11 |
| m4 (1789414246, 19.63) | green | photo-message-live-render → m4-a01/a02 (496.4/519.9/499.9); video-message-live-playback → m4-a04; reaction-live-replace-remove → m4-a05/a06/a07 (305.6/278.9/388.7); edit-live-visibility → m4-a08/a09 (151.5/168.8/181); delete-live-tombstone → m4-a11 |
| m5 (1789414262, 17.29) | green | chat-color-background-sync → m5-a07; view-once-single-view-and-refusal → m5-a04/a05; warm-offline-search-over-synced-messages → m5-a12; disappearing-message-expiry-and-purge (303 s) → m5-a02 (relaunch purge) |
| m6 (1789414600, 9.81) | green (web) | offline-message-queue-flush-in-order: pending → in order → read (flush 412 ms). `supplementalExternal` ios-simulator-m6 is **not-recorded** |
| m8 run 1 (1789414602, 12.23) | **not green** | m8-a02 failed: "Global feed exposed no observably unliked Alice post for Bob". Minutes earlier my browser checks had created about 30 posts from grader accounts, which pushed every Alice post off Bob's first Global page. This was grader-induced. m8-a13/a14/a15/a16 passed |
| m2+m8 run 2 (1789414642, 25.52) | green, green | m8-a02 passed (likes received 32 → 33, refresh 297.9 ms); m8-a13 (430.9 ms), m8-a14 (806.4 ms), m8-a15 (flush 362.5/301), m8-a16 read. m2 re-run text-post 114.7/88/60.2. `supplementalExternal` ios-simulator-m8 is **not-recorded** |

Best-of-3 judgment: every timing-sensitive check passed. The best attempt is within bound
wherever a bound exists (m3-a06 and m3-a07); elsewhere the observable is "live without
manual refresh".

### 4.2 Custom-client API probes

Driven over plain HTTP per `API.md`, using fresh grader-owned accounts A, B, C, D.
Evidence: `grading/evidence/api-probes.json` (start about 1789414390) and
`api-probes-2.json`.

**4.2.1 m1-a07, session revocation.** Before logout a query returned 200. `/auth/logout`
returned 200 `{ok:true}`. The same bearer then got **401 E_AUTH** on a query and on a
mutation. After `/auth/refresh`, the old token got 401 and the new one 200. Sessions last
7 days.

**DMs and groups.** Starting the DM from either side returns the same id. Two groups with
identical members (A, B, C) are distinct, each with 3 members.

**m6-a08/a09, push seam.** B had never connected. Three payloads were logged, each with
exactly the keys `{chatId, preview, senderDisplayName, targetUserId}`, the right chat, and
the sender display name. Previews were the first 80 characters of a 140-character text,
`Photo` for a view-once photo, and `Video` for a clip.

**m4-a12, delete revokes asset.** The recipient's asset fetch returned 200 before delete
and **404** after; the uploader also got 404 after. A non-member got 404 even before
delete. History shows `tombstone:true`, empty text, `mediaReference:null`.

**m5-a06, view-once.** Recipient's first fetch 200, second **410 E_ASSET_VIEWED**,
non-member 404. In a group (api-probes-2), each member gets one view: B 200 then 410, C 200
then 410, D 200.

**Trust boundaries** (non-member C on the A–B DM):

- `client.history` NOT_MEMBER; device `chat.history` empty; `chat.message` null.
- send NOT_MEMBER; edit, delete, react, and acknowledge MESSAGE_NOT_FOUND; customize
  NOT_MEMBER.
- searchChat, room, roster, and typers all empty or null.
- B editing A's message: NOT_AUTHOR.

In a group, the non-admin's remove, add, self-promote, rename, and color change were all
refused NOT_ADMIN, and an off-palette color got INVALID_COLOR. After A removed C, C's
history was NOT_MEMBER, C could not read the new message, C's send was refused NOT_MEMBER,
and the group left C's conversation list. A member added later saw the full prior history
(api-probes-2). Reacting to or editing a tombstone was refused MESSAGE_DELETED.

**Social counts and set-state** (m2-a15, m2-a17, m2-a25, m2-a27, m8-a01, m8-a03):

- Trending scores equal live like counts after likes (P1 3, P2 2) and after unlikes (P2 2
  ranked above P1 1). The score does not lag.
- A duplicate `like state:true` leaves likes at 1. Repost count goes 1 → 2 → 1 on undo.
  Self-follow is refused CANNOT_FOLLOW_SELF.
- Insights for A match the controlled activity exactly: posts 2, likes received 3, reposts
  received 1, replies received 1, followers 1, following 0. There are 7 day buckets, and
  today's bucket shows 2 posts and 3 likes.
- An account following nobody sees its own post in Following (`complete:true`) with
  counts 0/0.

Validation (all server-side refusals): uppercase handle, 2-char handle, 51-char display
name, 201-char bio, 51-char location, and a non-URL link all got E_INPUT. A duplicate
handle got E_CONSTRAINT. A 501-char post and a 2001-char message got E_INPUT. A 7-char
password and a duplicate email got E_AUTH.

People search (m5-a09): `car` and `CAR` both find carol, as does the word prefix `chen`.
The mid-word substring `arol` does not match, which conforms to word-prefix semantics.

**4.2.2 m4-a10, edit window** (shortened to 60 s). An edit within the window returned
`sent`. At +65 s, `chat.edit` returned **failed EDIT_WINDOW_CLOSED**, and history still
shows the within-window body. The mutation accepts no caller timestamp; the window is
checked as `now - m.at <= editWindow()` on server time. Delete window (api-probes-2):
delete within 120 s returned `sent`; at +125 s, **DELETE_WINDOW_CLOSED** and the message
stayed visible.

**4.2.3 m5-a01, server-enforced expiry** (24h option = 180 s under the shortened config).
The DM was set to `24h` and a text plus a photo were sent. No client was connected: HTTP
only, no stream, no browser. Before expiry both were present and the asset returned 200.
At 185 s, history for both members omits both messages, `chat.message` is null, server
search has 0 hits, and the asset returns **404**.

**4.2.4 m6-a12, grader-written variation from API.md only.** Task: "fetch the latest
message of the group named Weekend Plans". As Alice: `/auth/login`, then paged
`/q/client.conversations`, then find `conversation.name`, then `/q/client.history`, then
take `data[0]`. `data[0]` has the highest ordinal and the page is strictly newest-first.
Every message exposes the M6 field manifest (id, conversationId, senderId,
serverTimestamp, type, text, mediaReference, edited, tombstone, replyToId,
reactions{emoji,count,mine}, receipt, plus viewOnce and ordinal). Pass.

Documentation gap: every DM is named "Direct message", and API.md never says how to find a
DM's counterpart (chat.roster appears only in `/api.ts`). Filed as d-05.

### 4.3 Grader browser checks

Evidence: `grading/evidence/browser-checks.json`, screenshots `shot-*.png`. Fresh accounts
throughout; load 13.95–15.80.

- **m1-signup.** UI sign-up landed authenticated. Display name, bio, location, and link
  persisted across a page reload. An avatar upload through the file chooser rendered after
  reload. Logging out and signing up with the taken handle `alice` showed a visible error:
  raw text `profiles.byHandle already has a row where handle = 'alice'`.
  **Retrying with a corrected handle and the same email** returned
  `E_AUTH: that email already has an account; sign in instead`. **Signing in with that
  email** reached the app, but `/profile/me` stayed on "Loading profile…" indefinitely
  (`shot-m1-orphan-profile.png`). The duplicate-email sign-up showed a visible error.
  Source: `src/session.tsx submit()` signs up first, then calls `saveProfile`; on failure it
  only signs out, so the auth account survives → **d-01**.
- **m2-a07, follower count live.** X watched its own profile while Y clicked follow on X's
  profile in another context. The count text changed without reload at **39 / 38 / 33 ms**
  (3/3, load 15.18). The frozen harness does not observe this item.
- **m2-links-repost-thread.** The URL renders as `role=link` (`sm-text-link`), and clicking
  it opened `https://example.com/grader-link` in a new page. The card has 0 media nodes and
  0 `img` elements, so no preview. Reposting from Y showed "↻ Reposted by Yuri Grader" on
  X. The thread lists parent, first reply, second reply in order. The reply does not
  appear in Global.
- **m2-pagination-ui.** X had 27 fresh posts. Following: 20 initial items, 28 after scroll,
  27/27 posts, distinct, strictly descending. Global: 20 initial items, 60 after scroll,
  27/27 distinct and ordered.
- **m5-search-ui.** All-messages search for `QUOK` grouped 3 results under
  "DIRECT MESSAGE" and "GRADER SEARCH GRP" (`shot-m5-global-search.png`). The "This chat"
  scope opened from the Search tab returned **0 results** for X's own chat. The same query
  via `/search?conversationId=<dm>` returned 2. Source: `app/search.tsx` uses
  `conversationId||'d-alice-bob'`, and no screen builds a `search?conversationId=` link →
  **d-02**. (The recorded field `conversationScreenHasSearchEntry:true` is a false
  positive: it matched the global nav bar's "Search" label.)
- **m8-insights-ui.** The six tiles equal the API values. There are 7 UTC day rows, and the
  six days before today render "Posts 0 Likes received 0" (`shot-m8-insights.png`).

### 4.4 m5-a02 / m5-a03, client purge

Evidence: `grading/evidence/purge-check.json`. Accounts E and F; DM set to 24h (180 s);
three clients: E, F1 (connected), F2 (closed before expiry).

| Step | Observation |
|---|---|
| Before expiry, E warm-offline in-chat search | 1 result, offline banner shown |
| F1 connected at expiry | bubble removed **81 ms** after expiry |
| E still offline, 2.4 s after expiry | offline search 0 results (the device drops the expired row locally) |
| E reconnects | 0 results (first poll, 526 ms) |
| E offline again after the sync (m5-a03) | 0 results, offline banner shown |
| E conversation online | 0 bubbles |
| F2 relaunched (new page, same storage) | 0 bubbles, still signed in |

### 4.5 m8-a08..a12, scheduled digest

Evidence: `grading/evidence/digest-check.json` and the push-log. Shortened config: 120 s
periods anchored at 00:00. Accounts H1–H5 were created over HTTP and never streamed or
opened a browser. Setup before P1: H1 follows H2; DM H2–H1; group "shared" (H2, H1);
group "private" (H2, H4, H5), which excludes H1.

- **P1** [1789414800000, +120 s]. Activity 3 s in:
  - H2 follows H1 and posts twice.
  - H2 sends 3 DMs to H1 and 1 message in "shared".
  - H2 sends and then deletes a second "shared" message.
  - H4 sends 5 messages in "private".

  Digests were logged 71–76 ms after the period ended, one per user:

  | User | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
  |---|---|---|---|---|
  | H1 | 1 | 2 | 4 | 2 |
  | H2 | 0 | 0 | 5 | 1 |
  | H5 | 0 | 0 | 5 | 1 |
  | H3 (idle) | none | | | |
  | H4 (authored only) | none | | | |

  All match expectations. H1's unread count excludes the 5 "private" messages (m8-a12) and
  the tombstone. The payload keys are exactly
  `kind, newFollowers, newPostsInFollowing, periodEnd, periodStart, targetUserId, unreadChats, unreadMessages`.
  → m8-a08, m8-a09, m8-a12 pass.
- **P2** (no activity): no digest rows for any of the five accounts → m8-a10 pass.
- **P3** [1789415040000, +120 s]. H2 sent H1 one DM 5 s in. I **SIGTERM'd the backend
  52 s into the period** and started a new backend on the same store. Port 49360 was down
  at 1789415091 and back up at 1789415092; the push worker logged socket errors and
  reconnected. Exactly **one** P3 digest was logged for H1: `{0,0,1,1}`, 366 ms after the
  period ended. The audit over every user and period found no duplicates → m8-a11 pass.

### 4.6 Follow-up checks

Evidence: `grading/evidence/followup-checks.json`; load 21.1–21.6.

- **Trending** (m8-a05/a06/a07). Ten fresh accounts:
  - A post with 10 likes is `rows[0]`; the next best has 9.
  - Two 9-like posts: the newer ranks at index 1, the older at index 2.
  - A post aged 25 h through the lane's CLI fixture job, liked 10 times, is absent.
  - Replies are excluded.
- **m2-a18.** Y follows Z but not X. Before Z reposts, X's post is absent from Y's
  Following. After Z reposts, Y's Following gains a repost entry (actor Z, original author
  X).
- **m2-a02.** A UI composer post with two fixture images has `kind=images` and 2 photos;
  the other client renders 2 loaded images (`shot-m2-two-images.png`).
- **m3-a15.** Seeds m1, m2, m3 were re-run (each `alreadyInstalled`). Before and after
  snapshots are identical: 148 Global entries, group history 12, DM page 35, 5
  conversations, follower counts 4/2.
- **m6-a10.** `node scripts/custom-client-demo.mjs` from the clean checkout: pass,
  authenticated, 5 conversations, 1 history page, message received via documented HTTP
  polling.

### 4.7 Source inspection

- **m1-a12.** `snapback/schema.q` declares `use identity password`, the built-in password
  identity (snapback4 README §4: Argon2, bounded slots). The grader store's
  `_credentials` holds 21 `$argon2id$v=19$m=19456,t=2,p=1` PHC strings, the OWASP baseline.
  No hand-rolled hashing.
- **m1-a13.** A byte scan of 399 files (about 1.15 GB) looked for the 8 starter persona
  passwords, in UTF-8 and UTF-16LE. Scope: `artifacts/` web and iOS Hermes bundles, lane
  `evidence/` logs, `app/`, `src/`, `snapback/`, `scripts/`, `public/`, the lane dev store,
  the grader store, grader evidence, and the scale store. **0 hits.** Grader server logs
  contain no token, password, or bearer strings.
- **m6-a11.** `scripts/custom-client-demo.mjs` covers login, conversations, history paging
  (up to 3 pages), send, and 1 s polling receive.
- **m8-a06.** `insights.q` trending reads only `ranked`. `ranked` rows
  `expire at .expiresAt` (post time + 24 h); per the engine docs a row is absent to every
  reader once past that time. `social.like` upserts `ranked` only while
  `p.at > now - 24h`.
- **Findings for the defect list:**
  - `app/search.tsx`: `conversationId||'d-alice-bob'` (d-02).
  - `src/chat.tsx` ChatSettings `onPressAddMember → setQ('d')` (d-04).
  - `app/conversation/[...path].tsx`: `group → 'g-starter'` alias (d-06).
  - `src/session.tsx`: sign-up then profile ordering (d-01).
  - `social.q following`: `entries after c last 20 by byTime where .actorId = viewer or exists follows[...]`,
    read-time filtering over the global entries index (d-03).
- **Security posture notes (not defects).** The dev server accepts `x-snapback-persona`,
  but it maps to a separate `dev:<name>` principal and cannot impersonate `user:` accounts
  (verified). The push dispatch mutation requires `viewer = 'service:pusher'`.

### 4.8 Native / simulator artifacts (O4 input, m6-a01..a07, m8-a17/a18)

- No iOS-simulator choreography artifact exists. In every lane and grader-run M6/M8
  segment summary, `supplementalExternal` reads `ios-simulator-m6|m8`, `pass:null`,
  `status:"not-recorded"`.
- `artifacts/mN-ios/` holds Hermes bundle exports (`evidence/native-artifacts.json`). The
  lane README says they "are not simulator execution proofs".
- The builder's `durable-offline-proof.json` and `scale-cold-sync.json` come from a Node
  `processDevice` replica ("not an iOS simulator claim"). They are builder assertions, not
  harness artifacts, so they are not admissible for O4.
- Per `choreography/simulator.md`, "O4/native scoring remains null or failed until this
  artifact exists." The nine native-artifact assertions record `not-run`, scored as
  not-passed.

### 4.9 M7 and scale record

- **M7.** Not attempted: `ENVIRONMENT.md` schedules it as a separate fresh session after
  grading, and `evidence/final-milestones.json` records `m7: not-run`. All 9 M7 IDs record
  `not-run`. m7-a09's condition (previously green milestones) holds, but M7 has not run.
- **Scale record (lane).**
  - `evidence/scale-result.json`: 167,243 settled actions (167,157 scale actions), log
    sha256 matches `scale-log.sha256`, 184 s execution excluding checkpoint work,
    verification true at 10%, 50%, and final.
  - The replay drove `/auth/signup` and `/m/<mutation>` with settle-before-next receipts
    (`scripts/replay.mjs`); push and digest were off (`replayEnabled()` true in the scale
    schema copy).
  - Post-M8 checkpoint probe record: `evidence/scale-extension.json`. Write-path record:
    `evidence/scale-write-probe.json` (celebrity/baseline p95 ratio 1.04; group send p95
    2.6 ms). Cold sync: 634 ms for 100 conversations.
- **Grader spot verification of the final store** (APFS clone `grading/scale-clone`, deleted after use;
  backend on 49366, read-only queries; evidence `grading/evidence/scale-spot.json`):
  - u0500 follows 500 and has 100 conversations.
  - u0005 follows 5.
  - u0900 has 900 followers and 200 posts.
  - u0901 follows 5, and the first Following page shows u0001–u0004 and u0900.
  - g0001 has 50 members, the roster handles equal the manifest list, and full paging
    returns 10,000 messages over 200 pages with no duplicates and no incomplete pages.
  - A stride sample of 10 DMs matched the manifest exactly (100 messages each).
  - 10 sampled users' following counts matched exactly.
  - Completeness at the envelope:
    - searchAll, Insights, Trending, and Global are complete.
    - **Following is incomplete for sparse users** (d-03): u0005's page 1 has 17 items with
      `complete:false`; u0929 and u0935, who follow nobody, get 2 and 12 items on page 1
      and need 7 and 4 incomplete pages to reach 25 items.

## 5. Phase 4 — holdout probes

**Skipped** (deviation 1). No probe set is committed (`probes/rotation-log.md` has no
rows), no probe was invented, and `probeResults` is `[]`.

## 6. Defect list (O2 input)

| ID | Severity | Milestone | Summary | Evidence |
|---|---|---|---|---|
| d-01 | major | M1 | Signing up with a taken handle orphans the account: the retry is refused as a duplicate email, and after sign-in the profile never loads, so profile setup cannot be completed | §4.3 m1-signup; shot-m1-orphan-profile.png; src/session.tsx |
| d-02 | major | M5 | In-chat search is unreachable for real chats: no entry point, and the "This chat" scope is hard-coded to fixture `d-alice-bob` | §4.3 m5-search-ui; app/search.tsx |
| d-03 | minor | M2 | At the envelope, Following pages for sparse-follow users are short and `complete:false` (read-time filter hits the row meter); the lane's O5 following5 probe timed incomplete pages | §4.9; social.q |
| d-04 | minor | M3 | The add-member picker pre-fills a hard-coded "d" query | src/chat.tsx |
| d-05 | minor | M6 | All DMs are named "Direct message": indistinguishable in grouped search, and API.md does not document counterpart discovery | §4.3, §4.2.4 |
| d-06 | cosmetic | M1 | Raw engine text in the duplicate-handle error; fixture-specific `/conversation/group` alias | §4.3; app/conversation/[...path].tsx |

## 7. O-dimension scoring

- **O1 = 75.** Interpolated between the ~60 anchor ("M1–M4 solid, later milestones patchy
  or failed on cap") and the ~90 anchor ("every in-scope milestone green, including
  platform-proof artifacts").
  - Independent pass count: 101 of 119 (85 of the prior-101 M1–M7 subtotal; 16 of 18 for
    M8).
  - Not passed: 9 M7 assertions (not run) and 9 native-artifact assertions.
  - M1–M5 and the web/API parts of M6 and M8 passed completely.
- **O2 = 55.** Just below the ~60 anchor ("a few medium defects off the happy path"), above
  the ~30 anchor. Two majors off the main path (d-01, d-02) are worse than "medium", but
  there were no crashes, no wrong data, and no core-flow breakage. Three minors and one
  cosmetic.
- **O3 = null.** Applicability would admit O3 (M6 green; M1–M5 attempted), but O3 is
  "scored from the wave's secret rotated holdout probes only", and none was committed
  (deviation 1). For the record, the checklist-level trust checks in §4.2 all refused
  correctly; they do not feed O3.
- **O4 = 10.** Below the ~30 anchor. No admissible native simulator artifact exists, so
  O4 scores as failed per `simulator.md`. The small residual credits the honest gap
  disclosure. Web-harness offline mechanics (M6 ordered flush to read; M8 dual-offline
  convergence) are not native O4 evidence.
- **O5 = band 30.** Exact band function, first-match order 0, 30, 60, 90, 75.
  - **0 did not fire.** The lane's verification reports conformance at every checkpoint,
    and grader spot checks on the store clone matched every named O5 fixture and all
    sampled counts. Replay execution took 184 s, so no cap was exhausted, although the
    wave's calibrated cap is uncommitted.
  - **30 fired.** In the lane's post-M8 checkpoint probe record (`scale-extension.json`;
    u0500 `chat.searchAll 'coffee'`, k=20 after 3 warm-ups, sequential), global message
    search p95 was 1.919 / 2.397 / 2.518 ms at 10% / 50% / full. The 50% point exceeds the
    line between the 10% and full points (2.185 ms), which fails the "no superlinear
    blow-up mid-curve" rule. The lane's own gate records `search.pass:false`.
  - **Every other rule passes.** following500/following5 = 0.094; celebrity read/5-follow
    = 0.52; page 50/page 1 = 1.00; Insights full/10% = 0.29 and mid-curve pass; Trending
    = 0.41 and pass; celebrity write ratio 1.04; group send p95 2.6 ms; cold sync 634 ms,
    no timeout; no probe errors or timeouts.
  - **Caveats.** The failure is at noise scale (about 0.2 ms), and the in-replay checkpoint
    record (search 2.305 / 1.274 / 1.853 ms) passes the same rule. The band function does
    not interpolate, and the post-M8 record is the only one that covers all M8 rules. No
    run record, wave probe set, or calibrated ceilings exist, so the 60/90/75 branches
    could not be distinguished even without this failure.
    d-03 also means the following5 probe measured `complete:false` pages.

No weighted total, efficiency statistic, or cross-lane comparison is computed here.

## 8. Result-file partition, schema limitation, prior measurement gap

- The frozen manifest has **119 unique assertion IDs** (M1 13, M2 27, M3 15, M4 12, M5 12,
  M6 13, M7 9, M8 18). Its `counts` block still says 116; the actual IDs are
  authoritative. All 119 were graded in this one session.
- **Frozen schema limitation.** `grader-report.schema.json` allows only
  `^m[1-7]-a[0-9]{2}$` keys in `assertionResults`. `grader-report.json` therefore carries
  exactly the 101 M1–M7 IDs, identical to `GRADER_ASSERTIONS_101.txt`. The 18 M8 results
  are in `grading/m8-assertion-results.json`, which uses the same record shape and enum
  values; I validated them against the report schema's per-assertion record. No ID appears
  in both files, and together they cover all 119.
- **Prior measurement-coverage gap.** The September 5 and September 12 structured
  `assertionResults` carried only the 101 IDs in `GRADER_ASSERTIONS_101.txt`. Their notes
  could describe M8 observations, but they gave no machine-comparable 18-ID M8 result set.
  Comparisons with those runs are valid only on the prior-101 subtotal.
- Tallies (for the harness to recompute):
  - Prior-101 subtotal: 85 pass, 16 not-run.
  - M8: 16 pass, 2 not-run.
  - Complete 119: 101 pass, 18 not-run, 0 fail.
- I validated `grader-report.json` against the frozen schema with AJV 2020 (from the
  choreography copy's `node_modules`): **valid**. The partition checks also passed.

## 9. Tooling written by the grader (all under `grading/tools/`)

- `launch.mjs`: detached server launch with PID recording.
- `run-choreo.mjs`: runs the frozen harness.
- `api-probes.mjs`, `api-probes-2.mjs`: API checks.
- `browser-checks.mjs`, `purge-check.mjs`, `followup-checks.mjs`: browser checks.
- `digest-check.mjs`: digest schedule checks.
- `api-md-variation.mjs`: API.md-only variation.
- `scale-spot*.mjs`: scale store spot checks.
- `build-report.mjs`, `validate.mjs`: report assembly and validation.

The workspace size is dominated by `grading/checkout/node_modules`. The copy-on-write
`grading/scale-clone` was deleted after the spot checks; its results are in
`evidence/scale-spot.json`.
