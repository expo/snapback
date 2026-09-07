# social-messenger grader trace — lane `astra-snapback2`

Sanitized evidence and action trace for one grading session. Published artifact
(LLP 0197 redaction posture; the raw session is retained privately). Fixture
passwords, session tokens and the dev owner control secret are redacted
throughout and appear nowhere in this file or in the machine report.

- **Lane:** `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2`
  (backend `snapback2-0.0.4`, built on the public npm package `snapback2@0.0.4`)
- **Run scope:** full (M1–M8)
- **Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder context
- **Date:** 2026-09-06
- **Machine:** macOS arm64, Node 24.18.0, heavily shared (load average 9–22
  throughout; `uptime` recorded beside every timed step in
  `grading/evidence/uptime-*.txt`)

## Contamination control

Not read at any point: the lane's `diary.md`, `essay.md`, `final-report.md`,
`FINAL.md`, `run-log.md`, `evidence/m5-diary-draft.md`, or any other lane under
`lanes/`. `evidence/platform-gaps.md` was also left unread — it is builder
narrative about limitations, and the checklist was executed independently
instead. Nothing excluded reached this session, so the session is **not
contaminated**.

Inputs read: `instrument/grader/grader-prompt.md`,
`instrument/schema/social-messenger/{assertions,applicability}.json`,
`instrument/grader/grader-report.schema.json`,
`instrument/social-messenger.md`, `instrument/fixtures/**`, the lane's
`README.md`, `API.md`, `AGENTS.md`, `package.json`, application and backend
source, `run-record.json`, `coverage*.json`, `evidence/**` receipts,
`tools/choreography/**`, and `ui/screens.md`.

## Deviations from the frozen protocol (this run is N=1 calibration)

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped. `wave.probeSetSha256` is the literal `none-uncommitted` and
   `probeResults` is empty with a note. No probes were invented. As a
   consequence O3 has no scored input — it is null on its own applicability
   predicate as well (M6 is not green).
2. **The `claude` family has not passed the grader calibration gate.**
   `grader.calibrationPassed` is `false`, `grader.sameFamilyGraded` is `false`;
   the grade is labelled `uncalibrated-grader` by the record.
3. **Port substitution.** The lane's `README.md`, `API.md` and `package.json`
   document ports 49100–49103, but 49100–49102 on this machine belong to an
   unrelated program (verified with `lsof`: working directory
   `…/clique-improvement/grading/astra-006/app`). This lane was therefore run on
   **49120** (backend), **49121** (web client) and **49122** (push seam). No lane
   file on disk was edited. The substitution was applied by a Node module
   `load` hook (`grading/suite/hooks.mjs`) that rewrites the literal
   `127.0.0.1:49100/49101/49102` in modules under `scripts/`, `lib/`, `tools/`
   and `snapback/` at load time, plus `EXPO_PUBLIC_SNAPBACK_URL` for the web
   client. Grader-generated artifacts were redirected into `grading/evidence/`
   so the lane's own artifacts were not overwritten; idempotency journals that
   belong to the backend instance (`evidence/seed-*.jsonl`,
   `evidence/sample-50-receipts.jsonl`) were deliberately **not** redirected,
   and were byte-identical before and after.
4. **The push seam could not be substituted.** `snapback/provider.ts` and
   `snapback/digestProvider.ts` pin `http://127.0.0.1:49102` in the effect
   `grants`, and the effect source is compiled into the generated
   `.snapback/build/project.json`, which the native dev binary executes — the
   module hook does not reach it. Letting the effect fire would have POSTed this
   lane's payloads into the unrelated program's push server on 49102 and
   polluted its evidence file, so `presence.replayMode({enabled:true})` was set
   on the dev instance for the whole session to suppress push emission. **This
   blocked independent execution of m6-a08, m6-a09 and m8-a08–m8-a11**, which are
   graded from the lane's own receipts instead and are marked as such. m8-a12 was
   verified independently by another route (membership boundary + the aggregate
   the digest job reads). Digest configuration on the dev instance was the
   production daily period, so no digest sweep fired before the flag was set;
   `evidence/push-payloads.jsonl` is unchanged from the builder's run.
