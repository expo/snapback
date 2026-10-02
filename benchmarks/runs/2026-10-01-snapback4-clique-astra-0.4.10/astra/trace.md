# Sanitized grading trace — lane `astra-snapback4`

Wave `full-3models-astra`. Grader family `claude`, model `claude-opus-5`.
Session outcome: **completed** (one permitted re-run used). Grade label:
**uncalibrated-grader**.

Credentials are never printed in this trace. Fixture passwords were read from
the instrument's starter log (the declared test-fixture exception), held only in
process memory or a scratch file under `grading/work/`, and referenced by
length or by result only. Account emails created by my probes use the
`g<n>-<role>-<stamp>@example.com` shape and are grader-synthetic. No raw
transcript is published.

Machine note: other sessions share this host. `uptime` load average is recorded
beside every timing-sensitive session below; it ranged from **25.07** at the
start to **2.53** in the later phases.

---

## 0. Scope, inputs and integrity checks

| Input | Value |
|---|---|
| Assertion manifest | `instrument/schema/social-messenger/assertions.json`, version `0.3.0-m8`, sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| Applicability manifest | `applicability.json`, sha256 `b3d45805202375949b657cc30609e9d1de51da6a188469e9bf2c60f8fd1e37a1` |
| Assertions | 119 total — M1 13, M2 27, M3 15, M4 12, M5 12, M6 13, M7 9, M8 18; by executor: 64 suite-required, 39 choreo, 16 grader |
| Run scope | `full`. Nothing struck by `ENVIRONMENT.md`. |
| Backend | `snapback4-0.4.10` / `snapback4-expo-0.4.10`, Node 24.18.0, macOS arm64 |

**Excluded material.** `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`
and `run-log.md` exist in the lane directory. I did not open any of them. The
lane `README.md` and `scripts/fixture-server.mjs` reference them; I used only
the parts of those files that do not quote their contents, and I wrote my own
launcher rather than the lane's, so that no grading step appended to
`run-log.md`. No other lane under `lanes/` was read. The session is not
contaminated.

**Choreography integrity.** `diff -rq` between the lane's `choreography/` copy
and the frozen `instrument/choreography/` shows the only differences are
`node_modules/` and `package-lock.json`. The harness is unmodified at version
`0.3.8-m8`. The lane's wrapper (`scripts/choreo.mjs`) invokes it with only
`--suite-status`, `--setup-identity`, `--adapter` and `--receipts`; it passes
**no `--simulator-status`**, so no native pass is claimed through the harness.

**Config integrity.** `config/windows.shortened.json` and
`config/digest.shortened.json` are byte-identical to the fixture pack's copies.
The generated `snapback/config.q` was already built from the shortened profile
(edit 60 s, delete 120 s, 24h option = 180 s, 7d option = 300 s) and
`snapback/digest.q` from the shortened digest (`every 120s`). All expiry and
digest grading below ran under that configuration.

**Run record.** `run-record.json` is the agent-authored base schema only. It
carries no per-milestone statuses, no replay record and no
`performanceProbes.o5Inputs`. Milestone status, invariant conformance and the
O5 inputs were therefore read from the lane's receipts under `evidence/`, and
that substitution is recorded in the report's `notes`. The record states
"M7 intentionally not run", which I confirmed independently (§7).

---

## 1. Processes I started

Lane port range 49360–49379 only. Every PID below was started by me and is
killed at the end of the session; nothing else was touched, and no
`pkill`/`killall` was used.

