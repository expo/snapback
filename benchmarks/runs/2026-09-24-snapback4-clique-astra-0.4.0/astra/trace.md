# social-messenger grading — sanitized evidence and action trace

Lane `astra-snapback4`, backend `snapback4-0.4.0` (public npm `snapback4@0.4.0` /
`snapback4-expo@0.4.0`). Wave `full-3models-astra`. Grader family `claude`, model
`claude-opus-5`. Session outcome: **completed**.

This is the published companion to `grader-report.json`. The raw grading session is
retained privately for audit and is never published. Credentials, bearer tokens and
incidental personal data are redacted throughout: fixture passwords are referred to by
name only, no token or session value appears, and grader-created accounts are described
by display name rather than by the addresses they were registered with.

## Deviations from the frozen protocol (this run)

This is an **N=1 calibration run, not a claim-eligible wave**. Three deviations are
recorded:

1. **No holdout probe set was committed for this wave.** Execution-order phase 4 was
   skipped entirely. `wave.probeSetSha256` is the literal string `none-uncommitted` and
   `probeResults` is empty with an explanatory note. No probes were invented, and no
   anchor probe was run or reported.
2. **The grading family has not passed the calibration gate.** `grader.calibrationPassed`
   is `false` and `grader.sameFamilyGraded` is `false`. The lane was graded anyway; the
   record labels the grade `uncalibrated-grader`.
3. **Timing-sensitive checks are judged best-of-3**, and the machine load is recorded
   beside each timing observation because other sessions shared this host.

