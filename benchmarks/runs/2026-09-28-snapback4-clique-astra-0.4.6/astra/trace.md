# social-messenger grader trace — lane `astra-snapback4`

Sanitized evidence and action trace, the published companion to
`grader-report.json`. Credentials are redacted throughout: the fixture pack's
persona passwords and every account I created are referred to by role, never by
value. Raw transcripts are not published (LLP 0197 redaction posture, LLP 0198
rule); this file is the record.

| | |
|---|---|
| Lane | `astra-snapback4`, backend `snapback4-0.4.6` (npm `snapback4@0.4.6`, `snapback4-expo@0.4.6`) |
| Run scope | `full` (M1–M8 in the denominator) |
| Wave | `full-3models-astra`; probe set `none-uncommitted` |
| Grader | family `claude`, model `claude-opus-5`, fresh session, no builder context |
| Session outcome | `completed`, 1 re-run used (M5 suite) |
| Host | macOS arm64, Node 24.18.0, ports 49360–49379 only |
| Instrument pins | `assertions.json` sha256 `e15c3952…`, `applicability.json` sha256 `b3d45805…` |

## 0. Contamination control

Before reading anything in the lane I listed its top level and excluded
`diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and `run-log.md` from every
read, grep and glob for the whole session. None of them was opened, and no
builder self-score, transcript or narrative reached me. `grader.contaminated` is
`false`.

What I did read: the frozen instrument (brief, `ENVIRONMENT.md`, `CONTRACT.md`
extracts, `assertions.json`, `applicability.json`, the grader prompt and report
schema, `choreography/` docs and schema, `fixtures/`), and from the lane its
source, scripts, `API.md`, `README.md`, `package.json`, `milestones.json`,
`suite-status.json`, `coverage-manifest.json`, `coverage-protocol.json`,
`windows.json`, `digest.json`, `run-record.json`, and the machine-readable
contents of `evidence/` and `artifacts/`.

## 1. Environment brought up by me

Documented entrypoints from the lane's `README.md`. `npx snapback4 check`
passed (advisory planner output only). I started the backend and a static server
for the already-built `dist/` rather than re-exporting, after confirming the
bundle targets `127.0.0.1:49360`.

| Process | PID(s) | Port | Log |
|---|---|---|---|
| `npx snapback4 dev --port 49360` | 55241 → 55284 → 55289 | 49360 | `grading/backend.log` |
| static web server for `dist/` (`grading/serve-web.mjs`, a copy of the lane's `scripts/serve-web.mjs` with its `run-log.md` append removed) | 55245 | 49361 | `grading/web.log` |
| push worker (`grading/push-worker.mjs`, same copy treatment) | 56211 | – | `grading/push-worker.log` |
| isolated instance for my M8 trending/digest probes | 70645/70699/70704, then 76516/76695/76731 after the deliberate restart; worker 70782 | 49366 | `grading/m8-grader-backend.log` |

The lane's own `scripts/proof-instance.mjs` additionally opened and closed an
instance on 49363 during the M8 suite. Nothing outside 49360–49379 was touched;
no `pkill`, `killall` or pattern kill was used at any point; only the PIDs above
were signalled, at the end.

Machine load is recorded beside each phase below because other sessions share
this host. Over the session `uptime` 1-minute load ranged from **4.16 to 44.32**.

## 2. Phase 1 — builder suite

`npm run acceptance -- --milestone mN` for every attempted milestone, with
`ACCEPTANCE_RECEIPT`/`ACCEPTANCE_STATUS` redirected into `grading/` so the
builder's first-green receipts stayed intact.

| Milestone | Load (1 min) | Result | Tests |
|---|---|---|---|
| m1 | 27.6 | pass | seed-idempotent, signup, duplicate-handle, edit-profile, avatar, duplicate-email |
| m2 | 32.4 | pass | seed-idempotent, posts, following, unfollow, likes, reposts, self-membership, replies, pagination, links |
| m3 | 36.4 | pass | seed-idempotent, dm-dedupe, groups, nonadmin, quoted-reply |
| m4 | 36.9 | pass | media-picker, reaction-intents, edit-label, asset-revocation, server-windows |
| m5 | 39.8 | **fail** on `grouped-search` | view-once, admin-settings, people-prefix, chat-search passed |
| m5 (re-run) | 26.7 | pass | all five |
| m6 | 39.7 | pass | push-seam, custom-client, sample-conformance, cold-offline-and-durable-queue |
| m8 | 44.3 | pass | insights-totals, utc-days, trending-window, scheduled-digest-no-clients |

The single M5 failure was a Playwright strict-mode violation: the test renames a
freshly created group to a fixed title on every run, so a second run against a
store that already ran it leaves two identically-titled groups and the locator
resolves to two nodes. Per the grader-abort protocol I re-ran the phase once and
it passed, so this is not a grader abort. It is filed as defect **d-03** (suite
re-runnability, minor) and the underlying assertion was verified independently in
phase 3. Receipts: `grading/suite-m1..m8.json`, `grading/suite-m5-rerun.json`,
`grading/suite-status.json`.

## 3. Phase 2 — coverage-manifest spot-verification

Verdict **honest**; no milestone is adjudicated to `capability-failure`.

`coverage-protocol.json` (sha256 `146ad4e4…`, unchanged from the value the run
record pins) maps every suite-required assertion of all seven attempted
milestones to a named test — M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5,
M8 6/6 — which I checked against the frozen manifest's own suite-required sets.
I then read the mapped test body for sixteen sampled ids (`m1-a03`, `m1-a11`,
`m2-a13`, `m2-a22`, `m2-a24`, `m2-a27`, `m3-a03`, `m3-a15`, `m4-a06`, `m4-a09`,
`m5-a05`, `m5-a09`, `m6-a11`, `m6-a13`, `m8-a04`, `m8-a07`) and confirmed each
test actually exercises that assertion's observable, and that each mapped test
passed in my own runs.

Two mappings are honest but thin, and I closed both gaps myself rather than
leaning on them:

- **m2-a24** claims "no duplicates *and no gaps*"; the mapped `pagination` test
  only checks duplicates across the first two pages. I walked both feeds to
  exhaustion (Following 2 pages/27 items, Global 14 pages/277 items), found no
  duplicate `(id, repost, actor)` key, confirmed both walks non-increasing in
  `.at`, and confirmed all 26 of the account's own top-level posts appear
  exactly once in the Global walk.
- **m3-a15** compares one starter conversation's message id list rather than
  corpus-wide counts. I additionally compared profile and post totals across a
  re-seed (37→37 profiles, 288→288 posts, 20→20 messages).

One artifact-hygiene note, not a mapping defect: `scripts/acceptance.mjs`
rewrites `coverage-manifest.json` on every run and hardcodes the M1 block instead
of importing it, so the manifest is a run output rather than a fixed input. I
diffed the rewritten file against `coverage-protocol.json`'s `testMappings` for
all seven milestones — every mapping is identical.

## 4. Phase 3 — independent checklist execution

Every assertion was re-executed by me except the `[choreo]` ones, which the
frozen prompt requires be scored from harness recordings and receipts and never
re-driven. Results in `grading/results-*.json`.

### 4.1 Harness choreography receipts (all `[choreo]` assertions)

First I established the receipts are admissible. `diff -rq` of the lane's
`choreography/` against the read-only instrument copy shows **no difference**
outside `node_modules`/`package-lock.json`, and both declare VERSION
`0.3.8-m8` — the harness was copied, not modified. I then validated every
receipt line against the frozen `receipts.schema.json` with the choreography's
own AJV (2020 dialect): **171 receipt lines across 26 files, 0 invalid**. (The
`*.observations.jsonl` sidecars are a different D0.6 format and are not receipt
lines; they are excluded.)

Every web choreography assertion passed, and every segment summary records
`green:true`, `pass:true`, `nonGreenCause:null`: m1 3/3, m2 9/9, m3 7/7,
m4 5/5, m5 4/4, m6 1/1, m8 5/5. Best-of-3 flake control is visible and honest —
several assertions failed one or two attempts and passed another
(`follow-unfollow-live-projection` 1 fail, `dm-live-messages` 1 fail,
`quoted-reply-excerpt-and-jump` 2 fails, `reaction-live-replace-remove` 2 fails)
with all attempts retained in the receipt.

**Native simulator legs are absent.** Both the M6 and M8 segment summaries record
`supplementalExternal` `ios-simulator-m6` / `ios-simulator-m8` with
`status:"not-recorded"`, `pass:null`, `requiredForGreen:false`. I searched the
whole lane for the artifacts `choreography/simulator.md` requires —
`m6-ios-screen.mp4`, `m6-ios-receipts.jsonl`, `m6-ios-run.json` and their M8
counterparts — and found none; `artifacts/m*-ios/` contain only exported
Expo/Hermes bundles (`_expo/`, `assets/`, `metadata.json`). Consequently
`m6-a01`–`m6-a07` and `m8-a17`/`m8-a18` are recorded **not-run**: their
designated evidence never existed, the prompt forbids substituting builder
assertions, and it forbids my re-running the simulator. This is the single
largest driver of the O1 and O4 placements. The lane records the gap honestly
rather than claiming a native pass.

Timing-sensitive best-of-3 values are taken from these receipts, so they carry
the *builder* session's machine load, which I cannot observe; that caveat is in
the report. The two receipts with numeric bounds both pass with margin: typing
visible 64.7 ms best-of-3 against 2 s, typing expiry 986.3 ms best-of-3
against 5 s.

### 4.2 M1 (load 8.6 for the API probe; web probe at load 10.1)

- `m1-a01` signup with a 17-character password → ok.
- `m1-a07` raw HTTP: `/q/myProfile` with the bearer returned **200** before
  `POST /auth/logout` and **401** `E_AUTH` "this session is not live; sign in
  again" after. Server-side revocation, not a client-side forget.
- `m1-a02`/`a03`/`a04`/`a08`/`a10`/`a11` by browser automation: signup leaves the
  auth form; a duplicate handle shows "That handle is taken."; a duplicate email
  shows "that email already has an account; sign in instead"; display name and
  bio survive a full reload; the fixture avatar uploads and renders at
  `naturalWidth=256` *after a reload*, i.e. served from the backend rather than a
  local blob preview.
- `m1-a12` source inspection: `snapback/schema.q:1` declares the documented
  built-in provider path `use identity password`, and the app authenticates only
  through `snapback4/auth`'s login/signup (`src/Clique.tsx:20`) — no hand-rolled
  hashing anywhere. Provider documentation: `node_modules/snapback4/README.md:30`
  and `CLIENT-AND-OPERATIONS.md:1433–1442` (Argon2, ≥8 characters, 7-day
  sessions). The running server prints its Argon2 slot count at startup, and
  server persistence contains `$argon2id$v=19$m=19456,t=2,p=1$…` digests —
  argon2id at standard published parameters.
- `m1-a13`: no fixture or grader password string occurs in
  `.snapback4/store.sqlite`, its `-wal`, the exported web bundle under `dist/`,
  or any log under `evidence/` or `grading/`. Only argon2id digests appear.
  (Passwords do appear in the fixture pack and in the lane's own test scripts;
  the fixture pack is the declared exception and test scripts are neither server
  persistence, client bundle nor log.)

### 4.3 M2 (custom-client API, plus browser automation for the UI clauses)

Three fresh grader accounts, then the whole M2 checklist end to end: text /
2-image / video posts read back by a second client; Global-before-Following
projection; follow, then unfollow with the older posts also gone from Following
while still served in Global; a retried like intent leaving `likeCount=1` then
unlike to 0; repost surfacing the original author to a follower and toggling off;
thread ordering with `replyCount=2` and a nested reply excluded; replies absent
from both feeds; 20-per-page with cursors in both tabs; and self-membership with
`followers=0, following=0`. The no-gaps walk is described in §3.

Browser clauses: the URL renders as a tappable `role="link"` span, underlined,
`cursor:pointer`, containing only the URL substring inside otherwise plain post
text, and clicking it calls the platform URL opener — I instrumented
`window.open` and captured exactly the post's URL (React Native
`Linking.openURL`, the web equivalent of the system browser). No preview, unfurl
or link-card node renders, and no media node appears inside the item. The repost
renders "↻ Reposted by ⟨reposter display name⟩" with the original author
preserved on the card.

Two of my own first-pass web checks failed and were my test's fault, not the
lane's: I looked for an `<a>` element (React Native Web renders
`<span role="link">`) and I mis-scoped the quoted-reply bubble locator. Both were
re-probed with correct selectors and passed; `grading/web2-probe.json` holds the
DOM evidence. I record this explicitly so the failures in
`grading/results-web.json` are not read as lane defects.

### 4.4 M3 / M4 (load 8.6)

DM de-duplication across both directions to one channel id; a group of three and
a second identical-membership group coexisting under a distinct id; non-admin
`removeMember` → `NOT_ADMIN` with the roster unchanged; seed idempotency across
every installed segment. Photo and video messages delivered with the recipient
able to fetch the bytes; a retried reaction intent leaving one reaction, ❤️
replacing 👍, and re-tapping clearing it; the "edited" label present on the
edited bubble and absent on an unedited one in the same chat.

Two boundaries I deliberately probed more strictly than the suite does:

- **`m4-a10`** — the suite advances the dev clock. I instead waited **65 s of
  real elapsed time** under the shortened 60 s window. The in-window edit
  succeeded; the post-window edit was refused server-side with
  `EDIT_WINDOW_CLOSED` and the stored text was unchanged by the refused write.
- **`m4-a12`** — `GET /assets/{id}` with the recipient's own bearer returned
  **200** before the delete and **404** `E_ASSET_UNKNOWN` after, with the message
  tombstoned.

### 4.5 M5 (load 6.9 for the expiry probe, 4.2 for the purge probe)

View-once: the recipient's first fetch returned 200 / 2087 bytes, the second
**410** `E_ASSET_VIEWED`; a third member independently got exactly one 200 then
410, so the allowance is per principal; a `Range` request on view-once media is
refused **416**, matching `API.md`. Non-admin rename → `NOT_ADMIN`. People search
matches "car"/"CAR"/"Car"/"che" to Carol and correctly does *not* match the
mid-word "arol". In-chat search for "COF" returns the seeded coffee line. A
unique token planted in two chats returns exactly two groups, one per
conversation, each with its own hits.

Expiry needed care to be a real proof, and my first attempt was not one:

1. **`m5-a01`** — a DM set to the 24h option (180 s under the shortened config).
   All three API clients *and* the browser context were closed before the TTL and
   stayed closed for the whole window. Raw HTTP afterwards: `/q/message` returns
   `data:null`, and the message is absent from `/q/history` and from server-side
   search. Server-enforced, no client involved — `schema.q` declares
   `expire at .expiresAt`.
2. **`m5-a02`/`a03`, first attempt — discarded.** I relaunched with a copied
   Playwright `storageState`, which does not carry IndexedDB, so the replica was
   empty and the message's absence proved nothing. I threw the result away rather
   than bank it.
3. **`m5-a02`/`a03`, final.** A **persistent on-disk browser profile**, so the
   replica survives the app kill, and a non-expiring control message in the same
   chat. Before expiry, an offline reload rendered the disappearing bubble and
   offline search found it — it was genuinely durably cached. After the 205 s
   all-clients-closed window the same profile was relaunched: the expired message
   was purged within 9 ms of reconnect, the control message survived, offline
   search returned 0 hits for the expired message and still found the control,
   and the limited-horizon badge was shown. Session was also restored without
   re-auth, which incidentally corroborates `m1-a05`.

### 4.6 M6 (load 10.4)

- **`m6-a08`/`a09`** — with no client open for the recipient, three sends
  produced three logged payloads, all targeting him, each with the right
  `chatId` and the sender's current `displayName`. The text preview is exactly
  the first 80 characters of a 130-character body; the view-once photo previews
  as `Photo` and the video as `Video`; no caption text leaked into any preview.
- **`m6-a10`/`a11`** — `scripts/custom-client-demo.mjs` run directly with only
  the documented environment variables exited 0
  (`conversations:37, historyPages:2, receivedBy:"documented polling"`). Reading
  it confirms every listed operation: `/auth/login` (or an issued token), `inbox`
  paged to exhaustion, `apiHistory` plus a second cursor page, `POST /m/send`,
  and receipt of the new message by the documented polling loop — no private
  socket protocol.
- **`m6-a12`** — my own variation, raw `fetch` only, written from `API.md`
  without reading source: page `/q/inbox` until `row.chat.title` matches, take
  `row.conversation`, call `/q/apiHistory` with `c:null`, read `data[0]`. It
  returned the correct newest message, with the right `type`, **on the first
  try**. The documentation was sufficient.
- **`m6-a13`** — `node scripts/replay.mjs sample` standalone: the frozen
  `fixtures/validate.mjs` validated `sample-50.log` (50 actions, 13 verbs)
  against `0.1.0-p1`, all 50 settled, and the adapter's own verification re-read
  every entity, roster, reaction and quote and hash-compared real media bytes.
  The adapter is substantive, not ceremonial.
- `m6-a01`–`a07`: **not-run**, per §4.1.

### 4.7 M8 (load 9.2 main instance, 6.3 isolated instance)

- **`m8-a01`** — I re-derived all six totals from *different* primitives than the
  builder suite uses (per-post `likeCount`/`repostCount` counters, `api.replies`
  paged per authored post, `api.social` counters) and got an exact match:
  `{posts:55, likesReceived:12, repostsReceived:11, repliesReceived:7,
  followers:4, following:2}`. The Insights screen renders the same six tiles and
  7 day rows.
- **`m8-a03`/`a04`** — a post created during the probe raised today's bucket from
  13 to 14; the seven day keys were exactly the consecutive UTC epoch-days
  20718–20724 ending at `floor(insights.at/86400000)`, i.e. server-time UTC
  boundaries; five of the seven were all-zero days rendered as zeros rather than
  omitted.
- **`m8-a05`/`a06`/`a07`** — on a fresh isolated instance: the 3-like recent post
  ranks first; a post liked by everyone and then aged past the window by
  advancing that instance's clock 25 h is absent from Trending although it still
  carries `likeCount=3`; two posts tied at 2 likes rank newest-first.
- **`m8-a08`–`a12`** — my own digest fixture on the isolated instance under the
  shortened 120 s config, with **every client closed** before the boundary.
  Exactly three payloads landed, one per active user, matching counts I derived
  by hand: `{1,1,1,1}`, `{1,1,1,1}`, `{0,0,2,2}`. A reply was correctly excluded
  from `newPostsInFollowing`; a tombstoned message, the recipient's own message
  and a seen-through message were all correctly excluded from `unreadMessages`.
  The quiet fourth persona received nothing at all. For the trust boundary, a DM
  between two other users contributed 0 to the non-member, and a group message
  sent before the target was removed contributed 0 once his membership ended —
  while the third persona, who *is* a member of both, correctly counted 2 across
  2 chats, so the zeroes are authorization and not a dropped counter. I then
  stopped and restarted the backend mid-period with the same clock offset, clients
  still closed: the first period still shows exactly three payloads (no double
  emission), and the following period, with no new activity, emitted nothing.
- `m8-a17`/`a18`: **not-run**, per §4.1.

### 4.8 M7

Not attempted. `ENVIRONMENT.md` defers M7 to a separate fresh session run by the
orchestrator after grading and instructs the builder not to attempt it;
`milestones.json` and `run-record.json` both record `not-run`, and
`preExistingM7Structures` shows `visibleMessageCount:false`, `polls:false`. No
suite, coverage mapping, choreography receipt or migrated state exists, so all
nine assertions are **not-run**. `m7-a09` is recorded not-run rather than
not-applicable: the not-applicable branch is reserved for the case where no
milestone was previously green, whereas M1–M6 and M8 are all green here — the
regression simply never ran. Under `applicability.json` these nine still sit in
O1's denominator as not-passed.

## 5. Phase 4 — holdout probes: not run (recorded deviation)

No probe set was hash-committed for this wave, so execution-order phase 4 was
skipped. `wave.probeSetSha256` is the literal string `none-uncommitted` and
`probeResults` is empty. **No probes were invented.** The report schema gives
`probeResults` no place for a note, so the explanation lives in the report's
`notes`.

Because O3 is nonetheless applicable (M6 green, M1–M5 attempted) I wrote nine
trust-boundary probes covering every category the brief publishes and ran them
against the live backend (`grading/results-trust.json`, load 7.0). They are
reported in O3's justification, not as `probeResults`, because they are not the
wave's rotated set and are not claim-eligible. Every boundary held server-side
rather than by UI absence:

| Probe | Result |
|---|---|
| Cross-user DM read (`history`, `apiHistory`, `message`, `searchIn`, `roster`) by a non-member | nothing leaked; `data:null` envelopes |
| Private chat photo via `GET /assets/{id}` | 404 as a non-member, 401 unauthenticated |
| Removed-member delivery | no post-removal message served; her writes refused `NOT_MEMBER`; her pre-removal copy intact |
| Session families | ordinary logout revoked only its own family (401) while an independently issued session stayed live (200); `logout-all` killed it (401) — matches `API.md` |
| Replica-only held queries | refused `E_QUERY_HELD`, not silently answered |
| Non-member `send`/`react`/`seen` | `NOT_MEMBER`, `MESSAGE_NOT_FOUND`, `NOT_MEMBER` |
| Foreign `editMessage`/`deleteMessage` | `NOT_AUTHOR` both |
| Non-admin `promoteMember`/`configureChat`/`addMember` | `NOT_ADMIN` all three |
| Delete window | in-window delete succeeds; post-window refusal recorded by the suite's `server-windows` test |

Plus the trust-boundary checklist assertions verified in phase 3: view-once
second fetch 410 and Range 416, deleted-asset 404, expired-edit
`EDIT_WINDOW_CLOSED` on real elapsed time, server-enforced expiry with every
client closed, and digest authorization.

## 6. Phase 5 — defects beyond the checklist

Six, severity-bucketed in the report: two **major** (the 50-member busy-group
send/render stall past 30 s at the full envelope, and the ~1000-conversation cold
offline acquisition timing out at 90 s), two **minor** (the razor-thin Insights
mid-curve predicate failure at 1.8170 ms vs a 1.8092 ms limit, and the M5 suite's
re-runnability), two **cosmetic** (the quoted-reply block labelled "Reply"
instead of the quoted sender, and choreography residue permanently mutating the
seeded persona display names because the idempotent seed replays its profile
write as a no-op).

The two majors are read from the lane's own recorded probe receipts across six
attempts; I did **not** re-run the 2396 s scale replay, and the lane's run record
already agrees the gate did not pass. Nothing I executed below the scale envelope
misbehaved: zero failed assertions across M1–M5, M6-web and M8-web, no crash, no
wrong data, and 58 lines of backend log with no error or exception for the whole
session.

The missing native simulator artifact is deliberately **not** filed as a defect.
It is a checklist gap, not a finding beyond the checklist, and filing it here
would double-count it against O2 when it is already scored in O1 and O4.

## 7. Phase 6 — O-dimension scores

Scored exactly the dimensions `applicability.json` makes applicable for a full
run with M6 green and M1–M5 attempted: all five of O1–O5, none null. Anchor text
is cited in each score's `anchorsCited`.

| | Score | One-line basis |
|---|---|---|
| O1 | 78 | 101/119 assertions pass, 7 of 8 milestones green, but no platform-proof artifact exists and M7 is entirely not-run |
| O2 | 70 | two majors, both confined to the scale envelope; everything below it clean |
| O3 | 88 | every boundary denied server-side, on grader-written substitutes narrower than a rotated wave set |
| O4 | 30 | O4's designated basis — the simulator artifact — does not exist; held at 30 by honest recording and the passing web offline segments |
| O5 | band 30 | first-match at 30: the Insights mid-curve rule fails and two probes error/time out; band 0 excluded because the invariant manifest conformed and the cap was not exhausted |

No weighted total, efficiency statistic or cross-lane comparison is computed or
reported here — those belong to the harness and publisher under LLP 0197/0198
gating.

## 8. Recorded deviations from the frozen protocol

1. **No holdout probe set** was committed for this wave. Phase 4 skipped,
   `probeSetSha256` = `none-uncommitted`, `probeResults` empty, nothing invented.
   Substitute bases for O3 and O5 are labelled as such and are not
   claim-eligible.
2. **Uncalibrated grader.** My family has not passed the calibration gate:
   `calibrationPassed:false`, `sameFamilyGraded:false` (the builder harness is
   recorded as `gpt-6-astra`, a different family). The record labels this grade
   `uncalibrated-grader`. I graded anyway, as instructed.
3. **Best-of-3 and machine load.** Timing-sensitive checks are judged best-of-3.
   Those values come from the frozen harness receipts, which I must not re-drive,
   so they carry the builder session's load rather than mine; load is recorded
   beside every measurement I took myself, and the session range (4.16–44.32) is
   recorded above.
4. **Frozen schema limitation.** `grader-report.json`'s `assertionResults`
   pattern is `^m[1-7]-a[0-9]{2}$`, which cannot express an M8 id. All 119 frozen
   assertions were graded in this one independent session; the report holds
   exactly the 101 M1–M7 ids and the 18 M8 results are in
   `grading/m8-assertion-results.json`, keyed by the same enums, with no id
   duplicated across the two files. I verified the union is byte-identical to the
   full id list in `assertions.json` and that the 101 are byte-identical to
   `GRADER_ASSERTIONS_101.txt`.
5. **Prior measurement-coverage gap.** The September 5 and September 12
   structured `assertionResults` carried only those same 101 ids. Their notes
   could describe M8 observations, but they provided no machine-comparable 18-id
   M8 result set. This is therefore the first run with a complete, machine-
   comparable 119-id partition, and comparisons against those earlier records
   should use the 101-id subtotal, not the 119-id total.
6. **Nothing struck.** `ENVIRONMENT.md` strikes nothing in this run, so no
   assertion is recorded `struck-by-environment` and every assertion was graded
   at the brief's bar.

## 9. Side effects of grading, and cleanup

Running the lane's own entrypoints against its own dev store necessarily wrote to
the lane: appends to `evidence/push.jsonl`, new replay/verification receipts under
`evidence/`, and `scripts/acceptance.mjs` rewriting `coverage-manifest.json`
(diffed — mappings identical). Suite receipts were redirected to `grading/` so the
builder's first-green receipts were not overwritten. Everything else I produced is
under `grading/`. I wrote nothing into `instrument/`.

At the end I signalled only the PIDs listed in §1 and confirmed no listener
remained in 49360–49379. The final state of the port range is recorded in
`grading/cleanup.txt`.

## 10. Artifact index

| File | Contents |
|---|---|
| `grader-report.json` | the machine record, 101 M1–M7 assertion results, defects, O-dimensions |
| `m8-assertion-results.json` | the 18 M8 assertion results |
| `suite-m{1,2,3,4,5,6,8}.json`, `suite-m5-rerun.json`, `suite-status.json` | my phase-1 suite receipts |
| `results-m1m2.json`, `results-m3m4.json`, `results-m5.json`, `results-m5b.json`, `results-m5c.json`, `results-m6.json`, `results-m8a.json`, `results-m8b.json`, `results-web.json`, `results-web2.json`, `results-trust.json` | per-phase independent-execution results |
| `m4-edit-window-probe.json`, `m5-expiry-probe.json`, `m5-purge-probe.json`, `m6-push-probe.json`, `m6-a12-probe.json`, `m8-insights-probe.json`, `m8-digest-probe.json`, `m8-web-insights.json`, `web2-probe.json` | focused probe evidence |
| `g-*.mjs`, `build-report.mjs`, `validate-receipts.mjs`, `validate-report.mjs` | the scripts I wrote, for re-execution |
| `backend.log`, `web.log`, `push-worker.log`, `m8-grader-backend.log`, `m8-grader-push.jsonl` | logs of processes I started |
| `cleanup.txt`, `pids.txt` | PID and teardown record |
