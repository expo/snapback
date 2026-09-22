# Grader evidence and action trace — lane `astra-snapback4`

Sanitized, publishable record of one independent grading session against the
frozen `social-messenger` instrument. Credentials, bearer tokens and service
tokens are redacted as `[REDACTED]`; generated persona e-mails created by the
grader are shown as `[grader-account]`. The raw session is retained privately
for audit only (LLP 0198).

- Grader family / model: `claude` / `claude-opus-5`. Calibration gate: **not
  passed** — this grade is labelled `uncalibrated-grader`.
- Lane backend: `snapback4-0.2.32` (public npm `snapback4@0.2.32`,
  `snapback4-expo@0.2.23`). Run scope: `full`. Wave: `full-3models-astra`.
- Assertion manifest: `instrument/schema/social-messenger/assertions.json`,
  version `0.3.0-m8`,
  sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
- Session outcome: `completed`. `rerunsUsed` 0 — no phase failed because of the
  grader's own environment or tooling.
- Contamination: none. The lane's `diary.md`, `essay.md`, `final-report.md`,
  `FINAL.md` and `run-log.md` were never opened; directory listings showed
  their names only. No other lane under `lanes/` was read.

## <a id="setup"></a>Environment and process custody

macOS arm64, 18 cores. `node -v` → `v24.18.0` from
`~/.volta/tools/image/node/24.18.0/bin/node`. Playwright 1.62.1 with a
pre-installed chromium was already present in the lane's `choreography/`
copy, so no new browser download was needed.

Ports 49360–49379 were all free at session start (`lsof -nP -iTCP:<p>
-sTCP:LISTEN` for each). Servers started by the grader, and only these were
stopped at the end:

| Purpose | Port | Spawn PID | Listener PID |
|---|---|---|---|
| lane backend (`npx snapback4 dev`) | 49360 | 62742 | 62762 |
| lane web client (`npx expo start --web`) | 49361 | 63872 | 63950 |
| grader-owned isolated digest backend | 49366 | 11899 → 94491 → 3134 | 11945 → 94491 → 3162 |

The digest backend was deliberately stopped and restarted twice as part of the
`m8-a11` probe. No `pkill`, `killall` or pattern kill was used at any point.

Machine load (1/5/15-minute averages, 18 cores) sampled beside every timing
observation: 22.42/14.41/11.75 at session start, then 13.04, 12.96, 11.31,
10.88, 8.93, 9.35 and 8.01 across the measurement phases. The host is shared
with other sessions, which is why timing-sensitive checks are judged best-of-3.

## <a id="build"></a>Configuration and build check

`config/windows.shortened.json`, `config/windows.production.json`,
`config/digest.shortened.json` and `config/digest.production.json` are
byte-identical to the fixture pack's copies. The grader ran
`node scripts/configure.mjs` with no `CLIQUE_CONFIG`, which compiles the
**shortened-windows** profile the grading protocol requires:
`snapback/config.q` → `editWindow() 60000`, `deleteWindow() 120000`,
disappearing `24h` → 180000 ms, `7d` → 300000 ms;
`snapback/digestConfig.q` → `schedule digestSchedule every 2m`.

`npx snapback4 check` compiles clean. It emits notes, not errors. One is worth
recording (**defect d-03**): `N_NEVER_COMPLETE` on `digest.preview` — the page
over `members[..] by byPrincipal` can never report `complete`, because the read
rule reads `.conversationId`, which the scan does not pin. The platform prints
the rewrite; the lane shipped without applying it. `digest.preview` is a
diagnostic query and the scheduled job calls `digestFor` directly, so nothing
observable is wrong.

Integrity of the frozen support packages, checked by recursive diff against
`instrument/` (excluding `node_modules`): `choreography/`, `metering/` and
`ui/` in the lane are **byte-identical** to the frozen copies. The
choreography adapter is input-only:
`{"schemaVersion":"social-messenger.choreography-adapter.v1","fixtures":{"directory":"instrument/fixtures"}}`.

## Phase 1 — the builder suite, re-run by the grader

`npm run acceptance -- --milestone mN` against the running backend and web
client, in the lane's documented invocation shape. Phase 1 was run against the
lane's delivered store rather than a fresh checkout, so the suite was exercised
on the artifact as delivered; `suite-status.json`, `evidence/coverage-m*.json`
and the `.seed/` ledgers were backed up first and restored afterwards.

| Milestone | Grader's suite run | Builder's recorded receipt |
|---|---|---|
| M1 | **pass** (5/5 checks) | pass |
| M2 | **pass** (7/7 checks) | pass |
| M3 | **fail** — `quoted excerpt renders and jumps to original`, missing `m3-a10`, `m3-a11` | pass |
| M4 | **pass** (3/3) | pass |
| M5 | **pass** (3/3) | pass |
| M6 | **pass** (3/3) | pass |
| M8 | **pass** (3/3) | pass |

