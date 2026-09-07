# Grading trace — lane `muse-convex` (social-messenger, backend convex-1.45.0)

Sanitized evidence and action trace. Fixture passwords, session tokens, the
Convex admin key and instance secret are redacted throughout; they appear
nowhere in this file. Raw grader transcripts are not published.

- **Wave:** `muse` · **Run scope:** full (M1–M8) · **Instrument:**
  `social-messenger` assertions `0.3.0-m8`
  (sha256 `e15c3952…732d04`), fixture pack `0.2.1-m8`, choreography `0.3.6-m8`
- **Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder
  context. `diary.md`, `essay.md`, `final-report.md`, `run-log.md` and every
  other lane under `lanes/` were never opened; the session is not contaminated.
- **Session outcome:** completed, 1 re-run used (§5.1).
- **Host:** macOS arm64, Node 24.18.0, Playwright 1.62.1 / chromium 151. The
  machine is shared with other lanes and was loaded throughout; `uptime` load
  averages are recorded beside every timing-bearing observation.

## 1. Deviations from the frozen protocol (recorded, not chosen by the grader)

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped, `wave.probeSetSha256` is the literal `none-uncommitted`, and
   `probeResults` is empty. No probes were invented. O3 is therefore scored
   **off-basis** — from the trust-boundary checks executed in phase 3 (§7)
   rather than from the rotated secret probes it is defined over — and is not
   claim-eligible.
2. **The grading family has not passed the calibration gate.**
   `calibrationPassed: false`, `sameFamilyGraded: false`. The grade is labelled
   `uncalibrated-grader`.
3. **Timing-sensitive checks are best-of-3** and are read from the harness's own
   recorded attempts (§10), never re-driven by the grader, with machine load
   recorded alongside.
4. **No run record.** `run-record.json` does not exist in the lane. Grading was
   done from `receipts/acceptance-m*.json`, `receipts/choreo-m*.jsonl` and their
   observation sidecars, `coverage-manifest.json`, `setup-identity.json`,
   `suite-status.json`, the source tree, and the grader's own execution.
5. **M8 assertion results are not machine-keyed.** The report schema's
   `assertionResults` pattern is `^m[1-7]-a[0-9]{2}$` with
   `additionalProperties: false`, predating the 2026-08-11 M8 amendment. M8 was
   fully executed; its results are in §8 and in the report's `notes`, and they
   are in O1's denominator.

## 2. Environment brought up by the grader

Started from the lane's own documented instructions (`API.md`, `package.json`
scripts). Ports used: **49800, 49811, 49812** only — all inside the assigned
49800–49819 band. No other lane's ports were touched; no `pkill`/`killall` was
ever used.

| what | command | port | PID |
|---|---|---|---|
| Convex local backend (first) | `npx convex dev` | 49811 / 49812 | 66514 (wrapper), 67241 (backend) |
| Convex local backend (after the §8 restart test) | `npx convex dev` | 49811 / 49812 | 77951 (wrapper), 78141 (backend) |
| static web client | `node scripts/serve.mjs 49800` | 49800 | 3959 |

`uptime` at bring-up: `19:56 … load averages: 23.36 26.64 26.46`.

## 3. Phase 1 — the lane's documented acceptance entrypoint

`npm run acceptance -- --milestone mN`, run by the grader against the
grader-started backend.

### 3.1 Suite results (grader re-run)

| milestone | result | notes |
|---|---|---|
| m1 | **8/8 pass**, 0 missing | signup, duplicate handle/email rejection, profile edit, avatar upload + render, seed idempotency |
| m2 | **23/23 pass**, 0 missing | posts, follow graph, URL rendering, likes/reposts/replies, pagination, implicit self-follow |
| m3 | **17/17 pass**, 0 missing | see §9 — the ID→test mapping does not hold |
| m4 | **6/6 pass**, 0 missing | photo/video messages, reaction replace + clear, edited label |
| m5 | **7/7 pass**, 0 missing | view-once, non-admin rename denial, the three search scopes |
| m6 | **7/7 pass**, 0 missing | push payload + `Photo` preview, push suppressed when connected, custom-client demo, 50-action replay conformance (`settled=50 checks=9`) |
| m7 | **runner error** | see §3.2 |
| m8 | **7/7 pass**, 0 missing | Insights totals, today bucket, zero days, Trending order/absence/tie |

