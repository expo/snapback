# social-messenger grading — sanitized evidence and action trace

**Lane backend:** `supabase-2.112.4` (hosted Supabase Auth + Postgres behind a
lane-authored Node/Express API, `@supabase/supabase-js@2.112.4`).
**Lane path:** `lanes/grok-supabase`. **Run scope:** full (M1–M8).
**Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder
context. **Wave:** `grok`.
**Instrument:** assertions `0.3.0-m8` (116 assertions), applicability `0.3.0-m8`,
grader report schema v1, choreography/receipts `0.3.6-m8`.

Credentials, tokens, connection strings and the lane's `provider-secrets.env`
are never reproduced here; user ids that appear in quoted payloads are the
fixture personas' backend UUIDs and are truncated or replaced where they are
not needed to read the evidence. Raw transcripts are not published.

---

## 0. Session setup and deviations recorded for this run

This run is an **N=1 calibration grading**, not a claim-eligible wave. Three
deviations from the frozen grader prompt were directed by the wave wrapper and
are recorded here and in the report:

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   (holdout probes) was skipped. `wave.probeSetSha256` records the literal
   string `none-uncommitted` and `probeResults` is empty. No probes were
   invented. Because O3 is scored *only* from the wave's rotated holdout probes,
   this would independently have forced O3 to carry no probe evidence; as it
   happens O3 is null anyway on its own applicability predicate (below).
2. **The grading family has not passed the calibration gate.** `grader.calibrationPassed`
   is `false` and `grader.sameFamilyGraded` is `false`; the grade is labelled
   `uncalibrated-grader` by the record.
3. **Machine load is recorded beside every timing observation.** Other sessions
   share this host. `uptime` load averages during the session ranged from
   **10.12 → 28.83** (1-minute average), which is high; every timing-sensitive
   judgement below is best-of-3 and is reported with the load context.

**Excluded material.** `diary.md`, `essay.md`, `final-report.md` and
`run-log.md` are present in the lane directory. None of them was opened at any
point in this session. No other lane under `lanes/` was read. The grading
session is **not** contaminated.

**No run record.** The lane wrote no `run-record.json` (`ls run-record*.json`
→ no matches). Milestone statuses below are therefore derived from the lane's
own receipts (`receipts/*-suite.json`, `receipts/*-choreo.jsonl`,
`receipts/suite-status.json`, `receipts/simulator-status.json`) and from my own
execution, and the report's `lane.runRecordPath` records the absence.

## 1. Environment, processes and ports

macOS arm64, Node v24.18.0 (`/Users/ccheever/.volta/.../24.18.0/bin/node`),
Playwright 1.62.1 chromium from the shared cache (reached through the lane's
existing `choreography/node_modules`; nothing was installed into
`instrument/`).

Ports 49600–49619 were confirmed free before start (`lsof -nP -iTCP:49600-49619
-sTCP:LISTEN` → none listening). Processes started by this session, and the
only ones killed at the end:

| PID | Process | Port |
|---|---|---|
| 23301 | `node --import ./server/register-env.mjs server/index.mjs` (lane API) | 49600 |
| 93481 | `npx expo start --web --port 49601 --non-interactive` (lane web client) | 49601 |

No `pkill`/`killall` was used at any point.

**State note.** The lane's teardown had already dropped its schema and deleted
its storage bucket (`artifacts/drop-prefix.json`: `droppedAt`,
`bucketDeletedAt`, `verifiedEmptyAt`). The lane's `start()` re-applies
`server/schema.sql` and re-creates the bucket on boot, so the backend
self-healed; I then ran the lane's documented seed
(`npm run seed -- --segment m3`), which installed the M1+M2+M3 starter-log
segments and self-reported `seed idempotent ok segment=m3`.

**Builder evidence preserved.** The lane's acceptance entrypoint overwrites
`receipts/` and `coverage-manifest.json`. Before running it I copied the
builder's originals to `grading/evidence/builder-originals/` (receipts,
coverage manifest sha256 `38e1c81c…2ac3`, artifacts); every builder-side claim
quoted below is read from that snapshot.

**Harness copy.** The lane's `choreography/` is byte-identical to the frozen
`instrument/choreography/` for `choreography.mjs`, `control-lane.mjs`,
`self-test.mjs`, `startup.test.mjs`, `receipts.schema.json`, `package.json` and
the three `w9-*` hosts. The only difference is `setup-identity.mjs`, whose sole
diff is an import path (`../../lib/json-schema.mjs` → `./json-schema.mjs`) with
the helper vendored beside it — a layout fix, not a change to scoring logic.

---

## 2. Phase 1 — the builder's acceptance suite, run by me from a clean state

The documented entrypoint is `npm run acceptance -- --milestone mN`
(`package.json`), which runs `scripts/acceptance.mjs` against the running API.
I ran all seven milestones the lane implements, in order, in one pass
(`grading/evidence/grader-suite-run1.log`).

| Milestone | Builder's receipt (snapshot) | My run | Divergence |
|---|---|---|---|
| m1 | PASS | **PASS** | — |
| m2 | PASS | **PASS** | — |
| m3 | PASS | **FAIL** — `seed-idempotent` | yes |
| m4 | PASS | **PASS** | — |
| m5 | PASS | **PASS** | — |
| m6 | PASS | **PASS** | — |
| m8 | PASS | **FAIL** — `trending: recent present` | yes |

### 2.1 m3 `seed-idempotent` (m3-a15) fails reproducibly

```
FAIL seed-idempotent: drift {"before":{... "followEdges":12 ...},
                             "after" :{... "followEdges":13 ...}}
```

Replaying the starter-log segments a second time **adds a follow edge**. Root
cause, in `server/service.mjs:344-374`: the follow mutation-idempotency guard is
`select * from clqfg_follows where tenant=$1 and mutation_id=$2` — the mutation
id is stored *on the edge row*, and `op:"clear"` **deletes that row**
(`delete from clqfg_follows where …`, line 364-367). Once any seeded edge has
been cleared, the original `set` mutation id is no longer on record, so
replaying that `set` re-inserts the edge. The M2 suite's own
`follow-feeds` case clears a seeded edge (`service.follow(bob,"alice","clear",…)`),
so running the documented suite in its documented order is sufficient to make
the next `seed-idempotent` check fail. `like`, `repost` and `react` carry the
same pattern (`service.mjs:495`, `:535`, `:1142` — mutation id stored on a row
the clear deletes).