The M3 failure was re-run once and reproduced identically
(`TimeoutError … waiting for getByTestId('sm-convo-quote-preview')`). Cause and
independent product verification are under [#m3-quote](#m3-quote); filed as
**defect d-01**.

## Phase 2 — coverage-manifest spot-verification → **honest**

`coverage-manifest.json` maps every suite-required assertion of every in-scope
milestone to a named test, with no unmapped ids: M1 7/7, M2 22/22, M3 7/7,
M4 5/5, M5 6/6, M6 5/5, M8 6/6.

21 mappings were sampled and each mapped test body was read in
`scripts/acceptance*.mjs`. Every one exercises the assertion's own observable:

- `m1-a11` waits for a rendered `<img>` with `naturalWidth > 0` inside
  `sm-profile`, not merely a successful upload call.
- `m2-a13` counts `iframe` / `preview-card` nodes on the thread screen.
- `m2-a24` compares the cross-page id **set size** to the row count and checks
  the page boundary is time-monotone.
- `m3-a15` re-runs every installed seed segment and deep-compares the inbox.
- `m4-a01` drives the real composer file chooser, then confirms the server row
  carries `photo`.
- `m5-a05` asserts the exact `E_ASSET_VIEWED` refusal code.
- `m6-a13` runs the frozen `instrument/fixtures/validate.mjs`, replays the
  50-action log, and re-checks the replayed end state field by field.
- `m8-a01` cross-checks the maintained totals against raw-row SQL and then
  against the six screen tiles.
- `m8-a06` backdates a post 25 h with `snapback4 run --now`, so the >24 h
  exclusion is genuinely exercised.

Two mappings are thin but not dishonest, and both were confirmed in a stronger
form by the grader: `m2-a27` reads the follower/following counts while implicit
self-membership is in effect but demonstrates invariance against an *explicit*
self-follow attempt (the grader re-checked on a zero-follow account), and
`m5-a11` observes one search group rather than several (the grader confirmed
two). **No mapping was found dishonest; no milestone is adjudicated to
`capability-failure`.**

## Phase 3 — independent checklist execution

All grader scripts used only the documented custom-client API
(`snapback4/auth`, `snapback4/client`) and Playwright against the web build on
`http://127.0.0.1:49361`. Grader-created accounts use generated addresses and a
grader-chosen password; all such credentials are `[REDACTED]`.

Five grader-script bugs were found and corrected during this phase, each
re-run to completion. None was a lane fault and none is an environment or
tooling failure under D3.4, so `rerunsUsed` stays 0:

1. `m2-a10`/`m2-a11`/`m2-a25` first used Dave as an "unfollowed" author, but
   `starter-m2.log` contains `bob follow dave`. Re-run with Erin and with a
   brand-new zero-follow account.
2. `m1-a07`'s pre-logout control read `me()` on an account with no profile row.
   Re-run probing `people()` after saving a profile.
3. `m5-a01`'s failure message called `JSON.stringify(undefined).slice(...)`,
   which threw on the *passing* path. Re-run with `assert.equal(x, undefined)`.
4. `m5-a10` read `chat.dm(...).id` (the `dmPairs` row id) instead of
   `.conversationId`. Re-run correctly — this also produced **defect d-04**.
5. `m5-a02`/`m5-a03` navigated to `/search` *after* going offline, which also
   blocks the Metro bundle. Re-run loading the search screen online and cutting
   connectivity before typing.

The grader's m2 checks temporarily removed the seeded `bob → alice` follow
edge; it was explicitly restored afterwards and re-verified.

### <a id="m1"></a>M1 — accounts and profiles

- `m1-a01` A 15-character password signed up successfully; a 7-character
  password was refused (`E_AUTH`).
- `m1-a02` A fresh signup in a clean browser context landed on the
  authenticated profile-setup screen; `sm-auth-submit` was detached.
- `m1-a03` Saving the handle `alice` showed `sm-profile-error` reading
  *"That handle is taken."*; the API refusal is server-side.
- `m1-a04` Signing up with the fixture Alice address showed `sm-auth-error`
  (*"that email already has an account; sign in instead"*) and the client
  stayed unauthenticated.
- `m1-a07` `[grader, full-only]` An authenticated read succeeded, then
  `logout(url, token)` was called. The **same bearer token** on a brand-new
  client returned `{"denied":{"code":"E_AUTH","family":"auth","message":"sign
  in to continue"}}`, and a raw HTTP probe with that token was refused too.
  Revocation is server-side, not local credential clearing.
- `m1-a08` Display name and bio round-tripped through `me()`; original values
  restored.
- `m1-a10` / `m1-a11` `avatar-alice.png` uploaded, `placeAvatar` accepted, the
  profile row carries the reference and `client.asset(...)` reads it back.

#### <a id="m1-hashing"></a>Password storage (m1-a12 / m1-a13)

`snapback/schema.q:1` declares `use identity password` — the platform's
built-in adaptive password auth; nothing in `src/`, `app/` or `scripts/`
hand-rolls hashing, and `src/client.ts` persists only sessions
(`expo-secure-store` on native, `localStorageSessionStore` on web).

The pinned `snapback4-darwin-arm64@0.2.32` binary embeds the Rust `argon2`
0.5.3 crate and the encoded parameter string
`$argon2id$v=19$m=19456,t=2,p=1` — argon2id at OWASP-published parameters. The
backend logs `Argon2 slots: 16 on this host` at startup. **m1-a12 passes.**

Plaintext scan for the five fixture/grader passwords: **0 hits** in
`.snapback4/store.sqlite` and its WAL, **0 hits** across `web-dist/`,
`artifacts/*-ios/` and `public/`, **0 hits** across `evidence/*.log`,
`evidence/*.json` and `evidence/*.jsonl`. Server persistence holds 14
`$argon2id$v=19$m=19456,t=2,p=1` records. **m1-a13 passes** on the three
surfaces the assertion names.

Observed while scanning, filed as **defect d-02** (cosmetic): seven lane
scripts hard-code fixture persona passwords as string literals rather than
reading the declared fixture credential file.

### <a id="m2"></a>M2 — posts and the follow graph

Text, 2-image (`img-01`, `img-02`) and video (`vid-01`) posts all created
through the client API with the media references present on the rows.
Follow → Alice's posts in Bob's Following feed; unfollow → no Alice originals
remain **including the pre-follow post**, while the same post is still in
Global. A post by an author Bob does not follow appears in Global and is absent
from Following. `like(set:false)` twice decremented exactly once (1 → 0).
Repost surfaced in a follower's Following feed attributed to the reposter with
a display name, and toggled off. `social.replies` returned exactly the two
direct replies in creation order with the nested reply excluded, and neither
reply appeared in either feed.

Pagination, both tabs: page 1 = 20 rows with a `next` cursor, page 2 non-empty,
union of ids has **no duplicates**, and `page1.last.at >= page2.first.at` so
there is no gap.

#### <a id="m2-self"></a>Implicit self-follow (m2-a25 / a26 / a27)

Verified on a brand-new account with `following = 0` and `followers = 0`: its
own original post appeared in its own Following feed, its repost of another
author's post appeared there attributed to itself, and both counts stayed 0
throughout. An explicit self-follow edge is refused (`CANNOT_FOLLOW_SELF`).

#### <a id="m2-links"></a>URL rendering (m2-a12 / a13)

The URL renders as
`<span role="link" data-testid="sm-text-link" style="color: rgb(37,99,235);
text-decoration-line: underline">` inside the post body — tappable text, not a
card — and `src/Chat.tsx` / the UI kit wire `onPressLink` to
`Linking.openURL`, which opens the system browser. Zero `iframe`,
`preview-card`, `unfurl`, `link-card` or `embed` elements on the thread screen.

#### <a id="m2-a07"></a>Live follower count (m2-a07)

The frozen choreography harness has **no follower-count check**: its m2 follow
assertion (`follow-unfollow-live-projection`,
`choreography/choreography.mjs:1331`) observes the Following-feed projection
and the Global-feed persistence, not the count. No harness receipt therefore
covers this assertion's observable, so the grader observed it directly:
Alice's own profile page stayed loaded in one browser context while a second
context followed her from her profile. `sm-profile-follower-count` moved
4 → 5 with **no reload** (the page URL was re-checked after the observation).
Three consecutive toggles measured 255 / 224 / 221 ms; best 221 ms.
Load average at measurement: 9.35/9.13/9.47.

### <a id="m3"></a>M3 — messaging core

`createDM` from either side, three times, returned the same conversation
(`d-alice-bob`), and `chat.inbox` shows exactly one Alice/Bob DM channel. A
group with Alice+Bob+Carol was created, then a **second** group with the
identical roster got a distinct id and kept its own 3-member roster. A
non-admin's `removeMember` was refused (`NOT_ADMIN`) with the roster unchanged;
`promote` and `addMember` by a non-admin were refused too. Re-running seed
segments m1, m2 **and** m3 left `chat.inbox` and the Global-feed id list
byte-identical.

#### <a id="m3-quote"></a>Quoted replies (m3-a10 / m3-a11) and defect d-01

The suite check fails from the delivered state and the **product does not**.

`scripts/acceptance-m3.mjs:95-110` opens `/conversation/bob` and waits for
`sm-convo-quote-preview` containing the m3 starter-log message
*"Coffee after work?"*. `snapback/chat.q:94` pages the thread `last 50 by
byChatTime`, so that seeded quoted reply is only on the first page while the
conversation stays short. M4, M5, M6, M8 and the digest proofs all wrote into
`d-alice-bob`, pushing it past the newest-50 window; the mapped test then times
out. Reproduced twice.

Independent verification in a grader-created conversation: the quoted reply
rendered `sm-convo-quote-preview` containing the exact original text, and
tapping the excerpt moved the original message node from **top = −2984 px**
(above a 720 px viewport) to **top = 165 px**, in view. `m3-a10` and `m3-a11`
are recorded **pass** with `suiteResult: fail`, and the reproducibility gap is
filed as **defect d-01** (minor).

### <a id="m4"></a>M4 — media messages, reactions, edit/delete

Photo and video messages delivered with `type` `image` / `video` and readable
`mediaReference`s on the recipient. Reaction `👍` → `❤️` left exactly
`[["❤️",1]]` (at most one per user per message) and `react(emoji: null)`
cleared it. The recipient's bubble showed the new text plus an `edited` label.

#### <a id="m4-a10"></a>Edit window enforced server-side (m4-a10)

`[grader, shortened-windows]` An in-window edit succeeded. After sleeping
66 s (shortened `editWindow` = 60 s) the identical edit was refused with
*"the program refused with EDIT_WINDOW_CLOSED"* and the stored text was
unchanged when read back by the recipient. `media.edit` is declared `: server`
in `snapback/media.q:24`, so this is not the absence of a UI affordance.

#### <a id="m4-a12"></a>Asset revoked after delete (m4-a12)

`[grader]` The asset served **2080 bytes** over its documented `assetSource`
URI before the delete. After `media.delete`, the same URI returned **HTTP 404**
and the SDK returned `{"denied":{"code":"E_ASSET_UNKNOWN", …}}`; the row's
`mediaReference` is `null` and `tombstone` is `true`.

### <a id="m5"></a>M5 — ephemeral, chat config, search

- `m5-a04` / `m5-a05` / `m5-a06` `[a06 grader]` The recipient's first fetch of
  a view-once asset served **2062 bytes**; the second returned **HTTP 410
  Gone** and the SDK returned `{"denied":{"code":"E_ASSET_VIEWED", …}}`.
  Refused server-side, not hidden in the UI. The sender, a different principal,
  still has their own single read — the documented one-read-per-principal asset
  type.
- `m5-a08` Non-admin `search.customize{title}` refused (`NOT_ADMIN`), title
  unchanged; the admin's rename succeeds.
- `m5-a09` `people('car')` and `people('CAR')` both return Carol; the infix
  `'arol'` does not — word-prefix, not substring, exactly as specified.
- `m5-a10` `search.inChat` on `d-alice-bob` for `Coffee` (and `coffee`) returns
  the seeded *"Coffee after work?"* and nothing from other conversations.
- `m5-a11` `search.allMessages` returned **2** groups keyed by
  `conversationId`, each carrying only its own conversation's messages.

#### <a id="m5-expiry"></a>Server-enforced expiry with no client open (m5-a01/a02/a03)

`[grader, shortened-windows]` Timeline, under the shortened profile where the
`24h` option is a 180 s TTL:

| Time (UTC) | Event |
|---|---|
| 20:59:33 | Control (non-expiring) message sent; conversation set to `24h`; ephemeral message sent. Server stamped `expiresAt` 180 003 ms out. |
| 20:59:36 / 20:59:38 | Each of the two web clients signed in, opened the conversation, saw the ephemeral message, and **closed**. |
| 20:59:38 → 21:02:33 | No client open anywhere; expiry falls inside this window. |
| 21:02:48 | Grader probes resume. |

**m5-a01** — a fresh API client's `chat.thread` no longer contains the message;
`media.react` against its id is refused (*"the program refused with
MESSAGE_NOT_FOUND"*); server-side `search.inChat` returns 0 hits for its token.
The control message in the same chat survived and is still searchable, so this
is expiry, not a broken read.

**m5-a02** — both clients relaunched: each renders the control message and
neither renders the expired one.

**m5-a03** — after the relaunch synced the expiry, each client was put offline
(the `sm-search-offline` banner *"Offline · searching synced messages"* was
asserted present). The **control token still returns a hit** from the local
replica — proving offline search really is running — while the expired token
returns nothing. Both clients.

### <a id="m6"></a>M6 — offline writes, push seam, custom-client API

#### <a id="m6-push"></a>Push payload logging (m6-a08 / m6-a09)

Verified with a **grader-minted** service token
(`npx snapback4 token --service grader-push-observer`, value `[REDACTED]`) so
the check does not depend on the lane's own token. With no live client for the
recipient, a 211-character send logged **exactly one** payload with
`targetUserId` = the recipient, `chatId` = `d-alice-bob`, `senderDisplayName` =
the sender's display name, and `preview` equal to the **first 80 characters
exactly** (length asserted = 80). A view-once photo logged `preview: "Photo"` —
its caption did **not** leak — and a video logged `"Video"`.
`snapback/push.q:5` emits only when `not exists connected[m.principal]`, which
is the "clients closed" precondition.

#### <a id="m6-demo"></a>Custom-client demo (m6-a10 / m6-a11)

The grader ran `node scripts/custom-client-demo.mjs` itself. It exited green
with `{"pass":true, "operations":["authenticate","list conversations","page
history","send text","receive live"]}` — the full documented list — and printed
no credentials (the output was scanned for the fixture password strings).

#### <a id="m6-a12"></a>Grader-written API.md-only variation (m6-a12)

Task: fetch the latest message of a *named* conversation, using nothing but
`API.md`. The grader wrote a fresh script:
`login` → `createClient` → `chat.inbox` (documented as returning "membership,
conversation metadata, roster and latest message") → match `conversation.title
=== 'Weekend Plans'` → `conversationId` → `chat.thread` (documented "newest
first, 50 messages per page") → `data[0]`.

It worked on the **first attempt** with no undocumented knowledge, returning
id, `senderId`, `serverTimestamp`, `type`, `text`, `mediaReference` and
`receipt`. As a cross-check the inbox's own `latest` agreed with the thread
head. Documentation quality on the required surface is good. One rough edge at
the margin is filed as **defect d-04** (cosmetic).

#### <a id="m6-a13"></a>Scale-replay adapter conformance (m6-a13)

The grader ran the frozen `instrument/fixtures/validate.mjs` against
`sample-50.log` — *"valid … 50 actions, 0 markers, 13 verbs"* — then
`scripts/replay.mjs`, which reported `settled: 50`. The replayed end state was
re-checked independently: `sample-post-01` likes 1 / replies 2 / reposts 0,
`sample-dm-01` 4 messages, `sample-group-01` 6 messages.

#### <a id="m6-native"></a>Native/simulator artifacts — absent (m6-a01…a04)

`choreography/simulator.md` names the qualifying artifacts exactly:
`m6-ios-screen.mp4`, `m6-ios-receipts.jsonl`, `m6-ios-run.json`. **None
exists.** The M6 segment summary records

```
supplementalExternal: [{ id: "ios-simulator-m6", pass: null, receipt: null,
                         status: "not-recorded",
                         reason: "M6 simulator evidence is recorded separately
                                  from web green", requiredForGreen: false }]
```

and `artifacts/m6-ios/` contains only an Expo/Hermes bundle export
(`_expo/`, `assets/`, `metadata.json`). A filesystem-wide search of
`artifacts/` found no `.mp4`, no `*ios-receipts*` and no `*ios-run*`.

The frozen grader prompt scores these assertions only from the harness's
simulator recordings and receipts, never from builder assertions, so the
lane's own `evidence/offline-restart-proof.json` and `cold-scale-proof.json`
were **not** used. `m6-a01`…`m6-a04` record **not-run**: nothing was observed.

Note that the platform ships `snapback4 witness ios --bundle-id … --segment …
--artifacts …`, so producing this artifact was within reach of the toolchain
the lane already had.

### <a id="m7"></a>M7 — not attempted

`ENVIRONMENT.md` reserves Day-2 evolution for a separate fresh session run
after this grading ("do not attempt it"), and the lane records M7 status
`not-run` with reason *"Explicitly reserved for a later fresh session."*
`README.md` states no M7 implementation is included. All nine M7 assertions
record **not-run**. `m7-a09`'s `conditionalOn` precondition *is* satisfied —
M1–M6 and M8 were green — so it records `not-run` rather than
`not-applicable`. Per `applicability.json`, M7 stays in O1's denominator on a
full run and scores not passed.

### <a id="m8-insights"></a>M8 — Insights totals and the 7-day breakdown

`m8-a01` — `insights.mine` totals were compared against the grader's **own**
independent row counts (read-only SQL over `posts`, `likes`, `feedPosts`,
`feedFollows`, formulated by the grader rather than copied from the lane's
test). All six matched exactly, and `social.relation` agreed independently on
followers and following. The `/insights` screen's six tiles
(`sm-insights-total-posts`, `-likes-received`, `-reposts-received`,
`-replies-received`, `-followers`, `-following`) showed the same six numbers.

`m8-a03` / `m8-a04` — `insights.mine` returns exactly 7 buckets; the last
equals `floor(asOf / 86400000)`, i.e. the server-time **UTC** day; buckets are
consecutive UTC days; a post created during the check incremented that bucket
by exactly 1. **5 of 7** buckets carried explicit numeric `posts: 0` /
`likesReceived: 0` rather than being omitted, and the UI rendered all 7
`sm-insights-day-row` rows including the zero days.

### <a id="m8-trending"></a>M8 — Trending

`m8-a05`/`a06`/`a07` — the grader backdated a post 25 h with
`npx snapback4 run social.createPost … --now <now-90000000>`, created a
deliberate tie pair 8 ms apart and one reply, then had all 8 fixture personas
like all four. Results: the head of `insights.trending` is the **newer** of the
two 8-like in-window posts; the tie is broken newest-first
(`rows[0].at > rows[1].at`); the backdated post — confirmed by row count to
hold 8 likes, the same as the head — is **absent**; the reply is absent and no
row has a `parentId`; every row is inside `now − 24 h`; and the ranking is
non-increasing in likes with the newest-first tiebreak holding for every
adjacent equal-likes pair. The Trending tab rendered the same 10 rows, head
first.

### <a id="m8-digest"></a>M8 — scheduled digest (m8-a08/a09/a10/a12)

`[grader, scheduled]` Run on a **grader-owned isolated backend** on port 49366,
built from the lane's own `snapback/` schema and the shortened 2-minute digest
config, so the measurement could not be contaminated by the lane's live
instance. Observation used a grader-minted service token (`[REDACTED]`).

Four personas were created, then the grader slept to a 2-minute bucket boundary
so all seeded activity landed in one period (`periodStart` 1790110440000):

- *sender* follows *active* → 1 new follower;
- *active* follows *sender*, who posts twice → 2 new posts in following;
- *sender* opens a DM with *active* and sends **3** messages → 3 unread in 1 chat;
- *outsider* creates a group with *sender* (**not** *active*) and sends **5**
  messages there — the trust-boundary control;
- *quiet* does nothing at all.

All clients were closed before the period ended. Results after the schedule ran:

- **m8-a08** exactly one digest per active user (2 users, 1 each), with
  `newFollowers 1`, `newPostsInFollowing 2`, `unreadMessages 3`,
  `unreadChats 1` — matching the seeded activity exactly, and matching the
  server's own `digest.preview` for the same window.
- **m8-a09** *quiet* received **0** digests.
- **m8-a10** the next 2-minute period, in which no writes occurred, emitted
  **0** digests for any user.
- **m8-a12** *active*'s counts stayed 3 / 1 from its own DM, while *sender* —
  who **is** a member of the outsider group — correctly counted 5 / 1. Activity
  in a chat the target is not a member of never entered the target's counts.
  `snapback/digest.q` iterates only `members[reader]`.

### <a id="m8-digest-restart"></a>M8 — restart mid-period (m8-a11)

`[grader, scheduled]` In a fresh period (`periodStart` 1790110920000) the
grader seeded follow + post + DM activity for two users, then **SIGTERMed the
backend listener mid-period** at 21:02:02, confirmed the port had no listener,
and restarted it at 21:02:04 (2.6 s down) — 115 s before the period closed.

After the period closed: **exactly one** digest per user for that period, and
across **all three** periods observed on that instance no `(user, period)` pair
ever received more than one digest. `snapback/digest.q`'s `job daily` inserts
the `digestMarkers` row in the same chunk as the emit, with a `unique byPeriod:
principal, periodEnd` constraint, which is the mechanism.

### <a id="m8-native"></a>M8 — durable-queue native artifact — absent (m8-a17/a18)

Same finding as [#m6-native](#m6-native): the M8 segment summary records
`{id:"ios-simulator-m8", pass:null, receipt:null, status:"not-recorded"}`, and
`artifacts/m8-ios/` holds only a bundle export — no `m8-ios-screen.mp4`,
`m8-ios-receipts.jsonl` or `m8-ios-run.json`. `simulator.md` makes that
artifact the sole basis for `m8-a17`/`m8-a18` and states that missing M8
evidence "never gates or inherits a pass from the M8 web segment". Both record
**not-run**.

## <a id="choreo"></a>Choreography receipts — the basis for every `[choreo]` score

Scored from the harness's structured receipts only, never re-driven by the
grader. Every receipt line validates against the frozen
`receipts.schema.json` shape, and the lane's harness copy is byte-identical to
the frozen one.

<a id="choreo-m1"></a>**M1** (`evidence/choreo-m1.jsonl`, green, 3/3 required):
`profile-edit-live-visibility` bestOf:3 `visibleMs` **79.1 / 74 / 75.7**;
`session-persists-on-relaunch` 366.7 ms; `logout-remains-signed-out-on-relaunch`
645.4 ms.

<a id="choreo-m2"></a>**M2** (`choreo-m2-1790105261698.jsonl`, green, 9/9):
`feed-text-post-live-update` `visibleMs` **210.4 / 101.5 / 87.9**;
image **163.1 / 154.2 / 96.1**; video **95.1 / 98.7 / 156.2**;
`feed-author-avatar-and-display-name` passed on exact avatar identity plus the
display name; `like-unlike-live-count` `likeVisibleMs` **127.1 / 54.1 / 55.2**;
`reply-live-thread-projection` `replyCountVisibleMs` **55.3 / 56.8 / 55.6**;
`follow-unfollow-live-projection` passed on its third attempt after two
10 s-timeout failures — a best-of-3 pass, and the two failures are exactly the
flake-control case the protocol anticipates.

<a id="choreo-m3"></a>**M3** (`choreo-m3-1790105622910.jsonl`, green, 7/7):
`dm-live-messages` `visibleMs` **171.9 / 258 / 339.8**;
`sender-avatar-identity-when-rendered` passed on exact sender identity;
`typing-indicator-within-2s-expires-within-5s`
(`typingObservationBoundaryVersion: v2`) — `visibleAfterLastKeystrokeMs`
**8.6 / 15.3 / 16.1** against the 2 000 ms bound and
`expiresAfterLastKeystrokeMs` **4324.3 / 4830.2 / 4314.5** against the 5 000 ms
bound, all three attempts inside both bounds;
`receipt-sent-delivered-read-transitions` passed on *exact semantic
sent/delivered/read tokens, no glyph matching* (the frozen harness records this
one at bestOf:1, so only one measurement exists — noted on `m3-a08`);
`group-receipt-waits-for-slowest-member` passed;
`member-add-promote-remove-leave-and-live-cutoff` passed, with the live cutoff
checked only after a later progress marker reached the removed member.

<a id="choreo-m4"></a>**M4** (`choreo-m4-1790105834262.jsonl`, green, 5/5):
`photo-message-live-render` **959.1 / 927.5 / 947.3**;
`video-message-live-playback` 1858.7 ms;
`reaction-live-replace-remove` **950 / 886.5 / 1005.5**;
`edit-live-visibility` **114.9 / 154.4 / 85.9**;
`delete-live-tombstone` 1947.7 ms.

<a id="choreo-m5"></a>**M5** (`choreo-m5-1790106138268.jsonl`, green, 4/4):
`chat-color-background-sync` `visibleMs` 129.3;
`warm-offline-search-over-synced-messages` 1035.4 ms;
plus two supplementary receipts — `view-once-single-view-and-refusal` (32.0 s)
and `disappearing-message-expiry-and-purge` (303.8 s, a real
shortened-window wait).

<a id="choreo-m6"></a>**M6** (`choreo-m6-1790107180000.jsonl`, green, 1/1):
`offline-message-queue-flush-in-order`, `flushMs` 315.2. Reading
`choreography/choreography.mjs:2340-2390`, this single check covers three
assertion observables: both offline-composed bubbles must expose the **exact
semantic receipt value `pending`** (`m6-a05`), both must render on the
recipient in **send order** by index comparison (`m6-a06`), and both sender
receipts must be waited to the **exact value `read`** (`m6-a07`).
`simulator.md` states the P2 hardening "re-scopes milestone green to the
implemented web queue/flush segment", so these three are scored **pass** from
this web-carrier harness receipt, with the separate native artifact absent.

<a id="choreo-m8"></a>**M8** (`choreo-m8-1790108095889.jsonl`, green, 5/5):
`m8-a02-insights-like-refresh` — `beforeLikes 69 → afterLikes 70` after the
like and a refresh (`refreshMs` 192.9);
`m8-a13-same-account-message-live` `visibleMs` 624.7;
`m8-a14-cross-device-read-state` `clearVisibleMs` 390.3;
`m8-a15-dual-offline-convergence` `firstFlushMs` 228.8, `secondFlushMs` 343.5;
`m8-a16-dual-offline-receipts` `firstReadMs` 2.4, `secondReadMs` 2.3.

## Phase 4 — holdout probes: **skipped, none committed**

No probe set was hash-committed before this wave, so
`wave.probeSetSha256` records the literal `none-uncommitted` and
`probeResults` is empty. No probe was invented. Because `applicability.json`
makes the wave's secret rotated holdout probes the **sole** scoring basis for
O3 — "anchor probes are non-scored continuity diagnostics and never bear on
O3" — **O3 records `null`**: unscoreable for want of its only input, not
inapplicable. Its gate (M6 green plus M1–M5 attempted) is in fact met.

## <a id="trust"></a>Grader trust-boundary checks (reported as defect-list input, not O3)

Eleven checks, run so the information is not lost, reported outside O3:

| Check | Result |
|---|---|
| Non-member reads a private DM thread | row-filtered to `data: []` — no leak |
| Non-member sends into a conversation | refused `NOT_MEMBER` |
| Non-member fetches a private conversation's media asset | HTTP 404 + SDK `E_ASSET_UNKNOWN` |
| Non-member global message search | 0 groups; private message not leaked |
| Editing another user's message | refused `NOT_AUTHOR`, text unchanged |
| Deleting another user's message | refused `NOT_AUTHOR` |
| Non-admin promote / addMember / removeMember | all refused, roster intact |
| Removed member: thread, conversation, inbox, in-chat search | all empty server-side; her sends refused |
| `/effects` unauthenticated / bogus token / ordinary user session | 401 / 401 / 401 |
| Cross-account handle claim (`alice`) | refused |
| In-window delete-for-everyone | accepted (`deleteWindow` 120 s; `DELETE_WINDOW_CLOSED` declared at `snapback/media.q:33`) |

The read rules are declarative and server-side —
`conversations.read <- exists members[.id, viewer]`,
`messages.read <- exists members[.conversationId, viewer]` — so authorization
is not UI absence. **No trust-boundary defect was found.** The non-member read
returning an empty complete page rather than an explicit refusal discloses
nothing and is ordinary row-level filtering, so it is recorded here as an
observation, not a defect.

## <a id="o5"></a>O5 — scale replay, verified from the replay record

Independent cross-checks the grader performed on the record:

- `instrument/fixtures/scale.log` sha256 matches its pin
  (`b26bf1ae…0b6abba9`) exactly.
- All **18** `perEntityCounts` in `evidence/scale-verify-final.json` match
  `invariant-manifest-combined.json` exactly — users 1008, profiles 1008,
  followEdges 5921, posts 50228, topLevelPosts 48224, replies 2004,
  activeLikes 5008, activeReposts 1004, conversations 1002, dms 901,
  groups 101, memberships 2053, messages 100015, textMessages 99105,
  mediaMessages 910, quotedReplies 2736, activeReactions 2000,
  disappearingSettingsEnabled 0.
- The four per-user/per-chat maps (`perUserFollowingCounts`,
  `perUserConversationCounts`, `perChatMessageCounts`, `perGroupMemberCounts`)
  are verified at **all three** checkpoints (10 %, 50 %, final), each with
  `pass: true`.
- Named O5 fixtures match at each checkpoint: celebrity follower count exactly
  **900**, the celebrity-follower's 5-account following list
  `[u0001,u0002,u0003,u0004,u0900]`, and the busy group's **50**-member roster.
- Settlement accounting: `evidence/scale-settlements.jsonl` has **167 243**
  lines with **0** unsettled, and the verb totals sum to 167 157 scale actions
  + 86 starter-log lines = 167 243 — an exact reconciliation.
- All **11** degradation checks pass, including the M8 envelope extension:
  history page 50/page 1 **1.019×** (limit 3×), 500-follow/5-follow feed
  **1.032×**, global search full/10 % **0.809×** with the 50 % curve
  16.46 s ≤ 19.84 s, Insights **0.751×** with 1.664 s ≤ 2.146 s, Trending
  **0.980×** with 2.003 s ≤ 2.691 s, celebrity read path **1.114×**,
  celebrity write path **0.657×**, and cold sync **5.17 s** against the 30 s
  bar. No probe timed out, errored or OOMed.
- Replay used **687.49 s** of the lane's declared 14 400 s cap = **4.8 %**.

Band function, first-match over 0, 30, 60, 90, 75 → **75**. Branch 0 does not
fire (manifest conforms; cap not exhausted). Branch 30 does not fire (all rules
pass; no probe failure). Branch 60 does not fire — the frozen brief leaves the
absolute p95 ceiling table as a P3 placeholder ("pilot-calibrated"), so no
calibrated ceiling exists to exceed, and 4.8 % is well under 80 %. Branch 90
**cannot** fire: it requires an affirmative "every probe's observed ceiling
utilization is ≤ 50 %", and with no calibrated ceilings
`maxCeilingUtilization` is null and cannot be affirmed; the replay-cap half of
that branch *is* satisfied. First match is therefore **75**.

Diagnostics for a later re-band should P3 calibrate the ceilings — observed
p95s were 2.42 ms (500-follow feed), 2.35 ms (5-follow feed), 17.54 ms (global
search), 16.91 ms (history page 1), 17.22 ms (history page 50), all far under
the 30 s probe timeout that is the only pinned per-probe bound.

## Results summary

| Milestone | Passed / total |
|---|---|
| M1 | 13 / 13 |
| M2 | 27 / 27 |
| M3 | 15 / 15 |
| M4 | 12 / 12 |
| M5 | 12 / 12 |
| M6 | 9 / 13 (`m6-a01…a04` not-run: no simulator artifact) |
| M7 | 0 / 9 (not attempted; reserved for a later fresh session) |
| M8 | 16 / 18 (`m8-a17`, `m8-a18` not-run: no simulator artifact) |
| **Total** | **104 / 119** |

Coverage-manifest spot-verification: **honest**.
Defects: 0 blocker, 0 major, 1 minor (d-01), 3 cosmetic (d-02, d-03, d-04).
O-dimensions: **O1 78**, **O2 85**, **O3 null** (no probe set committed),
**O4 20**, **O5 band 75**.

No weighted total, efficiency statistic or cross-lane comparison is computed
here; those are the harness's and publisher's jobs.

## <a id="files"></a>Result files

- `grading/grader-report.json` — schema-valid against
  `instrument/grader/grader-report.schema.json`, carrying the **101** M1–M7
  assertion ids the frozen schema permits.
- `grading/m8-assertion-results.json` — the **18** M8 results from this same
  single grading session, in the same record shape and enum vocabulary.

### Recorded measurement-coverage gaps

1. **Frozen schema limitation.** `grader-report.schema.json`'s
   `assertionResults` uses `patternProperties: "^m[1-7]-a[0-9]{2}$"` with
   `additionalProperties: false`, so M8 results **cannot** be carried in the
   schema-valid report even though `assertions.json` version `0.3.0-m8` defines
   18 M8 assertions and `applicability.json` version `0.3.0-m8` puts M8 in
   O1/O2's full-run observing set. The report schema was not re-frozen
   alongside the 2026-08-11 M8 amendment. The two files above are the
   workaround; the 119-id partition is exact and non-overlapping.
2. **Prior measurement-coverage gap.** The structured `assertionResults` of the
   September 5 and September 12 grading records carried only the 101 M1–M7 ids
   listed in `GRADER_ASSERTIONS_101.txt`. Their notes could describe M8
   observations in prose, but they did **not** provide a machine-comparable
   18-id M8 result set, so no prior structured M8 subtotal exists to compare
   against. This session is the first to emit one.

## <a id="cleanup"></a>Cleanup

Lane state touched by phase 1 (`suite-status.json`, `evidence/coverage-m*.json`,
the `.seed/` ledgers) was backed up before the suite ran and restored after
(contents verified identical; the `.seed/` ledgers were unchanged by the
re-run, confirming seed idempotence a second time). The nine new
`evidence/suite-m*-<timestamp>.json` receipts and the one failure screenshot
the entrypoint wrote during the grader's run were moved out of `evidence/` into
`grading/_work/grader-run-receipts/` so the lane's delivered evidence set is
unchanged. One file could not be restored: the M8 acceptance entrypoint
rewrites `evidence/m8-ranking.json` unconditionally, and it was not backed up
before the first run, so it now holds the grader's run's trending snapshot
rather than the builder's. It is a derived receipt of a check that passed in
both runs.
The three grader-started servers, and only those, were stopped by PID at the
end of the session; no pattern kill was used.