The runner validates `coverage-manifest.json` against the frozen
`assertions.json` before running, and re-runs the seed to confirm content-table
counts do not move. It excludes `media`, `sessions`, `mutations`, `pushLog`,
`digests` and `presence` from that check; the `media` table rose from 233 to 391
across the grader's seven suite runs because the seed re-uploads every fixture
blob each time (defect **d-09**).

### 3.2 M7 was never attempted

```
acceptance failed: Cannot find module .../scripts/tests/m7.mjs
```

Corroborating evidence: `scripts/acceptance.mjs`'s own usage string is
`m1|m2|m3|m4|m5|m6|m8` (no m7); there is no `receipts/acceptance-m7.json` and no
`receipts/choreo-m7.jsonl`; `convex/schema.ts` declares no poll table and
`convex/` exports no poll or vote mutation (the only M7-shaped surface present is
`chats.messageCount`, which the source comments as pre-existing). The
instrument-supplied UI kit ships `PollCompose`/`PollDisplay`, but nothing in the
app or backend uses them. All nine M7 assertions record `not-run`.

## 4. Phase 3 — grader-executed `[grader]`-class assertions via the API

Tooling written by the grader: `grading/tools/{env,fast,timed,apimd-variation}.mjs`.
Raw results: `grading/out/{fast,timed}.json`.

### 4.1 m1-a07 — server-side session revocation (full-run only) — **pass**

Signed in as a persona, confirmed a live query and `GET /api/conversations`
(HTTP 200), called `auth.signOut`, then retried on every surface:

```
before=200  afterQuery=threw[UNAUTHENTICATED]  afterMutation=threw[UNAUTHENTICATED]
http=401    auth.me=null
```

Revocation is enforced server-side (`sessions.revoked` checked in
`convex/lib.ts:getSession`), not by UI absence.

### 4.2 m1-a12 / m1-a13 — password storage — **pass / pass**

- `convex/auth.ts:53` and `:101` — `hashSync(password, 10)` from `bcryptjs`;
  bcrypt at cost 10 is a named adaptive KDF at standard published parameters.
- Scanned the backend store for the 8 distinct fixture passwords:
  **0 plaintext hits** in an 18.9 MB store; **231** hashes matching
  `$2[aby]$NN$…`, all with the `$2b$10$` prefix.
- Scanned all 13 exported web-bundle files (`dist-web`): **0 plaintext hits**.
- No password appears in any `console`/log call in `convex/`.

### 4.3 m4-a10 — post-window edit rejected server-side — **pass**

Installed the fixture pack's shortened-windows profile and confirmed it took
effect: `edit=60s del=120s ttl(24h)=180s profile=shortened-grading`.

```
in-window edit                → accepted
edit at +70 s   (window 60 s)  → [WINDOW_EXPIRED] The edit window has closed.
delete at +130 s (window 120 s)→ [WINDOW_EXPIRED] The delete window has closed.
```

Both are enforced in the mutation against server time
(`convex/messages.ts:378`, `:410`), not merely by hiding the affordance.

### 4.4 m4-a12 — media URL after delete-for-everyone — **pass**

```
GET /media?id=…  before delete            → 200
GET /media?id=…  after delete (recipient) → 410
GET /media?id=…  after delete (sender)    → 410
history row: deleted=true, mediaId=null, text=""
```

### 4.5 m5-a01 — expired disappearing message refused server-side — **pass**

Fresh DM set to the `24h` option (180 s under the shortened profile), one
message sent, **both clients closed**, waited past the TTL:

```
sender history contains it   = false
recipient history contains it = false
in-chat search hits           = 0
global search groups          = 0
/api/stream poll carries it   = false
```

### 4.6 m5-a04 / m5-a05 / m5-a06 — view-once — **pass / pass / pass**

```
openViewOnce #1  → ok, mediaId issued
GET /media #1    → 200, Cache-Control: no-store
GET /media #2    → 403
openViewOnce #2  → [ALREADY_VIEWED]
GET /media as a non-member session → 403
```

### 4.7 m6-a12 — grader-written variation from `API.md` alone — **pass**

`grading/tools/apimd-variation.mjs` was written against `API.md` only: no lane
source read for it, no generated Convex client, no lane script imported. Task:
fetch the latest message of a named conversation (`Weekend Plans`).

