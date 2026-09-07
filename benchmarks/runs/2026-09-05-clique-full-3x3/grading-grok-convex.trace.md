# Grader evidence and action trace — lane `grok-convex` (social-messenger)

Sanitized, published artifact. Credentials, session tokens and storage URLs are
redacted or referenced by shape only; the raw session is retained privately.
Companion machine record: `grading/grader-report.json`.

| | |
|---|---|
| Lane | `/Users/ccheever/clique-full-20260905/lanes/grok-convex`, backend `convex-1.45.0` (anonymous local backend) |
| Run scope | full (M1–M8 plus the scale replay) |
| Instrument pin | assertions `0.3.0-m8`, applicability `0.3.0-m8`, fixture pack `0.2.1-m8`, choreography `0.3.6-m8` |
| Grader | family `claude`, model `claude-opus-5`, fresh session, no builder context |
| Session outcome | `completed` — no grader-abort, no phase re-run for grader-side failure |
| Machine | macOS arm64, Node 24.18.0, shared host (1-min load average 12–30 throughout; recorded per measurement below) |

## Deviations recorded for this run

1. **No holdout probe set was hash-committed for this wave.** Execution-order
   phase 4 was skipped by instruction. `wave.probeSetSha256` records the
   sentinel `none-uncommitted`, `probeResults` is empty, and no probes were
   invented. O3 records `null` because its sole defined input does not exist.
2. **The grading family has not passed the calibration gate.**
   `calibrationPassed: false`, `sameFamilyGraded: false`. The grade is
   labelled `uncalibrated-grader`.
3. **Timing-sensitive checks are best-of-3** with machine load recorded beside
   each measurement.

## Excluded material

`diary.md`, `essay.md`, `final-report.md` and `run-log.md` are present in the
lane directory and were **not opened**. No other lane under `lanes/` was read.
The session is not contaminated.

The lane wrote **no `run-record.json`**. Replay accounting was taken from
`receipts/scale-replay.json` and independently re-verified against the fixture
pack's invariant manifest.

## Environment handling

Processes started by the grader, all on ports 49500–49519, all stopped at the
end; no other process was signalled and no `pkill`/`killall` was used.

| Purpose | Command | Ports |
|---|---|---|
| Dev backend | `npm run convex:dev` | 49501 (cloud), 49502 (site) |
| Scale instance | `convex dev --local-cloud-port 49503 --local-site-port 49504` from `scale-instance/` | 49503, 49504 |
| Web client | `npm run web` (Expo) | 49500 |

All of them were stopped at the end of the session by PID (`kill` on the
specific pids only); ports 49500–49519 were verified clear afterwards.

Two side effects of running the lane's documented entrypoint, disclosed:

- `scripts/acceptance.mjs` writes `receipts/mN-suite-receipt.json` on every run,
  so the grader's phase-1 run **overwrote the lane's own suite receipts**. The
  builder's originals had been read and recorded before that happened; they have
  been **restored content-faithfully** (file mtimes are the grading date), and
  the grader's own run copies are kept at
  `grading/logs/grader-run-receipts/`.
- The grader's probes wrote test content to the dev instance (posts, messages,
  reactions, one throwaway account, digest activity) and restarted the dev
  backend once for the m8-a11 restart test. The **scale instance was queried
  read-only**; the celebrity write-path probe was deliberately skipped so the
  verified fixture state stays intact.