This is also a direct violation of the brief's **write-idempotency global
ruling** ("toggle-shaped operations … carrying client-generated mutation IDs, so
at-least-once delivery and offline-queue retry can never invert intended
state"). Demonstrated end-to-end through the HTTP API
(`grading/evidence/probe-api-run1.log`, probe `tb-idempotent-set-state`):

```
POST /posts/<id>/like {op:set,   mutationId:M}  -> likeCount 1
POST /posts/<id>/like {op:clear, mutationId:M-c}-> likeCount 0
POST /posts/<id>/like {op:set,   mutationId:M}  -> likeCount 1   # retry of the FIRST intent
```

The retry of an already-applied `set` re-likes the post after the user cleared
it — exactly the state inversion the ruling forbids.

### 2.2 m8 `trending` fails reproducibly

```
FAIL trending: recent present
```

The mapped test asserts that a post with **zero** likes appears in a
`limit 10`, `order by like_count desc` list. On a corpus that already has ten
posts with ≥1 like in the trailing 24 h — which the documented m1→m8 suite order
produces — the assertion cannot hold. The *product* behaviour is correct here
(§4.8); the *test* is order-dependent.

I re-ran both failures once to confirm they are not environment flakes; both
reproduce (§2.1's mechanism is deterministic given the M2 suite's unfollow, and
§2.2's is deterministic given ≥10 liked posts in the window).

---

## 3. Phase 2 — coverage-manifest spot-verification

The lane's `coverage-manifest.json` maps every suite-required assertion of
M1–M6 and M8 to `scripts/acceptance.mjs#<milestone>`. The mappings are
*complete* (every suite-required id appears) and the file is regenerated by the
suite itself, so the interesting question is the one the grader prompt asks:
does the mapped test actually exercise the assertion's observable?

I read `scripts/acceptance.mjs` in full and sampled 14 mappings across all
seven milestones, choosing the ones whose observable is easiest to fake:

`m1-a03`, `m1-a10`, `m1-a11`, `m2-a12`, `m2-a13`, `m2-a22`, `m2-a24`,
`m3-a11`, `m3-a15`, `m5-a11`, `m6-a11`, `m6-a13`, `m8-a06`, `m8-a07`.

**Verdict: dishonest**, on M8. Two M8 mappings are categorically non-exercising:

- **m8-a06** — *"An older heavily-liked post (>24 h) is absent from Trending."*
  The mapped case (`acceptance.mjs`, `trending`) creates three posts **seconds
  before** the assertion and then asserts `ids.includes(p2.id) && ids.includes(p3.id)`
  — i.e. that two *recent* posts are **present**. No post older than 24 h exists
  anywhere in the test. If the implementation dropped the 24-hour filter
  entirely the mapped test would be *more* likely to pass, not less.
- **m8-a07** — *"A like-count tie in Trending breaks newest-first."*
  In the mapped case `p1` has 2 likes, `p2` has 1 and `p3` has 0. **No tie is
  ever constructed**, and the only ordering assertion is on the top item
  (`tr.items[0].id === p1.id`), which is m8-a05's observable. Nothing in the
  test can observe the tie-break rule.

Per the frozen rule, a dishonest mapping adjudicates its milestone to
`capability-failure` — scoring-only and non-retroactive. That applies to **M8**.
I verified independently (§4.8) that the *product* satisfies both m8-a06 and
m8-a07; the adjudication is about the coverage claim, not the feature.

**Weak-but-not-adjudicated mappings**, recorded for the record because they
came close to the line and a future wave should tighten them:

| Assertion | Mapped test does | Judgement |
|---|---|---|
| `m1-a10` "uploading a fixture avatar succeeds" | performs **no upload**; asserts the seeded profile has an `avatar_path` | weak proxy — the seed's `profile-set` replay does perform the upload through the app's write path, so the observable is transitively exercised |
| `m1-a11` "avatar renders on the profile" | asserts `publicProfile(p).avatarUrl` is non-null | weak proxy — a non-null string is not a render; verified independently in §4.1 |
| `m2-a12` / `m2-a13` link rendering / no unfurl | greps `ui/src/linkify.tsx` for `https?:` and `app/index.tsx` for absence of `og:image`/`unfurl` | weak proxy; the negative (no-unfurl) form is defensible, the positive one is not. Verified independently in §4.3 |
| `m3-a11` "tapping the quoted excerpt jumps" | greps `ConversationScreen.tsx` for `scrollIntoView` **or** `msg-` | very weak (the `msg-` disjunct is near-vacuous), but the referenced code at `ConversationScreen.tsx:137,154-156` genuinely implements the jump, so the mapping points at real behaviour. Verified independently in §4.5 |
| `m2-a22` Following-tab pagination | asserts `f1.items.length <= 20` (vacuous) and only fetches page 2 conditionally | weak |
| `m2-a24` "no duplicates **and no gaps**" | checks duplicates on the Global tab; **gaps are never checked** in either tab | partial |

None of these are adjudicated: each either points at real implementing code or
transitively exercises the observable, and each is independently verified below.

A separate structural point about the suite as a whole: most cases call
`service.*` **in-process** rather than going through the HTTP API. That still
drives the app's own write path, so it is inside the rules, but it means no
suite-required assertion with a UI clause ("visible error", "renders",
"scrolling loads") is actually observed by the suite. That is why phase 3 below
leans on browser automation.

---

## 4. Phase 3 — independent execution of the checklist

`[choreo]` assertions are **not** re-driven by me: per the frozen prompt they are
scored only from the harness's recordings and structured receipts (§5).
Everything below is my own execution — HTTP API probes
(`grading/probe-api.mjs`, `probe-timed.mjs`, `probe-trending.mjs`,
`probe-convview.mjs`, `probe-latency.mjs`, `probe-load.mjs`,
`probe-profile500.mjs`, `probe-avatar.mjs`) and Playwright on the web build
(`probe-web2.mjs`, `probe-web3.mjs`), with screenshots in
`grading/evidence/shots/`. Grading ran against the fixture pack's
**shortened-windows** config, which the lane already ships verbatim
(`config/windows.json` and `config/digest.json` are byte-identical to
`fixtures/config/windows.shortened.json` / `digest.shortened.json`:
edit 60 s, delete-for-everyone 120 s, disappearing 24h→180 s, digest period
120 s).

### 4.0 A single root cause behind most of what follows

Two structural problems account for the majority of the web-side failures, so
they are stated once here and referenced below rather than repeated.

**(a) Connection-pool exhaustion → HTTP 500 on the read path.**
`server/db.mjs:20-27` builds `new pg.Pool({ max: 20 })` against
`DIRECT_URL`, which points at Supabase's **session-mode** pooler on port 5432
whose ceiling is **15** clients. Several read paths then fan out *in parallel*
across that pool — `userPosts` does
`Promise.all(rows.map(r => this.postView(...)))` over **all** of a user's posts
with no pagination (`service.mjs:651-665`), and each `postView` issues three
more queries (`service.mjs:460-474`); `thread()` has the same shape.

Measured (`grading/evidence/probe-load.log`):

| parallel `GET /feeds/global?limit=20` | 200s | failures |
|---|---|---|
| 1 | 1/1 | — |
| 5 | 5/5 | — |
| 10 | 10/10 | — |
| 20 | **15/20** | 5 × HTTP 500 `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15` |

And at concurrency **one** (`grading/evidence/probe-latency.log`), best-of-3:

```
200   346ms  /me
200  2103ms  /conversations
200   552ms  /conversations/d-alice-bob
200  9096ms  /conversations/d-alice-bob/messages?limit=50
200  5335ms  /feeds/following?limit=20
200  5104ms  /feeds/global?limit=20
200  1073ms  /insights
500   828ms  /profiles/alice        <-- 3/3 attempts
```

`GET /profiles/:handle` returns **HTTP 500 for an active author** with no
concurrent load at all, because the parallel fan-out alone exceeds the pooler.
`app/profile/[handle].tsx:16-19` then **polls that endpoint every 400 ms**, so
the own-profile screen never leaves its placeholder state (screenshot
`grading/evidence/shots/m1-profile2.png`: the signed-in user's own profile shows
`0 Followers 0 Following`, no bio, and a **Follow** button on herself, because
`data` is null). Load averages while measuring: 16–28.

**(b) Two React copies in the web bundle.**
`metro.config.js:6-9` adds `ui/node_modules` to `resolver.nodeModulesPaths`
without aliasing `react`/`react-native` back to the app's copies. The vendored
UI kit carries its own `react@19.2.3` / `react-native@0.86.2` devDependencies
while the app uses `react@19.1.0` / `react-native@0.81.5`. The result is a
second React instance in the bundle; the browser console during grading
recorded:

```
Invalid hook call. Hooks can only be called inside of the body of a function component…
TypeError: Cannot read properties of null (reading 'useRef')  (expo-router/entry.bundle)
```

which raises Expo's full-screen `#error-overlay` and makes the affected screens
unusable until reload.

**(c) Contract test IDs shadowed by injected no-op buttons.**
`app/_layout.tsx:13-38` imperatively appends a `position:fixed; z-index:9999`
bar to `document.body` containing three `<button>` elements carrying the
harness's contract test IDs `sm-feed-tab-following`, `sm-feed-tab-global`,
`sm-feed-tab-trending` — each with **`b.onclick = () => {}`**, a no-op. The real
`FeedTabs` component is rendered separately. Any automation that selects those
contract test IDs therefore has a 50 % chance of driving a dead control, and
because the injected bar is `z-index:9999` it intercepts pointer events for
those selectors; Playwright reported exactly that:
`<button data-testid="sm-feed-tab-global">Global</button> from <div
id="clqfg-feed-tabs">…</div> subtree intercepts pointer events`. The bar is also
visible to users as a duplicated tab row across the top of the app
(`grading/evidence/shots/m1-profile2.png`). I re-ran the affected checks by
selecting only controls **outside** `#clqfg-feed-tabs` (§4.3).

### 4.1 M1 — accounts and profiles

| id | executor | my result | evidence |
|---|---|---|---|
| m1-a01/a02 | suite | **pass** | UI signup with an 8-char+ password landed in the authenticated shell (`shots/m1-signup.png`); suite `signup-succeeds-authenticated` also passes |
| m1-a03 | suite | **pass** | `POST /auth/register` with an existing handle → `409 "Handle already taken"`. Note: the **web signup form exposes no handle field** (`ui/src/AuthForm.tsx`; the handle is derived from the email local part), so the duplicate-handle path is reachable only through the API; the visible-error surface itself exists and works (below) |
| m1-a04 | suite | **pass** | duplicate-email signup in the browser rendered `sm-auth-error` = *"Email already registered"* (`shots/m1-dup-email-error.png`) |
| m1-a07 | grader/api | **pass** | pre-logout `GET /me` → 200; `POST /auth/logout`; post-logout `GET /me` → **401 "Session revoked"**. Server-side revocation is real (`service.mjs:216-231` records `clqfg_revoked_sessions` and compares against Supabase's `last_sign_in_at`) |
| m1-a08 | suite | **fail** | The *persistence* is correct — after the edit, `GET /me` returns the new display name and bio. The assertion's observable ("updated values shown on own profile") **fails**: `/profile/alice` keeps polling `GET /profiles/alice`, which returns HTTP 500 (§4.0(a)), so the screen stays in its placeholder for 30 s+ of retries, showing `0 Followers 0 Following`, no bio, and a **Follow** button on the signed-in user's own profile (`shots/m1-profile2.png`) |
| m1-a10 | suite | **pass** | the seed's `profile-set` replay uploads `media/avatar-alice.png` through the app's own write path and the stored `avatar_path` resolves; the asset itself serves correctly (below) |
| m1-a11 | suite | **fail** | The asset layer is fine — `GET /media/<avatar>` returns `200 image/png, 729 bytes` with a Bearer token *and* with the `?access_token=` form, and correctly **401s unauthenticated**. But the profile screen never renders (same 500 loop), so `sm-profile-avatar` is never present and the avatar does not render on the profile |
| m1-a12 | grader/source | **pass** | Passwords are handed to **Supabase Auth** and never touched by the lane: `service.mjs:158-162` `admin.auth.admin.createUser({email, password, …})`, `service.mjs:204` `anon.auth.signInWithPassword(…)`. Supabase Auth is a managed provider whose documented KDF is bcrypt; the lane uses the documented provider path, not provider internals |
| m1-a13 | grader/source | **pass** | `server/schema.sql` has no password column of any kind (`grep -n password server/schema.sql` → no matches); the only occurrences of `password` in `app/`, `src/` and `ui/src/` are form state and the two API call sites that forward it. No password is logged: the API logs only its listen line |

### 4.2 M1/M2/M3/M4/M5/M6 — where my result agrees with the suite

The following suite-required assertions passed both in the lane's suite and in
my own run of it, and I did not find contrary evidence:
m2-a01, m2-a02, m2-a03, m2-a06, m2-a08, m2-a09, m2-a10, m2-a11, m2-a15,
m2-a18, m2-a20, m2-a21, m2-a25, m2-a26, m2-a27; m3-a03, m3-a04, m3-a05,
m3-a14; m4-a01, m4-a03, m4-a06, m4-a07; m5-a04, m5-a05, m5-a08;
m6-a08, m6-a09, m6-a10, m6-a11, m6-a13.

### 4.3 M2 — posts and the follow graph

| id | my result | evidence |
|---|---|---|
| m2-a12 | **pass** | The composed URL renders as `sm-text-link` with `role=link`, `text-decoration: underline`, `color: rgb(37,99,235)`, and clicking that node calls `window.open("https://example.com/tap-…")` — i.e. tappable text handed to the system browser (`app/index.tsx:117-120`, `ui/src/linkify.tsx`) |
| m2-a13 | **pass** | No `og:image`, `unfurl`, `preview-card` or `link-preview` markers anywhere in the rendered feed DOM; nothing but the styled text span is emitted for the URL |
| m2-a16 | **pass** | reposting from the UI rendered `sm-feed-repost-attribution` = **"↻ Reposted by Bob Bennett"** |
| m2-a17 | **pass** | `POST /posts/<id>/repost {op:set}` → `repostCount 1`; the toggle-off intent → `repostCount 0` |
| m2-a22 | **fail** | Following tab. See below |
| m2-a23 | **fail** | Global tab. See below |
| m2-a24 | **pass** | I paged both feeds to exhaustion via the API: **global** 3 pages / 55 entries, **following** 2 pages / 33 entries, **0 duplicates** and **0 gaps** (every entry visible in a single 50-item page also appeared in the paged walk) |
| m2-a04 | **fail** | choreography artifact (§5) |
| m2-a05, m2-a07, m2-a14, m2-a19 | **not-run** | no choreography evidence exists (§5) |

**m2-a22 / m2-a23 — scrolling never loads the next page.** The feed genuinely
is in a scrollable container (`overflow-y: auto`, `clientHeight 625`,
`scrollHeight 2910`), and I drove it three ways: programmatic `scrollTop =
scrollHeight` with a synthetic `scroll` event, four passes; the same after
clicking the **real** `FeedTabs` control rather than the shadowed one; and
**25 real `page.mouse.wheel` scrolls** over the feed. Every time the result was
identical: **20 items in, 20 items out**
(`grading/evidence/probe-web-v4.log`, `shots/m2-wheel.png`).

The mechanism is in `src/store.tsx:164-168`:

```js
const t = setInterval(() => {
  loadFeed(feedTab, 0, false).catch(() => {});   // offset 0, append = false
  loadConversations().catch(() => {});
}, 1000);
```

A **1 Hz non-appending reload of page 1** runs for as long as a user is signed
in, so whatever `loadMoreFeed()` appends is discarded within a second. The
API side is fine — `GET /feeds/global?limit=20&offset=20` returns the correct
second page with a correct `nextOffset` — it is the client that cannot hold on
to it.

That same interval is the demand side of §4.0(a): at ~5.1 s per `/feeds/*` and
~2.1 s per `/conversations`, a 1 Hz poll leaves roughly seven request chains in
flight per signed-in client, each fanning out several pool acquisitions. Two
browser contexts — which is exactly what two-client choreography opens —
saturate a 15-connection ceiling. The lane already ships an SSE stream
(`GET /events`, `server/index.mjs:263-279`) that this polling loop does not use.

### 4.4 M4 / M5 — windows, revocation, ephemerality (grader-class, shortened config)

| id | my result | evidence |
|---|---|---|
| m4-a10 | **pass** | edit **inside** the 60 s window → `200`; the same message edited after the window → **403 "Edit window expired"**. The check is server-side against server time (`service.mjs:1168-1171`), and a caller-supplied `createdAt` is ignored (probe `tb-client-timestamp`: a body carrying `createdAt: 2020-01-01` stored `2026-09-07T00:55:51Z`) |
| m4-a12 | **pass** | image message sent; recipient `GET /media/<path>` → `200` before the delete, **404 "Media not found"** after `POST /messages/<id>/delete`. `service.mjs:1191-1201` removes the object from storage *and* nulls `media_path` |
| m5-a01 | **pass** | DM set to disappearing (`24h` → 180 s under the shortened config); after expiry the message is **absent from `GET /conversations/:id/messages`** for the recipient — the server refuses it (`service.mjs:1087` filters `expires_at > now()`) |
| m5-a03 | **pass** | after expiry, server-side global message search returns **0 hits** for the expired token (`service.mjs:1344`), and the client's search screen surfaced none either |
| m5-a04 | **pass** | first view-once open → `200` with image bytes |
| m5-a05 | **pass** | second open by the same recipient → **403 "Already opened"** |
| m5-a06 | **pass** | the recipient is never given a `mediaPath`/`mediaUrl` for a view-once message at all, and `authorizeMedia` refuses any path belonging to a `view_once` row unconditionally (`service.mjs:1241`) — so a direct asset fetch is refused server-side both by construction and by rule |
| m5-a09 | **pass** | People-scope search `car` → **Carol Chen (@carol)**; `CHE` (uppercase, surname word-prefix) → **Carol Chen** — case-insensitive word-prefix matching confirmed |
| m5-a10 / m5-a11 | **pass** | `coffee` returned 3 results grouped under 2 chat headings (`Weekend Plans`, the DM partner's display name) |
| m5-a02 | **fail (inconclusive-leaning-fail)** | see below |

**m5-a02 — client purge.** The rule is server-authoritative refusal *plus*
client purge at the next sync. The server half passes (m5-a01/m5-a03). The
client half I could not confirm: in the run that reached it, the conversation
screen had never rendered the message in the first place (`visible before
expiry = false`), so "purged" and "never displayed" are indistinguishable. I
re-ran the conversation screen in isolation (§4.5) and it still would not load
its history. I record m5-a02 as **fail** because I could not observe the
required behaviour, and I state plainly that the cause is the screen not
loading rather than a demonstrated failure to purge.

### 4.5 M3 — the conversation screen crashes in the web build

Navigating to `/conversation/bob` in a clean browser context, after removing the
injected overlay of §4.0(c) so it could not be blamed, and waiting **80
seconds**, produced:

```
message bubbles rendered = 0
sm-convo-input elements   = 0
screen text               = "! Cannot read properties of null (reading 'useRef')
                              … Log 1 of 1 Uncaught Error Cannot read prop…"
```

(`grading/evidence/probe-web-v5.log`, `shots/m3-convo-load.png`). Reproduced in
**three independent browser sessions**.

The cause is §4.0(b) narrowed to one component. `ui/src/TypingIndicator.tsx` is
the **only** component in the vendored UI kit that calls React hooks
(`useRef` at line 41, `useEffect` at line 43), and it is rendered from exactly
one place: `src/components/ConversationScreen.tsx:218`. Because
`metro.config.js` lets the kit resolve `react` from `ui/node_modules/react`
(19.2.3) while the app renders with `react` 19.1.0, that component's hook call
reaches a null dispatcher and throws. Every screen that does **not** mount
`TypingIndicator` — feed, search, insights, profile-edit — renders fine, which
is exactly the pattern I observed.

The consequence is that **the messaging screen of a messenger is unusable in
the web build**, and it accounts for the whole M3 choreography segment failing
(`dm-live-messages`, `typing-indicator-…`, `receipt-…-transitions`,
`group-receipt-…`, `member-add-promote-remove-…`, `quoted-reply-…` — every one
of them has to open a conversation).

Assertion consequences, recorded honestly as "the specified observable could not
be observed", with the server-side behaviour noted where it is correct:

| id | result | note |
|---|---|---|
| m3-a10 | **fail** | the API *does* produce the quoted excerpt correctly (`sendMessage` with `quoteId` returns `quote.excerpt` containing the original text, and the suite's `quoted-reply` case passes on that) — but the bubble never renders |
| m3-a11 | **fail** | UI-only observable; the jump handler exists and is correct in source (`ConversationScreen.tsx:137,154-156`: `document.getElementById('msg-'+quote.id)?.scrollIntoView({block:'center'})`) but cannot be exercised |
| m4-a09 | **fail** | `POST /messages/:id/edit` sets `edited_at` and the API returns `edited: true` with the new text; the `edited` label lives in `ui/src/MessageBubble.tsx:198` and cannot render |
| m3-a02 | **not-run** | choreography check was `implemented:false`/skipped, and I do not re-drive choreo assertions |

### 4.6 M6 — push seam and the custom-client API

| id | my result | evidence |
|---|---|---|
| m6-a08 | **pass** | with the recipient's presence at 0, sending logs a push payload with `targetUserId`, `chatId`, `senderDisplayName` and an 80-char text preview (`service.mjs:961-981`) |
| m6-a09 | **pass** | a view-once photo logs `preview: "Photo"` |
| m6-a10 | **pass** | `scripts/custom-client-demo.mjs` ran green in my own suite run |
| m6-a11 | **pass** | the demo exercises authenticate → list conversations → page history → send text → observe the send by documented polling; all five listed operations appear |
| m6-a12 | **pass** | **My own variation, written from `API.md` alone**: `GET /conversations`, pick the one titled *Weekend Plans*, `GET /conversations/<id>/messages?limit=1`. It returned `sm0015 @ 2026-09-07T00:49:21Z`, which is exactly the newest message in the full 50-item page. API.md's "page history, newest page" was enough to get this right first try, though it does not state the within-page ordering (which is oldest→newest) — I had to discover that by comparing |
| m6-a13 | **pass** | the 50-action conformance sample replayed green in my run (50 actions, all settled); all 13 frozen action-schema verbs have handlers (§6) |
| m6-a01…a07 | **not-run** | no simulator artifact exists (§5) |

### 4.7 M7

M7 was never attempted: there is no `m7` runner in `scripts/acceptance.mjs`
(`const runners = { m1, m2, m3, m4, m5, m6, m8 }`), no `m7-suite.json`, and no
M7 choreography receipt. All nine M7 assertions record **not-run**, including
m7-a08's snapshot comparison — there is no pre-M7 snapshot to compare against.

### 4.8 M8

Independently verified through the app's own read paths:

- **m8-a01** — the Insights screen renders all six lifetime totals (posts,
  likes received, reposts received, replies received, followers, following)
  (`shots/m8-insights3.png`).
- **m8-a03 / m8-a04** — the 7-day breakdown renders exactly **7 day rows**,
  today first, with the zero days rendered as `Posts 0 / Likes received 0`
  rather than omitted.
- **m8-a05** — a 4-like post created inside the window ranks first in
  `GET /feeds/trending`.
- **m8-a06** — a **5-like** post aged to **30 hours** old is **absent** from
  Trending while the 4-like recent one leads it (`service.mjs:624-636` filters
  `created_at > now() - interval '24 hours'`). To age a row I updated one
  `created_at` through the app's own pool — there is no API affordance for
  creating an old post — and then read only through the app's read path.
- **m8-a07** — two posts tied at 2 likes: the later-created one ranks **first**
  (`order by like_count desc, created_at desc`).
- **m8-a08** — under the 120 s shortened digest period, closed-client activity
  produced digest payloads carrying `targetUserId`, `newFollowers`,
  `newPostsInFollowing`, `unreadMessages`, `unreadChats`; across 32 logged
  digest entries there were **zero duplicate `(user, period)` pairs**.
- **m8-a09 / m8-a10** — a user with no relevant activity in a period gets no
  digest: `service.mjs:1480-1482` skips emission when all four counters are
  zero, and no all-zero payload appeared in any logged digest.
- **m8-a12** — Carol's digests for the periods in which Alice and Bob were
  messaging each other privately show `unreadMessages: 0, unreadChats: 0`; the
  unread query is scoped by a `clqfg_members` join on the target user
  (`service.mjs:1454-1468`), so a chat the user is not in cannot contribute.
- **m8-a11** — the digest table's primary key is
  `(tenant, user_id, period_start)` and the emitter checks for an existing row
  before computing, so a restart inside a period cannot re-emit. I note one
  reachable gap rather than a demonstrated failure: the existence check and the
  `push_log` insert are not in one transaction, so two *concurrent* runs could
  both pass the check and write two `push_log` rows even though only one digest
  row survives. Reachable because `POST /internal/digest` is unauthenticated
  (defect d-03).

**M8's checklist is nevertheless scored not-passed for O1**, because the
milestone is adjudicated `capability-failure` on the dishonest coverage mapping
(§3). That adjudication is about the coverage claim; the features above do work.

---

## 5. `[choreo]` assertions — scored only from harness artifacts

Per the frozen prompt these are never re-driven by the grader. The lane's
receipts (builder snapshot, `grading/evidence/builder-originals/receipts/`)
contain choreography JSONL for **M1, M2 and M3 only**; there is none for M4,
M5, M6 or M8, and none for M7.

**M1 — `m1-choreo.jsonl`, segment summary `green: true`.**

| harness check | assertion | result | timings |
|---|---|---|---|
| `profile-edit-live-visibility` | m1-a09 | passed, bestOf 3 | visibleMs **2281.4 / 817.1 / 1122.6** → best **817 ms** |
| `session-persists-on-relaunch` | m1-a05 | passed | 925 ms |
| `logout-remains-signed-out-on-relaunch` | m1-a06 | passed | 2602 ms |

Segment summary: 3/3 required assertions passed, suite receipt hash-linked,
`browserPass: true`, `green: true`, `nonGreenCause: null`.

**M2 — `m2-choreo.jsonl`: three assertion records, and *no segment summary*.**

| harness check | assertion | result |
|---|---|---|
| `feed-text-post-live-update` | part of m2-a04 | passed (attempt waits 17195 / 14880 / 20009 ms; the third attempt timed out) |
| `feed-image-post-live-update` | part of m2-a04 | **failed** — 3 × ~20 000 ms timeout |
| `feed-video-post-live-update` | part of m2-a04 | **failed** — 3 × ~20 000 ms timeout |

The harness declares five more M2 checks (`follow-unfollow-live-projection`,
`feed-author-avatar-and-display-name`, `like-unlike-live-count`,
`repost-toggle-live-attribution`, `repost-following-feed-surface`,
`reply-live-thread-projection`) — none of them produced a receipt line, and the
segment produced no summary record, so the M2 choreography run ended early.
m2-a04 is **failed** (it requires *all three* post kinds to appear live);
m2-a05, m2-a07, m2-a14 and m2-a19 have **no evidence at all** and are recorded
`not-run`.

Note that the fastest *passing* live-feed observation the harness recorded is
**14.9 s**, against a check budget of 20 s — consistent with the 5.1 s
`GET /feeds/*` measured in §4.0(a) plus the injected dead tab controls of
§4.0(c).

**M3 — `m3-choreo.jsonl`, segment summary `green: false`,
`nonGreenCause: "choreography-failed"`, 0 passed / 6 failed / 1 skipped.**

| harness check | assertion(s) | result |
|---|---|---|
| `dm-live-messages` | m3-a01 | **failed** (3 attempts) |
| `sender-avatar-identity-when-rendered` | m3-a02 | skipped, `implemented: false`, `required: false` |
| `typing-indicator-within-2s-expires-within-5s` | m3-a06, m3-a07 | **failed** (3 attempts) |
| `receipt-sent-delivered-read-transitions` | m3-a08 | **failed** |
| `group-receipt-waits-for-slowest-member` | m3-a09 | **failed** |
| `member-add-promote-remove-leave-and-live-cutoff` | m3-a12, m3-a13 | **failed** |
| `quoted-reply-excerpt-and-jump` | (harness copy of m3-a10/a11) | **failed** |

**M4, M5, M6, M8 — no choreography receipts exist.** Their `[choreo]`
assertions are recorded `not-run`: m4-a02/a04/a05/a08/a11, m5-a07/a12,
m6-a01…a07, m8-a02/a13…a18.

**Native / simulator artifacts.** `receipts/simulator-status.json` records both
M6 and M8 simulator proofs as `pass: false`, `receipt: null`, reason *"iOS
Hermes bundle export failed (hermesc private properties); simulator proof not
run; **not faked**"*. `artifacts/ios-export-m1.log` and `-m2.log` show the
underlying cause: `hermesc … exited with non-zero code: 2`, repeated
`error: private properties are not supported`. `artifacts/ios-hermes/` is
**empty**, so the brief's per-milestone "iOS Hermes bundle export as a build
artifact" was not produced for any milestone. I record this as a
straightforwardly honest negative result by the lane — the status file says
plainly that the proof was not run and not fabricated — while noting that the
artifact the brief requires does not exist.

**Consequence for M6's status and for O3/O4.** A milestone's green receipt
requires its web choreography segment. M6 has no choreography receipt at all,
no segment summary and no simulator artifact, so **M6 is not green**.
`applicability.json` makes O3 conditional on `m6-green-and-m1-m5-attempted` and
O4 conditional on `m6-green`; both therefore record **null**. (O3 would in any
case have had no scoring input this wave — see deviation 1.)

---

## 6. Scale replay and O5

The replay **was attempted** — `artifacts/scale-replay.log` records
`scale-replay start=1788652491 tenant=scale` and `starter seeded on scale
tenant` — and then aborted:

```
error: (EMAXCONNSESSION) max clients reached in session mode -
       max clients are limited to pool_size: 15
    at async applySchema (server/db.mjs:46:3)
    at async scripts/scale-replay.mjs:18:1
```

The failure is the §4.0(a) pool ceiling again, this time at schema application,
before a single one of the scale log's actions replayed. Consequences, all
verified by absence:

- `artifacts/scale-replay.json` — the script's own end-of-run report, which is
  where `counts` would be compared against
  `fixtures/invariant-manifest-combined.json` — **does not exist**.
- No checkpoint records at 10 % or 50 % exist anywhere in the lane (the
  scale log does carry the `10%`/`50%` markers, and
  `scripts/scale-replay.mjs:33-36` would have logged them).
- No performance-probe results, p95 samples, or named-fixture checks
  (celebrity follower count, probe user's 500 follows, busy group's 50-member
  roster) exist.

O5's band function is evaluated **first-match in the order 0, 30, 60, 90, 75**.
The first branch is *"invariant manifest does not conform (including a
named-fixture mismatch) OR replay's wall cap was exhausted"*, and the brief is
explicit that "a fixture mismatch, like any manifest nonconformance, caps O5 at
its failure band (0) — performance is never scored on an artifact that did not
validly reach the envelope, nor against an underfilled workload." A replay that
never created the corpus cannot conform to the manifest, so **O5 = band 0**.

Two secondary observations recorded but not scored, since the band is already
determined:

- The replay targets a `scale` **tenant column** on the same hosted Supabase
  project as the dev data, rather than the "fresh backend instance" the replay
  contract calls for. The lane documents this as an isolated instance
  (`API.md`, `X-Clique-Tenant: dev|scale`); it is a defensible reading of
  "instance" but it is not a separate backend.
- The replay adapter itself is complete against the frozen action schema: all
  13 verbs in `fixtures/action-schema.json` (`register`, `profile-set`,
  `follow`, `post`, `like`, `repost`, `reply`, `dm-create`, `group-create`,
  `member-add`, `send`, `send-media`, `react`) have handlers in
  `server/replay.mjs`, and the 50-action conformance sample replayed green in my
  own run (m6-a13). The adapter is not the problem; the connection pool is.

---

## 7. Defects found beyond the checklist (O2's input)

Severity uses the report's vocabulary; MATERIAL = blocker or major.

**d-01 — blocker — any authenticated user can read a conversation they are not
a member of, including its last message body and full member roster.**
`GET /conversations/:id` never checks membership: `conversationView`
(`server/service.mjs:807-818`) loads the conversation and its members and never
calls `requireMember`, unlike the message-history, send, typing and settings
paths which all do. Observed (`grading/evidence/probe-convview.log`): Carol,
who is not in the Alice↔Bob DM, received `200` with the full member roster
(display names, handles, avatar URLs, backend user ids) and
`lastMessage.body = "PRIVATE-SECRET-STRING-for-grader-probe"`. A non-member also
reads a group's roster and metadata the same way. History (`403 Not a member`),
sending (`403`) and message search (0 hits) are correctly protected — this is
one missing check on one endpoint, but the data it exposes is exactly the
private content the trust boundary exists to protect.

**d-02 — blocker — `GET /internal/push-log` is unauthenticated and returns every
user's push payloads.** `server/index.mjs:288-291` mounts it outside the `auth`
middleware. Unauthenticated `GET /internal/push-log?tenant=dev` returned `200`
with 31 rows carrying `target_user_id` and `payload` — including message
previews (the first 80 characters of message text) and digest counts for every
persona. Evidence: `grading/evidence/probe-api-run1.log`, probe
`tb-internal-push-log`.

**d-03 — major — `POST /internal/digest` is unauthenticated.**
`server/index.mjs:293-296`. An unauthenticated `POST` returned `200` and ran the
digest emitter. Besides being an unauthenticated write, it is the reachable path
to the non-atomic `exists`-check/`push_log`-insert pair described in §4.8, so it
is also the way m8-a11's guarantee could be broken.

**d-04 — blocker — the DM/group conversation screen crashes in the web build.**
Duplicate React (`metro.config.js:6-9` + `ui/node_modules/react@19.2.3` vs
`node_modules/react@19.1.0`) makes `ui/src/TypingIndicator.tsx`'s `useRef` throw
`Cannot read properties of null (reading 'useRef')`. Reproduced in three
independent sessions; §4.5. This is why the entire M3 choreography segment
failed.

**d-05 — blocker — `GET /profiles/:handle` returns HTTP 500 for an active
author, with no concurrent load.** `userPosts` (`service.mjs:651-665`) fans out
`Promise.all` over **all** of a user's posts with no pagination, each
`postView` issuing three more queries, against a `pg.Pool({max:20})`
(`db.mjs:20-27`) pointed at a session-mode pooler capped at 15. Three of three
sequential attempts returned `500 (EMAXCONNSESSION)`. Because
`app/profile/[handle].tsx:16-19` polls that endpoint every 400 ms, the profile
screen — including the signed-in user's own — never leaves its placeholder.
§4.0(a), `grading/evidence/probe-latency.log`, `probe-load.log`.

**d-06 — major — the write-idempotency global ruling is violated for every
toggle operation.** `follow`, `like`, `repost` and `react` store the client
mutation id **on the row that a `clear` deletes** (`service.mjs:349-367`,
`:495-517`, `:535-555`, `:1142-1155`), so the guard cannot recognise a replayed
`set` after a `clear`, and the retry re-applies it. Demonstrated over HTTP:
`set(M) → 1`, `clear → 0`, `retry of set(M) → 1`. The brief requires that
at-least-once delivery and offline-queue retry "can never invert intended
state". This also makes the seed non-idempotent and is the direct cause of
m3-a15 failing (§2.1).

**d-07 — major — a 1 Hz full-feed poll defeats pagination and saturates the
connection pool.** `src/store.tsx:164-168` reloads page 1 of the feed *and* the
conversation list every second for every signed-in client, non-appending. It
discards anything infinite scroll appends (m2-a22/a23 fail, §4.3) and it is the
demand side of d-05. The API already exposes an SSE stream (`GET /events`) that
this loop does not use.

**d-08 — major — the app injects duplicate contract test IDs bound to no-op
buttons, in a `z-index:9999` fixed overlay.** `app/_layout.tsx:13-38` appends
`<button data-testid="sm-feed-tab-following|global|trending">` elements with
`onclick = () => {}` to `document.body`. Automation selecting the contract test
IDs can therefore drive a dead control, and Playwright reported the overlay
intercepting pointer events for those selectors. Users see a duplicated tab row
pinned across the top of every screen. Measured:
`elements matching [data-testid="sm-feed-tab-global"] = 2, one inside
#clqfg-feed-tabs with no React handler` (`grading/evidence/probe-web-v3.log`).

**d-09 — major — transient auth-service errors are surfaced as `401 Invalid
token`, signing the client out.** Every authenticated request calls
`admin.auth.getUser(token)` over the network (`service.mjs:233-236`) and maps
*any* error to `HttpError(401, "Invalid token")`. During grading a valid,
freshly minted token began returning `401 Invalid token` on five consecutive
requests while the app was under its own polling load, and the browser logged
`Error: Missing token` and a 401 storm. A user is logged out by backend
flakiness. Evidence: `grading/evidence/probe-profile500.log`, page-error list in
`probe-web-v2.log`.

**d-10 — minor — the access token is placed in media URL query strings.**
`src/api.ts:23-29` appends `?access_token=<jwt>` to every media URL so `<img>`
tags can load. Server-side this is accepted (`server/index.mjs:38`). Bearer
tokens in URLs land in server logs, browser history and `Referer` headers. The
`/media` route is otherwise correctly authorised (unauthenticated → 401).

**d-11 — minor — `authorizeMedia` fails open for unknown paths.**
`service.mjs:1233-1248` returns `true` when no message row references the
requested path, so any authenticated user can fetch any object in the bucket
that is not attached to a message (avatars, chat background images) if they can
name it. Paths embed a random id, so this is guess-resistance rather than
authorisation.

**d-12 — minor — the search screen's People/Messages scope toggle does not
re-run the query and carries no test ID.** `app/search.tsx:33-35`: changing
scope calls `setScope` only, so a user who has typed a query sees stale results
until they retype. It cost me one false negative before I noticed.

**d-13 — cosmetic — the feed tab row renders twice** (the injected bar of d-08
plus the real `FeedTabs`), visible at the top of `shots/m1-profile2.png`.

**d-14 — cosmetic — a non-member viewing a conversation, and the signed-in user
viewing their own failed-to-load profile, are both offered a "Follow" button on
themselves** (`shots/m1-profile2.png`) — a downstream symptom of d-05.

### What is correctly enforced

Recorded for balance, since these are the checks a trust-boundary probe set
would have gone after first: message history, sending, typing, group settings
and member management are all membership- and role-checked (`403 Not a member` /
`403 Admin only`); editing or deleting another user's message is `403`;
message search is scoped by membership and returns nothing for a non-member;
window enforcement is server-side against server time and ignores a
caller-supplied `createdAt`; view-once media is never handed to the client as a
fetchable path and is refused unconditionally by `authorizeMedia`; deleted
media is removed from storage and 404s; expired messages are filtered out of
history, search and digest counts; unauthenticated media requests are 401.

---

## 8. Assertion tally and O-dimension scores

Keyed results (`grading/grader-report.json`), over the 101 M1–M7 assertions
listed in `assertions.json` 0.3.0-m8:

| milestone | pass | fail | not-run | total |
|---|---|---|---|---|
| M1 | 11 | 2 | 0 | 13 |
| M2 | 20 | 3 | 4 | 27 |
| M3 | 4 | 10 | 1 | 15 |
| M4 | 6 | 1 | 5 | 12 |
| M5 | 9 | 1 | 2 | 12 |
| M6 | 6 | 0 | 7 | 13 |
| M7 | 0 | 0 | 9 | 9 |
| **total** | **56** | **17** | **28** | **101** |

M8's 18 assertions were executed in full (§4.8) but **cannot be keyed in the
report**: the grader report schema is version 1 and its `assertionResults`
`patternProperties` admits only `^m[1-7]-a[0-9]{2}$`, which predates the M8
amendment. This is recorded in the report's `notes`. For O1 they count as
not-passed anyway under the capability-failure adjudication, giving **56 of
119 ≈ 47 %** of the full-scope checklist.

Milestone statuses as I read them from the receipts, since there is no run
record: **M1 green**; **M2, M3, M4, M5, M6 attempted, not green**; **M7
not-run**; **M8 attempted, adjudicated capability-failure**; **scale replay
attempted, aborted**.

**O1 — Functional completeness — 40.** Between the 30 anchor ("core features
partially work; several checklist items fail") and the 60 anchor ("M1–M4 solid,
later milestones patchy or failed on cap"), nearer 30. It is well short of
"M1–M4 solid": M3 — the messaging core of a messenger — has an unusable
conversation screen on the web build and a wholly failed choreography segment,
and the brief's per-milestone iOS Hermes export artifact is missing for every
milestone. It is clearly above 30: M1 is fully green, the M2/M4/M5/M6
service-layer suites pass in my own clean run, and every M4/M5 grader-class
window, revocation and ephemerality assertion passes under the shortened-windows
config.

**O2 — Correctness under grading — 22.** At or slightly below the 30 anchor
("multiple high-severity defects in core flows"). Four blocker-class defects
(d-01, d-02, d-04, d-05), five major (d-03, d-06, d-07, d-08, d-09). Placed
below 30 rather than at it because d-01 is a direct read of another user's
private message content, the worst class of finding the rubric names. Held above
the floor because most of what a probe set would attack first is correctly
enforced (see "What is correctly enforced" in §7).

**O3 — Trust boundaries — null.** `applicability.json`'s predicate is
`m6-green-and-m1-m5-attempted`; M6 is not green (§5). O3 is in any case scored
only from the wave's rotated holdout probes, and none was committed (deviation 1).

**O4 — Observed offline behavior — null.** Predicate `m6-green`; M6 is not
green. There is also no simulator artifact of any kind to score from — the lane
records honestly that the proof was not run and not faked.

**O5 — Performance at the scale envelope — band 0.** First-match branch 0 on the
frozen band function; see §6.

No weighted total, efficiency statistic or cross-lane comparison is computed
here — those are the harness's and publisher's jobs.

---

## 9. Session hygiene

**Grader-abort protocol.** Not invoked. Two of my own tooling problems occurred
and were fixed rather than charged to the lane: my first browser script was
truncated by a shell pipe and re-run; my first People-search check used the
screen's default *Messages* scope and produced a false negative on m5-a09, which
I re-ran with the *People* scope selected and recorded as a pass. Neither was a
lane failure. `grader.sessionOutcome` = `completed`, `rerunsUsed` = 0.

**Processes.** Started and terminated by this session only:

| PID | what | port |
|---|---|---|
| 23301 | lane API (`server/index.mjs`) | 49600 |
| 97518 | lane API, restarted mid-digest-period for the m8-a11 check | 49600 |
| 93481 | lane web client (`expo start --web`) | 49601 |

All within the assigned 49600–49619 range. No `pkill` or `killall` was used;
the only other processes I signalled were two of my own stuck wait-loop shells.

**Files written.** Everything I produced is under
`lanes/grok-supabase/grading/`: this trace, `grader-report.json`, the probe
scripts, `evidence/` (logs, screenshots, and the pre-run snapshot of the
builder's receipts and coverage manifest) and `DONE`. Running the lane's
documented acceptance entrypoint necessarily rewrote `receipts/` and
`coverage-manifest.json` in place; the builder's originals were snapshotted
first to `grading/evidence/builder-originals/` and nothing there was modified.

**Validation.** `grading/grader-report.json` validates against
`instrument/grader/grader-report.schema.json` with AJV 8.20.0 (2020-12 dialect):
`SCHEMA VALID`.
