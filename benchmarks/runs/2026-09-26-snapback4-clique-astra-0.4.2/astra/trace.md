# Grading trace — lane `astra-snapback4` (backend `snapback4-0.4.2`)

Sanitized evidence and action trace, the published companion to
`grader-report.json`. Raw session transcripts are never published (LLP 0198);
fixture passwords, session bearers and the dev worker's service token are
redacted everywhere below and in `probe-results/`.

| | |
|---|---|
| Wave | `full-3models-astra` |
| Grader | family `claude`, model `claude-opus-5`, fresh session, no builder context |
| Lane run record | `run-record.json` (present), read for lane identity only |
| Run scope | `full` — nothing struck by `ENVIRONMENT.md` |
| Instrument | commit `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`, assertion manifest `0.3.0-m8` sha256 `e15c3952…ba732d04`, choreography/receipt pin `social-messenger@0.3.8-m8`, typing boundary `v2` |
| Session outcome | `completed`, 1 phase re-run used (my own tooling — see §Grader-abort accounting) |
| Ports used | 49360 backend, 49361 web, 49363 clock-offset proof instance, 49367 isolated digest instance, 49368 scale-corpus instance — all inside the assigned 49360–49379 |

## Contamination control

I did not open the builder's `diary.md`, `essay.md`, `final-report.md`,
`FINAL.md` or `run-log.md`, and I read no other lane under `lanes/`. Those
files are present in the lane directory and appear in directory listings, but
none was read. `run-record.json` (an authorized input) contains no builder
self-scores; I used it for lane identity only. `journey-record.json` was read
for milestone status and artifact pointers, which I then re-derived
independently from the receipts. `grader.contaminated` is `false`.

## Deviations from the frozen protocol, as instructed for this N=1 calibration

1. **No holdout probe set was committed for this wave.** Execution-order
   phase 4 was skipped in full; `wave.probeSetSha256` is the literal
   `none-uncommitted` and `probeResults` is empty. No probe was invented.
   Consequences: O3 records `null` (its only permitted input does not exist —
   see §O3), and O5's bands 60 and 90 cannot be evaluated (see §O5).
2. **The claude family has not passed `calibration.md`'s gate.**
   `grader.calibrationPassed = false`, `grader.sameFamilyGraded = false`
   (the builder was `gpt-6-astra`). The grade is labelled
   `uncalibrated-grader` and I graded anyway.
3. **Timing-sensitive checks are judged best-of-3**, with the machine load
   recorded beside each measurement (§Timing records). This host is shared
   with other sessions and load moved between 12 and 120 during the session.

## Environment and how I started the lane

macOS arm64, Node v24.18.0 (volta), other sessions active on the machine.

To avoid writing into the builder's retained evidence, I APFS-cloned the
lane's source, `node_modules`, `dist`, `scripts`, `snapback/`, `config/` and
its `choreography/` copy into `grading/work/app`, symlinked the read-only
instrument, and **deleted `.snapback4` so the backend built a fresh store**.
That makes phase 1 a genuine clean-checkout run rather than a replay over the
builder's residue. The builder's `evidence/`, `artifacts/` and stores were
never modified.

```
snapback4 check                      -> ok, 32 tables (23 synced), 44 operations, no problems, 2 notes
snapback4 dev --port 49360           -> pid 60588 (worker pid 60594)   [fresh store]
node scripts/seed.mjs --segment m1   -> {"segment":"m1","pass":true,"applied":8,"actions":16}
node scripts/seed.mjs --segment m2   -> {"segment":"m2","pass":true,"applied":28,"actions":52}
node scripts/seed.mjs --segment m3   -> {"segment":"m3","pass":true,"applied":0,"actions":18}
node scripts/web-server.mjs          -> pid 61701, http://127.0.0.1:49361
```

Seeded state checked directly: inbox holds `d-alice-bob` and `g-starter`
("Weekend Plans"), the starter DM has 6 messages, the group has 9, and the
group roster is alice/bob/carol — the 0.3.7-m8 fixture shape the M3 receipt
choreography needs. The exported web bundle points at `127.0.0.1:49360` and at
no other origin.

PIDs I started and later stopped: 60588, 60594, 61701, 66698 (49363 proof),
22133/22149 and the digest restart child (49367), 70639 (49368 scale). No
`pkill`/`killall` was used and no process I did not start was signalled.

## Phase 1 — the documented acceptance entrypoint

`npm run acceptance -- --milestone mN` from the clean checkout, against the
running backend and web client. M8 additionally needs the isolated
clock-offset instance the README documents (`scripts/start-proof.mjs` then
`scripts/trending-proof.mjs`), which I started on 49363; see defect **d-04**.

| Suite | Result | Suite-required assertions reported |
|---|---|---|
| m1 | **pass**, exit 0 | 7, `missing: []` |
| m2 | **pass**, exit 0 | 22, `missing: []` |
| m3 | **pass**, exit 0 | 7, `missing: []` |
| m4 | **pass**, exit 0 | 5, `missing: []` |
| m5 | **pass**, exit 0 | 6, `missing: []` |
| m6 | **pass**, exit 0 | 5, `missing: []` |
| m8 | **pass**, exit 0 | 6, `missing: []` |