One self-inflicted slip, disclosed: two scratch probe files were briefly written
into `instrument/fixtures/` because a shell working directory persisted across
commands. They were deleted immediately and the instrument tree was verified
back to its committed contents (no file under `instrument/` is newer than the
pack's own timestamps). All later work used absolute paths.

---

<a id="phase1-suite"></a>
## Phase 1 — the lane's documented acceptance entrypoint

`npm run acceptance -- --milestone mN` for `m1`…`m8` against the running dev
backend. Full log: `grading/logs/acceptance-all.log`. Load average at start:
14.67.

| Milestone | Suite verdict | Detail |
|---|---|---|
| m1 | SUITE PASS | 7/7 |
| m2 | **SUITE FAIL** | 21/22 — `m2-a10: unfollowed author missing from global` |
| m3 | **SUITE FAIL** | 5/7 — `m3-a10: no quoted reply`, `m3-a11: Cannot read properties of undefined (reading 'replyToId')` |
| m4 | SUITE PASS | 5/5 |
| m5 | SUITE PASS | 6/6 |
| m6 | SUITE PASS | 5/5 |
| m7 | **`unknown milestone`** | `scripts/acceptance.mjs` has no m7 runner |
| m8 | SUITE PASS | 6/6 |

The three failures are **suite fragility, not app defects** — each test reads a
fixed-size first page of a corpus that has grown across runs. All three
observables verify as correct when re-checked with full paging (see
[m2-a10](#m2-a10), [m3-a10](#m3-a10)). Filed as defect **d-08**.

The `m7` result is not fragility: M7 was never built.

<a id="d-07"></a>
### Backend start (defect d-07)

`npm run convex:dev` reports **8 TypeScript errors** (TS2339 ×6 in
`convex/conversations.ts:324–399`, TS2345 ×2 in `convex/messages.ts:51–54`) and
aborts the function push:

```
✖ TypeScript typecheck via `tsc` failed.
Found 8 errors in 2 files.
```

The local backend binary still came up on 49501/49502 and served the functions
the lane had previously deployed (`admin:counts`, added late in the lane's own
session, responds — so the running deployment does match the shipped source).
Grading proceeded against that deployment. From a genuinely clean checkout the
documented command would leave no functions deployed.

---

## Phase 2 — coverage-manifest spot-verification

**Verdict: `dishonest`. Adjudicated milestones: M2, M4.**

Every suite-required mapping in `coverage-manifest.json` was read against its
test body in `scripts/acceptance.mjs`, and re-executed independently wherever
the observable was checkable another way. The bar applied: *a mapping is
dishonest when the mapped test cannot fail even if the asserted observable is
false.*

### Mappings that cannot fail

| Assertion | Mapped test | Why it cannot fail |
|---|---|---|
| `m2-a13` "no preview card renders" | body is a bare comment `/* no unfurl fields exist on post objects */` | asserts nothing |
| `m2-a17` "reposting again removes the repost" | issues `setRepost(intent:'clear')` | asserts nothing after the call |
| `m2-a27` "implicit self-follow does not change counts" | queries `users:me` twice back-to-back and compares | compares a value to itself |
| `m2-a22` "scrolling loads the next page in Following" | checks page 1 is non-empty | never pages |
| `m4-a07` "tapping ❤️ again removes the reaction" | issues the repeat reaction | asserts nothing after the call |

`m2-a18` and `m2-a26` additionally pass vacuously when their precondition post
is not found (`if (post) { … }` with no else).

Two of these concealed **real failures** that independent execution found:
`m2-a22`/`m2-a23` (web feed capped at 60 items behind an inert "Load more") and
`m4-a07` (a reaction can never be removed). That is what makes the adjudication
material rather than stylistic.

### Weak but honest — recorded, not adjudicated

- `m3-a15` maps to a test that replays only the **M1** segment and compares only
  the **user** count, although the assertion covers every installed segment. The
  behaviour itself passes at full scope when re-verified ([m3-a15](#m3-a15)).
- `m3-a11` maps to an API field check rather than the tap/jump it names — but
  the harness's own browser assertion `quoted-reply-excerpt-and-jump` does cover
  it, best-of-3.
- `m6-a11` is a bare comment delegating to `m6-a10`; the demo it delegates to
  genuinely exercises every listed operation (verified by reading
  `scripts/custom-client-demo.mjs`).
- `m2-a12`, `m5-a11`, `m8-a01` are weak proxies that can nonetheless fail.

### Separate finding

`coverage-manifest.json` declares mappings for `m7-a01/a03/a04/a06/a07/a09`
while `scripts/acceptance.mjs` has **no m7 runner at all**. M7 is not listed as
adjudicated only because it was never attempted and its checklist already scores
not-passed.

---

## Phase 3 — independent checklist execution

Probe scripts are retained under `grading/probes/`; browser screenshots under
`grading/screenshots/`.

### M1

<a id="m1-a07"></a>**m1-a07 — logout revokes the token server-side.** PASS.
`users:me` succeeds before logout; after `auth.logout` the same token fails
`users:me` and `conversations:list` with `Not signed in.`, and
`GET /api/me` with the bearer token returns **401**.

<a id="m1-a11"></a>**m1-a11 — uploaded avatar renders.** PASS. `/profile/alice`
renders a 256×256 image under `sm-avatar` sourced from the storage endpoint.
(An earlier check against `sm-profile-avatar` returned nothing — that test id
belongs to the *edit form*, not the profile header; the grader's first reading
was wrong and is corrected here.) Screenshot `08-profile-avatar.png`.

<a id="m1-a12"></a>**m1-a12 — password KDF.** PASS. `convex/helpers.ts:11,25–29`:
`@noble/hashes` **scrypt** at **N=16384, r=8, p=1, dkLen=32** with a 16-byte
random salt, stored as `scrypt$N$r$p$salt$hash`. RFC 7914 standard published
parameters. `verifyPassword` re-derives with the stored parameters.

<a id="m1-a13"></a>**m1-a13 — no plaintext or reversible storage.** PASS. The
`users` table declares only `passwordHash` (`convex/schema.ts:5–23`). A literal
byte scan for the fixture passwords found **0 occurrences** in: both backend
SQLite files (dev and scale), all seven iOS Hermes bundle exports
(`artifacts/m*-ios/**/*.hbc`), both backend logs, and the client sources under
`app/`, `components/`, `lib/`, `context/`, `config/`. Fixture credentials appear
only in `scripts/custom-client-demo.mjs` and `scripts/acceptance.mjs` (defect
d-12, cosmetic).

### M2

<a id="m2-a10"></a>**m2-a10.** PASS on independent execution (suite reported
FAIL). Paging Bob's Global feed to exhaustion returns **4 posts authored by
carol**, whom Bob does not follow (`users:getByHandle` → `following:false`). The
suite's fixed 40-item window over 185 accumulated posts is what failed.

<a id="m2-a12"></a>**m2-a12 / <a id="m2-a13"></a>m2-a13.** PASS. The browser pass
found the URL rendered as a `sm-text-link` node (`https://example.com/cafe`),
and a whole-DOM scan for any `preview|unfurl|opengraph|link-card|embed` test id
returned **none**. `onPressLink` is wired to `Linking.openURL`.

<a id="m2-a17"></a>**m2-a17.** PASS. `repostCount` 1 → 0 after `intent:'clear'`,
and the "reposted by" attribution disappears from the feed.

<a id="m2-a21"></a>**m2-a21.** PASS. Reply text appears on the thread screen and
in neither feed.

<a id="m2-a22"></a><a id="m2-a23"></a><a id="d-04"></a>**m2-a22 / m2-a23 — FAIL
(defect d-04).**

```
Global    : 60 items → click "Load more" → 60 items   (1 such control present)
Following : 60 items → 8 wheel scrolls    → 60 items
```

`app/index.tsx:107–111` issues exactly two fixed queries (`limit: 40`, then a
follow-up `limit: 20`) and `app/index.tsx:283–287` renders a `Load more`
`Pressable` **with no `onPress` handler**. There is no `onEndReached` and no
infinite scroll. Beyond 60 items the feed cannot be paged in the app at all.
API-level cursor paging does work, which is why the suite's API-shaped test
passed.

<a id="m2-a24"></a>**m2-a24.** PASS. Full cursor paging on the identity key
`(clientId, repostedByHandle)`: Global 10 pages / 185 items, Following 9 pages /
160 items, **0 duplicates**; on the scale instance u0500 paged 61 pages / 1220
items with **0 duplicates**.

<a id="m2-a25"></a>**m2-a25 / <a id="m2-a27"></a>m2-a27.** PASS. A freshly
registered account with `followingCount 0` / `followerCount 0` sees its own
original post in its Following feed, and the implicit membership leaves both
counts at 0.

### M3

<a id="m3-a10"></a>**m3-a10 / m3-a11.** PASS on independent execution (suite
reported FAIL). Paging `d-alice-bob` fully surfaces fixture messages
`sm0001`…`sm0006`, with `sm0002 → sm0001`, `sm0003 → sm0002`, `sm0006 → sm0005`
carried in `replyToId`, and the quoted source present in the same history. The
harness separately recorded `quoted-reply-excerpt-and-jump` passing best-of-3
(226.7 / 221.8 / 228.7 ms) using selector `sm-convo-quote-preview`. The grader's
own scroll measurement was inconclusive because the conversation uses an inner
scroller with `scrollIntoView` (`components/ConversationScreen.tsx:317–320`); the
harness receipt is the governing evidence.

**m3-a02 — not-run.** The harness skipped `sender-avatar-identity-when-rendered`
with `outcomeClass: "instrument"` and the reason "the kit does not render sender
avatars in the default 1:1 layout". This is an instrument limitation, not a lane
gap: the grader's browser pass found the lane **does** render
`sm-convo-sender-avatar` (6 nodes, all with images) in the group conversation
layout. Screenshot `09-group-convo.png`.

**m3-a13 — not-run.** No harness assertion separately evidences that a removed
member retains her local copy of pre-removal history; the M3 segment records the
live cutoff only. `[choreo]` assertions are not grader-driven, so this is
recorded as not demonstrated rather than failed.

<a id="m3-a15"></a>**m3-a15.** PASS at the assertion's **full stated scope**.
Replaying `starter-m1.log`, `starter-m2.log` and `starter-m3.log` a second time
left every entity count identical:

```
before {conversations:9, dms:3, follows:15, groups:6, likes:15, messages:233, posts:159, replies:14, reposts:27, users:15}
after  {conversations:9, dms:3, follows:15, groups:6, likes:15, messages:233, posts:159, replies:14, reposts:27, users:15}
```

<a id="d-10"></a>**Defect d-10.** The group route resolves by **display title**:
`/conversation/group/Weekend%20Plans` loads the chat (28 bubbles), while
`/conversation/group/g-starter` and `/conversation/group/weekend-plans` both
render "Group not found". The dev instance currently holds two distinct groups
titled "Second Same" and two titled "Digest Private", which are therefore not
individually addressable.

### M4

<a id="m4-a06"></a>**m4-a06.** PASS. 👍 → ❤️ leaves exactly one reaction (❤️).

<a id="m4-a07"></a><a id="d-05"></a>**m4-a07 — FAIL (defect d-05).** Sequence
👍 → ❤️ → ❤️ leaves `[{emoji:"❤️", count:1}]`. `convex/messages.ts:255–258`
patches the existing row only when the emoji **differs**; a clear branch exists
at `:252` behind the sentinel `emoji:"none"`, but
`components/ConversationScreen.tsx:322–331` (chip press) and `:365–372` (picker)
always send the literal emoji. **No path in the app removes a reaction.**

<a id="m4-a09"></a>**m4-a09.** PASS. "edited" labels render on edited bubbles.

<a id="m4-a10"></a>**m4-a10.** PASS. Shortened-windows config confirmed live via
`config:get`: `editWindowSeconds 60`, `deleteForEveryoneWindowSeconds 120`,
disappearing `off / 24h→180 s / 7d→300 s`.

```
t+0     edit → success
t+68 s  edit → error "Edit window has closed."
stored text unchanged: "edited inside window"
```

`convex/messages.ts:191` compares server `now()` against `createdAt` and the
config — no caller-supplied timestamp is accepted.

<a id="m4-a12"></a>**m4-a12.** PASS. Pre-delete fetch of the storage URL:
`200`, 2080 bytes. After delete-for-everyone: same URL `404`, and `media:urlFor`
no longer mints a URL. `convex/messages.ts:224` deletes the storage object.

### M5

<a id="m5-a01"></a>**m5-a01.** PASS. DM set to the `24h` option (ttl 180 s under
the grading config). With no client attached across expiry, the message was
absent afterwards from `messages:history`, `messages:list` **and**
`messages:forCache` (the offline-cache feed).

<a id="m5-a02"></a>**m5-a02.** PASS. A browser client left **connected** through
expiry dropped the message with no manual refresh; a client opened **fresh after**
expiry never rendered it. Screenshot `10-after-expiry-connected.png`.

<a id="m5-a03"></a>**m5-a03.** PASS. Searching the expired message's unique
token returned **0** results online and **0** with the browser context forced
offline (`sm-search-offline` indicator present). Screenshot
`11-offline-search.png`.

<a id="m5-a05"></a>**m5-a05.** PASS. The second `messages:openViewOnce` is
refused.

<a id="m5-a06"></a><a id="d-01"></a>**m5-a06 — FAIL (defect d-01, blocker).**

```
first open (permitted)          → 200, 2066 bytes
second messages:openViewOnce    → refused ✓
re-fetch of the SAME asset URL  → 200, 2066 bytes   ✗
media:urlFor(storageId) with NO token, after the view
                                → mints a URL → 200, 2066 bytes   ✗
media:accessCheck               → {ok:false, reason:"view-once"}  (advisory only)
```

Root cause `convex/media.ts:13–18`: `urlFor` is a **public query taking only a
storage id** — no session, no membership check, no revocation check. The
advisory `accessCheck` gets the answer right and nothing consults it.

The same hole crosses the user boundary. Carol is not a member of the
alice↔bob DM. `messages:history` correctly returns 0 messages for her — but:

```
media:urlFor(storageId of that DM's image)  → URL minted (no token required)
fetch                                       → 200, 2087 bytes
```

Message bodies are protected; **media is not**. Members legitimately receive
`mediaReference` (the raw storage id) in `messages.history`, so the ids needed
to exploit this are handed out by design, and they stay valid after view-once
consumption and after a member is removed from a group.

<a id="m5-a09"></a><a id="m5-a10"></a><a id="m5-a11"></a>**m5-a09 / a10 / a11.**
PASS in the browser. "car" → `Carol Chen @carol`. "coffee" → 3 hits under two
`sm-search-group` headings (`WEEKEND PLANS`, `ALICE ALVAREZ`) — grouped by chat.
Screenshot `05-search.png`.

**m5-a12.** PASS (harness receipt), independently corroborated: with the browser
context forced offline the search screen still returned 3 hits for "coffee" with
the offline indicator shown.

### M6

**m6-a01…a04 — not-run.** The native/simulator proof does not exist.
`artifacts/native/m6-ios-run.json` records `attempted: true`, `pass: false`,
`status: "attempted-no-native-binary"` — Expo export produces a Hermes `.hbc`
bundle rather than an installable `.app`/IPA, so `simctl` could not cold-start
the app. None of `choreography/simulator.md`'s required artifacts
(`m6-ios-screen.mp4`, `m6-ios-receipts.jsonl`, digests) are present. Cold-start
offline reads, cached media, cold-offline search and view-once non-caching were
therefore **never demonstrated**. The lane states this plainly and claims
nothing — that honesty is credited in O4.

**m6-a05 / a06 / a07 — pass on the web artifact.** `choreography.mjs:2302–2352`
shows the M6 web segment requires all three clauses: both offline-composed
bubbles must expose semantic receipt value `pending`; both must arrive on the
second client in compose order after reconnect; both receipts must reach `read`.
`receipts/m6-choreo.jsonl` records it passing (`flushMs 617.8`).

<a id="m6-a11"></a>**m6-a11.** PASS by inspection.
`scripts/custom-client-demo.mjs` exercises authenticate, `conversations.list`,
`messages.history` with a limit, `messages.send`, and receipt of the sent
message by documented polling.

<a id="m6-a12"></a>**m6-a12 — grader-written variation from API.md alone.** PASS.

```
POST /api/login                                    → 200
conversations.list                                 → 7 entries; "Weekend Plans" resolved
messages.history(conversationClientId, limit: 5)   → success
latest message: {id, sender: alice, text, serverTimestamp}
GET /api/messages?conversationId=…  (documented)   → 200
```

<a id="d-09"></a>Documentation friction found while doing it (defect d-09):
API.md documents `cursor?` as an argument but never names the field to feed back
(`nextCursor`), and passing an explicit `cursor: null` errors with
`ArgumentValidationError … Validator: v.float64()`. API.md also does not
document which `conversations.list` field identifies a named conversation.

<a id="m7"></a>
### M7 — never attempted

`npm run acceptance -- --milestone m7` prints `unknown milestone`;
`scripts/acceptance.mjs:653` registers runners for m1–m6 and m8 only. There is
no poll module in `convex/` and no message-count surface. No `m7` suite receipt,
choreography receipt or iOS artifact exists. All nine M7 assertions record
`not-run`. (The vendored UI kit does ship `sm-poll*` test ids — the kit supports
polls; the lane did not build them.)

### M8

Recorded here because the report schema's `assertionResults` pattern
(`^m[1-7]-a[0-9]{2}$`, `additionalProperties: false`) cannot carry M8 keys even
though applicability.json places M8 in O1/O2's full-run observing set.
**16 pass / 18.**

| Assertion | Result | Evidence |
|---|---|---|
| m8-a01 | pass | Six lifetime totals render; `insights.posts = 127` matches an independent count of alice's original posts in the global feed (127); followers/following match the profile. |
| m8-a02 | pass | Harness receipt `m8-a02-insights-like-refresh`, `beforeLikes 3 → afterLikes 4`. |
| m8-a03 | pass | 7 rows, `Today` bucket carries today's 3 posts. |
| m8-a04 | pass | Zero days render as `0`, not omitted (`2026-09-04`…`2026-09-01` all present). |
| m8-a05 | pass | After seeding likes, the 2-like post ranks first. |
| m8-a06 | pass | No post older than 24 h appears. |
| m8-a07 | pass | Like-count ties order newest-first. |
| m8-a08 | pass | One digest per active user with correct counts (bob `unread 1/1`; alice `newPostsInFollowing 1`; dave `unreadChats 1 / unreadMessages 3`). |
| m8-a09 | pass | henry, erin, frank — no activity, no digest. |
| m8-a10 | pass | A fully idle period emitted **0** digests. |
| m8-a11 | pass | A **real backend restart** mid-period, then another digest run: `pre {bob:1}` → `post {bob:1}`, no duplicate. |
| m8-a12 | pass | A group grace and henry are not members of contributed nothing to their counts (`grace.unreadChats 0`, henry no digest) while member dave counted 1 chat / 3 messages. |
| m8-a13–a16 | pass | Harness receipts (`same-account-message-live`, `cross-device-read-state`, `dual-offline-convergence`, `dual-offline-receipts`). |
| m8-a17, m8-a18 | not-run | Durable-queue restart is a native artifact; `artifacts/native/m8-ios-run.json` records the same `attempted-no-native-binary` status. |

---

## Scale replay — invariant conformance and degradation rules

The lane's `receipts/scale-replay.json` was not taken on trust. The retained
scale instance (528 MB of local state) was restarted on port 49503 and queried
directly.

### Settle accounting and custody

```
actionLog.sha256 b26bf1ae…  ==  fixtures/scale-log.sha256 b26bf1ae…   ✓
actionCount 167157          ==  manifest artifacts.scale.log.actionCount    ✓
settledPrefix 167157, failedActions 0                                        ✓ (full settle)
checkpoint 10%: settledPrefix 24777 / prefix f1f4abf9…  == manifest          ✓
checkpoint 50%: settledPrefix 88057 / prefix f3ce5872…  == manifest          ✓
wallSeconds 2222 (ran to completion; the cap is an unfrozen placeholder)
```

### Independent end-state verification — 41 of 41 sampled invariants conform

Named O5 fixtures (all exact): `u0500` 500 follows / 100 conversations;
`u0005` 5 follows; `u0900` **900 followers / 200 posts**; `u0901`'s following set
exactly `{u0001,u0002,u0003,u0004,u0900}`; `g0001` 50-member roster matching the
manifest member-for-member.

Grader-chosen sample (disclosed, since the wave's committed sample seed does not
exist): per-user following and conversation counts for
`u0001, u0042, u0117, u0333, u0500, u0777, u0900, u0901, u1000, alice, bob, carol`;
group member counts for `g-starter, g0001, g0007, g0050, g0100`; and per-chat
message counts by **full paging** — `d-alice-bob` 6, `g-starter` 9, and the busy
chat `g0001` counted exactly at **10,000** over 126 pages in 5,345 ms.

**Result: no nonconformance.** O5's band-0 branch does not fire.

### Degradation rules (published, hardware-independent), k=20 after 3 warm-ups, sequential

Load average during this block: 21.02 / 21.97 / 40.02.

| Rule | Measured | Verdict |
|---|---|---|
| 10k-chat page 50 ≤ 3× page 1 | 1.67 ms vs 1.79 ms (**0.93×**) | pass |
| 500-follow Following feed ≤ 3× 5-follow | 1.81 ms vs 1.57 ms (**1.15×**) | pass |
| M8 celebrity read path ≤ 3× 5-follow | 1.64 ms vs 1.57 ms (**1.04×**) | pass — but see below |
| Cold-start sync of the 100-conversation probe user | **126.5 ms**, 100 conversations, no timeout | pass |
| Global message search, full corpus | **structurally fails** — see d-02 | fail |
| Celebrity write path; receipt aggregation | not measured — both mutate the verified fixture state | n/e |
| Search / Insights / Trending 10% vs 50% vs full | not evaluable — only the final-state instance was retained | n/e |

Diagnostics (indicative only, local colocated): Insights for the probe user
p95 1.65 ms (server-side aggregation — it does **not** transfer the corpus to the
client), Trending p95 1.56 ms.

<a id="d-02"></a>**Defect d-02 — search is silently unbuilt over the whole scale
corpus.** `convex/helpers.ts:200–208`:

```ts
export async function indexMessageTokens(…) {
  if (await replayMode(ctx)) return;      // ← no tokens written during replay
```

`scripts/scale-replay.mjs:40` sets `replayMode: true`; nothing clears it or
backfills, and it is still `true` on the instance today. Consequence, measured:

```
u0001 is a member of g0001, whose messages read "Busy group coffee signal 09998."
  in-chat search  "coffee" in g0001 → 0 hits
  global search   "coffee" / "busy" / "signal" / "09998" → 0 hits
(people search is unaffected: "scale" → 50 hits, "u0500" → u0500)
```

The brief's replay contract authorises disabling the **push seam** only.

<a id="d-03"></a>**Defect d-03 — the Following feed truncates at the envelope.**
`convex/feed.ts:6` caps the scan at 800 feed events and `:67` returns a cursor
only when the page filled, so a sparse-follow user's feed ends early:

```
u0901 (follows the 200-post celebrity u0900 + 4 accounts): 7 posts TOTAL, 1 page,
      of which only 2 are the celebrity's — no next cursor
u0005 (5 follows):                                          6 posts TOTAL, 1 page
u0500 (500 follows):                                     1220 posts, 61 pages, 0 duplicates
```

The celebrity read-path ratio passes numerically only because that query returns
7 items instead of a full page.

<a id="d-11"></a>**Defect d-11 — filter-after-take in search.**
`convex/search.ts:59–63` takes the 200 newest matching token rows *before*
applying the membership and conversation filters at `:67–69`, so accessible
matches are dropped whenever they are not among the globally newest rows. This
is the mechanism that would keep search broken even if the index existed.

---

<a id="d-01"></a><a id="d-06"></a>
## Trust-boundary observations (not probe results)

No holdout probes were run — none exist for this wave. These surfaced during
checklist execution and are filed as defects, scoring under O2, not O3.

- **d-01 (blocker)** — `media:urlFor` mints storage URLs with no authorization:
  cross-user private media read, and view-once media still fetchable after
  consumption. Full transcript above under [m5-a06](#m5-a06).
- **d-06 (major)** — `convex/push.ts:5–9`: `token` is `v.optional` and is
  validated only when supplied, while `targetHandle` filters freely. A tokenless
  call for `targetHandle: "bob"` returned three payloads including a private
  message's preview text.

What **is** correctly enforced, verified in the same pass: non-member
`messages:history` returns 0 messages; non-member `messages:send` is refused
(`Not a member of this conversation.`); non-member `conversations:updateSettings`
is refused; non-admin group rename and member-remove are refused; logout revokes
server-side; the edit and delete windows are enforced against server time;
disappearing expiry is refused across history, list and the offline-cache feed.

---

## Timing records (best-of-3)

From the harness's retained per-attempt receipts. Load average when the grader
read them: 23.4.

| Subject | Attempts (ms) | Best |
|---|---|---|
| m1-a09 profile edit live | 78.7 / 79.2 / 79.7 | 78.7 |
| m2-a04 feed post live | 241.4 / 421.9 / 262.7 | 241.4 |
| m2-a07 follow count live | **25410.1** / 2297.3 / 2595.0 | 2297.3 |
| m2-a14 like count live | 785.1 / 829.8 / 874.1 | 785.1 |
| m2-a19 reply count live | 567.2 / 592.2 / 551.8 | 551.8 |
| m3-a01 DM live | 137.7 / 166.3 / 110.0 | 110.0 |
| m3-a06/a07 typing indicator | 7717.4 / 3903.4 / 3859.3 | 3859.3 |
| m4-a02 photo live render | 468.2 / 1128.9 / 985.9 | 468.2 |
| m4-a05 reaction live | 479.6 / 760.9 / 445.1 | 445.1 |
| m4-a08 edit live | 907.2 / 432.4 / 282.7 | 282.7 |
| m3-a10/a11 quote excerpt + jump | 226.7 / 221.8 / 228.7 | 221.8 |

Two M2 attempts recorded ~25 s outliers on this shared machine; best-of-3
discarded them, which is exactly the mechanism's purpose. The m3-a06/a07
figures are the combined appear-then-expire settlement waits and include the
deliberate 5 s expiry dwell, so they are not a 2 s-bound violation — the harness
recorded the assertion `passed`.

---

## Scores

| Dimension | Score | One-line basis |
|---|---|---|
| O1 Functional completeness | **45** | 98/119 assertions pass on independent execution; 62/119 after M2 and M4 adjudicate to capability-failure; M7 wholly absent; native platform proofs absent. |
| O2 Correctness under grading | **25** | 1 blocker + 5 major defects, four of them in core flows. |
| O3 Trust boundaries | **null** | No holdout probe set exists for this wave; O3's sole defined input is absent. |
| O4 Observed offline behavior | **40** | No native proof at all, so cold-start offline was never demonstrated; the web/M8 offline behaviour that *was* demonstrated is correct on structured receipts, and the gap is disclosed honestly. |
| O5 Performance at the envelope | **band 30** | Manifest conforms and the replay completed (band 0 does not fire); the search degradation rule fails structurally because the search read-model was never built for the replayed corpus. Bands 60/90 are unevaluable — ceilings and the wall cap are unfrozen placeholders. |

Full anchor citations and reasoning are in `grading/grader-report.json`
(`oDimensionScores`). No weighted total, efficiency statistic or cross-lane
comparison is computed here — those are the harness's and publisher's jobs.

## Artifacts retained

`grading/grader-report.json` · `grading/trace.md` · `grading/probes/*.mjs`
(every probe script) · `grading/logs/` (suite output, backend logs, scale
measurements, digest and window probe logs) · `grading/screenshots/` (11 browser
captures).