```
ok  POST /api/login                        status=200
ok  GET  /api/conversations                12 conversations returned
ok  locate "Weekend Plans" by title         chatKey=g-starter kind=group members=4
ok  GET  /api/history (no cursor)           9 items, done=true
ok  latest message identified               from=Alice Alvarez, type=text
ok  agrees with listing lastMessageAt       exact match
ok  documented field manifest present       all 12 documented fields
```

One documentation gap, filed as **d-08**: `API.md` says "newest page first when
`cursor` is absent" but never states the ordering **within** a page (observed
oldest-first). `createdAt` is documented, so the answer is still derivable and
cross-checks against the listing's `lastMessageAt`.

## 5. Phase 3 — grader web automation against the web build

Playwright chromium from the lane's own `choreo/node_modules` (the instrument
tree was never written to). Tooling: `grading/tools/{web-smoke,web-eph2,m3a02}.mjs`.

### 5.1 Grader re-run (abort protocol)

The grader's first ephemeral-message script set the browser context offline and
*then* navigated, which fails at the network layer. That is grader tooling, not a
lane defect. Per the grader-abort protocol the phase was rewritten (navigate
first, then go offline; and use a **persistent** browser profile so "kill and
relaunch" keeps the same IndexedDB durable store) and re-run **once**.
`rerunsUsed: 1`. The rewritten run completed.

### 5.2 m5-a02 — client purge of an expired message — **fail** (one branch)

Setup: fresh DM, one durable control message, then disappearing set to `24h`
(180 s). One client kept **connected and on the conversation** across expiry; a
second client on a persistent profile closed before expiry and relaunched after.

| branch | result |
|---|---|
| connected client, polled to **expiry + 330 s** (brief's stated tolerance is 5 minutes) | **still rendering the expired message** |
| the same connected client, 1 s after an unrelated write landed in the chat | message gone |
| relaunched client (same durable store, session restored) | expired message **not** rendered; durable control message rendered |

Root cause, `lib/Conversation.tsx:137-139`: the `expiresAt` filter is applied
**only** to the offline snapshot branch; when the live Convex query has a result,
`baseItems = liveItems` unfiltered. A Convex query result is only recomputed when
a dependent table is written, and expiry is a time event with no write — so a
connected client never re-evaluates and the staleness is unbounded, not merely
slow. Screenshot: `grading/out/shot-connected-after-expiry.png`.

The lane's own choreography assertion `disappearing-message-expiry-and-purge`
closes **both** pages before waiting and only re-checks after relaunch
(`choreo/choreography.mjs:2280-2295`), so it cannot observe this branch.

The launch/reconnect branch passes, so the assertion is scored `fail` with that
qualification recorded.

### 5.3 m5-a03 — offline search after the expiry sync — **pass**

On the relaunched client, with the context taken offline **after** navigation:

```
offline-search hits for the expired message = 0
offline-search hits for the durable control message in the same chat = 1
```

Baseline before expiry on the same profile: 1 hit for the ephemeral message, so
the search path genuinely covered it and then stopped. `hydrateMessage` serves
`expiresAt` (`convex/messages.ts:109`) and `app/search.tsx:64` filters on it.
Screenshots: `shot-offline-search-before-expiry.png`,
`shot-offline-search-after-expiry.png`.

Session persistence across the relaunch was observed incidentally
(`session-restored`, corroborating m1-a05).

### 5.4 m3-a02 — DM messages render with sender avatars — **fail**

Two independent runs, signed in as different personas:

| surface | `sm-convo-bubble` | `sm-convo-sender-avatar` |
|---|---|---|
| DM (alice ↔ bob) | 11 → 8 | **0** → **0** |
| group "Weekend Plans" | 9 → 9 | 6 → 7 |

`lib/Conversation.tsx:758` passes `showSender={group && !mine}`, and the kit only
renders the avatar slot when `showSender` is true
(`ui-kit/src/MessageBubble.tsx:153-161`). Sender avatars therefore never appear
in DM bubbles. Screenshots: `shot-dm-no-sender-avatar.png` (0 avatars),
`shot-group-sender-avatars.png` (avatars present).

This is invisible in the lane's green receipt: the choreography harness records
the matching assertion `sender-avatar-identity-when-rendered` as
`skipped / implemented:false / required:false`, with the reason "the kit does not
render sender avatars in the default 1:1 layout". The frozen assertion m3-a02 has
no `greenRequired:false` marker, so the grader scores it against `assertions.json`.

## 6. Phase 3 — independent re-execution of suite-required claims

Tooling: `grading/tools/{fast,extra}.mjs`. Raw results `grading/out/{fast,extra}.json`.

### 6.1 m2-a22 / m2-a24 — Following-tab pagination — **pass**

The lane's mapped test walks Bob's Following feed while he follows nobody and
passes on a **single 8-item page**, never exercising a second page. The grader
built the required corpus (a fresh account following one author with 26 posts):

```
pages=3  page sizes=20,20,7  duplicates=none  grader posts seen=26/26
```

Correct behaviour, weak coverage. Recorded as a coverage weakness in §9, not as
a dishonest mapping.

### 6.2 M3 assertions re-executed against their frozen text — **all pass**

```
m3-a03  createDM alice→carol, carol→alice, and again with a *fresh* chatKey hint
        all resolve to one channel; resolveDM agrees.            pass
        (self-DM refused with [SELF_DM])
m3-a04  group members active = alice,bob,carol                   pass
m3-a05  a second, distinct group with the same three members      pass
m3-a14  carol (non-admin) removeMember → [NOT_ADMIN]; bob still active  pass
```

### 6.3 m4-a06 / m4-a07 — reactions — **pass / pass**

```
👍 then ❤️            → exactly one chip, ❤️            (m4-a06)
❤️ sent again         → still one chip (set-state, no server-side toggle)
explicit clear "none" → no chips                        (m4-a07)
```

The "tap the same emoji again removes it" observable is implemented client-side:
`lib/Conversation.tsx:374` sends `emoji: "none"` when the tapped emoji is already
the caller's own. The suite's mapping is fair.

### 6.4 Further re-checks — all pass

```
m5-a09  "car" → carol; "CAR" → carol                                  pass
m5-a10  "cof"/"COF"/"coffee time" match; mid-word "ossing" does not    pass
m5-a11  searchAll returns per-chat groups with hit arrays              pass
m2-a08  post leaves Following on unfollow                              pass
m2-a09  …stays in Global and stays readable (projection-scoped)        pass
m2-a23  5 Global pages, 98 items, newest-first                         pass
m2-a24  98 unique across a full walk — no duplicates, no gaps          pass
send idempotency: a retried msgKey yields one message, and a retry with a
        different body does NOT rewrite the stored text                pass
post validation: 5 images rejected; 1000-char text rejected            pass
self-follow refused with [SELF_FOLLOW]                                 pass
```

## 7. Trust-boundary probes (defect basis; O3 off-basis input)

A throwaway account ("outsider") was created that is a member of no chat and
follows nobody. Probes at the API, not through the UI.

### Correctly denied

| probe | result |
|---|---|
| post-logout token on query / mutation / HTTP | `UNAUTHENTICATED` / 401 |
| outsider reads another pair's DM history | threw |
| outsider reads chat metadata (`getChatByKey`) | threw |
| outsider cross-chat search for a secret marker | 0 hits |
| outsider `/api/stream` poll | no leak of the private chat |
| outsider writes into another pair's chat | `[NOT_MEMBER]` |
| a member edits / deletes **another** user's message | both threw |
| media asset after delete-for-everyone | 410 (sender **and** recipient) |
| media asset re-fetch after view-once | 403 |
| media asset fetched by a non-member | 403 |
| edit / delete after the shortened windows | `[WINDOW_EXPIRED]` |
| expired disappearing content in history/search/stream | excluded |

The 90-anchor's named cases — asset access after view-once and after delete — are
all correctly denied.

### Broken

| id | probe | observed |
|---|---|---|
| **TB1** (d-02) | outsider calls `messages.pushLog` / `GET /api/push` | read **74 entries**, including the first-80-character preview of a DM between two *other* personas carrying the grader's secret marker, with sender name and chat id. Identical over HTTP. |
| **TB2** (d-05) | `config.setProfile` and `config.setPushEnabled` with **no token** | both succeeded — window lengths, digest schedule and push on/off are globally mutable by anyone |
| **TB3** (d-01) | `users.setFixtureProfile` with **no token** | rewrote another persona's display name to a grader marker; **restored by the grader immediately** |
| **TB4** (d-06) | outsider calls `social.testingSetPostCreatedAt` on someone else's post | `createdAt` rewritten `1788746670479 → 1` |
| **TB5** (d-07) | outsider calls `digest.digestsFor({userKey: <other user>})` | read **351** of another user's digest rows |

`users.setFixtureProfile` and `config.setProfile` take no session at all;
`messages.pushLog`, `digest.digestsFor` and `social.testingSetPostCreatedAt`
require only *some* valid session and then apply no ownership or membership
filter. All are exported from `convex/` and therefore publicly callable.

## 8. M8 — Insights, digest and multi-device (grader phase)

### 8.1 The scheduled digest chain was dead on arrival (defect d-03)

The grader's first digest period produced **zero** digest rows for every user,
including one with known activity. Cause, from the backend's own scheduler table:

```
digest.js:tick  scheduledTime 1788733857806 (2026-09-06T22:30:42Z)
                state: { "error": "Function execution timed out (maximum duration: 1s)", "kind": "failed" }
```

`convex/digest.ts:tick` re-arms itself with `ctx.scheduler.runAfter` inside its
own `finally`. A failed Convex mutation rolls back everything it did, including
that re-arm — so the self-perpetuating chain ended there and **no tick ran for
the next ~3.4 hours**. `digestState.lastTickAt` confirms it: `1788733842806`.

`convex/digest.ts:26 ensureScheduled` cannot recover it: it returns
`{already:true}` whenever `digestState.scheduled` is true, which it still was.

This predates the grading session — the failing tick is ~3.4 h before the
grader's backend was started, and the lane's own M8 suite ran green afterwards
because m8-a08…a12 are `[grader]`-class and the suite never touches digests.

`emitDueDigests` walks every user × every chat they belong to × every message ×
a per-message receipt lookup, inside a single 1 s mutation, so the timeout
recurs as the corpus grows.

**To score m8-a08…a12 on their merits rather than on a pre-existing dead chain,
the grader invoked `digest:tick` once by hand** (it succeeded, emitting 52 rows
and re-arming the chain) and then re-ran every digest probe on the restored
chain across three fresh 120-second periods. All results below are from the
restored chain.

### 8.2 Digest results

Isolated personas per period: **U1** target (gains a follower, a followed
author's post, and one unread DM), **U2** group member, **U3** author, **U4**
member of nothing, **U5** removed from the busy group *before* its traffic.

```
U1: rows=1 pushes=1 counts={newFollowers:1, newPostsInFollowing:1, unreadMessages:1, unreadChats:1}
U2: rows=1 pushes=1 counts={0,0,3,1}
U3: rows=1 pushes=1 counts={1,1,0,0}
U4: rows=1 pushes=0 counts={0,0,0,0}
U5: rows=1 pushes=1 counts={0,0,3,1}
```

| assertion | result | evidence |
|---|---|---|
| m8-a08 | **pass** | exactly one logged digest payload for the active user with counts 1/1/1/1; zero users had more than one digest push in the period |
| m8-a09 | **pass** | U4 — no activity in the period → a zero-count marker row but **no push**. (The grader's intended "quiet" persona U2 was mis-designed — it was a member of the busy group — so U4 carries this assertion.) |
| m8-a10 | **pass** | the following idle period emitted **0** digest pushes for the target and 0 system-wide; a zero-count marker row was still recorded |
| m8-a11 | **pass** | the backend was killed and restarted **40 s into a 120 s period** (§2, second PID pair); when the period completed, every user had exactly one digest row and one push — no double emission, and the chain survived this restart |
| m8-a12 | **FAIL** | **U5, removed from the group before its three messages were sent, recorded `unreadMessages=3`, `unreadChats=1` and received a digest push.** Reproduced identically across two independent periods (`periodStart` 1788747480000 and 1788747960000). The plain non-member U4 is correctly excluded. Cause: `convex/digest.ts:150` collects `members` rows `by_user` with no `status`/`statusAt` filter. Defect **d-04**. |

### 8.3 Remaining M8 assertions

`m8-a01, a03, a04, a05, a06, a07` — pass, builder suite (§3.1).
`m8-a02, a13, a14, a15, a16` — pass, from `receipts/choreo-m8.jsonl` (Insights
like refresh; same-account live message; cross-device read-state clearing;
dual-offline convergence with both writes flushing at 75.0 / 75.1 ms; receipts
advancing after the dual-offline flush).
`m8-a17, a18` — **not-run**: `choreo-m8.jsonl` records
`supplementalExternal: ios-simulator-m8, status "not-recorded", pass null`.

## 9. Phase 2 — coverage-manifest spot-verification

All **58** suite-required assertions of M1–M6 and M8 were traced from
`coverage-manifest.json` into `scripts/tests/*.mjs` and compared against the
frozen assertion text. (M7 has no tests at all — §3.2.)

**M1, M2, M4, M5, M6, M8 — honest.** Every mapped test exercises its assertion's
observable.

**M3 — dishonest mapping.** Five of seven do not:

| frozen assertion | required observable | test emitted under that ID | exercises it? |
|---|---|---|---|
| m3-a03 | starting the same DM again reuses the channel | `member-rules-snapshot` (admin-only add/remove, idempotent add) | **no** |
| m3-a04 | create a group with Alice, Bob **and Carol** | `second-group-coexists` (a second Alice+Bob group) | **no** — that is m3-a05's observable |
| m3-a05 | a second group with the same three members coexists | `dm-delivery-both` (a DM reaches both participants) | **no** |
| m3-a10 | quoted reply renders the excerpt in its bubble | `quote-excerpt-rendered` | yes |
| m3-a11 | **tapping** the quoted excerpt jumps to the original | `reply-preserves-quote` (re-reads the quote payload) | **no** |
| m3-a14 | a non-admin cannot remove members | `dm-dedupe-same-pair` | **no** — that is m3-a03's observable |
| m3-a15 | seed is idempotent | `seed-idempotency` | yes |

The pattern is **stale ID numbering, not fabrication**: the same suite also emits
`m3-a16`…`m3-a19`, IDs that do not exist anywhere in the frozen manifest, and
`scripts/gen-coverage.mjs` regenerates the manifest mechanically from
`assertions.json` while the tests were never re-keyed. The runner's coverage
check (`scripts/acceptance.mjs`) compares **ID lists only**, so it cannot detect
the mismatch — and the resulting receipt prints `PASS m3-a11 reply-preserves-quote`
beside a frozen assertion about tapping a quote to jump.

Materially, most of the M3 observables *are* covered somewhere: the grader
independently confirmed m3-a03/a04/a05/a14 pass via the API (§6.2), and m3-a11's
tap-to-jump is covered by the choreography assertion
`quoted-reply-excerpt-and-jump`. But the mapping itself does not hold, which is
the test the protocol sets. **Verdict: `dishonest`, `dishonestMilestones: ["M3"]`.**
M3 is adjudicated `capability-failure` (scoring-only, non-retroactive) and its
checklist scores not-passed in O1; the grader's honest per-assertion results are
retained unchanged in `assertionResults`.

Coverage weaknesses that fall short of dishonesty are filed as observations, not
as part of the verdict: m2-a22's mapped test passes on a single-page Following
feed (§6.1), and m4-a07's mapped test drives the explicit clear rather than a
second tap (the client does send the clear — §6.3).

## 10. Choreography artifacts and timing records

`[choreo]` assertions are scored from `receipts/choreo-m*.jsonl` and their
observation sidecars, never re-driven by the grader. Every segment records
`green: true` with a sha256-bound suite receipt and a
`setup-identity.json` hash. The harness ran real Playwright chromium against
`CHOREO_BASE_URL` (`choreo/choreography.mjs:2977, 3018-3038`), not an in-process
fixture.

Best-of-3 timing observations (harness-recorded; load at grader bring-up
`23.36 26.64 26.46`, and between `19.05` and `27.86` across the session):

| assertion | measurements (ms) | best | bound |
|---|---|---|---|
| m1-a09 profile edit live | 69.9 / 69.5 / 73.2 | 69.5 | — |
| m2-a04 feed post live (text) | 2301.3 / 1802.8 / 2307.4 | 1802.8 | — |
| m2-a07 follower count live | 11946 / 407.7 / 2613 | 407.7 | — |
| m2-a14 like count live | 2002 / 1946.6 / 1953.1 | 1946.6 | — |
| m2-a19 reply count live | 1574 / 1843.4 / 1838.5 | 1574 | — |
| m3-a01 DM live | 235.9 / 115.1 / 118.8 | 115.1 | — |
| m3-a06 typing appears | 8.6 / 9.2 / 8.7 | 8.6 | 2000 |
| m3-a07 typing expires | 3303 / 3303.2 / 3297.9 | 3297.9 | 5000 |
| m4-a02 photo live | 277.1 / 136.5 / 129.1 | 129.1 | — |
| m4-a05 reaction live | 258.3 / 254.9 / 249.6 | 249.6 | — |
| m4-a08 edit live | 95.5 / 96.5 / 101 | 95.5 | — |

`m2-a07`'s first attempt (11.9 s) is a load artifact; best-of-3 is what is judged,
per the protocol.

**Two choreography assertions were not implemented / not required by the harness
and are scored by the grader against `assertions.json` instead:**
`sender-avatar-identity-when-rendered` (skipped → m3-a02 **fail**, §5.4) and
`quoted-reply-excerpt-and-jump` (passed but `required:false` → m3-a11 **pass**).

**No simulator artifact exists.** Both `choreo-m6.jsonl` and `choreo-m8.jsonl`
record their `supplementalExternal` entry as `status: "not-recorded", pass: null`,
with the reason "simulator evidence is recorded separately from web green". The
lane exported iOS bundles (`dist-ios-m1`, `dist-ios-m6`, `dist-ios-m8`) but
produced no recording and no receipt. `lib/store.ts:18-25` states plainly that
the native Hermes build has no IndexedDB and falls back to in-memory stores, so
"the durable offline queue then lasts only for the process lifetime on native";
no AsyncStorage or SQLite dependency is installed. The nine native-artifact
assertions (m6-a01…a07, m8-a17, m8-a18) therefore record `not-run`, and this is
the dominant input to O4. The gap is **disclosed rather than claimed**, which is
what keeps O4 above its floor.

## 11. O5 — the scale replay was never attempted

The observing subject for O5 is the scale replay, and its applicability predicate
is `replay-attempted`. No scale replay exists in this lane: no replay record, no
checkpoint or invariant-manifest verification, no `o5Inputs`, no performance
probe results, and `scripts/replay.mjs` has no ceiling, p95 or invariant logic at
all. The instance holds roughly 100 posts and 80 messages, not the envelope's
~100k. The only replay executed is the M6 conformance sample (`sample-50.log`,
50 actions), which is assertion m6-a13 and not the scale replay.

**O5 records `null`** (never-attempted replay).

## 12. Artifacts produced by this grading session

All under `lanes/muse-convex/grading/`:

```
grader-report.json            the machine record (schema-validated, §13)
trace.md                      this file
build-report.mjs              builds the report
validate.mjs                  AJV schema validation
tools/env.mjs                 shared grader helpers
tools/fast.mjs                §4.1 §4.4 §4.6 §6.1 §6.2 §6.3 §7
tools/timed.mjs               §4.3 §4.5
tools/apimd-variation.mjs     §4.7 (written from API.md alone)
tools/extra.mjs               §6.4
tools/web-smoke.mjs           §5.4 first observation
tools/web-eph2.mjs            §5.2 §5.3
tools/m3a02.mjs               §5.4 confirmation
tools/digest-p1.mjs           §8 activity placement
tools/digest-p2.mjs           §8 readback
out/*.json                    raw probe results
out/*.png                     screenshots (§5.2 §5.3 §5.4)
receipts-as-delivered/        copy of the lane's receipts before the grader re-ran the suites
logs/                         process logs; contains no credentials
```

## 13. Validation and cleanup

`grading/grader-report.json` validates against
`instrument/grader/grader-report.schema.json` with AJV 8.20.0
(`ajv/dist/2020`, draft 2020-12): **schema-valid: true**.

Processes started by the grader and stopped at the end, by PID, with no
`pkill`/`killall` used: 66514, 67241 (first backend pair, stopped during the §8
restart test), 77951, 78141 (second backend pair), 3959 (static web server).
Ports 49800, 49811 and 49812 were released. No other lane's processes or ports
were touched. State the grader changed and did not revert: the deployment is left
on the fixture pack's **shortened-windows / shortened-digest** profile (the
prescribed grading configuration), the digest scheduler chain is left **alive**
after the manual re-arm in §8.1, and the database carries the grader's probe
users, posts and chats. The one destructive probe (TB3, an unauthenticated
profile rewrite) was restored to its original values immediately.