All 58 suite-required assertions of the seven attempted milestones reported
`pass`, reproduced from a clean checkout and a fresh store. Every
`suiteResult` in the report is therefore `pass` except M7's, which are
`not-covered`.

## Phase 2 — coverage-manifest spot-verification

Verdict **honest**; no milestone adjudicated to `capability-failure`.

I read the mapped test for **all 58** suite-required assertions
(`scripts/acceptance.mjs` plus `acceptance-m2/m3/m4/m5/m6/m8.mjs`) rather than
sampling, then re-executed each observable myself (phase 3). Completeness also
holds mechanically: `evidence/coverage-manifest.json` contains exactly the 58
ids — M1 7, M2 22, M3 7, M4 5, M5 6, M6 5, M8 6 — and each acceptance run
recomputes `missing` from the frozen manifest and fails closed if an id is
unmapped.

Three qualifications, none of them dishonesty; the full text is in
`grader-report.json → coverageSpotVerification.detail`:

- **m8-a06 / m8-a07** assert on booleans stored in
  `evidence/m8-trending-clock.json` rather than re-deriving the observable at
  suite time, and **m8-a05** additionally queries the separate 49363 backend.
  The artifact is genuinely produced by `scripts/trending-proof.mjs`, and I
  re-ran that script from a fresh store and then queried Trending myself
  (§m8-trending), so the mappings are honest but **indirect**.
- Some tests bundle clauses across executors — e.g. m2-a16's mapped test
  checks repost attribution at the API level while the `reposted by
  {display name}` string is proved by the M2 choreography segment and by my
  own browser run.
- The test mapped to **m2-a06** contains a dead sub-expression
  `ids.every((id) => false) ||` that can never be true. Harmless, but it
  obscures what the poll waits for.

## Phase 3 — independent checklist execution

Own client, own browser automation, own probes; I did not import the lane's
`scripts/api.mjs`. Sanitized machine-readable outputs are in
`probe-results/`, screenshots in `shots/`.