| Port | Role | PIDs |
|---|---|---|
| 49360 | backend (first) — `npx snapback4 dev --port 49360` | wrapper 58525, binary 58552, push worker 58555 |
| 49361 | web client — `npm run serve:web` over the lane's `dist/` | wrapper 59158, server 59177 |
| 49360 | backend (restarted at §8's period midpoint) | wrapper 56362, binary 56566, watchdog 56611, push worker 56616 |
| 49368 | isolated fresh instance for M8 clock-advance work | wrapper 25154, binary 25182 |
| 49363 | started and stopped by the lane's own M8 acceptance run | managed by the suite |

`npx snapback4 check` before starting: **ok — 30 tables (18 synced), 52
operations, no problems, 13 notes**. The notes are advisory (`N_SYNC_ORDER`,
`N_NEVER_COMPLETE`, `N_MAINTAIN_DELTA` and similar), not errors.

---

## 2. Phase 1 — the builder suite

Ran the documented entrypoint `npm run acceptance -- --milestone mN` against
the running backend for every attempted milestone.

| Milestone | Result |
|---|---|
| m1 | **fail** — `avatar-upload-and-render` (see §3) ; the other 6 checks pass |
| m2 | pass — 10/10 checks |
| m3 | pass — 5/5 |
| m4 | pass — 7/7 |
| m5 | pass — 7/7 |
| m6 | pass — 6/6 |
| m8 | pass — 4/4 (starts and stops its own fresh instance on 49363) |
| m7 | not run — the milestone was never attempted |

Per the abort protocol I re-ran the failed m1 phase once; it failed again, so
the failure is not a grader-environment failure and the session continued.
`rerunsUsed = 1`.

---

## 3. <a id="m1-avatar"></a>The M1 avatar flake (defect d-02)

The shipped check asserts
`page.locator('[data-testid="sm-profile"] img').count() > 0` the instant
`sm-profile-heading` becomes visible after save, with no wait.

- Shipped entrypoint: **5 runs → 4 fail, 1 pass**, at load averages 25.07,
  22.26, 3.59, and lower.
- An instrumented copy of the same script (identical logic plus a DOM dump):
  **6 runs → 1 fail, 5 pass**.
- Combined: **11 runs, 5 failures (~45%)**, independent of machine load.
- Captured failure state: `url .../profile/me`, `sm-profile img = 0`,
  `total img = 1` — the avatar image existed on the page but outside the
  `sm-profile` subtree at that instant, i.e. a route-transition race.
- Captured pass state: the `sm-profile` subtree contains
  `<img alt="Avatar for …" src="blob:…">` plus a matching
  `background-image` on `sm-avatar`.

**Independent verification of the feature itself** (my own script, web
automation, load average 3.81):

- fixture avatar uploaded from the edit screen; the stored asset resolved and
  previewed in **47 ms**;
- after save, the avatar `<img>` painted **3 ms** after `sm-profile-heading`
  became visible, `complete=true`, `naturalWidth=256`;
- after a full page reload it still rendered (1 ms);
- zero page errors.

So `m1-a10` and `m1-a11` **pass** on independent execution while the suite
reports `fail`. The divergence is recorded per-assertion in `suiteResult` and
filed as defect **d-02**: the lane's own green-receipt generator is
non-deterministic.

---

## 4. Phase 2 — coverage-manifest spot verification

Verdict: **honest**. No milestone adjudicated to capability-failure.

Completeness check, machine-compared against the manifest's suite-required sets:

| Milestone | required | mapped | missing | extra |
|---|---|---|---|---|
| m1 | 7 | 7 | none | none |
| m2 | 22 | 22 | none | none |
| m3 | 7 | 7 | none | none |
| m4 | 5 | 5 | none | none |
| m5 | 6 | 6 | none | none |
| m6 | 5 | 5 | none | none |
| m8 | 6 | 6 | none | none |

M7 has no coverage manifest, correctly, because M7 was never attempted.

I then read the mapped test bodies for 21 sampled ids and re-executed the same
observables myself. Representative confirmations:

- `m2-a27` genuinely reads `followState` and asserts `followers=0`,
  `following=0` rather than inferring the counts.
- `m2-a22/a23/a24` fetch two real pages per tab, build composite
  `repost:id` keys, assert set-size equality and count all 25 seeded posts —
  duplicates *and* gaps.
- `m6-a13` runs the fixture pack's own `validate.mjs` and then asserts replayed
  state per entity class (follow counts, like/repost/reply counts, roster size,
  history length, a video message, an exact reaction group, a view-once row, a
  quoted reply, a cleared reaction).
- `m8-a05..a07` advance the server clock on an isolated instance and assert an
  exact three-way ranking including the tie-break.
- `m4-a06/a07` map to a set-state test that sets `👍`, then `❤️`, asserts a
  single `❤️`, then clears with `emoji:null`. The UI maps a repeat tap to
  `null` (`src/chat.tsx`), so the mapping is faithful.

One mapping is **narrower than its assertion but not dishonest**: `m3-a11` is
mapped to `quoted-excerpt-and-source-jump`, which really does assert the jump —
but only for a quoted original already on the loaded page. The paged case fails
(§5, defect d-01). That is a coverage gap the grader phase is for, not a
dishonest mapping.

---

## 5. Phase 3 — independent checklist execution

Everything below was executed by me against the running lane: the custom-client
API over HTTP, Playwright on the lane's web build, and source inspection.
`[choreo]` assertions were **not** re-driven; they are scored from the harness's
structured receipts (§6).

### <a id="m1"></a>M1 — accounts and profiles

- **m1-a01 / m1-a02** — `POST /auth/signup` with a 17-character password
  succeeded and the returned session immediately authenticated a read. A
  3-character password was refused (`E_AUTH`).
- **m1-a03** — `saveProfile` with an existing handle refused:
  `HANDLE_TAKEN`, "That handle is taken." (My first attempt hit `E_INPUT` on a
  malformed `location`/`link` of my own making; corrected and re-run.)
- **m1-a04** — re-signup with an existing email refused (`E_AUTH`).
- **m1-a07** — a session read `q/me` successfully, then `POST /auth/logout`;
  the same bearer then returned a client-level denial and **HTTP 401** on a raw
  `POST /q/me`. Server-side revocation confirmed.
- **m1-a08** — display name and bio saved, re-read, edited again, re-read;
  both edits persisted.
- **m1-a10 / m1-a11** — §3.

### <a id="m1-passwords"></a>M1 — password storage (m1-a12, m1-a13)

- `snapback/schema.q` line 1 is `use identity password` — the backend's
  documented managed credential path. The lane contains no hand-rolled hashing.
- The running store contains argon2id digests with published parameters:
  `argon2id$v=19$m=19456,t=2,p=1` (19 MiB, t=2, p=1), found in both
  `store.sqlite` and `store.sqlite-wal`. The server also prints
  "Argon2 slots: 10 on this host" at startup. **m1-a12 pass.**
- All **8** fixture passwords were scanned as literal byte sequences against
  `store.sqlite`, `store.sqlite-wal`, the whole web bundle under `dist/`, the
  server log, and the entire `evidence/` tree: **0 hits in every target**.
  **m1-a13 pass.** The fixture credential files themselves live in the
  instrument, outside the app, which is the declared exception.

### <a id="m2"></a>M2 — posts, feeds, engagement

Verified over the API with purpose-built accounts. Load average 3.53.

A first pass used the seeded personas and produced two misleading failures
(`m2-a11`, `m2-a27`) because the starter segments already give those personas
follow edges. I re-ran those assertions on **freshly created accounts with zero
follow edges**; the baseline was confirmed (`followers=0, following=0`) and all
of them pass. This is recorded because the correction matters: the first
reading was my setup error, not the lane's.

- **m2-a01..a03** — text post; image post with exactly 2 fixture images read
  back; video post with the fixture video asset.
- **m2-a06 / m2-a08 / m2-a09** — follow projects the author's posts into the
  Following feed; unfollow removes them *including older ones* on reload; the
  same posts remain in Global (projection-scoped, not revocation).
- **m2-a10 / m2-a11** — an unfollowed author's post is in Global and absent
  from Following.
- **m2-a15** — `setLike(enabled:true)` applied twice left the count at **1**
  (idempotent set-state); clearing dropped it to 0 with `liked=false`.
- **m2-a16 / m2-a17** — the repost feed entry carries `actor` and
  `actorProfile` beside the original card; reposting again removes it.
- **m2-a18** — a followed user's repost surfaced the **original author's** post
  with `repost=true` and the original author's handle on the card.
- **m2-a20 / m2-a21** — both direct replies returned in creation order; neither
  appeared in Global or Following.
- **m2-a25 / m2-a26 / m2-a27** — on a zero-follow account, own original posts
  and own reposts are in the Following feed while `followState` stays
  `followers=0, following=0`.

#### <a id="m2-paging"></a>Pagination (m2-a22, m2-a23, m2-a24)

25 posts seeded, both tabs:

| Tab | page 1 | continuation | page 2 | duplicate keys | seeded posts seen |
|---|---|---|---|---|---|
| Following | 20 | yes | 20 | 0 | 25 / 25 |
| Global | 20 | yes | 20 | 0 | 25 / 25 |

#### <a id="m2-links"></a>Links (m2-a12, m2-a13)

The URL renders with `role="link"` and exactly the URL text. I replaced
`window.open` before tapping: the tap called the platform opener with
`https://example.com/cafe` and the app did not navigate away. The card contains
**0** `sm-feed-media` nodes and **0** `<img>` elements — no unfurling.

### <a id="m3"></a>M3 — chats, groups, receipts

- **m3-a03** — `openDirect` called twice from one side and once from the other
  returned the **same** conversation id all three times.
- **m3-a04 / m3-a05** — a group with three members (roster 3); a second group
  with the same title and the same three members got a **distinct** id and its
  own roster of 3.
- **m3-a14** — a non-admin `removeMember` refused `NOT_ADMIN`; roster unchanged
  at 3.
- **m3-a10** — the quoted excerpt renders inside the replying bubble with the
  original text.

#### <a id="m3-quote"></a>m3-a11 — quoted-excerpt jump (FAIL, defect d-01)

Two configurations in one script:

| Configuration | `scrollIntoView` target | original in DOM | within viewport | result |
|---|---|---|---|---|
| reply adjacent to the original | `message-<source>` | yes | yes | **pass** |
| 25 messages between them | **never called** | yes | **no** | **fail** |

Instrumented reproduction of the failing case:

```
bubbles before click: 20      source in DOM before click: 0
quote preview text: "Reply GZ source …"
t+500ms   jumped=[] bubbles=27 sourceInDom=1 error=["Original message is not available in this history."]
t+1500ms  jumped=[] bubbles=27 sourceInDom=1 error=["Original message is not available in this history."]
t+3000ms  … t+15000ms  (unchanged)
source rect: {"top":-2064,"vh":720}
```

The thread *does* load the older page — the bubble count goes 20 → 27 and the
original enters the DOM — but the view never moves to it, and the user is shown
a false "Original message is not available in this history." The jump effect in
`src/chat.tsx` falls through to that error branch while the `loadMore()` it just
requested is still in flight. Deterministic across runs. `m3-a11` = **fail**.

#### <a id="m3-idempotency"></a>m3-a15 — seed idempotency

Counts over the live store before re-seeding m1, m2 and m3, and after:

```
before: profiles 87  posts 281  messages 420  conversations 42  members 102  follows 22
after : profiles 87  posts 281  messages 420  conversations 42  members 102  follows 22
```

Identical across every installed segment. **pass.**

### <a id="m4"></a>M4 — media, reactions, edit/delete

- **m4-a01** — photo message read back by the recipient with `type=photo`; the
  recipient fetched the asset bytes successfully.
- **m4-a03** — video message read back with `type=video`.
- **m4-a06** — switching `👍` → `❤️` left exactly one reaction, the heart.
- **m4-a07** — through the UI: tapping `❤️` added one reaction; tapping the same
  emoji again removed it (1 → 0). The API underneath is explicit set-state
  (`emoji` or `null`), matching the global idempotency ruling.
- **m4-a09** — the edited message carries `edited=true` in the portable
  manifest and the bubble renders the label.

#### <a id="m4-windows"></a>Server-enforced windows (m4-a10, m4-a12)

Under the shortened config (edit 60 s, delete 120 s):

- an edit **inside** the window: `state=sent`;
- the same edit at **+70 s**: `state=failed`, `EDIT_WINDOW_CLOSED`, and the
  stored text was still the in-window text — refused server-side, not merely
  hidden in the UI. **m4-a10 pass.**
- a delete at +70 s (still inside the 120 s delete window): `sent`, as
  configured — recorded as a control so the refusal above is not a blanket
  block.
- **m4-a12**: the recipient fetched the photo asset before the delete; after
  delete-for-everyone the client call was refused (`E_ASSET_UNKNOWN`) and a raw
  `GET /assets/<id>` with the same valid bearer returned **HTTP 404**. The
  tombstone retained identity and order with media cleared.

### <a id="m5-expiry"></a>M5 — disappearing messages (m5-a01, m5-a02, m5-a03)

Shortened config: the "24h" option is 180 s. A control message was sent with
expiry off, then the chat was set to disappearing and the target message sent;
the server reported `expiresAt` ~180 s out.

1. A persistent browser profile signed in as the recipient, opened the chat,
   saw the message among 6 bubbles, let the service worker settle, and **the
   browser was fully closed**.
2. After the TTL plus 20 s, with every client closed:
   - the expired message was **absent** from both principals' `apiHistory`;
   - the point read returned `null` over both the client and a raw
     `POST /q/message` with a valid bearer;
   - the non-expiring control message was **retained**. **m5-a01 pass.**
3. The same browser profile was **relaunched**: the expired bubble was gone
   (0 present, where 6 bubbles had been synced) while the control message still
   rendered. **m5-a02 pass.**
4. The relaunched client was taken **offline** and searched: **0** results for
   the expired token and **1** for the control string — the offline search
   surface was live and the expired row had left it. **m5-a03 pass.**

### <a id="m5-viewonce"></a>M5 — view-once (m5-a04, m5-a05, m5-a06)

- First open renders real bytes (`naturalWidth > 0`) in the media viewer.
- After closing, the affordance is `disabled` with `aria-valuetext="opened"` and
  `aria-label="View-once photo, already opened"`; no viewer renders.
- The second **direct asset fetch** was refused `E_ASSET_VIEWED`; a raw
  `GET /assets/<id>` with the recipient's bearer returned **HTTP 410**.
  **m5-a06 pass.**
- After a page reload the affordance re-enables; tapping it then renders no
  media and surfaces "this photo was for one view, and it was viewed". The
  server boundary holds in both cases — filed as cosmetic defect **d-04**.

### <a id="m5"></a>M5 — groups and search

- **m5-a08** — a non-admin `chatIdentity` refused `NOT_ADMIN` with the title
  unchanged; the admin's own rename then succeeded, so the refusal is
  authorization, not a broken mutation.
- Chat colour: an off-palette value was refused `INVALID_COLOR`; a palette value
  set by the admin was readable by a third member along with the background
  image. (The brief restricts *name and description* to admins; colour and
  background are member-settable, which the lane implements.)

#### <a id="m5-search"></a>Search semantics (m5-a09, m5-a10, m5-a11)

- `"car"` and `"CAR"` both resolved *Carolina Grader*; the mid-word
  `"arolina"` did **not** match — exactly the pinned case-insensitive
  word-prefix semantics.
- In-chat search returned exactly the one seeded string, scoped to its chat.
- Global search returned the 2 matching messages carrying their conversation
  ids across **2 distinct chats**; the web surface renders them under
  `sm-search-group` nodes.

### <a id="m6-push"></a>M6 — push payloads (m6-a08, m6-a09)

With the recipient having no client open, a 134-character message produced a
logged payload whose `targetUserId` was the recipient principal, whose `chatId`
matched the conversation, whose `senderDisplayName` was the sender's display
name, and whose `preview` was **exactly the first 80 characters** (length 80).
A view-once photo message logged `preview: "Photo"`.

### <a id="m6-demo"></a>M6 — custom-client demo (m6-a10, m6-a11)

Ran the documented invocation myself against the live backend:

```
{"pass":true,"authenticated":true,"listed":24,"pages":2,
 "sent":"01M3V6RM…","received":"01M3V6RM…","transport":"HTTP polling"}
exit 0
```

The script covers every listed operation: authenticate (or accept an issued
token), list conversations via `inbox`, page history twice, send a text through
the documented write envelope, and poll it back while validating every
documented manifest field.

### <a id="m6-a12"></a>M6 — grader-written variation (m6-a12)

I wrote a fresh client from `API.md` **alone** — raw `fetch`, no lane modules,
no generated types, no app source — following the documented recipe: page
`inbox` until `row.chat.title` matches, take `row.conversation`, query
`apiHistory`, use `data[0]`.

```
POST /auth/login -> HTTP 200
paged /q/inbox 1 page; titles ["Weekend Plans","Direct message","Acceptance group", …]
candidate conversations for "Weekend Plans": 1
/q/apiHistory -> HTTP 200, 20 messages, complete=true, next present
latest ordinal=21 type=text; documented manifest fields missing: none
page is newest-first by ordinal as documented: true
named DM with @bob resolved via directPeer: true; latest ordinal=244
```

The documentation was sufficient; the ambiguity rule it specifies (return
candidate ids) was also exercised. One inaccuracy: `API.md` documents
`"kind":"account"` in the session object while the server returns
`kind:"user"` — cosmetic defect **d-03**. **m6-a12 pass.**

### <a id="m6-adapter"></a>M6 — adapter conformance (m6-a13)

The fixture pack's own validator: `valid sample-50.log: 50 actions, 0 markers,
13 verbs`. The adapter replayed it green on the dev instance during my own m6
suite run; its receipt log shows every action settled and all **13** verbs
exercised (`register, profile-set, follow, post, like, repost, reply,
dm-create, group-create, member-add, send, send-media, react`), with the
state assertions passing. **pass.**

### <a id="m8-insights"></a>M8 — insights (m8-a01, m8-a03, m8-a04)

On a **fresh isolated instance on port 49368** (so seeded counts are exact), I
created content with known totals and compared:

```
expected {posts:3, likesReceived:4, repostsReceived:1, repliesReceived:2, followers:2, following:1}
observed {posts:3, likesReceived:4, repostsReceived:1, repliesReceived:2, followers:2, following:1}
```

`days` had exactly 7 entries; `days[6].at` was the server's UTC midnight
(`2026-10-01T00:00:00.000Z`) and held all 3 posts created that day; the 6
inactive days were all present with `posts=0` and `likesReceived=0` — rendered
as zero, not omitted. The web Insights screen showed all six labels and 7 day
rows.

### <a id="m8-trending"></a>M8 — trending (m8-a05, m8-a06, m8-a07)

A post with 3 likes was published and the server clock advanced **25 h**. Then
three fresh posts: two with 1 like each (earlier, later) and one with 2 likes.

```
trending order: ["winner", "tie-later", "tie-earlier"]
old 3-like post present in Trending: false
```

Most-liked in the trailing 24 h ranks first; the aged post is absent entirely;
the 1-like tie breaks newest-first. All three **pass**.

### <a id="m8-digest"></a>M8 — scheduled digest (m8-a08, m8-a09, m8-a10, m8-a12)

Shortened digest config, 120 s period. Five fresh personas. All activity was
placed inside one period and **every client was closed before the period
ended**.

Seeded: D3 follows D1; D1 publishes 2 posts; D1 sends 3 DMs to D3; D4 and D5
exchange 5 messages in a group that D1, D2 and D3 are not members of; D2 does
nothing.

Digests emitted for that period:

| persona | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
|---|---|---|---|---|
| D1 | 1 | 2 | 0 | 0 |
| D3 | 0 | 2 | 3 | 1 |
| D5 | 0 | 0 | 5 | 1 |
| D2 | — no digest | | | |
| D4 | — no digest (sender of its own messages, no other activity) | | | |

- **m8-a08 pass** — exactly one digest per active user, every count matching
  the seeded activity.
- **m8-a09 pass** — the inactive persona received zero.
- **m8-a10 pass** — a following period with no new activity emitted **0**
  digests for any of the five.
- **m8-a12 pass** — the 5-message outsider group contributed **0** to the
  non-member D1 and left D3 at exactly its own 3 DM messages in 1 chat; only
  D5, an actual member, received those 5. The job iterates
  `members where .principal = p.principal`, so non-member chats are
  structurally unreachable.

### <a id="m8-digest-restart"></a>M8 — restart mid-period (m8-a11)

Three fresh personas, activity seeded at the start of a period. At the **exact
midpoint** I `SIGTERM`ed the backend (listener 58552, wrapper 58525) and
restarted it (`npx snapback4 dev --port 49360`, new listener 56566). The
service came back and the period completed; I then waited a further full period
to give the restarted worker a chance to re-emit.

```
digests for that period: {"R1":1,"R2":1,"R3":1}
duplicate idempotency keys: 0
worker effect records naming those keys across both server logs: 3 for 3 keys
```

Exactly one digest per user per period across a restart. The schema emits
`once [principal, periodEnd]` and the worker runs with a ledger. **pass.**

---

## 6. <a id="choreography"></a>Choreography-scored assertions

The 39 `[choreo]` assertions are scored from the frozen harness's structured
receipts, never re-driven by me. The lane's latest receipts (run at
2026-10-01T07:10–07:16Z, with matching suite-status and setup-identity hashes
recorded in `evidence/green-receipt-index.json`) show **every required web
segment passing**:

| Segment | Checks | Result |
|---|---|---|
| m1 | profile-edit-live-visibility, session-persists-on-relaunch, logout-remains-signed-out-on-relaunch | all pass |
| m2 | text/image/video live feed updates, follow-unfollow live projection, feed author identity, like-unlike live count, repost toggle + following-feed surface, reply live thread projection | all pass |
| m3 | dm-live-messages, sender avatar identity, typing indicator (≤2 s / expires ≤5 s), receipt sent→delivered→read, group receipt waits for slowest member, member add/promote/remove/leave + live cutoff, quoted reply excerpt + jump | all pass |
| m4 | photo live render, video playback, reaction live replace/remove, edit live visibility, delete live tombstone | all pass |
| m5 | chat colour/background sync, view-once single view + refusal, warm-offline search, disappearing expiry + purge | all pass |
| m6 | offline-message-queue-flush-in-order | pass |
| m8 | insights like refresh, same-account live message, cross-device read state, dual-offline convergence, dual-offline receipts | all pass |

Best-of-3 timing records (all three attempts retained by the harness; the best
is judged):

| Assertion | measurements (ms) | best | bound |
|---|---|---|---|
| m1-a09 profile edit live | 634 / 374.4 / 213.6 | 213.6 | — |
| m2-a04 feed text live | 1703 / 1966.6 / 1504.8 | 1504.8 | — |
| m2-a07 follow projection live | 2308.5 / (attempt failed) / 3762.7 | 2308.5 | — |
| m2-a14 like count live | 3585.1 / (attempt failed) / 2886.8 | 2886.8 | — |
| m2-a19 reply count live | 1527.6 / 2270.8 / 1631.6 | 1527.6 | — |
| m3-a01 DM live | 2944.3 / 1904.4 / 2159.4 | 1904.4 | — |
| m3-a06 typing visible after last keystroke | 60.5 / 45.1 / 48.9 | 45.1 | 2000 |
| m3-a07 typing expiry after last keystroke | 3390 / 3889 / 3899.5 | 3390 | 5000 |
| m4-a02 photo live render | 1700.6 / 1478.1 / 1565.4 | 1478.1 | — |
| m4-a05 reaction live | 1263.8 / 1069.3 / 1102.4 | 1069.3 | — |
| m4-a08 edit live | 1404.4 / 948.7 / 1374.6 | 948.7 | — |

Two attempts (m2-a07 attempt 2, m2-a14 attempt 2) failed and two others passed
in each case — exactly the flake pattern best-of-3 exists to absorb. The host
was under concurrent load throughout.

### <a id="m6-native"></a>Native/simulator assertions — not executed

`m6-a01..a04`, `m8-a17` and `m8-a18` are tagged `simulator, native-artifact`.
`simulator.md` requires a qualifying run directory containing
`m6-ios-screen.mp4`, `m6-ios-receipts.jsonl` and `m6-ios-run.json`; "a recording
without passing structured receipts is not a pass."

What exists: `artifacts/m1..m8/ios/` holding Hermes `.hbc` bundles, and
`evidence/native-artifacts.json` recording only their byte counts and SHA-256
digests. The lane's own README states these "are Hermes build artifacts; they
make no claim of simulator execution," and the choreography wrapper passes no
`--simulator-status`. There is no simulator recording, no structured native
receipt and no run manifest anywhere in the lane.

These six assertions are therefore recorded **not-run**: the observable was
never executed on the carrier the assertion names. I did **not** substitute the
lane's own browser-restart proof scripts, which are builder assertions and are
excluded from O4 by rule.

`m6-a05`, `m6-a06` and `m6-a07` are a different case: the frozen harness's own
M6 web segment asserts exactly those three observables — both offline-composed
messages exposing a `pending` receipt state, the ordered flush on reconnect
(flushMs 2184.3), and both messages walking the normal receipt states to
`read` — and it passed. They are recorded **pass** from that harness receipt,
with the native form noted as unproven in each result.

---

## 7. <a id="m7"></a>M7 — never attempted

Independently confirmed, not taken from the run record alone:

- no poll, vote or message-count surface anywhere in `snapback/schema.q`,
  `src/` or `app/`;
- no `evidence/coverage-m7.json`;
- no M7 evidence files, no `artifacts/m7`;
- `suite-status.json` has no m7 entry;
- the frozen harness's M7 segment was never run.

All 9 M7 assertions are recorded **not-run**. `m7-a09` (the conditional
regression assertion) is recorded not-run rather than not-applicable: M1–M6 and
M8 *were* green, so the schema's not-applicable case ("no milestone was
previously green") does not hold; what never existed is the M7 migration to
regress against. `m7-a08` has no pre-M7 snapshot to compare against because no
migration occurred.

---

## 8. Phase 4 — holdout probes: skipped

**No holdout probe set was committed for this wave.** Execution-order phase 4
was skipped as instructed; `wave.probeSetSha256` is the literal string
`none-uncommitted` and `probeResults` is empty. No probes were invented.

Because `applicability.json` scores **O3 from the wave's secret rotated holdout
probes only**, O3 has no permitted scoring input and is recorded **null**.

### Trust-boundary observations (O2 evidence, *not* probes)

For completeness I ran 15 unscripted authorization checks of my own. These are
defect-hunt observations feeding O2; they are explicitly **not** holdout probes
and bear on neither O3 nor O5.

| Check | Result |
|---|---|
| outsider `apiHistory` on a private DM | 0 rows |
| outsider point read of a private message | `null` |
| outsider in-chat search | 0 hits |
| outsider global search for the private text | 0 hits |
| outsider asset fetch | `E_ASSET_UNKNOWN`, raw HTTP 404 |
| outsider `conversationScreen` | `null` |
| outsider `send` | failed `NOT_MEMBER` |
| outsider `editMessage` | failed `NOT_FOUND` |
| outsider `deleteMessage` | failed `NOT_FOUND` |
| chat member editing another member's message | failed `NOT_AUTHOR` |
| outsider `setReaction` | failed `NOT_FOUND` |
| outsider `/m/seen` | failed `NOT_MEMBER` |
| outsider `chatExpiry` | failed `NOT_FOUND` |
| outsider adding themself to a DM | failed `NOT_ADMIN` |
| reusing another user's asset id as your own avatar | failed `E_ASSET_UNKNOWN` |

Every one enforced server-side, with a valid bearer, not by UI absence. Plus
the window and revocation boundaries already shown in §5: post-window edit
`EDIT_WINDOW_CLOSED`, deleted media HTTP 404, consumed view-once HTTP 410,
revoked session HTTP 401, off-palette colour `INVALID_COLOR`, and the
group-only disappearing-setting rule enforced in schema.

---

## 9. Phase 5 — defects beyond the checklist

| id | severity | milestone | summary |
|---|---|---|---|
| d-01 | major | M3 | Quoted-excerpt jump never fires when the original is outside the loaded page, and shows a false "Original message is not available in this history." (§5) |
| d-02 | major | M1 | The documented acceptance entrypoint is non-deterministic — `--milestone m1` fails its avatar check in roughly half of runs, so the M1 green receipt is not reliably reproducible (§3) |
| d-03 | cosmetic | M6 | `API.md` documents `kind:"account"`; the server returns `kind:"user"` (§5) |
| d-04 | cosmetic | M5 | The view-once affordance re-enables after a page reload; the server refusal still holds, so the user is offered a control that can only error (§5) |

No crashes, no wrong data, no authorization gaps, and zero uncaught page errors
across all my browser sessions.

---

## 10. Phase 6 — O-dimension scores

| Dimension | Score | Basis |
|---|---|---|
| O1 Functional completeness | **77** | 103 / 119 pass, 1 fail, 15 not-run |
| O2 Correctness under grading | **66** | 2 material defects, 2 cosmetic, no authorization gaps |
| O3 Trust boundaries | **null** | No holdout probe set committed; O3 is probe-only by rule |
| O4 Observed offline behavior | **45** | Harness-proven ordered offline writes; no native cold-start proof at all |
| O5 Performance at the scale envelope | **band 30** | Degradation rules fail |

Full anchor citations and justifications are in `grader-report.json`.

### O5 inputs, checked

Band evaluation is first-match in the order 0, 30, 60, 90, 75.

**Band 0 does not fire.** The invariant manifest conforms at all three
checkpoints — the lane's verification receipts report per-entity counts
identical to the frozen manifest:

| | 10% | 50% | final | manifest (final) |
|---|---|---|---|---|
| users / profiles | 1008 | 1008 | 1008 | 1008 |
| followEdges | 5921 | 5921 | 5921 | 5921 |
| posts | 5048 | 25128 | 50228 | 50228 |
| topLevelPosts | 4844 | 24124 | 48224 | 48224 |
| replies | 204 | 1004 | 2004 | 2004 |
| messages | 10015 | 50015 | 100015 | 100015 |
| quotedReplies | 9 | 1821 | 2736 | 2736 |
| activeReactions | 200 | 1000 | 2000 | 2000 |

with `perChatCountsVerified` 1002, `followingCountsVerified` 1008,
`membershipCountsVerified` 1008, the busy chat counted exactly by full paging
(500 pages, 10000 messages), the named spot entities all resolved (6 profiles,
7 posts, 8 messages, 6 conversations, 12 media byte hashes), and the named O5
fixtures present (u0500 at 500 follows, the celebrity at 900 followers in the
write probe, g0001 at 50 members / 10000 messages). Replay wall time 2693 s
with no cap exhaustion recorded.

**Band 30 fires** on "any degradation rule fails". Four frozen rules fail on
the recorded checkpoint p95s:

| Rule | 10% | 50% | 100% | midpoint bound | verdict |
|---|---|---|---|---|---|
| Global message search mid-curve | 9.5500 | **10.4004** | 10.6865 | 10.0551 | fail |
| Insights mid-curve | 1.4999 | **2.3661** | 2.4277 | 1.9123 | fail |
| Trending mid-curve | 3.1925 | **10.9344** | 3.8767 | 3.4966 | fail (>3×) |
| Receipt aggregation must not visibly stall send/render | — | — | p95 **4158 ms**, max 4577 ms | — | fail |

The ratio rules all pass: page50/page1 **2.05**, following500/following5
**2.88**, celebrityFollower/following5 **0.88**, celebrity write path **1.38**
(all ≤ 3). Cold-start sync of the 100-conversation probe user completed in
**7.2 s** without unbounded memory growth. Bands 60, 90 and 75 are unreachable
once a degradation rule fails.

The lane recorded this honestly itself: its public performance summary carries
`pass: false` and notes that concurrent authoring and browser work was present
during the replay checkpoints. That honesty is creditable but O5 is an exact
function, not a judgement.

---

## 11. Totals

| Set | pass | fail | not-run | total |
|---|---|---|---|---|
| M1–M7 (the 101 ids the frozen report schema permits) | 87 | 1 | 13 | 101 |
| M8 (`m8-assertion-results.json`) | 16 | 0 | 2 | 18 |
| **Complete grade** | **103** | **1** | **15** | **119** |

### Recorded measurement-coverage gap

The frozen `grader-report.schema.json` constrains `assertionResults` to the
pattern `^m[1-7]-a[0-9]{2}$`, so a schema-valid grader report **cannot** carry
M8 results even though `assertions.json` version `0.3.0-m8` defines 18 of them
and `applicability.json` puts M8 in the full-run observing sets for O1, O2, O4,
B1, B3, B4 and B7. That is a limitation of the frozen schema, not of this lane.

Consequently the September 5 and September 12 structured `assertionResults`
carried only the 101 M1–M7 ids listed in `GRADER_ASSERTIONS_101.txt`. Their
notes could describe M8 observations in prose, but they did **not** provide a
machine-comparable 18-id M8 result set. This run closes that gap by emitting
the 18 M8 results as a separate, identically-shaped file
(`grading/m8-assertion-results.json`) using the same result records and enum
values, with no id duplicated across the two files. The 119-id partition was
machine-verified: 119 manifest ids, 119 graded ids, 0 duplicates, 0 missing,
0 extra, and the 101-id set matches the prior list exactly.

`grader-report.json` was validated against the frozen schema with AJV 8.20.0
(2020-12 dialect) from the choreography copy: **valid**.

---

## 12. Shutdown

Every process this session started was stopped at the end: the backend on
49360 (wrapper 56362, binary 56566, watchdog 56611, worker 56616), the web
client on 49361 (wrapper 59158, server 59177), and the isolated M8 instance on
49368 (wrapper 25154, binary 25182; already stopped mid-session). The
first-generation backend PIDs (58525 / 58552 / 58555) were stopped as part of
the m8-a11 restart test. No other process on this machine was signalled, and
no `pkill` or `killall` was used.