A fourth, structural limitation is recorded below under
[Schema limitation and the prior measurement-coverage gap](#schema-limitation-and-the-prior-measurement-coverage-gap).

## Contamination control

The lane directory contains `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and
`run-log.md`. **None of them was read.** `run-log.md` was touched exactly once, by a
byte-scan that emitted only the boolean "contains a fixture password: false" and no
content, as part of the m1-a13 credential sweep; no narrative from it entered this
session. `scripts/report.mjs` (the generator for those documents) was deliberately left
unread beyond a two-line `grep` for the string `midpointCeiling`, which returned nothing.
No other lane under `lanes/` was opened. The session is **not contaminated**.

## Environment and process inventory

macOS arm64; Node v24.18.0 from the absolute toolchain path; Playwright chromium from the
lane's existing `choreography/node_modules`. Machine load (`uptime`, 1-minute average)
was sampled repeatedly and ranged from **8.0 to 54.6** across the session — this host was
shared with other work throughout, which is why every timing judgement below is
best-of-3 and why the O5 noise-floor measurement was taken.

Every process the grader started, all inside the assigned range **49360–49379**:

| Port | Purpose | PIDs (wrapper → listener) |
|---|---|---|
| 49360 | lane backend, `npx snapback4 dev --port 49360` | 87174 → 87197; after the mid-period restart 32450 → 32470 → 32471 |
| 49361 | lane web build, `node scripts/serve.mjs` over `dist/` | 89481 |
| 49362 | isolated in-memory instance for M8 insights/trending | 7131 → 7133 |
| 49363 | isolated instance spawned and reaped by the lane's own M8 suite | self-managed by `scripts/accept-m8.mjs` |
| 49365 | backend over a **copy** of the retained final scale store | 58752 → 58754 |
| 49366 | grader HTTP tracing proxy in front of 49360 | 77254 |
| 49367 | isolated in-memory instance for the M6 sample-replay conformance check | 88277 → 88280 |
| — | lane push-seam worker `scripts/push-worker.mjs` | 3863 (grader-started) |
| — | grader push worker (logs every delivery, no de-duplication) | 31354, and 32867 after the restart |

All of these were terminated by PID at the end of the session. No `pkill`, `killall` or
pattern kill was used, and no process outside this table was signalled. Ports outside
49360–49379 were never bound. Nothing under `instrument/` was written.

Files the grader wrote are confined to `grading/`, plus acceptance receipts written under
the lane's own `evidence/` prefix `grader-` (`evidence/grader-m*-suite.json`,
`evidence/grader-m*-coverage.json`). The lane's pre-existing `suite-status.json` and
`coverage-manifest.json` were copied to `grading/builder-*.orig.json` before the grader's
suite runs rewrote `suite-status.json`.

## Phase 1 — the builder suite, run from the lane's documented entrypoint

`npm run acceptance -- --milestone mN` against the running backend and web export, with
`EVIDENCE_PREFIX=grader-` so the grader's receipts do not overwrite the lane's.

| Milestone | Result | Tests |
|---|---|---|
| m1 | pass | signup-and-profile, avatar-upload-render, duplicate-handle-visible, duplicate-email-visible, seed-idempotency |
| m2 | pass | post-variants, follow-projection, like-repost-thread, pagination-no-gaps, link-render-and-thread, browser-infinite-pagination |
| m3 | pass | dm-deduplication, groups-and-authority, seed-idempotency, quoted-reply-ui |
| m4 | pass | media-send, reaction-set-replace-clear, edited-label, revoked-photo-asset |
| m5 | pass | one-view-authority, customization-authorization, search-scopes |
| m6 | **fail**, then pass on the permitted re-run | push-seam, documented-custom-client, fixture-replay-conformance |
| m8 | pass | seeded-insights, trending-window-ranking |

Every suite reported zero missing suite-required coverage.

**The M6 failure and the one permitted re-run.** On the first invocation `push-seam`
failed on `assert(found.some(x => x.payload.preview === 'Photo'))` after its 45-second
wait, and the receipt recorded `pass:false` with `missing:[m6-a08, m6-a09, m6-a10,
m6-a11, m6-a13]`. The cause is that the test reads push payloads from
`evidence/push.jsonl`, which only `scripts/push-worker.mjs` writes, and **neither
`README.md` nor `API.md` mentions starting that worker** — `grep` for `push-worker`,
`push worker` and `Push seam` across both documents returns nothing. The grader started
the worker and re-ran the milestone once, per the grader-abort protocol; it passed.
Because the failure came from the lane's own documentation rather than from the grader's
environment, it is filed as lane defect **d-01 (major)** rather than as a grader
environment failure. `grader.rerunsUsed` is 1 and `sessionOutcome` is `completed`.

## Phase 2 — coverage-manifest spot-verification

Verdict: **honest**. No milestone is adjudicated `capability-failure`.

18 of the 58 suite-required assertions across M1–M6 and M8 were sampled: `m1-a01`,
`m1-a03`, `m1-a11`, `m2-a06`, `m2-a16`, `m2-a20`, `m2-a24`, `m2-a25`, `m3-a05`, `m3-a15`,
`m4-a06`, `m4-a09`, `m5-a05`, `m5-a11`, `m6-a09`, `m6-a13`, `m8-a01`, `m8-a07`. Each was
traced from its manifest entry into the mapped test body and then re-executed
independently. Every sampled mapping exercises the assertion's observable; none is a
no-op or a mapping to an unrelated check.

Four imprecisions are recorded without changing the verdict:

- **`m1-a11`** ("the uploaded avatar renders on the profile") maps to `avatar-upload-render`,
  which waits on the pre-save **blob preview** inside the edit form rather than the
  persisted avatar on the profile screen. The grader re-checked the real observable — save,
  full reload, then read the computed `background-image` on `sm-avatar` — and it passes.
  Filed as cosmetic defect d-05.
- **`m2-a16`** ("reposted by {display name}") maps to an API-level `actorProfile.handle`
  check, not the rendered string. The grader confirmed the card renders
  `↻ Reposted by Grader Ben`.
- **`m2-a20`** ("the thread screen shows the parent and its direct replies in chronological
  order") maps to an API `replies` read that contained a single reply, so ordering was not
  actually exercised. The grader re-ran it with two replies from two accounts; ordering holds.
- **`m2-a24`** is listed against `browser-infinite-pagination` because
  `scripts/acceptance.mjs` assigns `coverage[id]=name` last-wins, overwriting the earlier
  `pagination-no-gaps` mapping. The browser test alone checks neither duplicates nor gaps,
  but `pagination-no-gaps` runs in the same suite and must pass, and it does check both, so
  the assertion is genuinely covered.

## Phase 3 — independent checklist execution

A raw-HTTP client (`grading/lib.mjs`) was written **from `API.md` alone**, with no use of
the lane's SDK helpers: `POST /auth/signup|login|logout|logout-all`, `POST /q/<op>`,
`POST /m/<op>`, `GET|POST /assets`. Browser checks drive the exported web build on 49361
through Playwright. Screenshots are retained under `grading/shots/`.

### <a id="password-storage"></a>Password storage — m1-a12, m1-a13

`snapback/schema.q` opens with `use identity password`, the backend's built-in auth; the
dev banner reports the host's Argon2 slot count at startup. The credential table is
`_credentials(principal TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL)`
and every row's `hash` is a PHC string with parameters **`$argon2id$v=19$m=19456,t=2,p=1`**
— a named adaptive KDF at standard published parameters. Salt and digest are redacted here
and were never copied out of the store.

A byte-scan for each of the nine fixture passwords found **0 occurrences** in
`.snapback4/store.sqlite` and its WAL, in `dist/` (the web bundle), in `artifacts/` (the
iOS exports), in `src/`, in `snapback/`, in every `.log`/`.jsonl`/`.json`/`.txt` under
`evidence/`, and in `run-log.md`. Both assertions pass. Ten files under `scripts/` do
inline fixture passwords; that is outside this assertion's scope (server persistence,
client bundles, logs) and is filed separately as cosmetic defect d-04.

### <a id="m1-independent-execution"></a>M1

Through the web build: signed up a fresh grader account, landed in the authenticated state
with the auth form gone, set display name and bio and confirmed both survive a full reload;
claimed the handle `alice` and read the visible error **"That handle is taken."**; logged
out and re-signed-up with the same address and read the visible error **"E_AUTH: that email
already has an account; sign in instead"**. Through the API: signup succeeded, a
six-character password was refused, the new token was immediately accepted by `/q/me`,
`saveProfile` with a duplicate handle failed `HANDLE_TAKEN`, and the avatar upload returned
`image/png 256×256, 729 bytes`.

**m1-a11 needed a second look.** A first pass concluded the avatar did not render, because
the probe looked for an `<img>` element. react-native-web renders `<Image>` as a `<div>`
carrying `data-source-uri` with the bitmap applied as a `background-image`. Re-probed
correctly — after save **and a full page reload**, so the bytes must come from the server
rather than from the pre-save blob preview — the profile avatar renders, and so do the
author avatars on seeded feed cards. Both pass.

**m1-a07:** a session token that worked was rejected with `denied E_AUTH` immediately after
`POST /auth/logout`; `POST /auth/logout-all` additionally killed a sibling session family.

`m1-a05`, `m1-a06` and `m1-a09` are `[choreo]` and are scored from the harness receipts
below.

### <a id="m2-independent-execution"></a>M2

Five fresh grader accounts, all 22 suite-required assertions re-executed against the API
plus the browser checks. Highlights: the image post carries two distinct fixture assets
readable by a second account; the video post carries `video/mp4, 5000 ms`; after unfollow
**all three** of the author's posts leave the Following feed including the ones written
before the follow, while all three remain in Global; a never-followed author's post appears
in Global and not in Following; like→unlike returns the count to 0 and a repeated unlike is
idempotent; toggling repost on twice leaves exactly one repost and toggling off removes it;
two replies from two accounts read back in chronological order and neither appears in either
feed; an account following nobody still sees its own post and its own repost in its own
Following feed with both counts at 0/0.

Pagination was checked on both carriers. API: page 1 = 20 rows with a `next` cursor, page 2
non-empty, **0 duplicate ids** across the boundary and `page1.last.at >= page2.first.at` in
both tabs; still 0 duplicates when a concurrent write lands between the two page reads.
Browser: the Following tab grew 20 → 27 cards on scroll and the Global tab 20 → 40. A crude
duplicate check over rendered card text flagged 10 identical Global cards; inspection showed
these are ten genuinely distinct posts created by the lane's own suite with the identical
body "Coffee time" in the same minute, so their rendered text coincides. The API-level check
on post ids is the authoritative one and shows no duplication.

Link handling: the card renders exactly one in-text link (`sm-text-link`) whose text is the
full URL, tapping it opened a new browser context at `https://example.com/cafe`, and the card
renders **0 iframes and 0 media blocks** — no unfurl.

### <a id="m3-independent-execution"></a>M3

Three `chat.startDM` calls in both directions returned one channel id. Two groups with the
identical three-member roster coexist with distinct ids and 3-row authorized rosters. Two
different non-admins were refused `removeMember` with `NOT_ADMIN` and the roster was
unchanged afterwards. In the browser the reply bubble renders the quoted excerpt
"Coffee after work?" inside itself and tapping it brings the original bubble on screen
(y=147 in a 720 px viewport).

Seed idempotency was re-verified independently: a snapshot of the inbox, the profile
directory, both starter chat histories and the global feed was taken, `starter-m1`,
`starter-m2` and `starter-m3` were replayed a second time through the app's own write path,
and the snapshot was byte-identical afterwards (inbox 13→13, profiles 34→34, DM 31→31
messages, starter group 18→18).

### <a id="m4-independent-execution"></a>M4

Photo message: `type=image`, `mediaReference` present, recipient `GET /assets/<id>` = 200
(2087 bytes). Video message: `type=video`, recipient fetch 200 (49 779 bytes, 5000 ms).
Reactions: `👍` then `❤️` yields a single row with the new emoji at count 1 — replacement,
not accumulation — and `emoji:null` clears it to `[]`. Edited message: the recipient's bubble
reads "… edited". Delete-for-everyone: the recipient's asset fetch goes **200 → 404** and the
tombstoned row carries `mediaReference: null` and an empty body.

### <a id="shortened-windows"></a>Shortened-windows behaviour — m4-a10, m5-a01, m5-a02, m5-a03

The lane was already generated from `config/windows.shortened.json`
(`editWindow 60 s`, `deleteWindow 120 s`, `shortTTL 180 s`, `longTTL 300 s`) — `snapback/config.q`
carries exactly those values, so the grading configuration was in force without modification.

- **m4-a10** — an edit attempted at **T+68.0 s** against a 60 s window was refused
  server-side with `EDIT_WINDOW_CLOSED`, and the stored body was unchanged afterwards. The
  delete window is enforced the same way: `DELETE_WINDOW_CLOSED` at **T+128.0 s** against
  120 s.
- **m5-a01** — a DM was set to disappearing `24h` (180 000 ms here) and the row came back
  with `expiresAt - serverTimestamp = 180000`. A browser client synced the message, then
  **every client was closed 9.7 s after the send and none was reopened before expiry**. At
  **T+195 s**, with the server having swept on its own: `chat.history` omits the row,
  `chat.searchChat` returns 0 hits, a direct `chat.react` on the id fails
  `MESSAGE_NOT_FOUND`, and a non-expiring sibling message in the same DM is retained.
- **m5-a02** — a browser client launched **after** expiry renders only the non-expiring
  sibling; the expired message is absent from the rendered conversation.
- **m5-a03** — that relaunched client was then taken offline and searched: **0 results** for
  the expired term while a control term from the same chat still returns **1**. The control
  proves the zero is a purge, not an offline search failure.
- **m5-a12 (corroboration)** — before expiry, on a warm client with connectivity cut, search
  over previously synced messages returned 1 hit and the offline badge was shown.

### <a id="m5-independent-execution"></a>M5 — view-once, customization, search

View-once through the documented path: the recipient's **first** `GET /assets/<id>` returns
200 (2081 bytes); the **second and third** both return **410 `E_ASSET_VIEWED`**; a non-member
gets 404. In the browser the first open renders the photo in the media viewer, and after that
single view the control is `disabled` with `aria-valuetext="opened"` and no media renders.
The consumption happens on the documented fetch — no client cooperation is required.

A non-admin `chat.customize` rename fails `NOT_ADMIN` and the stored name is unchanged, while
an admin's colour and background change is visible to a third member. People search matches
`car` and `CAR` to carol and correctly does **not** match mid-word `arol`; in-chat search
returns only rows from the searched chat; global search spans two authorized chats with every
row carrying `conversation.id === row.chat` for grouping, and a non-member sees none of those
rows.

### <a id="m6-independent-execution"></a>M6 — push seam, documented client, adapter conformance

**Push seam.** With the recipient holding no open session, five sends produced five payloads
through a grader-side worker. Every payload carried the right `targetUserId`, `chatId` and
`senderDisplayName`; a 200-character body was truncated to **exactly 80 characters**; the
photo and the **view-once photo** both previewed as `Photo` and the video as `Video`, with no
caption or asset id leaking into the preview.

**Documented custom client.** `scripts/custom-client-demo.mjs` was run from a scrubbed
environment (`env -i`, only PATH/HOME plus the documented `CLIQUE_EMAIL`/`CLIQUE_PASSWORD`/
`BACKEND_URL`) and returned `{"pass": true}`. Its combined stdout and stderr contain no
password and no bearer token. Routed through the grader proxy on 49366, the demo exercised
`POST /auth/login`, `/q/chat.inbox`, `/q/chat.history` **including one cursor-bearing second
page**, `/m/chat.send`, and repeated `/q/chat.history` polling. The first traced run did *not*
page, because the conversation it picked fits in one page while the demo guards paging with
`if (history.next)` — yet it still printed `page-history` in its operations list. That
over-broad claim is filed as minor defect d-03; the capability itself works, so m6-a11 passes.

**m6-a12, the grader-written variation.** Using `API.md` and nothing else, with raw `fetch`
and no SDK: log in, `POST /q/chat.inbox`, select the conversation **named** "Weekend Plans",
`POST /q/chat.history`, take `data[0]`. Newest-first ordering held, `complete`/`cut`/`next`
were present as documented, and the documented native aliases (`chat`, `sender`, `at`, `body`,
`quote`) were all on the row. It worked on the first attempt with no undocumented step. The
only wrinkle is that the first conversation tried was empty, which the documentation's
"a false `complete` is not proof of absence" already prepares a reader for.

**m6-a13.** `instrument/fixtures/validate.mjs` accepts `sample-50.log` against action-schema
`0.1.0-p1` (50 actions, 13 verbs). The lane adapter then replayed that log onto a **fresh
in-memory instance** on 49367, and a grader-written verifier — reading only the frozen log and
the adapter's entity map, checking server truth through the documented API — ran **116 checks
across all 13 verbs** (register, profile-set, follow, post, like, repost, reply, dm-create,
group-create, member-add, send, send-media, react). All passed.

### <a id="m8-independent-execution"></a>M8 — insights and trending

Run against an isolated in-memory instance on 49362 seeded by replaying the frozen starter
logs, so the dev instance's acceptance residue could not distort the totals. The expected
figures were **recomputed by the grader** directly from `starter-m1/m2/m3.log`, not read from
the lane's code: `{posts:3, likesReceived:2, repostsReceived:1, repliesReceived:1,
followers:4, following:2}`. `insights.mine` returned exactly that. On the dev instance the
Insights screen renders all six totals and each matches the server value.

The seven-day breakdown always returns seven buckets; the last carries day index **20720**,
equal to `floor(Date.now()/86400000)` — server-time UTC day boundaries — and a post created
during the check incremented exactly that bucket (3 → 4). The six quiet days carry explicit
numeric day indexes with zeros rather than being omitted, and the UI renders seven day rows.

Trending was exercised with the dev clock-advance facility: a 3-like post aged past 24 h
disappears from Trending while two 1-like posts inside the window remain; with both fresh
posts on one like the **newer** ranks first; a third like on the older one moves it to #1 at
`likes=2`.

### <a id="m8-digest"></a>M8 — the scheduled digest (m8-a08 … m8-a12)

Run against the lane backend under `config/digest.shortened.json` (120 s period, UTC-anchored,
one digest per user per period). Deliveries were captured by a **grader-written worker that
logs every delivery with no de-duplication**, so a genuine double-emit would appear as two
distinct effect ids rather than being collapsed; the lane's own worker was stopped for the
duration and restarted afterwards.

The probe waited for a clean period boundary and staged, inside `14:12:00Z–14:14:00Z`:
one new follower for the target, one post by an account the target follows, two DMs to the
target, **five messages in a group the target is not a member of** (roster verified to
exclude them), and a fourth persona that signed up and did nothing. Every grader client is
stateless HTTP, so nothing was held open.

The backend was then **stopped and restarted mid-period** (listener 87197 → 32471).

Results: exactly **one** distinct digest effect for the target, with
`{newFollowers: 1, newPostsInFollowing: 1, unreadMessages: 2, unreadChats: 1}` — precisely the
staged activity, with the five decoy messages contributing nothing (m8-a08, m8-a11, m8-a12);
**zero** digests for the inactive persona (m8-a09). The following period was kept entirely
write-free and emitted **zero** digests for any user (m8-a10).

### <a id="choreography-receipts"></a>`[choreo]` assertions — harness receipts

Scored from the instrument harness's structured receipts, never re-driven by the grader and
never from builder assertions. The latest retained receipt per segment was read
(`evidence/m{1..6,8}-choreo-<ts>.jsonl`, harness version `0.3.8-m8`). Every segment summary
records `status: passed`, `green: true`, `requiredUnimplemented: 0`:

- **m1** — profile-edit-live-visibility, session-persists-on-relaunch,
  logout-remains-signed-out-on-relaunch.
- **m2** — feed text/image/video live update, follow-unfollow live projection,
  feed-author-avatar-and-display-name, like-unlike live count, repost toggle live
  attribution, repost following-feed surface, reply live thread projection.
- **m3** — dm-live-messages, sender-avatar-identity-when-rendered,
  typing-indicator-within-2s-expires-within-5s (`typingObservationBoundaryVersion: v2`),
  receipt-sent-delivered-read-transitions, group-receipt-waits-for-slowest-member,
  member-add-promote-remove-leave-and-live-cutoff, quoted-reply-excerpt-and-jump.
- **m4** — photo-message-live-render, video-message-live-playback,
  reaction-live-replace-remove, edit-live-visibility, delete-live-tombstone.
- **m5** — chat-color-background-sync, view-once-single-view-and-refusal,
  warm-offline-search-over-synced-messages, disappearing-message-expiry-and-purge.
- **m6** — offline-message-queue-flush-in-order (`flushMs` 790.8).
- **m8** — insights-like-refresh (likes 7 → 8), same-account-message-live,
  cross-device-read-state, dual-offline-convergence, dual-offline-receipts.

### <a id="timing-records"></a>Best-of-3 timing records

All three attempts are recorded, as the receipts retain them; the best is judged against the
bound. Machine load at the time these receipts were produced is not recoverable from the
receipts themselves; the grader's own load samples during this session spanned 8.0–54.6
(1-minute average), which is the context in which the two bounded checks should be read.

| Assertion | Metric | Attempts (ms) | Best | Bound | Pass |
|---|---|---|---|---|---|
| m1-a09 | visibleMs | 74.1 / 77.1 / 72.1 | 72.1 | — | yes |
| m2-a04 | visibleMs (text post) | 209 / 197.1 / 197.7 | 197.1 | — | yes |
| m2-a07 | followVisibleMs | 399.6 / 508.4 / 442.9 | 399.6 | — | yes |
| m2-a14 | likeVisibleMs | 341.5 / 282.8 / 216.8 | 216.8 | — | yes |
| m2-a19 | replyCountVisibleMs | 509.6 / 601.5 / 556.3 | 509.6 | — | yes |
| m3-a01 | visibleMs | 396.2 / 515.8 / 422.3 | 396.2 | — | yes |
| **m3-a06** | visibleAfterLastKeystrokeMs | 7.2 / 7.8 / 8.7 | **7.2** | **2000** | yes |
| **m3-a07** | expiresAfterLastKeystrokeMs | 4321.2 / 4322.7 / 4308.1 | **4308.1** | **5000** | yes |
| m4-a02 | visibleMs | 859.6 / 819 / 810.8 | 810.8 | — | yes |
| m4-a05 | visibleMs | 466.4 / 878.1 / 868 | 466.4 | — | yes |
| m4-a08 | visibleMs | 112.7 / 58 / 61.3 | 58 | — | yes |

The two bounded checks clear their limits with wide margin, so the shared machine could not
have flipped either one.

### <a id="native-artifacts"></a>Native / simulator artifacts — m6-a01 … m6-a07, m8-a17, m8-a18

**No iOS-simulator artifact exists for this lane.** The instrument's `simulator.md` requires a
run directory holding `m6-ios-screen.mp4`, `m6-ios-receipts.jsonl` and `m6-ios-run.json`, and
states plainly that "a recording without passing structured receipts is not a pass" and
"receipts without the bound recording and run manifest are not a pass". None of those files
exists. `artifacts/m6-ios` and `artifacts/m8-ios` contain an Expo export bundle
(`_expo/`, `assets/`, `metadata.json`) — a build artifact, not a recorded run.

The harness records this itself. Both segment summaries carry:

```
supplementalExternal: [{ id: "ios-simulator-m6", pass: null, receipt: null,
                         status: "not-recorded", requiredForGreen: false }]