5. **Timing-sensitive checks** are judged best-of-3 per the frozen prompt.
   Machine load is recorded beside every measurement.
6. **The frozen grader-report schema predates the M8 amendment.**
   `assertionResults` is `additionalProperties:false` over
   `^m[1-7]-a[0-9]{2}$`, so M8 assertion ids cannot be keyed there without making
   the report schema-invalid. M8's eighteen results are recorded in this trace
   and summarised in the report's `notes`; they are included in the O1
   judgement.
7. **Manifest inconsistency (informational).** `assertions.json`'s `counts` block
   records `M2: 24` and `total: 116`, but the file enumerates `m2-a01…m2-a27`
   and 119 assertions overall. Grading used the enumerated assertions.

## Environment brought up

| Process | Port | Notes |
|---|---|---|
| `npx snapback2 dev --port 49120` | 49120 | lane dev instance, three successive PIDs across two deliberate restarts |
| `npx expo start --web --port 49121` (with `EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:49120`) | 49121 | web build under test |
| `node scripts/push-server.mjs` under the port hook | 49122 | started, but never reached (see deviation 4) |

Every PID started was recorded and killed at the end of the session; nothing was
`pkill`ed or `killall`ed, and no port outside 49120–49139 was bound. Before
starting, `.snapback/` was copied to `grading/snapback-preimage/` as a
pre-grading image of the dev instance.

Confirmed at start-up that the web client on 49121 talks to the substituted
backend (observed requests to `http://127.0.0.1:49120/api/manifest` and
`/api/auth/me`) and that the shortened-windows config was already applied to the
dev instance (`settings.windows` = editMs 60000, deleteMs 120000, dayMs 180000,
weekMs 300000 — matching `fixtures/config/windows.shortened.json`).

## Phase 1 — builder suite

