# Sanitized grading trace — lane `astra-snapback2`, wave `astra`

Grader: `claude` / `claude-opus-5`, fresh session, no builder context.
Lane backend: `snapback2-0.0.25`. Run scope: **full**. Session outcome: **completed**.
Report: `grading/grader-report.json` (schema-valid, see [§9](#s9-validation)).

**Redaction posture (LLP 0197).** Fixture passwords are never reproduced here; where a
command needed one it was read from the frozen fixture pack at run time and is shown as
`[REDACTED]`. Bearer tokens, asset session tokens and principal identifiers are truncated
or elided. Raw transcripts are not published; this file is the published artifact.

**What I did not read.** `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`,
`run-log.md`, and every other lane under `lanes/`. None reached me; the session is not
contaminated. I did read `run-record.json`, which this run's wrapper supplies as a lane
input, and I deliberately took only its milestone statuses, scope and artifact pointers
from it — no builder self-scores or narrative were consulted.

---

## 0. Environment and process inventory {#s0}

| | |
|---|---|
| Host | Ubuntu Linux x86_64, AMD EPYC 9454, shared with other sessions |
| Node | v24.13.1 |
| Playwright | 1.62.1 / Chromium, from the lane's own `choreography/node_modules` |
| Ports used | 53200 lane backend, 53201 Expo web client, 53202 replayed scale instance |
| Apple simulator | unavailable on this host — all native proofs graded `not-run` |

The run-specific wrapper supersedes `instrument/ENVIRONMENT.md` for host, tool and port
facts; that frozen file still records the prior Mac host.

Processes I started, and the only ones I killed at the end (no `pkill`, no `killall`):

```
BACKEND_PID=1478291                      # npx snapback2 dev --port 53200
EXPO_PID=1481811                         # expo start --web --port 53201
RESTART_r1789174923027_PID=1755661       # backend restart #1, for m8-a11
RESTART_r1789174923027b_PID=1768675      # backend restart #2, for m8-a11
SCALE_PID=1855516                        # scale-instance-retry on 53202
```

Machine load (`uptime`), recorded beside every timing-sensitive judgement because this
host is shared:

| Moment | load 1/5/15 |
|---|---|
| start of grading | 2.46 / 2.17 / 3.22 |
| during the acceptance suites | 3.47 / 2.79 / 3.26 |
| immediately before the O5 probe battery | 2.68 / 3.35 / 3.73 |
| immediately after the O5 probe battery | 1.89 / 3.07 / 3.62 |
| close of grading | 2.97 / 2.85 / 3.43 |

**State handling.** `evidence/` was copied to `grading/work/evidence-preserved` *before* I
ran any suite, because `npm run acceptance` rewrites `evidence/suite-mN.json` and
`evidence/coverage-mN.json`. I verified the lane's harness copies are the frozen
instrument byte-for-byte — all 16 `choreography/` files and every `metering/` module
compare equal — so the receipts I scored `[choreo]` assertions from are the frozen
harness's own output. I never re-drove the choreography myself, per the frozen prompt.
The replayed scale instance was read-only throughout.

---

## 1. Phase 1 — the builder's acceptance suite {#p1-suites}

Started the backend and web client from the lane's documented instructions
(`README.md`), then ran the documented entrypoint `npm run acceptance -- --milestone mN`
for every milestone in scope.

| Milestone | Result | Tests | Wall |
|---|---|---|---|
| m1 | PASS | 5 | 6.0 s |
| m2 | PASS | 13 | 18.2 s |
| m3 | PASS | 7 | 17.5 s |
| m4 | PASS | 5 | 10.0 s |
| m5 | PASS | 6 | 13.7 s |
| m6 | PASS (see below) | 4 | — |
| m8 | PASS | 5 | 10.6 s |

`evidence/suite-status.json` after my run records `pass: true` for all seven.

### The M6 suite failure, and why it is not a lane defect {#m6-suite}

M6 failed twice on first contact, both times on the same clause of `m6-a08`:

```
assert.ok(log.some(p => p.targetUserId===bob.principal && p.chatId==='d-alice-bob'
          && p.senderDisplayName===alice.displayName && p.preview==='a'.repeat(80)))
```

Per the grader-abort protocol I re-ran the phase once; it failed identically, so I
investigated rather than recording an abort. An isolated probe sending the same message
through the SDK returned a fully correct payload:

```
push log = [{ chatId: "d-alice-bob",
              preview: "aaaa…"  (exactly 80 characters),
              senderDisplayName: <matches profiles.mine>,
              targetUserId: <matches bob's principal> }]
```

The cause is in `snapback/push.q:7`:

```
if member.principal != viewer and not exists connected[member.principal]:
```

The push payload is correctly suppressed while the recipient still has a connected
client. The M5 suite, which runs immediately before M6, signs Bob in through the browser;
his presence record had not yet lapsed when M6 ran. About a minute later the same suite
passed unchanged:

```
PASS m6-a08 closed-recipient push logs correct target sender and 80-character preview
PASS m6-a09 once-photo push previews Photo
PASS m6-a10,m6-a11 standalone clean client authenticates lists pages sends and polls
PASS m6-a13 frozen 50-action validator and every verb settle with semantic state checks
```

The behaviour under test is right — the checklist says "with Bob's clients closed" — and
only the suite's failure to establish that precondition is wrong. Scored `m6-a08`/`m6-a09`
as **pass**, and filed the fragility as defect **d-04** (minor).

---

## 2. Phase 2 — coverage-manifest spot-verification {#p2-coverage}

`evidence/coverage-all.json` (`clique-coverage-manifest.v1`, instrument
`social-messenger@0.3.6-m8`) maps 45 tests. I diffed its per-milestone lists against the
suite-required set computed from `assertions.json`: **exact match, no omissions and no
additions**, for M1–M6 and M8. M7 is absent, which is correct — it was never attempted.

I then read all five suite modules against the assertion text. Verdict: **honest**.
Most mappings are stronger than the minimum:

- `m8-a01` recomputes the six lifetime totals from raw `posts`/`likes`/`feedEntries`/
  `follows` rows through the system CLI, rather than trusting the read-model it is testing.
- `m3-a15` deep-equals a five-surface snapshot (DM history, group history, profile, feed,
  group settings) across a re-seed of every installed segment.
- `m2-a24` pages both tabs to exhaustion and asserts entry-id uniqueness across all pages.
- `m2-a27` deep-equals the social counts before and after the implicit-self-follow writes.

**One sampled mapping is weak**, filed as defect **d-01**. The test mapped to `m8-a05`
("most-liked original leads trending") likes *all four* fixture posts from *every* client
before asserting `rows[0] === heavy`. With the like counts equal, that ordering is decided
by the newest-first tiebreak — `heavy` is simply created last — so the test would pass
unchanged even if Trending ignored likes entirely.

I recorded the verdict as `honest` rather than `dishonest`, and adjudicated no milestone to
capability-failure, on two grounds: the underlying observable does hold under independent
execution ([§4](#p3-api)), and the other 44 mappings are substantive. A reader who weighs
the rule's anti-gaming purpose more heavily can disagree on exactly these facts, which is
why they are stated in full here.

---

## 3. Phase 3 — grader-class assertions {#p3-grader}

### m1-a12 / m1-a13 — password storage {#m1-a12} {#m1-a13}

`snapback/schema.q:1` declares `use identity password` — the backend's built-in identity
module. `src/Auth.tsx` calls only `useAuth().actions.login` / `.signup` from
`snapback2/react`; the lane never handles or persists a credential itself. That is the
documented provider path, so **m1-a12 passes** without inspecting provider internals.

For **m1-a13** I searched for each starter persona's plaintext password in every place the
assertion names:

| Location | Occurrences |
|---|---|
| `.snapback/store.sqlite` (server persistence, `strings -a`) | 0 |
| `.snapback/log.jsonl` | 0 |
| backend stdout during grading | 0 |
| exported iOS bundles (`artifacts/m*-ios`) | 0 |

**Pass.** (The lane's own test scripts do embed fixture passwords, but the assertion scopes
to server persistence, client bundles and logs, so this is not a violation; it is not filed
as a defect either, since the fixture pack's credentials are a declared test-fixture
exception.)

### m1-a07 — server-side session revocation {#m1-a07}

Logged in, carried the bearer token to a second independent client (query succeeded), then
called `auth.logout()` on the first client and replayed the token:

```
pre-logout query with token: ok = true, handle = alice
post-logout SDK client        -> refused
post-logout raw HTTP GET /api/auth/me with the same Bearer token
  -> 401 {"code":"E_AUTH_SESSION","message":"session is missing or expired",
          "rewrite":"log in again and send Authorization: Bearer <token>"}
```

**Pass** — revocation is server-side, not client-side forgetting.

### m4-a10 — edit window enforced server-side {#m4-a10}

Generated config `snapback/config.q` is the instrument's shortened profile
(`editMs(): 60000`, `deleteMs(): 120000`, `disappear24Ms(): 180000`), matching
`fixtures/config/windows.shortened.json`. Grading ran against it, as required.

```
send                          -> committed
edit inside the window        -> committed
… wait 64 s …
edit after the window         -> rejected  EDIT_WINDOW_EXPIRED
                                 (rule site snapback/messages.q:147)
final body on the recipient   -> "edited inside window"
```

**Pass** — rejected by a server rule, not by the absence of a UI affordance.

### m4-a12 — media unreachable after delete-for-everyone {#m4-a12}

```
recipient assetBlob BEFORE unsend            -> served 2104 bytes
unsend                                       -> committed
recipient assetBlob AFTER  unsend            -> REFUSED "asset is unavailable"
FRESH session assetBlob AFTER unsend         -> REFUSED "asset is unavailable"
recipient row after unsend                   -> deleted=true, photo=null, body=null
```

**Pass.** (A bare unauthenticated `fetch` of the asset URL returns 404 both before and
after, because the documented path requires an SDK asset session; I therefore measured
through `assetBlob`, which is what `API.md` prescribes.)

### m5-a06 — view-once asset refused after the view {#m5-a06}

```
first viewing (recipient, {viewing:{}})      -> served 2119 bytes
second viewing, same client, new token       -> REFUSED "…already delivered to this principal"
third viewing, FRESH client and session      -> REFUSED  (same)
direct fetch with no viewing token           -> REFUSED  (same)
unauthenticated raw HTTP                     -> 404
```

**Pass** — refusal is server-side and per-principal, and survives a new session.

### m5-a01 / m5-a02 / m5-a03 — disappearing messages {#m5}

Created a fresh DM between two personas, set it to the `24h` option (180 s under the
shortened config), sent a marked message, confirmed a browser client rendered it *and*
found it in in-chat search, then closed every client and waited out the TTL.

```
pre-expiry: recipient sees the body; expiresAt - now = 179 979 ms
pre-expiry (browser): message visible in the conversation AND found by in-chat search
--- both clients closed at expiry; waited 205 s ---
m5-a01  messages.history          -> 0 rows, probe absent
        messages.details(expired) -> denied  MESSAGE_REQUIRED
        messages.conversationView -> 0 rows
        server searchChat         -> 0 hits
m5-a02  relaunched the SAME persistent browser profile -> 0 bubbles; the expired
        message is not rendered
m5-a03  in-chat search for the marker -> 0 hits
        global  search for the marker -> 0 hits
```

**All three pass.** `m5-a02` used a persistent Chromium profile so the client's local cache
genuinely survived the relaunch — otherwise the check would be vacuous.

### m6-a12 — grader-written client, from `API.md` only {#m6-a12}

I wrote a client from scratch using nothing but `API.md`: `createClient` → `auth.login` →
page `groups.mine` with the opaque cursor until a title matches → `messages.conversationView`
with `c: null` → `page.data.messages.find(row => row.message)?.message`, then normalised to
the exact neutral field table the document publishes.

```
authenticated as viewer: <matches session>
conversations paged: 24
resolved conversationId for "Choreography Trio"
page fields: count,messages,preview,reads | rows: 10 | count: 17
LATEST MESSAGE (neutral form): { id, conversationId, senderId, at, type:"text",
  body, media:null, edited:false, tombstone:false, replyTo:null, author, reactions:0 }
server timestamp is newest-first head: true
```

**Pass**, correct on the first attempt with no undocumented guessing. Documentation quality
is explicitly part of this bar and `API.md` met it: the response shapes, the cursor
protocol, the newest-first ordering and the nullable-join warning were all accurate.

### m8-a08 … m8-a12 — the scheduled digest {#m8-digest}

The digest is a scheduled sweep (`snapback/digest.q`) guarded by a persisted
`digestRuns[owner, periodStart]` row, emitting to `digestLog` only when a count is non-zero.
Under the shortened config the period is 120 s. I ran three controlled experiments with
every client closed across each period boundary.

**Experiment 1 — correctness of counts (m8-a08, m8-a09, m8-a12).** Aligned to a fresh
period, reset the relevant follow edges and read marks, then seeded exactly: one new
follower for `grace`; two posts by `grace` (whom `frank` now follows); three DMs to `bob`;
four messages in a *new group that `bob` and `henry` are not members of*; and nothing at
all involving `henry`.

```
digestLog rows for the target period: 5
   bob    newFollowers=0 newPostsInFollowing=0 unreadMessages=3 unreadChats=1
   carol  newFollowers=0 newPostsInFollowing=0 unreadMessages=4 unreadChats=1
   dave   newFollowers=0 newPostsInFollowing=0 unreadMessages=4 unreadChats=1
   frank  newFollowers=0 newPostsInFollowing=2 unreadMessages=0 unreadChats=0
   grace  newFollowers=1 newPostsInFollowing=0 unreadMessages=0 unreadChats=0
digestRuns rows: 29, distinct owners 29 — exactly one per user
henry: NO DIGEST ROW
```

Every count is exactly what was seeded. **m8-a08 passes.** `henry` — no activity in the
period — received nothing, so **m8-a09 passes**. And the decisive check for **m8-a12**:
`bob` shows `unreadMessages=3`, not 7, so the four messages in the group he does not belong
to contributed nothing; `carol` and `dave`, who *are* members, correctly show 4/1. **Pass.**

**Experiment 2 — a quiet period (m8-a10).**

```
QUIET period: no activity performed at all, all clients closed
digestLog rows for that period: 0   (expected 0)
digestRuns rows for that period: 29 (the sweep ran and deliberately emitted nothing)
```

**Pass** — and the `digestRuns` count proves this is a real emit-nothing decision rather
than a sweep that failed to fire.

**Experiment 3 — restart mid-period (m8-a11).** Seeded two DMs, then killed the *listening*
backend process at the exact period midpoint and started a fresh one.

```
RESTART-TEST period 1789174920000 -> 1789175040000
killed listening pid 1478321 at the period midpoint;  backend DOWN = true
restarted;  up = true
after the sweep:  digestLog rows = 1 | distinct users = 1 | DOUBLE-EMIT = false
                  digestRuns = 29, distinct owners 29
second restart, after the sweep, same period:  digestLog rows = 1 (unchanged)
```

**Pass.** (My first attempt at this test aborted on a module-format error in my own probe
script, and had only killed the `npx` wrapper rather than the server; that is grader
tooling, not a lane failure. The script was rewritten and the test run to completion.)

---

## 4. Phase 3 — independent re-execution of suite-required observables {#p3-api}

Re-executed through the custom-client API rather than trusting the suite.

```
m8-a05  Trending really ranks by likes, not recency — over the FULL read-model:
        a 6-like post created BEFORE a 2-like post outranks it, and also outranks
        a 3-like NEWER post.  Index byRank = (likes, at, id).  PASS
        like-count histogram at the time of the check: {0:157, 1:10, 2:2, 3:6, 6:1, 8:12}
        (my 6-like probe did not enter the truncated top-10 only because twelve
        8-like suite fixtures occupied it — which is correct behaviour, not a failure)
m8-a07  two posts with equal likes rank newest-first.  PASS

m2-a22/23/24  first page exactly 20 in BOTH tabs; full paging 98 Following / 203 Global;
        unique entry ids 98/98 and 203/203, zero duplicates; timestamps monotonically
        non-increasing across every page join (no gaps).  PASS
m2-a25/26/27  a zero-follow account still sees its own original and its own repost in
        its Following feed, and profiles.social deep-equals before/after.  PASS

m5-a09  people search: car / CAR / Car / ca / chen all resolve Carol;
        the mid-word "arol" correctly does NOT (word-prefix, not substring).  PASS
m3-a03  dmCreate from both directions returns the same conversation id.  PASS
m3-a05  two groups with identical title and membership get distinct ids.  PASS
m3-a14  non-admin memberRemove -> rejected ADMIN_REQUIRED, roster unchanged.  PASS
m5-a08  non-admin rename       -> rejected ADMIN_REQUIRED.  PASS
```

### Browser automation on the web build {#p3-web}

```
m1-a11  sm-profile-image decoded, naturalWidth/Height = 256x256.  PASS
m2-a05  6 of 6 Global feed items carry a decoded author avatar (blob URL, complete,
        naturalWidth>0) plus display name and handle.  PASS
m2-a12  the URL renders as an accessibilityRole="link" span; ui/src/linkify.tsx is
        wired to onPressLink={Linking.openURL} in FeedCard, MessageBubble and Profile,
        so a tap opens the system browser.  PASS
m2-a13  0 preview / unfurl / link-card nodes — linkify only detects and styles.  PASS
m3-a02  5 of 5 counterpart DM bubbles and 4 of 4 group bubbles carry a decoded
        sm-convo-sender-avatar. (Own bubbles omit it, the usual convention.)  PASS
m3-a10  the reply bubble embeds the quoted source text and an sm-convo-quote-preview.  PASS
m3-a11  tapping the excerpt scrolled the original to top=287 in a 720 px viewport.  PASS
m5-a11  "coffee" -> 3 results under 2 chat groups (WEEKEND PLANS, DIRECT MESSAGE).  PASS
m8-a01  all six Insights tiles render.  m8-a03/a04  exactly 7 day rows.  PASS
m2-a22/23  scrolling grew both tabs past 20 items.  PASS
```

---

## 5. `[choreo]` assertions, from the harness receipts only {#p4-choreo}

Scored from `evidence/choreography-m*.jsonl`, never re-driven by me. Every segment summary
reports `green: true` with `requiredUnimplemented: 0`.

| Segment | Assertions | Required | Passed | Failed |
|---|---|---|---|---|
| m1 | 3 | 3 | 3 | 0 |
| m2 | 9 | 9 | 9 | 0 |
| m3 | 7 | 5 | 7 | 0 |
| m4 | 5 | 5 | 5 | 0 |
| m5 | 4 | 2 | 4 | 0 |
| m6 | 1 (web) | 1 | 1 | 0 |
| m8 | 5 | 5 | 5 | 0 |

Best-of-3 measurements for every timing-sensitive assertion are in the report's
`timingRecords` and in each assertion's `bestOf3Ms`. The two with an explicit numeric bound:

- **m3-a06** typing indicator within 2 s — `visibleAfterLastKeystrokeMs` = **25.0 / 30.2 / 23.2 ms**.
- **m3-a07** indicator expires within 5 s — `expiresAfterLastKeystrokeMs` = **2819.6 / 2324.9 / 2823.4 ms**.
  All three are inside 5 s *and* above 2 s, so expiry was genuinely observed rather than the
  indicator never having appeared. The receipt stamps `typingObservationBoundaryVersion: v2`.

Two assertions needed the receipt read carefully rather than taken on its name:

- **m3-a12 / m3-a13** are both carried by `member-add-promote-remove-leave-and-live-cutoff`.
  Reading the frozen harness source confirms it asserts the live cutoff *only after* a
  subsequent direct-message progress marker proved the removed client was still live (so a
  dead client cannot pass by accident), and separately asserts the removed member still holds
  **exactly one** copy of the pre-removal message ("lost or duplicated retained group history").
  Both assertions are genuinely exercised. **Pass.**

One observation became a defect: `feed-image-post-live-update` and `feed-video-post-live-update`
each had **attempt 2 of 3 fail** with `composer image/video attachment did not expose semantic
value … within 10000ms`, `outcomeClass: application`. Best-of-3 correctly let the segment pass,
but the same race reproduced on both media kinds in one run — filed as defect **d-05** (minor).

---

## 6. Native / simulator proofs {#s6-native}

Graded `not-run`, not failed, and never substituted:

- `native-status.json` records `ios-simulator-m6` and `ios-simulator-m8` as
  `pass: null, receipt: null, reason: "unavailable: Linux x86_64 host has no Apple iOS simulator"`.
- The M6 and M8 segment summaries carry the simulator entry under
  `choreography.supplementalExternal` with `requiredForGreen: false` and `status: "not-recorded"`.
- The lane's `README.md` states plainly that "Linux cannot produce Apple simulator execution
  proofs" and that "the additional web restart proof is explicitly not a simulator substitute".

The per-milestone iOS artifacts are genuine Hermes bytecode — I checked the magic myself
(`c6 1f bc 03 c1 03 19 1f`) on `artifacts/m8-ios-final/…/entry-*.hbc` — but a bundle is a
build artifact, not an execution proof, and I did not treat it as one.

Affected assertions, all scored `not-run`: **m6-a01 … m6-a07**, **m8-a17**, **m8-a18** (9 total).

---

## 7. Phase 4 — holdout probes: not run {#s7-probes}

`instrument/grader/probes/rotation-log.md` contains **no rows** — "No rows yet — the first
wave's probe set is authored at wave time". No probe set was committed for wave `astra`, so
per this run's wrapper I skipped execution-order phase 4 entirely, set
`wave.probeSetSha256` to the sentinel `none-uncommitted`, and left `probeResults` empty.
**No probes were invented.**

Consequence for **O3**: the dimension's applicability predicate *is* satisfied (M6 green,
M1–M5 all attempted), but both `applicability.json` and the brief restrict O3 to the wave's
secret rotated probes, and those do not exist. O3 therefore records **null for absence of
evidence, not for inapplicability** — a property of the wave, not of the lane.

Trust-boundary behaviour was nevertheless exercised incidentally all through the checklist,
and every such check held: post-logout token revocation, non-admin rename and member-remove
refusal, post-delete and post-view-once asset refusal across fresh sessions, expired-message
refusal, and digest counts that never draw on a chat the target is not a member of. Those are
checklist observations and are deliberately **not** used to score O3.

---

## 8. O5 — scale replay verification {#o5-fixtures}

I booted the lane's replayed instance (`scale-instance-retry/`, 5.4 GB store) on port 53202
and verified the invariant manifest myself rather than accepting the lane's receipt.

**Entity counts.** All 18 `perEntityCounts` in `fixtures/invariant-manifest-combined.json`
match the lane's recorded end state exactly, at 100% and at both checkpoints — 1008 users,
1008 profiles, 5921 follow edges, 50 228 posts (48 224 top-level, 2004 replies), 5008 active
likes, 1004 active reposts, 1002 conversations, 2054 memberships, 100 015 messages, 910 media
messages, 2736 quoted replies, 2000 active reactions, 0 disappearing settings.

**Named O5 fixtures — checked live against the instance, all exact:**

```
u0500  following=500  conversations=100        expected 500 / 100     OK
u0005  following=5                             expected 5             OK
u0900  followers=900  originalPosts=200        expected 900 / 200     OK   (the celebrity)
u0901  following=5, and exactly {u0001,u0002,u0003,u0004,u0900} true,
       with u0005/u0010/u0500/u0899 all false  expected that set      OK
g0001  roster 50 handles, exact set match      expected 50            OK
g0001  10 000 messages counted by FULL paging  expected 10 000        OK  (4.9 s)
```

**Sampled manifest spot checks:** `perUserFollowingCounts` 8/8; `perChatMessageCounts` 3/3
(counted while logged in as a member of each chat — the other samples were correctly
invisible to a non-member, which is access control working, not a mismatch);
`perGroupMemberCounts` 3/3 visible; named spot profiles 5/5, posts 5/5 *including* their
like/repost/reply counts, messages 4/4 accessible *including* quote links, conversations 2/2.

**Degradation rules**, measured by me at the full corpus, k=20 sequential after 3 warm-ups,
30 s timeout:

| Probe | n | p50 | p95 |
|---|---|---|---|
| following-feed u0500 (500 follows) | 20 | 17.8 | 57.6 |
| following-feed u0005 (5 follows) | 20 | 50.8 | 54.7 |
| following-feed u0901 (celebrity + 4) | 20 | 53.4 | 54.3 |
| busy chat g0001 page 1 | 20 | 43.8 | 44.2 |
| busy chat g0001 page 50 | 20 | 43.8 | 44.8 |
| conversationView g0001 (50 members) | 20 | 50.8 | 60.0 |
| messages.searchChat g0001 | 20 | 1.5 | 1.9 |
| insights.mine u0500 | 20 | 3.6 | 4.0 |
| insights.trending | 20 | 48.0 | 48.5 |

```
R1  deep paging      p95 page50 / page1      = 1.01x   <= 3x   PASS
R2  following feed   p95 500-follow / 5      = 1.05x   <= 3x   PASS
R7  celebrity read   p95 u0901 / u0005       = 0.99x   <= 3x   PASS
R5  cold start       fresh login + all 100 conversations = 113 ms, heap 29 MB   PASS
R8  Insights payload = 359 bytes (six totals + 7 day records) — the corpus is NOT
    transferred to the client, so it passes structurally, not merely on latency
R10 no probe timed out, errored or OOMed
```

The **celebrity write path** is O(1) in follower count *by construction*: `snapback/feeds.q`
builds the Following feed as a read-time `merge` over the viewer's follow set, and
`createPost` inserts a single `feedEntries` row per post regardless of audience. R7's 0.99×
confirms the cost is not pushed onto followers either. I did not measure the write path with
live traffic, because doing so would have written ~46 posts into the verified invariant
artifact and invalidated its counts for any later audit.

**Not evaluable this wave:** the three mid-curve rules that compare the full corpus against
the 10% checkpoint (global message search, Insights, Trending). They need the rotated probe
queries and a 10% baseline, and the instance is now at 100%. The lane's own checkpoint
receipts show flat curves for the four probes it did record across 10%/50%/100%.

**Band derivation** (first-match, frozen order 0, 30, 60, 90, 75):

| Branch | Fires? | Why |
|---|---|---|
| 0 | no | manifest conforms, named fixtures exact, replay green (167 157 actions), wall cap is an unset placeholder so it cannot be exhausted |
| 30 | no | every measurable degradation rule passes with margin; no timeout, error or OOM |
| 60 | **cannot** | absolute p95 ceilings and the replay wall cap are pilot-calibrated placeholders never instantiated in the frozen brief — no ceiling can be exceeded, no >80% utilisation established |
| 90 | **cannot** | requires affirmatively establishing ceiling utilisation ≤50% *and* cap utilisation ≤50%; neither denominator exists |
| 75 | **yes** | first match by elimination |

**O5 = band 75.**

---

## 9. Defects beyond the checklist {#s9-defects} {#d-01} {#d-02}

No blocker and no major defect. Five minor, one cosmetic.

| id | sev | summary |
|---|---|---|
| d-01 | minor | the coverage-mapped test for `m8-a05` gives all four Trending fixtures equal likes, so its ordering assertion is decided by the recency tiebreak and would pass even if Trending ignored likes ([§2](#p2-coverage)) |
| d-02 | minor | people search renders a raw internal SDK error object to the user for a refused term |
| d-03 | minor | message search shows "No results" for a server-*refused* query, so rejection is indistinguishable from an empty result |
| d-04 | minor | the M6 suite asserts a push payload without establishing its own "recipient disconnected" precondition ([§1](#m6-suite)) |
| d-05 | minor | intermittent web-composer attachment race, 1 of 3 attempts on both image and video ([§5](#p4-choreo)) |
| d-06 | cosmetic | no API enumerates who a user follows — only counts plus a per-viewer `mine` flag |

**d-02 / d-03 in detail.** `messages.searchChat` and `profiles.search` refuse multi-word or
punctuated terms with a clear, actionable server error:

```
searchChat "web-1789"  -> refused  E_INPUT: "search one word"
searchChat "cof fee"   -> refused  E_INPUT: "search one word"
profiles.search "car-ol" -> refused  E_INPUT: "search one word"
```

The single-word constraint is a legitimate design choice and no checklist item requires
multi-word search. The defect is what the client does with the refusal. In the message scope
the reason is discarded and the user sees only:

```
BACK PEOPLE ✓ MESSAGES ⌕ No results
```

In the people scope the raw SDK error object is rendered verbatim into the page, and its text
is about queued writes rather than the actual problem:

```
… No results {"code":"refused","message":"retry this local operation; preserve queued
writes and inspect the reported state error if it repeats"}
```

(This is also what made a grader search appear to hang earlier in the session — the query had
been rejected, and nothing said so.) Robustness itself is fine: emoji, a 120-character term
and whitespace-only all return a clean empty result rather than an error.

---

## 10. Scores {#s10-scores}

| | Score | One-line basis |
|---|---|---|
| O1 Functional completeness | **80** | 101 / 119 in-scope assertions pass; M1–M6 and M8 all green; short of the 90 anchor on its two explicit clauses — M7 never attempted (9) and no platform-proof artifacts (9) |
| O2 Correctness under grading | **82** | no blocker, no major; five minor and one cosmetic, none touching data correctness or a core flow |
| O3 Trust boundaries | **null** | no holdout probe set exists for this wave; the only admissible evidence source is absent ([§7](#s7-probes)) |
| O4 Observed offline behavior | **65** | warm-offline reads/search, ordered offline flush and M8 dual-device convergence all clean; the entire cold-start-offline half has no artifact, and the native proof the 90 anchor requires does not exist |
| O5 Performance at the envelope | **band 75** | manifest and named fixtures verified exact; all measurable degradation rules pass with margin; 60 and 90 both unreachable because ceilings and the cap were never instantiated ([§8](#o5-fixtures)) |

Per the frozen prompt, **no weighted total, efficiency statistic or cross-lane comparison is
computed here** — those are the harness's and publisher's jobs. Under `nullDimensionRule` the
null O3 would bar a total in any case.

### Assertion tally

```
M1 13/13   M2 27/27   M3 15/15   M4 12/12   M5 12/12
M6  6/13   (a01–a07 not-run: no Apple simulator)
M7  0/9    (milestone never attempted)
M8 16/18   (a17/a18 not-run: no Apple simulator)
------------------------------------------------------
   101 pass, 18 not-run, 0 fail, of 119 in scope
```

---

## 11. Recorded deviations and caveats {#s9-validation}

1. **No holdout probe set** was committed for wave `astra`; phase 4 skipped,
   `probeSetSha256 = "none-uncommitted"`, `probeResults` empty. O3 null in consequence.
2. **Calibration gate not passed** by this grader's family: `calibrationPassed: false`,
   `sameFamilyGraded: false`. The grade is labelled **uncalibrated-grader** and this is an
   N=1 calibration run, not a claim-eligible wave.
3. **Timing** judged best-of-3 with machine load recorded beside it ([§0](#s0)).
4. **M8 results are not in `assertionResults`.** The frozen report schema keys that object
   with `patternProperties: ^m[1-7]-a[0-9]{2}$` under `additionalProperties: false`, so it
   predates the 2026-08-11 amendment that added M8. Keying `m8-*` would make the report
   schema-invalid. All 18 M8 assertions were executed, are listed in the report's `notes` and
   in this trace, and are scored into O1/O2 exactly as if they were keyed.
5. **Assertion-count discrepancy in the instrument.** `assertions.json` 0.3.0-m8 declares
   `counts.assertions.total = 116` with `M2: 24`, but its milestone arrays hold **119** with
   `M2: 27`. I graded the 119 that exist in the arrays. The lane's coverage manifest also
   enumerates the real 22 suite-required M2 assertions, so it agrees with the arrays.
6. **Grader re-runs: one** (the M6 suite, [§1](#m6-suite)). One grader-authored probe script
   also aborted on my own module-format error and was rewritten; that is grader tooling, not a
   lane failure, and the affected test was re-run to completion.

### Schema validation

```
AJV 8.20.0, draft 2020-12 dialect, against instrument/grader/grader-report.schema.json
SCHEMA-VALID: true
```

I also ran `lanes/lib/json-schema.mjs`, which reports every `assertionResults` key as an
"unknown field". That helper does not implement `patternProperties` at all (`grep -c
patternProperties` → 0), so it treats every keyed assertion as an additional property under
`additionalProperties: false`. AJV with the declared draft-2020-12 dialect is the
authoritative check, and it passes.

---

## 12. Cleanup {#s12-cleanup}

`evidence/` was restored to its exact pre-grading state after scoring: running
`npm run acceptance` rewrites twelve receipt files, so the originals were copied back from
`grading/work/evidence-preserved/` and my own run's versions retained separately under
`grading/work/evidence-from-grader-run/`. A byte-comparison of every JSON receipt against the
pre-grading backup now reports no differences. No new files were left in `evidence/`, and
nothing was written into `instrument/`.

Every process I started was killed by PID at the end of the session ([§0](#s0)); no `pkill`
or `killall` was used, and no process outside my own five was touched.