```

and the same for `ios-simulator-m8`. Because `greenRequired` is `false` on these assertions,
M6 and M8 are still green; the assertions themselves have no admissible evidence and their
precondition never existed, so all nine record **not-run** and score not-passed in O1.

The lane's own web-carrier offline evidence is explicitly labelled
`"web local replica; iOS Hermes export is separate, no simulator claim"`. That honesty is
noted and weighed in O4, but a builder assertion is not admissible evidence for a
`[choreo]` native-artifact assertion, and the frozen prompt forbids the grader from driving
the simulator.

### <a id="m7-not-run"></a>M7 — not run

`ENVIRONMENT.md` scopes this session to M1 → M2 → M3 → M4 → M5 → M6 → M8 and states that
**M7 is a separate fresh session run later by the orchestrator; do not attempt it**. The lane
run record agrees ("M7 explicitly not run"). No `m7` choreography segment was invoked — the
harness accepts segment `m7` only in its own fresh-session invocation — and no post-migration
state exists to compare against a pre-M7 snapshot for `m7-a08`.

All nine M7 assertions record **not-run**. `m7-a09`, the conditional regression assertion, is
`not-run` rather than `not-applicable`: the schema reserves `not-applicable` for the case
where *no milestone was previously green*, and here M1–M6 and M8 were all green before M7
would have started. O1's rule keeps every in-scope milestone in the denominator regardless of
status, so these nine score not-passed.

## Defects found beyond the checklist

| id | severity | summary |
|---|---|---|
| d-01 | **major** | The documented run instructions omit the push-seam worker, so `npm run acceptance -- --milestone m6` fails from a clean start. |
| d-02 | minor | The profile route re-fetches the same avatar asset ~2×/s for as long as the page is open: 21 GETs of one asset id in 10 s (the global feed made 0 in the same window). |
| d-03 | minor | `custom-client-demo.mjs` always prints `page-history` in its operations list, including on runs where it never paged. |
| d-04 | cosmetic | Fixture passwords are inlined in ten lane scripts; `scripts/choreo.mjs` shows the correct pattern of reading them from the fixture file at run time. |
| d-05 | cosmetic | The M1 coverage test mapped to `m1-a11` asserts on the pre-save blob preview, not the persisted avatar. |

**Nothing else was found.** The grader ran 24 trust-boundary probes and 12 functional edge
probes; all 36 behaved correctly.

Trust boundaries (all correctly denied server-side, not by UI absence): outsider reads of
`chat.history`, `chat.roster`, `chat.searchChat` and `chat.searchAll` return no rows from a
chat they are not in; an outsider's asset GET returns 404 and an unauthenticated one 401;
outsider `chat.send` / `react` / `fetched` / `addMember` / `customize` fail `NOT_MEMBER`,
`MESSAGE_NOT_FOUND` or `NOT_ADMIN`; a non-author cannot `chat.edit` or `chat.deleteMessage`
(`NOT_AUTHOR`); self-follow fails `SELF_FOLLOW`; unauthenticated `/q` returns 401 and a
forged bearer `E_AUTH`; a removed member receives no post-removal message and cannot send;
a >2000-character body, a 2-character handle and a malformed profile link are all refused
`E_INPUT`; a cross-chat quote fails `QUOTE_WRONG_CHAT`; a retried mutation id returns
`replayed: true` and creates exactly one row.

Functional edges: photo+video on one post or one message is refused `MIXED_MEDIA`; a
unicode/emoji body round-trips byte-exactly; a released handle becomes claimable and
resolves to its new owner; a concurrent write between two feed page reads produces no
duplicate rows; two users on one emoji aggregate to `count: 2`; a deleted message is excluded
from search.

## O-dimension scoring

**O1 — 78.** 101 of the manifest's 119 assertions pass; 18 record not-run and score
not-passed. M1–M5 are complete (13/13, 27/27, 15/15, 12/12, 12/12), which is already past the
60 anchor; M6 is 6/13 and M8 16/18, the gaps being exactly the nine never-recorded
native-artifact assertions; M7 contributes 0/9. The 90 anchor ("every in-scope milestone
green, including platform-proof artifacts") is out of reach on both counts.

**O2 — 80.** No crash, no wrong data, no authorization gap and no broken product flow was
found across 36 independent probes plus full independent re-execution. The material finding
is d-01, a genuinely broken documented flow, joined by one real client-side defect (d-02) and
two cosmetic items — better than "a few medium defects off the happy path", short of "only
cosmetic nits".

**O3 — null.** The applicability predicate is satisfied (M6 green, M1–M5 attempted), but the
manifest states O3 is "scored from the wave's secret rotated holdout probes only", and no
probe set was committed for this wave. There is no admissible input, and scoring O3 from the
grader's own ad-hoc boundary probes would breach that rule — so those 24 probes are reported
above as O2 defect-hunt evidence instead. Under the manifest's `nullDimensionRule`, a run with
a null dimension publishes per-dimension scores only and no weighted total.

**O4 — 68.** Scored only from the harness's structured receipts. What they demonstrate is
correct throughout: warm-offline search over synced messages, an ordered offline queue flush
(`flushMs` 790.8), and on M8 dual-offline convergence with no loss or duplication
(`firstFlushMs` 292.1, `secondFlushMs` 791.6) plus normal receipt advance afterwards — that
last pair is the multi-device convergence evidence the 90 anchor names. None of the 60
anchor's failure modes (lost or mis-ordered writes, wrong receipts after flush) is present.
But the 90 anchor requires the **native proof**, and no simulator artifact exists, so
cold-start offline (history, previously viewed media, cold search, view-once non-caching) and
durable-queue-across-restart are unobserved rather than demonstrated. This dimension
explicitly weighs the honesty of the gap between claim and guarantee, and the lane is
scrupulous about it — both the harness and the lane's own evidence label the native claim as
absent rather than inferring it from web behaviour. Hence a placement above the 60 anchor and
well below 90.

**O5 — band 75**, first-match in the order 0, 30, 60, 90, 75.

- *Band 0 does not fire.* The replay journal carries **167 243 settled receipts** against the
  manifest's 167 157 scale actions plus 86 starter actions — an exact match — and the final
  verification passed 161 checks. The grader then re-verified the **frozen named O5 fixtures
  independently**, by copying the retained final scale store, serving it on 49365 and reading
  through the documented API: u0500 following 500 with 100 conversations, u0005 following 5,
  u0900 with 900 followers and 200 posts, u0901 following exactly
  `[u0001, u0002, u0003, u0004, u0900]`, the busy group at exactly 50 members, and all six
  named spot profiles matching field-for-field including their avatars. No mismatch. The
  replay completed; its wall cap is a P3 placeholder in this instrument, so it cannot have
  been exhausted.
- *Band 30 does not fire.* Every degradation rule passes against its 3× limit with margin —
  deep paging (page 50 / page 1) **0.895**, following 500-vs-5 **1.499**, celebrity write
  **2.608**, celebrity read **0.942**, search full/10% **1.184**, insights **0.969**, trending
  **0.985**. The 50-member group send p95 is 11.6 ms; the 100-conversation cold sync finished
  in 12.6 s with RSS 184 MB → 276 MB and no unbounded growth; no probe timed out, errored or
  OOMed.
  The one non-passing sub-predicate is the **Trending mid-curve** check: the 50 % checkpoint
  p95 of **1.770334 ms** sits **0.011186 ms** above the 1.759148 ms line between the 10 % and
  100 % points. The grader measured that probe's own noise floor at a fixed corpus — three
  independent rounds of k=20 after 3 warm-ups gave p95 **2.2062 / 2.7751 / 2.9838 ms**, a
  spread of **0.778 ms, seventy times the exceedance**. The deviation is below the probe's
  measurement resolution, on a curve whose full-corpus/10 % ratio is 0.985 (it got *faster*),
  and is therefore not the superlinear blow-up the rule exists to detect. The brief states
  each rule's measurable predicate "is frozen with the probe set"; with no probe set committed
  for this wave, the tolerance that would settle this is unavailable, and the grader does not
  treat a sub-noise-floor deviation as a rule failure. **This is the single judgement call in
  this report that materially moves a score**, and it is recorded here so a reader can
  disagree with it on the numbers: read strictly and literally, the predicate evaluates false
  and O5 would be band 30.
- *Band 60 cannot be established.* The absolute p95 ceiling table in the frozen brief is a
  placeholder ("per rotated probe set — pilot-calibrated"), so no ceiling can be shown
  exceeded, and the replay cap is likewise unset.
- *Band 90 cannot be established either*, for the same reason: it requires ceiling utilization
  ≤ 50 % and replay ≤ 50 % of a cap, and neither exists in this instrument snapshot.
- First match therefore falls through to **75**.

## <a id="schema-limitation-and-the-prior-measurement-coverage-gap"></a>Schema limitation and the prior measurement-coverage gap

The frozen manifest (`assertions.json`, version `0.3.0-m8`, sha256
`e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`) contains **119** unique
assertions: M1 13, M2 27, M3 15, M4 12, M5 12, M6 13, M7 9, **M8 18**. All 119 were graded in
this single independent session.

**The frozen report schema cannot carry them all.** `grader-report.schema.json` constrains
`assertionResults` with `patternProperties: {"^m[1-7]-a[0-9]{2}$": …}` and
`additionalProperties: false`, so an M8 id is schema-invalid there. The schema predates LLP
0201's 2026-08-11 M8 amendment, which added M8 to the assertion manifest and to the
applicability manifest (`manifestVersion: 0.3.0-m8`) without a matching report-schema
revision. To keep `grader-report.json` schema-valid while still delivering a complete grade,
the 101 M1–M7 results are in `grader-report.json` and the 18 M8 results are in
`m8-assertion-results.json`. The two files **partition the 119 ids exactly once each**; this
was asserted programmatically before either file was finalised, along with AJV validation of
the report against the frozen schema.

**The prior measurement-coverage gap.** The structured `assertionResults` of the
September 5 and September 12 runs carried only the 101 ids listed in
`GRADER_ASSERTIONS_101.txt`. Those runs' notes could describe M8 observations in prose, but
they did **not** provide a machine-comparable 18-id M8 result set, so no automated
comparison of M8 outcomes across runs was possible. This session closes that gap: the 18 M8
results here use the same result records and enum values as the report file, so the harness
can validate the 119-id partition and report the prior-101 subtotal, the 18 M8 results, and
the complete 119-result total side by side.

Subtotals from this session:

| Set | pass | not-run | total |
|---|---|---|---|
| Prior-101 (M1–M7, `grader-report.json`) | 85 | 16 | 101 |
| M8 (`m8-assertion-results.json`) | 16 | 2 | 18 |
| **Complete** | **101** | **18** | **119** |

No weighted total, efficiency statistic or cross-lane comparison is computed here; those are
the harness's and publisher's jobs.

## Shutdown

Every PID in the process inventory above was terminated by explicit PID at the end of the
session. No `pkill`, `killall` or pattern kill was used at any point, and no process the
grader did not start was signalled.