Ran the lane's documented entrypoint shape, `npm run acceptance -- --milestone
mN`, through a byte-for-byte copy of `scripts/acceptance.mts` that differs only
in the substituted web port, the relative import paths, and the output
directory (`grading/suite/acceptance.mts`; the diff is three lines and is
reproduced in `grading/evidence/`). Logs: `grading/evidence/m*-acceptance*.log`,
receipts: `grading/evidence/m*-suite-*.json`.

| Milestone | Result | Detail |
|---|---|---|
| m1 | **pass** | signup-authenticated, duplicate-handle-visible, profile-edit-avatar, duplicate-email-visible, seed-idempotency |
| m2 | **pass** | 7/7 tests, including create-post-variants (2 fixture images + video) |
| m3 | **pass** | 6/6 tests |
| m4 | **pass** | 4/4 tests, including delete-revokes-photo |
| m5 | **pass** | 5/5 tests |
| m6 | **fail** | `closed-client-text-push` and `view-once-push-preview` fail because the push seam is suppressed (deviation 4). `clean-headless-client` and `all-50-action-conformance` pass. |
| m8 | **pass** | 3/3 tests |

Grader-tooling note (one re-run used, per the abort protocol): the first m6 run
also failed `all-50-action-conformance` with `E_AUTH_EMAIL_TAKEN`. That was my
fault — the write-redirect had pointed `evidence/sample-50-receipts.jsonl` at an
empty file, and `Replay` reads that journal to decide whether a `register` action
should sign up or log in. Removing that one redirect and re-running gave a clean
pass, and the lane journal's md5 was identical before and after. Not a lane
defect.

The notable phase-1 result is that **M1, M2, M4 and M5 suites all pass against a
restarted backend**, while the lane's own record ends with M1/M2/M5/M6 aborted
for a "final accumulated-state media regression". The cause is identified below.

## Phase 2 — coverage-manifest spot verification

Read `evidence/coverage-manifest.json` and `evidence/coverage-validation.json`
(pass; 58 suite-required assertions mapped across m1–m6 and m8, no gaps), then
read each mapped test in `scripts/acceptance.mts`, `scripts/m2-tests.mts`,
`scripts/m3-tests.mts`, `scripts/m4-tests.mts`, `scripts/m5-tests.mts`,
`scripts/m6-tests.mts` and `scripts/m8-tests.mts` and checked that the mapped
test really exercises the assertion's observable.

Sampled: m1-a03, m1-a10, m1-a11, m2-a02, m2-a03, m2-a08, m2-a13, m2-a16, m2-a22,
m2-a24, m3-a05, m3-a11, m3-a15, m4-a01, m4-a06, m4-a09, m5-a04, m5-a05, m5-a09,
m5-a11, m6-a11, m6-a13, m8-a01, m8-a04, m8-a05.

**Verdict: honest.** Every sampled mapping exercises its assertion's observable
with real data — several go beyond it (m8-a01 recomputes the six lifetime totals
from raw table scans rather than from a seeded constant; m6-a13 replays all fifty
sample actions and then verifies group roster, message counts, quote, reactions,
media, view-once flag and post counts). No mapping was found to be a stub, a
tautology, or mapped to a test that does not touch the observable. Three
mappings are **weak but not dishonest**, in each case covering the item's main
clause while leaving a parenthetical clause unexercised:

- `m2-a22 → ui-links-and-infinite-scroll` asserts that scrolling loads more than
  20 items in the Following tab but never asserts the "(20 per page)" clause —
  and the Following feed in fact pages at 10 (defect d-03).
- `m5-a09 → people-prefix` queries only the lowercase term `car`, so the
  "case-insensitive" clause is unexercised — and the documented API is in fact
  case-sensitive (defect d-04).
- `m8-a05 → trending-rank-age-tie` gives its two in-window posts equal like
  counts, so it tests the tie-break but not "ranks the post with the most likes
  first". Independent execution with unequal counts passes.

No milestone is adjudicated `capability-failure` on coverage grounds.

Separately, every choreography receipt line in the seven latest per-segment
JSONL files validates record-by-record against the frozen
`tools/choreography/receipts.schema.json` (41 records, 0 invalid).

## Phase 3 — independent checklist execution

`[choreo]` assertions are scored from the harness's recordings and structured
receipts and were never re-driven, per the frozen prompt. `[grader]` and
`[suite-required]` assertions were re-executed by me over the custom-client API
and by browser automation on the web build. Scripts and machine-readable results
are under `grading/suite/` and `grading/evidence/`.

### Choreography artifacts (`[choreo]`)

Latest receipt per segment was used as the primary verdict, with earlier
retained-green receipts noted where they differ:

| Segment / receipt | Result |
|---|---|
| `m1-choreography-reconciled.jsonl` | session-persists ✔, logout-relaunch ✔, **profile-edit-live-visibility ✘ (3/3 attempts, 12036/11123/12154 ms against a 10 s window)** — the retained green at 16:47 had 305/308/313 ms |
| `m2-choreography-reconciled.jsonl` | text-post live ✔, **image-post live ✘**, **video-post live ✘**, follow/unfollow ✔, avatar+display name ✔, like ✔, repost ✔, repost-following ✔, reply ✔ — `m2-choreography-5.jsonl` had all nine green |
| `m3-choreography-carrier.jsonl` | 6 ✔; `sender-avatar-identity-when-rendered` **skipped** by the harness as instrument-class ("the kit does not render sender avatars in the default 1:1 layout") |
| `m4-choreography-complete.jsonl` | 5/5 ✔ |
| `m5-choreography-reconciled.jsonl` | **chat-color-background-sync ✘**, **view-once ✘ (non-required)**, warm-offline search ✔, disappearing expiry+purge ✔ (303.6 s) — `m5-choreography-5.jsonl` had all four green |
| `m6-choreography-carrier.jsonl` | offline-queue flush in order ✔ |
| `m8-choreography-continued2.jsonl` | 5/5 ✔ (insights refresh, same-account live, cross-device read state, dual-offline convergence, dual-offline receipts) |

Best-of-3 metrics taken from the receipts: M3 typing indicator visible
13.2 / 37.7 / 17.4 ms after the last keystroke (bound 2 s) and expiring
4326 / 4393 / 4355 ms after it (bound 5 s).

Native (simulator) proofs: the run record's own `native` block records
`proof:false` for both M6 and M8, with the honest reason that a Release build
was produced, installed and launched but no native driver signed in, primed
media, stopped the backend or verified cold-start offline behaviour. m6-a01–a07
and m8-a17/a18 are therefore **not demonstrated**.

### Grader-class assertions (API, source, snapshot)

`grading/evidence/g1-api-probes.json`, `g2-disappearing.json`,
`g10-digest-boundary.json`:

- **m1-a07 pass** — a session token issued by login stops working the moment
  `auth.logout()` is called: `auth.me()` refuses with `E_AUTH_SESSION` on a
  fresh client carrying the old token, and `chats.list` returns
  "authentication is required" with no data.
- **m1-a12 pass** — `snapback/schema.q` line 1 is `use identity password`, the
  backend's documented built-in identity path; no hand-rolled hashing anywhere in
  the lane. Stored credential material in `.snapback/store.sqlite` is
  `$argon2id$v=19$m=19456,t=2,p=1$…` — a named adaptive KDF at standard
  published parameters.
- **m1-a13 pass** — zero occurrences of a fixture password in
  `.snapback/store.sqlite`, `.snapback/log.jsonl`, `.snapback/blobs/`, the
  lane's `evidence/` logs, or the 4.3 MB web client bundle served from 49121.
  (Fixture passwords *are* hard-coded in twelve of the lane's own test/probe
  scripts — see defect d-09; those are not server persistence, a client bundle,
  or logs.)
- **m4-a10 pass** — under the shortened window (editMs 60 000) an edit at t≈0
  commits and an edit at t=66 s is rejected server-side with
  `EDIT_WINDOW_CLOSED`; the server-side body is still the in-window text.
- **m4-a12 pass** — after delete-for-everyone the row is `tombstone:true` with
  `photo:null`, the previously working asset URL refuses with
  `E_ASSET_NOT_READY`, and an unauthenticated raw fetch of the same URL returns
  404.
- **m5-a01/a02/a03 pass** — a DM set to disappearing `24h` (180 s under the
  shortened config) with both clients closed across the boundary: the server no
  longer returns the message (`messages.thread` has no such row, and no
  unexpired search row resolves to it); a relaunched web client shows 0 bubbles
  where it previously showed 1; and search returns 0 hits both online and after
  `setOffline(true)`, where it previously returned 1.
- **m5-a06 pass** — after `openPhoto` → `closePhoto`, a second `openPhoto` is
  rejected `ALREADY_VIEWED`, the previously working asset URL refuses
  `E_ASSET_NOT_READY`, and a raw unauthenticated fetch returns 404.
- **m6-a12 pass** — from a **clean `npm install snapback2@0.0.4`** in
  `grading/clean-client/`, following `API.md` alone, I wrote a client that lists
  the caller's memberships, resolves the conversation named "Weekend Plans" via
  `chats.get`, pages `messages.thread` and reads the latest message. It worked
  first time; `page.data[0].at` was the maximum `at` on the page, matching the
  document's "descending server timestamp, then id" claim. The same clean
  directory ran the documented `custom-client-demo.mjs` green, which is m6-a10's
  "clean checkout" clause.
- **m8-a12 pass** — Alice is not a member of a Bob↔Carol group carrying four
  messages; her `messages.thread` read of it is `denied`, she holds no membership
  row, the digest job iterates only `memberships[p.principal]`, and the unread
  aggregate it reads is `count receipts by principal, conversationId, period,
  state` — keyed by principal, so foreign traffic cannot contribute.
- **m8-a08/a09/a10/a11** — blocked from independent execution by deviation 4;
  graded from `evidence/digest-proof.json`, which records, under the shortened
  120 s digest config with all clients closed: exactly one digest payload for the
  active user with `newFollowers:1, newPostsInFollowing:1, unreadMessages:1,
  unreadChats:1` (a deleted message correctly excluded), no payload at all for
  the quiet third persona, no payload for the following empty period, and a
  deliberate backend kill/restart mid-period (PID 12159 → 14209) with still
  exactly one digest per user per period.
- **m7-a08** — not-run; M7 was never attempted, so there is no post-migration
  state to compare against a pre-M7 snapshot.

### Suite-required assertions, re-executed independently

`grading/evidence/g3-api-checklist.json` (API) and `g4-web.json` / `g5-web-retry.json`
/ `g6-probe.json` / `g8-staging-and-seed.json` (browser + API). Everything below
was driven with my own identifiers and my own assertions, not the lane's tests.

Passing on independent execution: m1-a01, m1-a02, m1-a03, m1-a04, m1-a08,
m1-a10, m1-a11; m2-a01, m2-a02, m2-a03, m2-a06, m2-a08, m2-a09, m2-a10, m2-a11,
m2-a12, m2-a13, m2-a15, m2-a16, m2-a17, m2-a18, m2-a20, m2-a21, m2-a23, m2-a24,
m2-a25, m2-a26, m2-a27; m3-a03, m3-a04, m3-a05, m3-a10, m3-a11, m3-a14, m3-a15;
m4-a01, m4-a03, m4-a06, m4-a07, m4-a09; m5-a04, m5-a05, m5-a08, m5-a09, m5-a10,
m5-a11; m6-a10, m6-a11, m6-a13; m8-a01, m8-a03, m8-a04, m8-a05, m8-a06, m8-a07.

Notes on the ones that took real work:

- **m2-a08** was strengthened with an Alice post created *before* Bob followed
  her, to exercise the "including older ones" clause; after the unfollow, zero
  Alice-authored rows remain in Bob's Following feed while both posts stay in
  Global (m2-a09).
- **m2-a13** first looked like a failure because React Native Web renders the
  link as `<span role="link">`, not `<a>`, and because the post card's author
  avatar sits inside the link's ancestry. Settled with a control: a post
  containing a URL and a post without one render the same number of images
  (1 each, the author avatar), zero iframes and zero videos. **No preview card.**
- **m2-a22 fails.** `posts.following` returns **10 rows per page**
  (`snapback/posts.q:8` — `merge entries after c last 10 by byAuthorTime`) while
  `posts.global` returns 20. The assertion text and `ui/screens.md` ("the lane
  provides … 20-per-page infinite scroll") both specify 20. Pagination itself is
  correct: 516 Following rows over 52 pages with 516 distinct ids and all 25
  probe posts present, no duplicates and no gaps (m2-a24 passes).
- **m3-a15** was verified without relying on the lane's journal mechanism:
  snapshot every table's row count, re-install all three installed seed segments,
  snapshot again. Zero drift across profiles/follows/posts/entries/likes/
  conversations/memberships/messages/reactions, and the journals were unchanged.
- **m5-a09 passes at the UI**, which is the app-level observable: searching
  `car`, `CAR` and `Car` each returns Carol. The documented server API does not:
  `search.people({term:'CAR'})` returns nothing because `peopleWords` stores
  lowercased prefixes and the query matches the term literally. The client
  normalises before querying; a custom client written from `API.md` would not
  (defect d-04).
- **m8-a01** matches `insights.load().totals` against six totals recomputed from
  raw `audit.scan*` table dumps — 484 posts, 161 likes received, 18 reposts
  received, 39 replies received, 3 followers, 2 following, all exact.
- **m8-a05** was re-run with unequal like counts (7 vs 3) rather than the suite's
  tie: the 7-like post ranks first. **m8-a07** with a true tie (7 vs 7) ranks the
  newer post first. **m8-a06**: a system-inserted post backdated 48 h with 7
  likes is absent from a 10-row Trending list.

## Root-cause work

### The staged-asset leak (defect d-01)

The lane's own final disposition aborts M1, M2, M5 and M6 for an "unrecovered
account upload staging quota", and `evidence/m6-suite-1788636726916.json` carries
the underlying refusal: `E_ASSET_TOO_LARGE: principal user:<redacted> has
reached the 268435456 byte or 20 object staging ceiling`.

I reproduced the mechanism from scratch on throwaway accounts
(`grading/evidence/g8-staging-and-seed.json`, `g9-viewonce-staging.json`):

1. 26 **distinct** image posts from one fresh account: all commit. Staging is
   released when the upload is attached.
2. 12 **distinct** view-once sends in a fresh 2-member DM: all commit.
3. The **same** view-once send retried with an identical message id — which is
   exactly what `API.md` invites ("IDs are client-generated idempotency keys:
   retry the identical send with the same ID"), and exactly what re-running the
   M5/M6 suites does — fails on the **7th retry**, and by then the failure has
   escalated past the per-principal ceiling to the owner-wide one:
   `E_ASSET_TOO_LARGE: the owner has reached the 536870912 byte or 40 object
   staging ceiling`.
4. After that, an ordinary `messages.sendMedia` from the same account also
   fails, while a plain text send still commits — i.e. **all media upload on the
   instance is dead for every account**, not just for the account that leaked.

The mechanism is visible in the source. `messages.grantPhoto` short-circuits with
`if exists intents[viewer, mutationId]: return true` and `messages.sendMedia`
with `if exists messages[id]: return { id }` — but the client has already
uploaded and staged the asset in order to send the argument, so on every retry a
fresh staged object is created and then never attached and never released.
`lib/sendViewOnce.mjs` multiplies this by the member count: it re-uploads the
photo once for every seat in the conversation, including the sender's own.

Recovery is not restart-based: I restarted the backend after triggering the leak
and the owner ceiling was still exhausted 15 minutes later. The lane's own
exhaustion on 2026-09-05 19:32 had cleared by the time grading started roughly
23 hours later, which points at time-based reclamation.

**State note:** triggering this reproduction left the lane's dev instance unable
to accept media uploads for any account. All media-dependent checks in this
grading had already been completed and passed before the reproduction was run.
The condition is expected to clear on its own, as it did for the builder; the
pre-grading image of `.snapback/` is preserved at
`grading/snapback-preimage/` if a byte-level restore is ever wanted.

### The profile-editor edit-loss race (defect d-02)

The failing m1 choreography assertion is **not** explained by the staging leak —
`profile-edit-live-visibility` uploads nothing, it only edits display name and
bio. I re-checked the observable directly and it failed twice
(`g4-web.json`, `g5-web-retry.json`), then characterised it
(`g7-profile-race.json`).

Four controlled trials of "open `/profile/edit`, change display name and bio,
save":

| Trial | Field prefilled when typing began | Display name persisted | Bio persisted |
|---|---|---|---|
| type immediately, 1 | no (empty) | **no** | yes |
| type immediately, 2 | no (empty) | yes | yes |
| wait for prefill, 1 | yes | yes | yes |
| wait for prefill, 2 | yes | yes | yes |

In the losing trial the browser's outgoing `profiles.save` request carried the
**previous server display name** even though the input visibly contained the
newly typed value, and **no error was surfaced** — the app navigated to the
profile as if the save had succeeded.

`lib/Screen.tsx` renders `<Edit key={profile?.id || 'new'} profile={profile}/>`
and `Edit` seeds its `values` state from the `profile` prop on mount. While the
live `profiles.me` query is still hydrating the key is `'new'` and the form is
empty; when the row arrives the key changes, `Edit` remounts, and any text typed
in the interim is replaced by the server values. Save then writes those stale
values back. It is load-dependent, which is consistent with the assertion passing
at 16:47 (305 ms) on a small dev instance and failing 3/3 at 19:32 after the
instance had grown to hundreds of posts.

The m2 image/video live-feed failures and the m5 chat-background failure in the
same 19:28–19:40 window *are* consistent with the staging leak — all three
require an upload, and `chat-color-background-sync` uploads a background image —
whereas the accent-colour half of that assertion passed.

## Phase 4 — holdout probes

Skipped: no probe set was committed for this wave (deviation 1). `probeResults`
is empty with a note; no probes were invented. Trust-boundary spot checks made
during defect hunting (recorded in `g1-api-probes.json`, and **not** scored as
probes) all held: `audit.scanMessages` as an ordinary user returned only rows
from the caller's own conversations; a non-member's `messages.thread` read of a
foreign DM was `denied`; a non-member's send was rejected `MEMBERSHIP_REQUIRED`;
a non-admin's `memberRemove` and `chats.customize` rename were both rejected
`ADMIN_REQUIRED`.

## O5 inputs

Scored from the lane's replay record and checkpoint probes, by the exact band
function (first match in the order 0, 30, 60, 90, 75).

- Attempt 1 (`scale`) failed at 75 s on a memberships cap; attempt 2 (`scale-2`)
  failed at 816 s on `OWN_ORIGINAL`; **attempt 3 (`scale-3`) passed**: 167 244
  settled receipts with unique keys, all committed, matching the expected total;
  end-state verification 3 258 checks, **0 failures**; `scale.log` sha256 matches
  the manifest.
- The verifier does check the named O5 fixtures — `perUserFollowingCounts`
  (u0500 = 500, u0005 = 5), `perUserConversationCounts` (u0500 = 100),
  `perChatMessageCounts` (g0001 = 10 000), `perGroupMemberCounts` (g0001 = 50),
  the celebrity u0900's 900 followers and 200 posts, u0901's exact 5-account
  following list, and g0001's 50-member roster. **The invariant manifest
  conforms**, so band 0 does not fire on manifest grounds.
- Replay wall 3 881 s against a 14 400 s cap = **27.0 %** — not exhausted, and
  ≤ 50 %.
- **Band 30 fires on a degradation rule.** The envelope's rule "Following-feed
  load for the 500-follow probe user ≤ 3× the same query for a 5-follow user"
  fails at every checkpoint:

  | Checkpoint | u0500 `posts.following` p95 | u0005 `posts.following` p95 | ratio | bound |
  |---|---|---|---|---|
  | 10 % | 303.4 ms | 18.6 ms | **16.3×** | ≤ 3× |
  | 50 % | 619.2 ms | 15.6 ms | **39.7×** | ≤ 3× |
  | full | 951.8 ms | 19.7 ms | **48.3×** | ≤ 3× |

  It fails on medians too (22× / 42× / 47×), so it is not a tail artifact. No
  probe timed out, errored or OOMed. The two M8 rules that *are* measured pass:
  Insights 6.42 → 3.69 → 4.35 ms (0.68× full-vs-10 %, mid-curve under the line)
  and Trending 10.78 → 10.78 → 15.38 ms (1.43×, mid-curve under the line).
- Probe methodology deviates from the brief (defect d-06): `scripts/scale-replay.mjs`
  takes **k = 10 samples with no warm-ups** rather than k = 20 after 3 warm-ups,
  and its six queries cover only 3 of the envelope's 10 degradation rules —
  deep paging into the 10 k chat (page 50 vs page 1), global message search,
  receipt aggregation in the 50-member group, cold-start sync of the probe
  user's 100 conversations, and both celebrity write- and read-path rules are
  never measured.

## O-dimension applicability

`applicability.json` predicates against the run record's statuses (M1 aborted,
M2 aborted, M3 green, M4 green, M5 aborted, M6 aborted, M7 not-run, M8 green;
scale replay attempted and passed on the third attempt):

- **O1** — applicable (grading phase ran). Scored.
- **O2** — applicable (grading phase ran). Scored.
- **O3** — **null**: the predicate is `m6-green-and-m1-m5-attempted` and M6 is
  aborted. It would in any case have had no scored input, since no holdout probe
  set was committed.
- **O4** — **null**: the predicate is `m6-green` and M6 is aborted. (Had it been
  applicable, the native artifacts would not have supported it: the run record
  records `proof:false` for both M6 and M8.)
- **O5** — applicable (replay attempted). Band-mapped, not interpolated.

## Lane files touched

Nothing in the lane was edited. Everything this session produced lives under
`grading/`. The only lane file rewritten during grading is
`evidence/old-post-fixture.q`, which the lane's own m8 acceptance test rewrites
from a fixed template on every run, byte-identically. The backend-owned
idempotency journals (`evidence/seed-m1..m3.jsonl`,
`evidence/sample-50-receipts.jsonl`) and `evidence/push-payloads.jsonl` are
unchanged. The dev instance's data did change, as running the acceptance suite
against it necessarily does, and the staged-asset condition described above was
introduced by the root-cause reproduction.

## Cleanup

Killed exactly the PIDs started by this session (three successive backend
owners, the Expo web server, and the push listener on 49122). No `pkill` or
`killall`. Ports 49100–49102 and every other lane's ports were left untouched.