**A probe bug I found and corrected.** My first API pass reported five
failures (`m1-a03`, `m3-a03`, `m3-a14`, `m4-a06`, `m5-a08`). Four were my
error: the backend returns terminal refusals as HTTP 200 with
`state:"failed"` and a `why` object — exactly as `API.md` specifies ("A failed
state carries `why`"; "never interpret an HTTP 200 alone as an accepted
operation") — and my helper only recognised the `denied` shape. `m3-a03` was a
loose filter of mine that counted a 2-member *group* as a second DM channel,
and `m4-a06` was a JSON key-order comparison. Diagnosed directly, then
re-checked; all five pass. Recorded here because the first-pass output exists
in my raw session and must not be mistaken for lane failures:

```
saveProfile handle=alice (other user) -> 200 state:"failed" why HANDLE_TAKEN "That handle is taken."; alice keeps the handle
configureChat by non-admin            -> 200 state:"failed" why NOT_ADMIN at schema.q:369:5; name still "Weekend Plans"
removeMember by non-admin             -> 200 state:"failed" why E_RULE (members delete rule); roster still bob,alice,carol
```

### <a id="m1"></a>M1 — accounts and profiles

- **m1-a01** `/auth/signup` accepted a 17-char and an exactly-8-char password
  and refused 7 chars; the returned session immediately authorised
  `/q/myProfile`.
- **m1-a02 / a03 / a04 / a08 / a10 / a11** driven in the browser.
  `sm-profile-error` renders "That handle is taken."; `sm-auth-error` renders
  "E_AUTH: that email already has an account; sign in instead"; edited display
  name and bio survive a reload on own profile; the uploaded fixture avatar
  decodes at 256×256 (`complete=true`, `naturalWidth=256`) — real bytes, not a
  placeholder. Screenshots `m1-a02…`, `m1-a03…`, `m1-a04…`, `m1-a08…`,
  `m1-a11-avatar.png`.
- **m1-a05 / a06 / a09** from the harness receipts (§choreography).
- **m1-a07** (grader, full-only): after `POST /auth/logout` the old bearer
  returns **HTTP 401 `E_AUTH` "this session is not live; sign in again"** on
  `/q/myProfile`. Server-side revocation, not a client-side discard.

### <a id="m1-a12"></a>M1 password storage (m1-a12, m1-a13)

`snapback/schema.q:1` declares `use identity password` — the backend's
documented built-in provider path. The app defines no credential table and
contains no hashing code (a grep for `password|argon|bcrypt|scrypt` across
`snapback/`, `src/`, `app/`, `ui/` matches that one line only). The provider's
own documentation (`snapback4 guide personas`) pins Argon2 verification, and
startup reports the Argon2 slot count. At rest the store carries
`$argon2id$v=19$m=19456,t=2,p=1` — **argon2id at standard published
parameters**. I verified the documented provider path, not provider internals,
as the assertion directs. **m1-a12 pass.**

For m1-a13 I grepped five fixture passwords across `store.sqlite`,
`store.sqlite-wal`, `store.sqlite-shm`, the exported web bundle
(`dist/**`), and the backend / web / push / proof logs: **zero occurrences
everywhere**, and no `"password"` field is logged. **m1-a13 pass.**

### <a id="m2"></a>M2 — posts and the follow graph

Text, 2-image and video posts created and their assets fetched by the other
persona (`image/png`, `video/mp4`). Follow projection: Alice's post reaches
Bob's Following feed on follow; after unfollow **all 10** of Alice's posts
including pre-follow ones leave Following while Global still serves them — the
projection is view-scoped, not fanned out at follow time. Unlike is an
idempotent set-state toggle (1 → 0, repeat harmless). Repost toggles on and
off; a followed user's repost surfaces the original author's post. Replies and
a nested reply are absent from both feeds and chronological on the thread.

- **Pagination (m2-a22/a23/a24)**: three cursor pages per tab — 60 rows, 20
  per page, zero duplicates, exact expected newest-first order, no gaps — plus
  the client's own Load-more path reaching 20 → 40 rendered items with 0
  duplicate rows in both tabs. Separately stressed with 30 concurrently
  written posts that produced **25 identical `.at` values**; paging still
  returned all 30 exactly once.
- **Implicit self-follow (m2-a25/a26/a27)**: with `following = 0`, own posts
  *and* own reposts appear in own Following feed, follower/following counts are
  unchanged, and an explicit self-follow edge is refused `SELF_FOLLOW`.
- **m2-a12/a13**: the URL renders as `role=link` and clicking it opened a
  popup at `https://example.com/cafe`; zero `sm-feed-media` nodes and no
  preview/OpenGraph text. **m2-a16** in the browser: the feed item reads
  "reposted by Bob Bennett" with `sm-feed-repost-attribution` carrying actor
  handle `bob`.

### <a id="m3"></a>M3 — messaging core

`createDM` from both directions returns the same chat `d-alice-bob`; the inbox
holds exactly one `dm`-kind chat for the pair and `resolveDM` agrees. Two
groups with the identical three-member roster coexist as distinct chats.
Non-admin removal is refused by the `members` delete rule (`E_RULE`) with the
roster intact, while the admin path works and a member may still remove
*themselves* (leave) — correct. Quoted excerpt renders in the reply bubble
(`sm-convo-quote-preview`, "Coffee after work?") and tapping it brings
`#message-sm0001` into the viewport (y=157 of 720); screenshots
`m3-a10-quote.png`, `m3-a11-jump.png`.

### <a id="m3-a15"></a>M3 seed idempotency (m3-a15)

Broader than the lane's own check: I snapshotted **14 independent SQL counts**
(profiles, posts, follows, likes, reposts, chats, members, messages,
reactions, seeded-message and seeded-post counts, avatars, and the two starter
chats' message counts), re-ran all three installed starter segments **twice**,
and re-snapshotted. **Zero drift on every count** (15 seeded messages, 24
seeded posts, 13 avatars, 31/9 messages in the two starter chats).

### <a id="m4"></a>M4 — media, reactions, edit/delete

Photo and video picked through the client's own file chooser and sent; the
bubble renders decoded image bytes and the server rows carry the assets.
👍 → ❤️ leaves exactly one chip `{emoji:❤️,count:1,mine:true}`; tapping again
clears it. The unedited bubble carries no label and the edited one shows
"edited" (`m4-a09-edited-label.png`).

### <a id="m4-a10"></a>M4 edit window (m4-a10, grader, shortened windows)

Installed grading config: `editWindowSeconds 60` (`config/windows.json`,
byte-equal in meaning to the fixture pack's `windows.shortened.json`).
Control first: an edit inside the window applied and set `edited:true`. At
**+205 s** the API refused `EDIT_WINDOW_CLOSED` and the stored body was
unchanged. Enforced server-side at `schema.q:349` against server `now`, not by
the absence of a UI affordance.

### <a id="m4-a12"></a>M4 asset revocation after delete (m4-a12, grader)

The photo asset served **HTTP 200** to the authorised recipient before
delete-for-everyone and **HTTP 404** to the same recipient afterwards; the
tombstone row is retained with `tombstone:true`. `deleteMessage` nulls
`photo`/`video`/`oncePhoto` at `schema.q:356`.

### <a id="m5-a01"></a>M5 disappearing messages (m5-a01, grader)

A dedicated DM pair, set to `24h` = **180 s** under the shortened-windows
config, with a non-expiring control message in the same chat. No client —
browser or SDK — was ever connected for this pair, so "both clients closed at
expiry" holds by construction. At **+205 s**:

```
apiHistory (recipient) : expired row absent, control row present
apiHistory (sender)    : expired row absent
/q/message  (direct)   : data = null
searchChat / searchMessages for the expired token : 0 hits
searchChat for the control token                  : 1 hit
```

The control row surviving is what makes the absences attributable to expiry
rather than to a broken read.

### <a id="m5-a02"></a>M5 client purge (m5-a02, grader) — both clauses

- **Disconnected clause**: a browser client launched *after* expiry rendered
  the durable control body and never the expired one
  (`m5-a02-after-launch.png`).
- **Connected clause**: a separate client left open on the conversation, with
  no reload and no navigation, stopped rendering the message at **+180 s** —
  0 s tolerance past the TTL (`m5-a02-connected-visible.png` →
  `m5-a02-connected-purged.png`).

### <a id="m5-a03"></a>M5 offline search after expiry (m5-a03, grader)

With the client's network fully aborted at the Playwright route level, offline
search returned **0 hits for the expired token and 1 hit for the durable
control token** (`m5-a03-offline-search.png`). The control hit is essential:
it shows the 0 is a purge, not a dead search.

### <a id="m5-a04"></a>M5 view-once (m5-a04, m5-a05, m5-a06)

Browser: the first open renders 640 px of real bytes in
`sm-media-viewer-image`; the second open renders none
(`m5-a04-viewonce-first.png`, `m5-a05-viewonce-second.png`). API: first fetch
**200** with `cache-control: private, no-store`, second **410**, direct
re-fetch **410**. A registered non-member gets **404** and — checked
explicitly — cannot burn the recipient's single view.

### <a id="m6"></a>M6 — push seam

With the recipient's clients closed, the logged payload carried the correct
`targetUserId`, `chatId`, `senderDisplayName` "Alice Alvarez" and a preview
truncated to exactly the first **80** characters. A view-once message previews
as `"Photo"` and the caption text appears nowhere in the payload.

### <a id="m6-a10"></a>M6 custom-client demo (m6-a10, m6-a11)

I ran `scripts/custom-client-demo.mjs` from the clean checkout against a
conversation **I** created with 60 messages:
`{"pass":true,"operations":["authenticate","inbox","history","send","poll"],"historyPages":2}`,
the sent message observed server-side afterwards, and no credential in stdout.
All five listed operations are exercised, with no privileged endpoint.

### <a id="m6-a12"></a>M6 grader-written variation (m6-a12)

I wrote `probe/m6-a12.mjs` from **`API.md` alone** — every endpoint, body
shape and field name quoted from that document — to fetch the latest message
of a *named* conversation. It worked on the first attempt for two named
conversations:

```
"Weekend Plans"   -> chat g-starter,    1 inbox page,  9 rows, latest sm0015 "Locked in. See you Saturday." receipt 1
"Direct message"  -> chat d-alice-bob,  1 inbox page, 24 rows, latest type "view-once"                      receipt 2
missingDocumentedFields: []   newestFirst: true   rowsOnPage <= 50: true
```

All 12 field-manifest keys present on the row, "rows are newest first"
confirmed from `serverTimestamp` ordering, the 50-row page cap held, and
`receipt` was non-null only for the caller's own messages exactly as
documented. Documentation quality is part of this bar and it cleared it.

### <a id="m6-a13"></a>M6 replay-adapter conformance (m6-a13)

I ran the fixture pack's conformance check myself:
`valid sample-50.log: 50 actions, 0 markers, 13 verbs … validated 1 logs and 50
actions against 0.1.0-p1`. The mapped suite test then replayed the sample
green on the dev instance in my clean-checkout run, verifying post-replay state
through roughly twenty independent API assertions (per-chat counts, reaction
counts, quote targets, rosters, media presence, profile avatars).

### <a id="m6-simulator"></a>M6/M8 simulator artifacts — absent, and honestly declared

`m6-a01…a07` and `m8-a17/a18` record **`not-run`**. There is no iOS-simulator
artifact anywhere in the lane: no `m6-ios-screen.mp4`, no
`m6-ios-receipts.jsonl`, no `m6-ios-run.json`, and the same for M8.
`artifacts/m6-ios` and `artifacts/m8-ios` are Hermes **exports**
(`metadata.json` + assets), not proof runs. All three M6 segment summaries and
all six M8 segment summaries carry:

```
supplementalExternal: [{ id:"ios-simulator-m6"|"ios-simulator-m8",
                         pass:null, receipt:null, status:"not-recorded",
                         requiredForGreen:false }]
```

`simulator.md` forbids inferring a native pass from web behaviour, so these
assertions were never executed. The lane's README states plainly that no
simulator proof is claimed and `setup-identity.json` declares no qualified
binary or wrapper. The declaration is scrupulous; the assertions still score
not-passed in O1, and the gap is the main driver of O4.

### <a id="m7"></a>M7 — never attempted

All nine M7 assertions record **`not-run`**. This packet's authoritative scope
excludes M7 (`RUN_QUALIFICATION.json`: "M7 and other builder lanes not run"),
the lane README states M7 is intentionally not implemented, and
`journey-record.json` records M7 `not-run`. No poll surface, no M7 suite, no
pre-M7 snapshot export and no M7 choreography segment exist, so nothing was
executed and `m7-a08` has nothing to compare against. `m7-a09`'s
`not-applicable` branch does **not** apply — M1–M6 and M8 were previously
green — so it records `not-run`. Suite-required M7 ids carry
`suiteResult: "not-covered"`.

### <a id="m8"></a>M8 — Insights and activity

Six lifetime tiles render and match the server aggregate exactly
(`{posts:14, likesReceived:2, repostsReceived:4, repliesReceived:7,
followers:2, following:3}` at my read); the mapped suite test additionally
cross-checks each total against independent SQL. A post created now lands in
the last bucket whose day equals `floor(serverNow/86400000)` — server-time UTC
boundaries — and that bucket increments by exactly 1. Exactly **7**
`sm-insights-day-row` rows render over 7 consecutive day numbers, **6** of them
zero-activity days present as rows rather than omitted
(`m8-a01-insights.png`, `m8-a04-days.png`).

### <a id="m8-trending"></a>M8 Trending (m8-a05, m8-a06, m8-a07)

Re-derived rather than read from the lane's artifact. I re-ran
`trending-proof.mjs` against a **fresh** proof store on the isolated
`--clock-offset -25h` instance (49363), then queried `insights.trending`
directly and compared against the raw post/like facts:

```
ranked : new-one 3 likes @1790402132460 ; new-two 2 likes @1790402132465
facts  : old-ranked 4 likes @1790312132448 (25.5 h old)
```

- **m8-a05**: the first row carries 3 likes, the maximum among posts inside
  the trailing 24 h.
- **m8-a06**: the aged post is 25.5 h old with **more** likes than any ranked
  row and is absent from Trending (`insights.q` constrains `.at > now - 1d`).
- **m8-a07**: I built the tie myself by adding a like so both in-window posts
  sat at 3, re-read, and the **newer** post ranked first (`insights.q` orders
  by `.likes, .at`).

### <a id="m8-digest"></a>M8 scheduled digest (m8-a08…a12, grader)

Run on a dedicated isolated instance (49367) under the installed shortened
digest config (`periodSeconds 120`), with a fresh five-persona cast, all
clients closed, activity confined to a single bucket, and the backend
**SIGTERMed and restarted inside the period**. Observed for period
`1790403600000`→`1790403720000`:

| persona | digests | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
|---|---|---|---|---|---|
| author | 1 | 1 | 2 | 0 | 0 |
| follower | 1 | 0 | 2 | 5 | 1 |
| member | 1 | 0 | 0 | 3 | 1 |
| quiet (no activity) | **0** | – | – | – | – |
| non-member of the active chats | **0** | – | – | – | – |

- **m8-a08** exactly one digest per active user with correct counts; the
  member's `unreadMessages` is 3, so the tombstoned message is excluded.
- **m8-a09** the inactive persona received nothing.
- **m8-a10** the immediately following period had no activity and emitted no
  digest for any user.
- **m8-a11** three payloads for the period, one per user, all effect ids
  distinct, across the mid-period restart. `digest.q` emits
  `once [p.principal, periodEnd]`, so the period is the idempotency key.
- **m8-a12** five messages in a chat the target is not a member of produced no
  digest for it and entered **no** non-member's counts, while the chat's actual
  member did count them. `digest.q` only walks
  `members where .principal = p.principal`.

## Choreography artifacts — `[choreo]` assertions and O4

Per the frozen prompt I scored `[choreo]` assertions from the harness's
receipts and never re-drove the choreography, and never from builder
assertions. I verified the artifacts mechanically first:

- All **18** frozen receipt streams validate line-by-line against the frozen
  `receipts.schema.json` (AJV 2020, 0 errors).
- Each stream's SHA-256 matches `evidence/frozen-index.json`; each summary's
  `suite.receiptSha256` matches the suite receipt file beside it; each
  `setupIdentity.sha256` matches `setup-identity.json`.
- All 18 are `green: true` with `nonGreenCause: null`, version `0.3.8-m8`,
  `instrumentPin social-messenger@0.3.8-m8`, `typingObservationBoundaryVersion v2`.
- Per-segment assertion tallies show `failed: 0`, `skipped: 0`,
  `requiredUnimplemented: 0` throughout.

Harness assertion names do not carry benchmark ids for M1–M6, so I mapped them
myself from the assertion text and the harness README's segment-coverage
section (M8's names already embed their ids):

| harness assertion (latest green segment) | benchmark id(s) |
|---|---|
| `profile-edit-live-visibility` | m1-a09 |
| `session-persists-on-relaunch` | m1-a05 |
| `logout-remains-signed-out-on-relaunch` | m1-a06 |
| `feed-text/image/video-post-live-update` | m2-a04 |
| `feed-author-avatar-and-display-name` | m2-a05 |
| `follow-unfollow-live-projection` | m2-a07 |
| `like-unlike-live-count` | m2-a14 |
| `reply-live-thread-projection` | m2-a19 |
| `dm-live-messages` | m3-a01 |
| `sender-avatar-identity-when-rendered` | m3-a02 |
| `typing-indicator-within-2s-expires-within-5s` | m3-a06, m3-a07 |
| `receipt-sent-delivered-read-transitions` | m3-a08 |
| `group-receipt-waits-for-slowest-member` | m3-a09 |
| `member-add-promote-remove-leave-and-live-cutoff` | m3-a12, m3-a13 |
| `photo-message-live-render` | m4-a02 |
| `video-message-live-playback` | m4-a04 |
| `reaction-live-replace-remove` | m4-a05 |
| `edit-live-visibility` | m4-a08 |
| `delete-live-tombstone` | m4-a11 |
| `chat-color-background-sync` | m5-a07 |
| `warm-offline-search-over-synced-messages` | m5-a12 |
| `offline-message-queue-flush-in-order` | web analogue of the M6 offline queue (the simulator ids m6-a05…a07 remain `not-run`) |
| `m8-a02/a13/a14/a15/a16-*` | m8-a02, m8-a13, m8-a14, m8-a15, m8-a16 |

`m3-a02` deserves a note: the harness treats a sender-avatar node the kit does
not render as an explicit optional skip, but this lane **does** mount
`sm-convo-sender-avatar` and the harness confirmed exact sender identity on it,
so the skip was not taken and m3-a02 is a genuine pass.

## <a id="timing"></a>Timing records (best-of-3) and machine load

From the retained three-attempt receipts of the latest green segment per
milestone. Load is `uptime` sampled during my session, when I read and judged
these records; the measurements themselves were produced by the harness.

| subject | measurements (ms) | best | bound | pass |
|---|---|---|---|---|
| m1-a09 | 75.1 / 67.8 / 72.7 | 67.8 | — | yes |
| m2-a04 | 97.8 / 88.6 / 91.1 | 88.6 | — | yes |
| m2-a07 | 10484.1 / 394.2 / 378.5 | 378.5 | — | yes |
| m2-a14 | 112.5 / 63.9 / 119.5 | 63.9 | — | yes |
| m2-a19 | 55.6 / 71.9 / 66.5 | 55.6 | — | yes |
| m3-a01 | 1337.1 / 3351.2 / 2330.3 | 1337.1 | — | yes |
| **m3-a06** | 600.1 / 15.3 / (agg. 7392.8) | **15.3** | **2000** | yes |
| **m3-a07** | 2900.8 / 96.2 / (agg. 7392.8) | **96.2** | **5000** | yes |
| m4-a02 | 1372.9 / 1540.6 / 1686.2 | 1372.9 | — | yes |
| m4-a05 | (agg. 12274.2) / 1352.1 / 1343.9 | 1343.9 | — | yes |
| m4-a08 | 1829.1 / 1849.8 / 1335.8 | 1335.8 | — | yes |

m3-a06/a07 are the only hard numeric bounds the brief pins. Both clear with
room: worst retained typing-render attempt 600.1 ms against 2 s, worst
retained expiry 2900.8 ms against 5 s. "(agg.)" marks an attempt whose receipt
retained only its aggregate duration rather than the per-clock metric; the
harness's own `selectedAttempt` agrees with the best value in every row.

Two timing-sensitive ids have no three-measurement record and none was
fabricated: `m3-a08`'s receipt retained a single attempt (`bestOf 1`), and
`m7-a02` was never run. My own m5-a02 connected-purge observation was a single
180 s run rather than a best-of-3, so it is described in the m5-a02 section
above and is not entered in `timingRecords` as three padded values.

Load samples across the session: `18:17 load 24.82 56.91 81.22` (packet
qualification), `22:51 17.31 18.25 23.79` (before I started the backend),
`23:05 21.27 21.39 22.17` (browser pass), `23:14 12.21 18.24 20.59` (first
digest attempt), `23:24 77.91 94.19 56.29` (digest re-run), `23:30 116.42
120.25 81.55` (O5 probes). The O5 probes returned single-digit-millisecond p95
values **while load average was 116**, so load did not flatter them.

## <a id="o5"></a>O5 — scale envelope, verified independently

I APFS-cloned the retained `scale-final` store (3.0 GB store + 1.4 GB WAL) into
my work directory and served the clone on 49368 with `--replay` (effects
suppressed, schedules held), so the builder's retained store was never written.

**Invariant-manifest conformance — mine, not the builder's.** All 18
corpus-wide expected counts in `invariant-manifest-combined.json` matched
exactly against application-table counts: 1008 profiles, 5921 follow edges,
50228 posts (48224 top-level, 2004 replies), 5008 likes, 1004 reposts, 1002
conversations (901 DMs, 101 groups), 2053 memberships, 100015 messages (99105
text, 910 media), 2736 quoted replies, 2000 reactions, 0 disappearing settings.

**Named O5 fixtures — all exact.** `u0500` 500 follows and 100 conversations;
`u0005` 5 follows; `u0900` **900** followers and **200** top-level posts;
`u0901`'s following list exactly `u0001,u0002,u0003,u0004,u0900`; `g0001`'s
roster exactly the manifest's 50 members and exactly **10,000** messages.
Ten sampled chats' message counts matched the manifest via paged API history,
and the busy chat paged to exactly **10,000 rows over 200 pages**.

**My own probes** — k=20 after 3 warm-ups, sequential, 30 s timeout:

| degradation rule | measured | bound | pass |
|---|---|---|---|
| busy-chat page 50 ≤ 3× page 1 | 4.72 ms | 14.30 ms | yes |
| 500-follow Following ≤ 3× 5-follow | 3.68 ms | 11.28 ms | yes |
| celebrity-follower read ≤ 3× 5-follow | 3.49 ms | 11.28 ms | yes |
| celebrity write ≤ 3× 5-follower write | 83.83 ms | 274.01 ms | yes |
| message search full ≤ 3× 10%, mid-curve on/below | 3.76 / 3.64 / 50%=2.43 ms | — | yes |
| Insights full ≤ 3× 10%, mid-curve | 2.40 / 2.32 / 50%=1.62 ms | — | yes |
| Trending full ≤ 3× 10%, mid-curve | 2.69 / 2.48 / 50%=1.72 ms | — | yes |
| cold-start sync of the 100-conversation user | 100 conversations in 45 ms | no timeout/OOM | yes |
| no probe times out / errors / OOMs | slowest single sample 609.92 ms | 30 s | yes |

The 10% and 50% figures are the lane's retained checkpoint probe records — the
replay-record checkpoint data the prompt supplies for full runs — because
reproducing them would require re-running the 2 h 22 m replay. The full-corpus
column is mine.

**Band = 75, by first-match.** Band 0 does not fire (manifest conforms, named
fixtures exact, all 167,243 actions across 13 verbs replayed rather than a cap
exhausted). Band 30 does not fire (every rule passes, nothing timed out,
errored or OOMed). Bands 60 and 90 both turn on inputs this instrument never
froze: `social-messenger.md`'s absolute-ceiling table and wall-cap table are
explicit *pilot-calibrated* placeholders, and this wave committed no probe set,
so the per-probe ceilings and the replay wall cap do not exist. 60's predicates
cannot be affirmed (no ceiling can be shown exceeded, no cap utilization shown
above 80%); 90's cannot either, since both its clauses need those numbers and I
will not invent them. First-match therefore lands on **75**. On the measured
margins this lane would very likely reach 90 had the ceilings and cap been
frozen — recorded as a diagnostic, not as the band.

## Defects beyond the checklist

### <a id="defect-d-01"></a>d-01 — minor — group aggregate receipt advances when an unread member leaves

`schema.q`'s `fn receipt(m)` takes the minimum state over the rows **currently**
in `members`, so removing an unread member's membership removes them from the
requirement instead of holding the aggregate back. The brief pins the
aggregate to "membership at send time".

```
3-member group, Alice sends. Bob acknowledges state 2. Carol never reads.
  aggregate = 0                       <- correct, waits for the slowest member
Carol then leaves (removeMember on her own membership; permitted, and correct as a leave)
  aggregate = 2  ("read by all")      <- nobody read Carol's copy
```

The member-joins side is handled correctly (`receipt()` excludes members whose
`joined`/`joinedOrdinal` postdate the message), which is why m3-a09's own
scenario passes green. Narrow trigger, no data loss, no security effect — but
it shows the user a claim that is false. Source: `schema.q:223-229` with the
`members` delete rule at `schema.q:172`.

### <a id="defect-d-02"></a>d-02 — cosmetic — `/m/acknowledge` reports success to a non-member

A freshly registered non-member POSTed
`/m/acknowledge {ids:["sm0001"], state:2}` and received `state:"sent"`. No
state changed. Every other non-member write in the same probe was refused
terminally (`NOT_MEMBER`, `NOT_ADMIN`, `MESSAGE_NOT_FOUND`, `E_RULE`).
`acknowledge` is the one delivery-acknowledgement operation `API.md` documents
for custom clients, so an inert success leaves a client unable to distinguish
"acknowledged" from "discarded". Source: `schema.q:289-302`.

### <a id="defect-d-03"></a>d-03 — cosmetic — the push seam writes to a directory it does not create

`snapback/worker.mts` appends each payload to `CLIQUE_PUSH_LOG` (default
`evidence/push.jsonl`) without ensuring the directory exists. On an instance
whose log directory is absent, every push and digest payload is lost with no
visible error while the effect is still acknowledged to the backend. Observed
on an isolated instance I created without an `evidence/` folder: the schedule
fired and `digest.daily` ran, yet no payload was ever recorded; creating the
directory made the same seam record normally. Does not affect the lane's own
evidence, where `evidence/` exists. (Also note the seam reads its path at
module load; `CLIQUE_PUSH_LOG` did not reach the worker the backend spawns, so
the default path is what is used in practice.)

### <a id="defect-d-04"></a>d-04 — cosmetic — the M8 acceptance receipt is not self-contained

`npm run acceptance -- --milestone m8` fails from a clean checkout unless
`scripts/start-proof.mjs` and `scripts/trending-proof.mjs` have already run,
because the tests mapped to m8-a05/a06/a07 read
`evidence/m8-trending-clock.json` and query the separate clock-offset backend
on 49363. The README documents the prerequisite, but it is not expressed in
`package.json` or enforced by the suite, so an m8 receipt can depend on
out-of-band state. The other six milestones needed nothing beyond backend,
seeds and web server.

## Trust-boundary probing (reported under O2, not O3)

With no holdout probe set committed, none of this bears on O3. It is O2
evidence. Everything held server-side rather than by UI absence:

| probe | result |
|---|---|
| unauthenticated `global`/`post`/`people`/`profile`/`thread`/`inbox` | all **401 `E_AUTH`**, no data |
| registered non-member reading another pair's DM (`thread`, `apiHistory`, `roster`, `room`, `searchChat`, `whoTypes`, `message`) | empty arrays / `null` — no leak (the member sees 29 thread rows) |
| non-member writes (`send`, `addMember`, `promote`, `configureChat`, edit/delete/react on another chat's message) | refused `NOT_MEMBER` / `NOT_ADMIN` / `CHAT_NOT_FOUND` / `MESSAGE_NOT_FOUND`; target state unchanged |
| sender forgery (`sender`/`author` args alongside a different bearer) | rejected outright `E_INPUT` "send takes no argument author" |
| cross-user `setLike` / `setFollow` / `saveProfile` with an extra `principal` | `E_INPUT`; identity is never taken from arguments |
| private DM asset | member **200**, registered non-member **404**, unauthenticated **401** |
| third party fetching a view-once asset | **404**, and the recipient's single view still worked afterwards (no view-burning) |
| refusal-code existence oracle | `promote` on a real invisible chat and on a nonexistent chat both return `NOT_ADMIN` — indistinguishable |
| write-id replay | same write id twice → exactly 1 message stored |
| receipt monotonicity | `sent 0 → read 2`; a later `state:1` did not regress it; `state:3` refused `BAD_RECEIPT` |
| input bounds | empty body and 2001 chars refused `E_INPUT`, exactly 2000 accepted; bad colour `BAD_COLOR`; cross-chat quote `WRONG_CHAT`; self-DM `SELF_DM` |
| tombstone | id preserved, text emptied, body gone from in-chat and global search |
| removed member | server read yields no post-removal row; re-sending refused `NOT_MEMBER` |
| unread accounting | 4 → 3 after a tombstone → 0 after reading the newest |
| edit side effects | sets `edited`, keeps the receipt at 2, keeps the message at its original ordinal position |

## <a id="o3"></a>O3 records null — and why

O3's applicability predicate **is** satisfied (M6 green, M1–M5 attempted), so
this is not a "not applicable" null. `applicability.json` restricts O3 to
"the wave's secret rotated holdout probes only", and deviation 1 removes that
input entirely. Scoring O3 from my own probing would substitute a different
instrument for the frozen one and would not be comparable to any calibrated
lane, so the honest record is `null`, with the trust-boundary evidence above
reported under O2 where it belongs. Under
`applicability.json → nullDimensionRule` this independently bars a weighted
total, which is consistent with the wave's uncalibrated status.

## Grader-abort accounting

`sessionOutcome: completed`, `rerunsUsed: 1`.

One phase failed on its first attempt through **my own** tooling, not lane
behaviour: for the M8 digest block I pointed my reader at
`digest/push.jsonl` via `CLIQUE_PUSH_LOG`, but the worker the backend spawns
reads its default `evidence/push.jsonl`, and I had not created that directory
on the isolated instance — so the payloads were lost (which is how I found
defect d-03) and my probe saw none. I diagnosed it, corrected the path,
created the directory, confirmed with a forced `notify` effect that the seam
records normally, and used the single permitted re-run of that phase. The
re-run passed all five digest assertions. No other phase was re-run, and no
lane defect was implicated in the first failure.

## Result files and the 119-assertion partition

I graded all **119** frozen assertions in this one session. The frozen
`grader-report.schema.json` constrains `assertionResults` keys to
`^m[1-7]-a[0-9]{2}$`, so it can carry only the 101 M1–M7 ids; the 18 M8
results are therefore written to `m8-assertion-results.json` using the same
record shape and the same enum values. Validated:

```
grader-report.json schema-valid            : true  (AJV 2020 against the frozen schema)
m1-m7 ids 101 | m8 ids 18 | union == 119   : true
no id duplicated across the two files      : true
m1-m7 set == GRADER_ASSERTIONS_101.txt     : true
m8 set == the frozen 18 M8 ids             : true
m8 records use the report's enums/shape    : true
every result carries an evidence pointer   : true
```

| milestone | passed / graded |
|---|---|
| M1 | 13 / 13 |
| M2 | 27 / 27 |
| M3 | 15 / 15 |
| M4 | 12 / 12 |
| M5 | 12 / 12 |
| M6 | 6 / 13 (a01–a07 `not-run`: no simulator artifact) |
| M7 | 0 / 9 (`not-run`: never attempted) |
| M8 | 16 / 18 (a17/a18 `not-run`: no simulator artifact) |
| **prior-measured 101 subtotal** | **85 / 101** |
| **M8 18-id subtotal** | **16 / 18** |
| **complete total** | **101 / 119 (84.9%)** |

### Measurement-coverage gap in the prior record, for the harness

Two facts belong on the record together. First, the **frozen schema
limitation**: `grader-report.schema.json`'s `assertionResults`
`patternProperties` key is `^m[1-7]-a[0-9]{2}$`, which cannot express an M8 id
at all, even though `assertions.json` (`0.3.0-m8`) carries M8's 18 assertions
and the applicability manifest puts M8 in O1/O2's full-run observing set. Any
schema-valid report under this instrument is structurally incapable of
carrying a machine-comparable M8 result set. Second, the **prior
measurement-coverage gap**: the structured `assertionResults` of the
September 5 and September 12 runs carried only the 101 ids listed in
`GRADER_ASSERTIONS_101.txt`. Their notes could describe M8 observations in
prose, but they did not provide a machine-comparable 18-id M8 result set. So a
comparison of this run's 119-id total against those runs is not like-for-like;
the prior-101 subtotal (85/101 here) is the comparable figure, and the 18 M8
results are new measurement coverage rather than a changed score.

## Scope note

Per LLP 0197/0198 gating this trace and the report compute **no** weighted
total, efficiency statistic or cross-lane comparison. Those are the harness's
and publisher's jobs.

## Published companion artifacts

- `grader-report.json` — the machine record (101 M1–M7 ids).
- `m8-assertion-results.json` — the 18 M8 ids, same shape and enums.
- `probe-scripts/` — the sanitized probe sources I wrote, so every claim above
  is re-runnable.
- `probe-results/` — sanitized machine-readable outputs of every probe I ran,
  plus `receipts-validation.json` (the AJV result and hash bindings for all 18
  frozen choreography streams).
- `shots/` — 22 browser screenshots referenced above.
