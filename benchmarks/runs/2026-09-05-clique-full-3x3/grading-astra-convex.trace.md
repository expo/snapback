# Grader evidence and action trace — lane `astra-convex` (backend `convex-1.45.0`)

Sanitized published artifact. Credentials, tokens, admin keys and incidental
personal data are redacted or read at runtime from the fixture pack; the raw
grading session is retained privately for audit only.

- **Wave:** `astra`. **Run scope:** `full` (M1–M8 + scale replay).
- **Grader:** family `claude`, model `claude-opus-5`. Fresh session, no builder context.
- **Grade label:** `uncalibrated-grader` (see *Deviations*).
- **Report:** `grading/grader-report.json` (schema-valid against
  `grader-report.schema.json`, sha256 `82d2133…bfac0c30`).
- **Assertion manifest:** `assertions.json` v`0.3.0-m8`, sha256
  `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
- **Session outcome:** `completed`. Grader re-runs used: 0. Contaminated: no.

## Contamination control

Not read: `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`, `run-log.md`,
`scale-instance/run-log.md`, and every other lane under `lanes/`. `README.md`
and `API.md` were read as the documented run instructions (named as inputs by
the wrapper); both mention `run-log.md`, which was not opened.

## Environment and process custody

macOS arm64, Node 24.18.0 (`/Users/…/volta/…/24.18.0/bin/node`). All ports
inside the assigned 49200–49219 range. Machine shared with other sessions —
load average at session start was `8.94 / 34.70 / 76.68`.

| Process | Port(s) | PID(s) |
|---|---|---|
| lane dev backend (`convex dev`, anonymous local) | 49201 / 49202 | 84808 → child 84870 |
| lane web client (`npx expo start --web`) | 49200 | 88481 → child 88510 |
| scale replay instance backend | 49211 / 49212 | 64568 → child 64710 |
| lane dev backend after the m8-a11 restart | 49201 / 49202 | 89979 → child 90102 |

Recorded in `grading/evidence/pids.txt`. Only these PIDs were signalled; no
`pkill`/`killall` by name, no process outside this table touched.

Backend environment as found: `CLIQUE_WINDOWS=shortened`,
`CLIQUE_DIGEST=shortened`, `CLIQUE_REPLAY=0` — the grading configuration the
brief requires, already set. `config/windows.*.json` and `config/digest.*.json`
are byte-identical to the fixture pack (`diff -r` clean).

<a name="harness-integrity"></a>
## Harness integrity

`diff -rq` of the lane's `choreography/` against the frozen instrument copy
(excluding `node_modules`) shows exactly one difference, the disclosed one:
`setup-identity.mjs:5` imports a lane-local `json-schema-portability.mjs`
(AJV-2020 `validateJsonSchema` over the unchanged frozen schema) because the
snapshot omits `../../lib/json-schema.mjs`. `choreography.mjs` — all the check
logic — is unmodified, so the receipts carry frozen semantics.

`artifacts/choreo-adapter.json` uses only first-class adapter knobs:
`fixtures.groupTitle` = "Choreography Trio" instead of the default
"Weekend Plans", and `disappearing.waitMs` = 185000 instead of 300000. Both are
justified: `starter-m3.log` puts **Erin** in "Weekend Plans", and the harness
drives browsers only for alice/bob/carol/dave, so the group aggregate-read check
(`group-receipt-waits-for-slowest-member`) could never reach `read` on the
default group; and the shortened config's `24h` option has a 180 s ttl, which
185 s covers and the 300 s default overshoots. The substitution preserves the
assertion's force — the check still requires the aggregate to hold at
`delivered` until the last member with a client opens the conversation.

<a name="p1-suite"></a>
## Phase 1 — builder acceptance suite, grader re-run

`npm run acceptance -- --milestone mN` for `m1 m2 m3 m4 m5 m6 m8`, against the
running backend, from the lane as shipped. Full console at
`grading/evidence/acceptance-all.log`; the grader's copies of the produced
receipts at `grading/evidence/grader-run-*.json`.

| Milestone | Suite verdict in the grader re-run | Notes |
|---|---|---|
| m1 | **pass** (6/6 tests) | |
| m2 | **fail** (9/10) | `scroll-pagination-both-tabs`; reported m2-a22/23/24 missing |
| m3 | **pass** (5/5) | |
| m4 | **pass** (3/3) | |
| m5 | **pass** (4/4) | |
| m6 | **pass** (3/3) | |
| m8 | **fail** (1/3 → aborted) | `utc-seven-days-including-zero-render`; reported m8-a03..a07 missing |

Both failures were run to ground and are **test brittleness, not product
defects** — every underlying behaviour verified pass independently (see
[m2 pagination](#m2-pagination) and [M8 insights](#m8-insights)). Filed as
defects **d-04** and **d-03** respectively. The builder's own recorded runs of
these same suites passed (`artifacts/acceptance-m2-final2-console.log`,
`artifacts/acceptance-m8-final2.log`), consistent with brittleness rather than
regression.

<a name="coverage"></a>
## Phase 2 — coverage-manifest spot-verification → **honest**

The manifest maps **every** suite-required assertion of every attempted
milestone with no gaps: M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5,
M8 6/6. Nineteen mappings were sampled, read against the mapped test source,
and where useful re-executed:

`m1-a03 m1-a04 m1-a11 m2-a13 m2-a22 m2-a24 m2-a27 m3-a05 m3-a11 m3-a15 m4-a07 m4-a09 m5-a05 m5-a11 m6-a09 m6-a11 m6-a13 m8-a01 m8-a07`

Every sampled mapping exercises its assertion's observable. Several are stronger
than the bar: `m1-a11` asserts `img.complete && naturalWidth > 0` rather than
mere presence; `m6-a13` re-derives every entity from the action log and checks
eight field classes; `m8-a01` derives the six expected totals from a *different*
query path than `metrics:insights` and then reads them off the rendered screen;
`m3-a15` replays all three installed seed segments twice and diffs history ids
and chat count. `m6-a11`'s mapping asserts `operations.length === 5` from the
demo's own stdout, which looks self-reported, but reading
`scripts/custom-client-demo.mjs` confirms it really performs authenticate →
`chat:list` → `chat:history` with and without `before` → `chat:send` → a polling
receive loop.

Three mappings are **weak but not dishonest**, recorded rather than penalised:

- `m2-a24` — no-duplicates/no-gaps is checked over a single `social:list`
  call plus a rendered-count comparison, not across the paginated pages the
  client actually uses. Verified independently instead.
- `m3-a11` — the jump is asserted only as `isVisible()`, which does not
  establish scrolling. Measured independently instead.
- `m4-a07` — clears with `emoji:'none'` rather than re-tapping the same emoji,
  though `components/Chat.tsx` maps that gesture to the same call.

No mapping was found that claims an assertion the mapped test does not touch.
No milestone adjudicates to `capability-failure`.

<a name="choreo-receipts"></a>
## Phase 3a — `[choreo]` assertions, from harness receipts

Scored from `artifacts/choreo-m{1,2,3,4,5,6,8}.jsonl` and
`artifacts/choreography-results.json` — never re-driven by the grader, per the
frozen prompt. Every web segment is `passed` / `green`, `browserPass: true`.
Best-of-3 metrics as recorded (ms):

| Assertion | Check | Attempts | Best | Bound |
|---|---|---|---|---|
| m1-a09 | profile-edit-live-visibility | 71.8 / 75.2 / 68.7 | 68.7 | — |
| m2-a04 | feed-text-post-live-update | 60.3 / 55.0 / 59.9 | 55.0 | — |
| m2-a07 | follow-unfollow-live-projection | 244.3 / 237.0 / 230.5 | 230.5 | — |
| m2-a14 | like-unlike-live-count | 56.3 / 55.3 / 54.4 | 54.4 | — |
| m2-a19 | reply-live-thread-projection | 54.2 / 54.3 / 54.9 | 54.2 | — |
| m3-a01 | dm-live-messages | 55.6 / 62.9 / 69.7 | 55.6 | — |
| m3-a06 | typing visible after last keystroke (boundary v2) | 5.8 / 6.3 / 6.3 | 5.8 | 2000 |
| m3-a07 | typing expiry after last keystroke | 4807.5 / 4809.0 / 4813.3 | 4807.5 | 5000 |
| m4-a02 | photo-message-live-render | 119.1 / 83.9 / 96.2 | 83.9 | — |
| m4-a05 | reaction-live-replace-remove | 95.8 / 97.2 / 93.3 | 93.3 | — |
| m4-a08 | edit-live-visibility | 71.8 / 56.8 / 57.3 | 56.8 | — |

`m3-a08` (receipt sent→delivered→read) is tagged timing-sensitive but the
harness runs it `bestOf: 1` (490.3 ms, passed), so no three-measurement record
exists. `m2-a04`'s image and video checks each passed on attempts 1 and 3
(visibleMs 62.9/71.0 and 60.2/71.1) with a 10 s locator timeout on attempt 2 —
best-of-3 covers it.

<a name="m3-a02"></a>
### m3-a02 — **fail**: DM messages render no sender avatar

The one substantive web checklist miss. The harness records
`sender-avatar-identity-when-rendered` as `status: skipped`,
`implemented: false`, `required: false`, with the reason "The kit does not render
sender avatars in the default 1:1 layout; identity is checked only when the app
opts into that node." The harness treats it as non-blocking; the brief does not —
M3 acceptance item 1 reads "Alice DMs Bob; Bob replies; both see messages live
**with sender avatars**."

Confirmed three ways:

- `vendor/ui/src/MessageBubble.tsx:152` renders the `sm-convo-sender-avatar`
  node only when `!isMine && showSender`.
- `components/Chat.tsx` passes `showSender={chat.kind === 'group'}`.
- Grader web automation: the alice↔bob DM view renders **100 bubbles / 0
  sender-avatar nodes**; the "Weekend Plans" group view renders **9 bubbles / 6
  sender-avatar nodes** (own messages correctly get none). Screenshot
  `grading/evidence/m3-a02-dm-no-sender-avatar.png`.

The capability exists and is wired for groups; DMs simply do not opt in.
Corroborating: the feed surface renders 20/20 `sm-feed-author-avatar` nodes, so
m2-a05 is unaffected.

<a name="m1-a12"></a><a name="m1-a13"></a>
## Phase 3b — `[grader]` assertions

### m1-a12 / m1-a13 — password storage → **pass**

`convex/auth.ts` uses `@convex-dev/auth`'s `Password()` provider with no `crypto`
override.
`node_modules/@convex-dev/auth/dist/providers/Password.js` → `Scrypt` from
`lucia`; `node_modules/lucia/dist/crypto.js` → `scrypt(N=16384, r=16, p=1,
dkLen=64)` with a fresh 16-byte random salt and constant-time comparison. That
is the documented managed-provider path with a named adaptive KDF at standard
published parameters; provider internals were not audited beyond confirming the
path.

No plaintext or reversible storage: `authAccounts.secret` is `salt:hash` hex
(32 + 128 hex chars, sampled via `convex data authAccounts`); no fixture
password byte-string appears in the backend SQLite file, the lane source, the
client bundle sources, or `artifacts/*.log`. The fixture pack's credential files
live outside the app and are the declared exception.

<a name="m1-a07"></a>
### m1-a07 — post-logout token revocation → **pass**

`grading/evidence/m1-a07.log`. A fixture account's live access token was
captured, `auth:signOut` called, then the same token replayed:

| After logout | Result |
|---|---|
| `chat:list`, `profiles:get`, `social:list`, `metrics:insights`, `push:logs`, `profiles:save`, `social:create` | **denied** (throw) |
| `profiles:me` | returns `null` — by design; it catches and reports "not signed in", leaking no data |
| `auth:signIn({refreshToken})` with the pre-logout refresh token | **denied** (no tokens issued) |

`convex/profiles.ts:user()` looks the live session record up by
`getAuthSessionId` and throws when it is absent or expired, so revocation is
server-side rather than token-expiry-based.

<a name="m4-a10"></a>
### m4-a10 — post-window edit → **pass**

`grading/evidence/m4-a10.log`. Under `CLIQUE_WINDOWS=shortened`
(`editWindowSeconds: 60`): an in-window edit was accepted and set `edited: true`;
at message age **66.0 s** `mediaMessages:edit` threw `Edit window expired` and
the stored text was unchanged. The check is
`Date.now() > m._creationTime + windows().editWindowSeconds*1000` — server time
against the server-assigned creation time, with no caller-supplied timestamp in
the argument validator.

<a name="m4-a12"></a>
### m4-a12 — asset after delete-for-everyone → **pass**

`grading/evidence/m4-m5-api-phaseA.json`. The image message's `mediaUri`
returned **200 / 2087 bytes** before `mediaMessages:remove` and **404** after.
The recipient sees `deleted: true` and `mediaUri: null`. `ctx.storage.delete` is
called on the blob, so this is real deletion, not just a hidden reference.

<a name="m5-disappearing"></a>
### m5-a01 / m5-a02 / m5-a03 — disappearing messages → **pass**

`grading/evidence/m5-disappearing-console.log`, `m5-disappearing.json`,
`m5-a03.log`, `m5-a03.json`. The alice↔bob DM was set to `disappearing: '24h'`
(shortened ttl 180 s) and restored to `off` afterwards.

**m5-a01** — a message was synced by a recipient client, both clients were then
closed, and the ttl allowed to elapse with no client connected. After expiry:

| Server probe | Result |
|---|---|
| sender's `chat:history` | message absent |
| recipient's `chat:history` | message absent |
| `chat:messageByKey` | `null` |
| `ephemeral:search` for the marker token | 0 hits |
| `mediaMessages:react` on it | refused |
| `mediaMessages:edit` on it | refused |

**m5-a02** — *disconnected*: the client was relaunched from the same persistent
browser profile after expiry; the session persisted, **0** expired bubbles
rendered, and the expired text was gone from the `clique-message-cache` in
`localStorage` (it was verifiably present before expiry, 41,921 cache bytes).
*Connected*: a second run kept the conversation open through expiry — the bubble
disappeared **505 ms** after `expiresAt` (host load average 19–30 at
measurement). `components/cachePolicy.ts` applies read-time expiry filtering on
both the live and cached paths, and the conversation re-renders on a 250 ms tick.

**m5-a03** — offline search after the client synced the expiry: **0** hits for
the expired token, with two controls to prove the probe was live — the same
offline search *before* expiry returned 1 hit, and an offline control search for
`coffee` returned 1 hit afterwards. The offline banner (`sm-search-offline`) was
present in both offline searches.

<a name="m5-a06"></a>
### m5-a06 — direct asset fetch after a view-once view → **pass**

`grading/evidence/m5-a06-followup.log`. Convex issues media URLs as
`/api/storage/<uuid>` where the uuid is **not** the storage document id, so
guessing a URL from a known storage id is not possible (an attempted
substitution returns 400 and proves nothing — recorded so the negative is not
over-read).

The real finding is structural: `convex/chat.ts:history` returns
`media: m.viewOnce ? undefined : m.media` and
`mediaUri: m.media && !m.deleted && !m.viewOnce ? getUrl(...) : null`, so **no
asset URL is ever issued for view-once media** and the storage reference is
omitted from the recipient's payload. Observed on 8/8 view-once messages in the
DM: `media` omitted, `mediaUri` null. `ephemeral:open` returns bytes only. The
viewer's second open is denied (`Already opened`) and a non-member's open is
denied. There is nothing to re-fetch.

One adjacent observation, filed as cosmetic **d-06**: for *ordinary* media the
issued URL is an unauthenticated bearer URL (an unauthenticated fetch returns
200), so a URL captured while authorised keeps working afterwards. That is the
Convex storage model, and the two revocation paths the brief tests are
unaffected.

<a name="m6-a12"></a>
### m6-a12 — grader-written variation from `API.md` alone → **pass**

`grading/evidence/m6-a12.log`. Written from `API.md` only, no lane source
consulted. First attempt, no corrections: sign in with the password flow →
`chat:list` → find the conversation named "Weekend Plans" → `chat:history`
`{chatId, limit: 20}` → `history.at(-1)`. The documented invariants all held:
pages return chronologically oldest-first, and paging with
`before: history[0]._creationTime` returned an older page whose timestamps are
all strictly less. The message shape matched the documented field list.
Documentation quality here is good — the snippet in `API.md` is directly
runnable.

<a name="m8-digest"></a>
### m8-a08 … m8-a12 — scheduled digest → **all pass**

`grading/evidence/m8-digest.{log,json}`, `m8-a11.{log,json}`. Four fresh grader
personas (target / actor / silent / outsider), all clients closed, under
`CLIQUE_DIGEST=shortened` (120 s period, 00:00:00 UTC anchor, 30 s cron).
Activity was confined to one period: 1 new follower on the target; 2 top-level
posts plus 1 reply by a followed account; 4 messages to the target across 2
chats; and **5 messages in a group the target is not a member of**.

| Assertion | Expected | Observed |
|---|---|---|
| m8-a08 | exactly 1 digest; `newFollowers` 1, `newPostsInFollowing` 2, `unreadMessages` 4, `unreadChats` 2 | exactly 1; **1 / 2 / 4 / 2** — all four matched |
| m8-a09 | the silent persona gets no digest | 0 digests in any period |
| m8-a10 | the following period, with no activity, emits nothing | 0 digests for that period |
| m8-a11 | a mid-period backend restart does not double-emit | backend killed and relaunched with 105 s left in the period → exactly 1 digest for that period; no user had >1 digest for any period |
| m8-a12 | out-of-chat traffic never contributes | the 5 excluded-chat messages left `unreadMessages` at 4 and `unreadChats` at 2 |

The reply correctly did not count as a post. `convex/digest.ts:emit` inserts the
`digestPeriods` guard row before the zero-activity suppression return, so
suppression and the exactly-once guard commit atomically — which is what makes
m8-a09/a10/a11 hold. Digest payloads were read only through the target's own
authenticated `push:logs`.

### m7-a08 — snapshot comparison → **not-run**

M7 was never attempted, so there is no post-migration state to compare against a
pre-M7 snapshot.

<a name="m2-pagination"></a>
## Phase 3c — independent re-execution of the two failing suite tests

### m2-a22 / m2-a23 / m2-a24 — feed pagination → **pass**

`grading/evidence/m2-pagination.{log,json}`.

*API page walk* through `social:page` — the query the client actually uses:

| Tab | Page sizes | Total | Duplicate `entryId`s | Missing vs `social:list limit 200` | Order identical |
|---|---|---|---|---|---|
| following | 20, 20, 20, 20, 20, 3 | 103 | 0 | 0 | yes |
| global | 20 × 6, 2 | 122 | 0 | 0 | yes |

*Browser*: both tabs render 20 items initially and grow to the full server set on
scroll — Global 20 → 40 → 60 → 100 → 122, Following 20 → 40 → … → 103, with 0
duplicate rendered blocks.

Why the suite failed: the suite drives scrolling with five `page.mouse.wheel`
events separated by 250 ms waits. Under this host's load those events did not
move the React Native Web `ScrollView` on the Following tab — 31 wheel-driven
iterations produced no growth in the same session in which setting the scroll
container's `scrollTop` directly paginated immediately, and in which the Global
tab did grow. A driving artifact, filed as **d-04**.

<a name="m8-insights"></a>
### m8-a03 … m8-a07 — Insights buckets and Trending → **pass**

`grading/evidence/m8-insights.{log,json}`, `m8-trending-tab.png`.

**m8-a03 / m8-a04** — verified on a *fresh* account with no prior activity, so
the check is clean: `metrics:insights` returned exactly **7** day buckets whose
`dayLabel`s are the correct UTC dates for the trailing week, all zero before any
post; creating one post incremented **only** `days[6]`, whose label equals the
server's UTC today. The rendered screen shows **7** `sm-insights-day-row` rows
including six explicit zeros (`2026-09-01 … 2026-09-06` at `Posts 0 / Likes
received 0`, then `2026-09-07` at `Posts 4 / Likes received 18`). The six
summary totals rendered and matched.

Why the suite failed: it asserts
`after.days.slice(0,6).every(d => d.posts === 0 && d.likesReceived === 0)` —
that the six days before today carry no activity at all. The fixture activity
was created on 2026-09-05 and the grader ran on 2026-09-06, so yesterday is
non-zero and the assertion throws, aborting the rest of the M8 suite and
dropping m8-a05/a06/a07 from the coverage file. Filed as **d-03**.

**m8-a05 / m8-a06 / m8-a07** — constructed with fresh accounts as likers:
a post with 8 likes ranked first (m8-a05); two posts tied at 5 likes ranked with
the newer first (m8-a07); and a **31 h old** post given 10 likes — the highest
like count in the corpus — was absent from Trending, with every returned post
under 24 h old (m8-a06). The Trending tab renders correctly in the UI: 10 posts
in the same order (`sm-feed-item`, not the kit's unused `sm-trending-row`).

<a name="ui-spotchecks"></a>
## Phase 3d — UI spot-checks on weak suite mappings

`grading/evidence/ui-spotchecks.{log,json}`, `ui-search.png`.

- **m3-a10** — the reply bubble's own text contains the quoted original.
- **m3-a11** — with 25 padding messages between them, tapping
  `sm-convo-quote-preview` moved the scroll container from `scrollTop` **11647 →
  9352** and brought the original bubble from `y = -1920` (off-screen above) into
  the viewport at `y = 375`. The jump is real, not incidental visibility.
- **m5-a11** — global search for `coffee` renders
  `sm-search-group` headers `["DIRECT CONVERSATION", "WEEKEND PLANS"]` over 3
  results, so grouping by chat exists in the UI and not only in the payload.
- **m5-a09** — people search for `car` returns `Carol Chen @carol`.

<a name="defects"></a>
## Defect hunting beyond the checklist

`grading/evidence/trust-probes.{log,json}`. **No defect found at ordinary
scale.** All 18 authorization probes were correctly denied:

- Cross-user, non-member: read DM history, read DM metadata, `ack`, `send`,
  `react`, `edit`, `remove`, read message by key — all denied.
- Member-but-not-sender: `edit` and `remove` on another member's message —
  denied.
- Unauthenticated: `chat:list`, `social:list`, `profiles:get`, `push:logs`,
  `metrics:insights`, `profiles:upload`, `ephemeral:search`, `social:trending` —
  all denied.

Other behavioural probes:

- **Removed-member cutoff** — saw the pre-removal message; does **not** see the
  post-removal message; still reads pre-removal history; cannot send; group-scope
  search returns empty. Exactly the specified semantics (m3-a12/a13).
- **Identity substitution** — a non-member's send into a DM is denied, and one
  user cannot take over another user's message idempotency key.
- **Idempotent set-state** — like count 8 → 9 on set, **still 9** after three
  retries of the same `mutationId`, back to 8 on clear. Retries do not toggle.
- **Spec bounds** — a 2001-char message, a 501-char post, a 51-char group name,
  a self-DM, a self-follow, a malformed 5-image post and a 7-char signup password
  were all rejected; a message of exactly 2000 chars was accepted.

One source-level correctness wrinkle, filed as **d-05**: the profile-feed branch
of `convex/social.ts:list` calls `.take(limit)` *before* filtering out replies
and accepts no `before` cursor, so a profile with recent replies silently returns
fewer than `limit` top-level posts with no way to page further.

<a name="o4-native"></a>
## O4 — offline behaviour, from choreography artifacts

**Demonstrated on web**, mechanically, in the harness receipts:

- `choreo-m6.jsonl` `offline-message-queue-flush-in-order` — two messages
  composed offline each expose a `pending` receipt; on reconnect they flush and
  render on the recipient **in send order**; both then walk to `read`
  (`flushMs` 105.8).
- `choreo-m8.jsonl` `m8-a15-dual-offline-convergence` — two of the same
  account's clients each compose one message while warm-offline; on reconnect
  both settle in server-arrival order, **exactly once**, verified on all three
  clients (`firstFlushMs` 190.7, `secondFlushMs` 227.4). `m8-a16` — both flushed
  messages reach `read`.
- `choreo-m5.jsonl` — warm-offline search over synced messages, and
  disappearing-expiry purge surviving a client relaunch.
- Independently reproduced by the grader: warm-offline search returned cached
  results (`m5-a03` control).

**Not demonstrated on any carrier:**

- Cold-start offline — m6-a01…a04 (synced chats and history, previously viewed
  media, offline search, and the view-once *non*-render).
  `artifacts/simulator-m6.json` records `pass: null`: "Release simulator build
  and launch succeeded. Required signed-in cold-offline/media/queue interaction
  proof was not completed; screenshot is launch evidence only."
- Durable offline queue across app restart — m8-a17/a18.
  `artifacts/simulator-m8.json` records `pass: null`: "…no signed-in offline
  kill/relaunch/flush receipt sequence was captured. Launch screenshot is not a
  qualifying durable-queue native proof."

The grader confirmed no web substitute exists
(`grading/evidence/web-coldstart-offline.log`): after a warm session synced text,
photo and a consumed view-once image into a persistent profile, a cold browser
start with connectivity cut failed at navigation with
`ERR_INTERNET_DISCONNECTED`. That is expected for a non-PWA web carrier and is
precisely why the brief specifies the simulator for these assertions — it is not
an app defect, it is a missing native proof.

**Honesty of the gap** — the dimension's second clause — is exemplary. The
simulator artifacts self-report `pass: null` with explicit reasons, `README.md`
states "Native simulator launch artifacts are not qualifying offline-flow
proofs", and `run-record.json` records "No held-out grading or complete O5
claim." Nothing in the lane claims a native offline result it did not obtain.

<a name="o5-grader-probes"></a>
## O5 — scale replay, grader verification

Replay instance started by the grader on 49211/49212 against the lane's own
`scale-instance/` database. Host load average during probing: 19.31 / 23.59 /
32.85 (`grading/evidence/uptime-o5.txt`).

### Band-0 gate: invariant-manifest conformance → **conforms**

`grading/evidence/o5-grader-probes.{log,json}`. Verified live against the running
instance, not by trusting the lane's receipt:

| Named O5 fixture | Expected | Observed |
|---|---|---|
| `u0500` following / conversations | 500 / 100 | **500 / 100** |
| `u0005` following | 5 | **5** |
| `u0900` followers / posts | 900 / 200 | **900 / 200** |
| `u0901` following | 5 | **5** |
| `g0001` members | 50 | **50** |
| `g0001` messages (counted by full paging) | 10000 | **10000** (7.2 s) |

All 18 `perEntityCounts` fields of `invariant-manifest-combined.json` match the
lane's independent export (`verification-final.json`, `errors: []`). The
replayed `scale.log` digest
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9` matches the
frozen `scale-log.sha256`. `summary.json`: 167,157 actions settled across all 13
verb classes, `pass: true`, `verificationPass: true`, 884 s execution. No wall
cap was exhausted — the instrument's cap table is still a P3 placeholder.

### Grader-measured degradation rules (k=20 after 3 warm-ups, sequential, 30 s timeout)

| Probe | p95 (ms) |
|---|---|
| following-u0500 | 2.52 |
| following-u0005 | 1.79 |
| following-u0901 | 2.01 |
| history-page1 (g0001) | 2.15 |
| history-page50 (g0001) | 2.25 |
| global-message-search | 1.89 |
| conversation-initial-sync (100 conversations) | 2.83 |
| insights-u0500 | 2.17 |
| **trending** | **errored** |

| Rule | Ratio | Verdict |
|---|---|---|
| following 500-vs-5 ≤ 3× | 1.40 | pass |
| deep page 50-vs-1 ≤ 3× | 1.04 | pass |
| celebrity read path (u0901 vs u0005) ≤ 3× | 1.12 | pass |
| cold-start sync completes without timeout | 2.83 ms | pass |
| **no probe times out / errors / OOMs** | — | **FAIL** |

### The Trending probe error — reproducible, deterministic

`grading/evidence/o5-followup.{log,json}`. `social:trending` failed **5 out of 5**
consecutive attempts, each at ~15.0 s, with "Your request timed out performing
too many system operations."

Root cause: `convex/social.ts:trending` does
`query('posts').withIndex('likes').order('desc').filter(parent === undefined && _creationTime > now - 24h).take(10)`.
The window predicate is a post-filter, so when **no** post falls inside the
trailing 24 h, `take(10)` never short-circuits and the scan walks all 50,228
posts. The newest post in the scale corpus is **31.4 h** old. The same query
returns 10 correctly ranked posts on the dev instance, where recent posts exist.

The lane's own recorded probe (`artifacts/m8-probes-full.json`, p95 1.79 ms) was
taken while the replayed corpus was still inside its own 24 h window, which
masked this entirely. Filed as **d-01**.

### The Following-feed cold path — a second, independent finding

Same measurement file. Cold `social:list({tab:'following'})` at the envelope:

| User | limit 20 | limit 50 | limit 100 |
|---|---|---|---|
| `u0005` (5 follows) | **10.5 s** | **error** | **error** |
| `u0901` (celebrity-follower) | **7.3 s** | **14.5 s** | **error** |
| `u0500` (500 follows) | 321 ms | 295 ms | 580 ms |

The app's own paging query is the same shape: six `social:page` pages took
**44.0 s** for `u0005` and **26.2 s** for `u0901`. Warm repeats of the identical
query return in 1–5 ms from the Convex query cache — which is exactly why every
`k=20`-after-3-warm-ups p95 above reads ~1.8–2.5 ms. The prescribed protocol *is*
warm measurement, so the ratios stand, but the cold reality is a Following feed
that takes tens of seconds per screen at the envelope for accounts with small
follow sets. Note the cost tracks follow-set **sparsity**, not celebrity-ness:
`u0005`, which does not follow the celebrity at all, is the worst case. Filed as
**d-02**.

### Recorded curve rules (checkpoints not re-derivable by the grader)

The 10% / 50% / final curve rules need the checkpoint states, which exist only as
snapshot zips; the grader did not restore them. From
`artifacts/scale-safety-probes.json`, whose `midBelowLine` predicate
(`values[1] <= values[0] + (values[2]-values[0])*4/9`) is a faithful
implementation of the frozen mid-curve rule:

| Curve | 10% | 50% | full | ≤3× | mid ≤ line |
|---|---|---|---|---|---|
| global search | 1.7082 | 1.6982 | 1.8701 | pass | pass |
| insights | 2.0255 | 2.0142 | 2.0135 | pass | pass |
| **trending** | 1.7850 | **1.9088** | 1.7908 | pass | **fail** (line 1.7876) |

The Trending mid-curve failure is a **0.12 ms** margin at ~1.8 ms — inside
measurement noise, and it is recorded rather than leaned on. The band rests on
the reproducible probe error above. The lane discloses its own limitations here,
including that these M8 checkpoint reads were taken on restored snapshots after
replay rather than inside the original replay clock.

### Band

First-match over the frozen order **0, 30, 60, 90, 75**:

- **0** — does not fire: manifest conforms, named fixtures exact, no cap
  exhausted.
- **30** — **fires**, on both clauses: a probe errors at the envelope (Trending,
  5/5), and a degradation rule fails (Trending mid-curve).
- **60 / 90** — unreachable regardless: the instrument's absolute p95 ceilings
  and replay wall cap were never calibrated out of their P3 placeholders, so no
  ceiling utilisation exists to compare and the 90 branch's "≤50% of ceiling"
  condition cannot be established.

**O5 = band 30.**

## Assertion tally

119 in-scope atomic assertions: **100 pass, 10 fail, 9 not-run.**

| Milestone | Pass | Total | Not passing |
|---|---|---|---|
| M1 | 13 | 13 | — |
| M2 | 27 | 27 | — |
| M3 | 14 | 15 | m3-a02 (fail) |
| M4 | 12 | 12 | — |
| M5 | 12 | 12 | — |
| M6 | 6 | 13 | m6-a01…a07 (fail — native proof absent) |
| M7 | 0 | 9 | all (not-run — milestone never attempted) |
| M8 | 16 | 18 | m8-a17, m8-a18 (fail — native proof absent) |

Nine of the ten fails are *undemonstrated* rather than observed-broken; only
m3-a02 is an observed product miss. M7's status is the lane's own recorded
decision (`artifacts/milestones.json` `status: "not-run"`, reason "Separate fresh
session explicitly excluded").

## O-dimension scores

| Dim | Score | One-line basis |
|---|---|---|
| O1 | **74** | 100/119; M1–M5 and M8 solid, M6 web-green; M7 never attempted and no platform-proof artifacts — the two things the 90 anchor names |
| O2 | **48** | two major scale-envelope defects in core read paths (d-01, d-02); zero correctness defects at ordinary scale across a wide probe surface |
| O3 | **null** | applicable, but its frozen rule scores it from the wave's committed holdout probes only, and none were committed — see Deviations |
| O4 | **55** | web offline writes/receipts/search/multi-device all behave as specced; cold-start offline and durable-queue restart unproven on any carrier; the gap is disclosed honestly |
| O5 | **band 30** | manifest conforms and named fixtures are exact, but a probe errors at the envelope and a degradation rule fails |

Full anchor citations and justifications are in `grading/grader-report.json`.
No weighted total, efficiency statistic or cross-lane comparison is computed
here — those are the harness's and publisher's jobs.

## Deviations from the frozen protocol

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped, `wave.probeSetSha256` is the literal `none-uncommitted`, and
   `probeResults` is empty. **No probes were invented.** Consequence: **O3 is
   recorded null.** The dimension is applicable under `applicability.json`
   (M6 green plus M1–M5 attempted), but its frozen rule scores it "from the
   wave's secret rotated holdout probes only" — with zero probes there is no
   admissible basis, and substituting grader-chosen queries would not be the
   scored instrument. The trust-boundary work above is real and is scored where
   it belongs, in the defect list and O2. Per `applicability.json`'s
   `nullDimensionRule` a null dimension blocks a weighted total; computing
   totals is not the grader's job.
2. **Calibration gate not passed.** The `claude` family has not passed
   `calibration.md`, so `calibrationPassed: false` and
   `sameFamilyGraded: false`. The lane was graded anyway per instruction and the
   grade carries the `uncalibrated-grader` label. N=1 calibration run, not a
   claim-eligible wave.
3. **Timing under shared load.** Timing-sensitive checks were judged best-of-3.
   The `[choreo]` best-of-3 records are read from the harness receipt JSONL — the
   source the frozen prompt specifies for `[choreo]` assertions — and were not
   re-driven. Host load is recorded beside each grader-executed timing
   measurement and in `grading/evidence/uptime-*.txt`.
4. **Grader-initiated, disclosed: the report schema cannot key M8.**
   `assertionResults` is `additionalProperties: false` with
   `patternProperties: ^m[1-7]-a[0-9]{2}$`, so the 18 M8 assertions added by
   LLP 0201's 2026-08-11 amendment cannot be keyed without making the report
   schema-invalid. They are enumerated in the report's `notes` with their
   verdicts and evidence, and are counted in O1 exactly as if keyed. This looks
   like an instrument gap worth fixing at the next schema revision.

## Side effects of grading, disclosed

Running the documented acceptance entrypoint — required by execution-order
phase 1 — rewrites `artifacts/suite-*.json`, `artifacts/coverage-*.json`,
`artifacts/suite-status.json` and `artifacts/replay-sample/*`. The grader's
copies are kept at `grading/evidence/grader-run-*.json`.
`artifacts/suite-status.json`, `suite-m2.json`, `suite-m8.json`,
`coverage-m2.json` and `coverage-m8.json` were **restored** to the builder's
recorded values afterwards, reconstructed from the lane's own
`artifacts/acceptance-m2-final2-console.log`,
`artifacts/acceptance-m8-final2.log` and the untouched
`artifacts/coverage-manifest.json`; the original suite receipt timestamps are not
recoverable and are recorded as `null` with a `restoredBy` note.
`suite-m1/m3/m4/m5/m6.json` still carry the grader run, which reported the same
`pass: true` outcome.

Grading also added rows to the dev database (grader personas, probe posts and
messages, digest period records) and performed one grader-initiated backend
restart on the dev instance as part of m8-a11. Transient browser profile
directories created under `grading/evidence/` held session tokens and were
deleted; no credential material remains under `grading/`.

## Artifact index

Grader scripts: `grading/tools/`. Evidence: `grading/evidence/` — suite console
(`acceptance-all.log`), per-assertion logs and JSON, O5 probe measurements
(`o5-grader-probes.json`, `o5-followup.json`), screenshots
(`m3-a02-dm-no-sender-avatar.png`, `m8-trending-tab.png`, `ui-search.png`),
backend and web dev logs, host-load captures, and `pids.txt`.
