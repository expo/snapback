# Grader evidence and action trace — lane `astra-snapback4`

Sanitized, publishable companion to `grader-report.json`. Credentials are
redacted throughout: fixture passwords are referred to as `<fixture-password>`
and never reproduced, and no bearer token, session token or asset URL appears in
full. Raw session transcripts are not published. Fixture persona handles and
`@example.com` addresses are synthetic instrument fixtures, not personal data.

- **Lane:** `astra-snapback4`, backend `snapback4-0.4.9` (npm `snapback4@0.4.9`,
  `snapback4-expo@0.4.9`), deployment posture `local-dev-server`.
- **Wave:** `full-3models-astra`. **Grader:** claude / `claude-opus-5`.
- **Run scope:** `full`. Lane run record present and used
  (`run-record.json`, `socialMessenger.runScope: "full"`, `capFamily:
  "gpt-frontier"` — so this claude session is the other scored family and
  `sameFamilyGraded` is false).
- **Assertion manifest pin:** `instrument/schema/social-messenger/assertions.json`,
  VERSION `0.3.0-m8`, sha256
  `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` — identical
  to the digest the lane recorded in `socialMessenger.assertionManifest`.
- **Session outcome:** `completed`. No grader-abort, 0 re-runs used. No excluded
  builder context reached this session (see *Contamination control*).

## Recorded deviations from the frozen protocol

This run is an N=1 calibration exercise, not a claim-eligible wave.

1. **No holdout probe set was committed for this wave.** Execution-order phase 4
   was skipped in full. `wave.probeSetSha256` records the literal string
   `none-uncommitted`, `probeResults` is an empty array, and no probes — scored
   or anchor — were invented or run under that name. The report schema gives
   `probeResults` no place for a note, so the required explanation lives in the
   report's top-level `notes`.
   *Consequence for O3:* `applicability.json` still makes O3 applicable (M6
   green plus M1–M5 attempted), so it is scored rather than nulled — but from
   grader-authored checks over the seven **published** trust-boundary categories
   in `grader/probes/categories.md`, not from the wave's secret rotated probes.
   That substitution is stated in O3's own justification.
   *Consequence for O5:* the per-probe measurable p95 predicates were to be
   frozen with the probe set. I applied the published degradation rules from the
   brief and `categories.md` instead, and recomputed every one from the lane's
   raw checkpoint probe files.
2. **This grading family has not passed the calibration gate.**
   `grader.calibrationPassed: false`, `grader.sameFamilyGraded: false`. Graded
   anyway; the record labels the grade `uncalibrated-grader`.
3. **Timing-sensitive checks judged best-of-3, with host load recorded.** This
   machine is shared with other sessions. `uptime` load averages were sampled
   beside every measurement phase and are listed in *Host load* below. All three
   measurements are retained for every timing-sensitive judgement, in the
   per-assertion `bestOf3Ms` and in `timingRecords`.

Nothing is `struck-by-environment` in this run (`ENVIRONMENT.md`), so every
assertion was graded at the brief's bar and no assertion records that status.

## Contamination control

Not opened at any point: `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`,
`run-log.md`, and every other lane under `lanes/`. Only `astra-snapback4` and the
read-only `instrument/` tree were read. The lane's permitted records —
`run-record.json`, `milestones.json`, `suite-status.json`,
`coverage-manifest.json`, `config-profile.json`, `setup-identity.json`,
`API.md`, `README.md`, `CONFIGURATION.md`, application source, and
`evidence/`, `artifacts/`, `scripts/` — were read as the prompt directs. I wrote
nothing into `instrument/` and nothing into any builder file; every artifact I
produced is under `grading/`. `grading/work/` holds my scripts, logs, 40
screenshots and raw result JSON.

## Environment and processes

macOS arm64, Node 24.18.0 from the absolute Volta toolchain path
(`~/.volta/tools/image/node/24.18.0/bin`), npm 11.16.0. Playwright 1.63.0 with
chromium was already provisioned inside the lane's own `choreography/` copy, so
I reused it rather than installing a second browser; I did not need to run the
choreography harness myself (see *Choreography*), and I never wrote into
`instrument/choreography`.

Ports used, all inside the assigned 49360–49379 range and all verified free
before start:

| Port | Purpose |
|---|---|
| 49360 | lane backend (`npm run backend`) |
| 49361 | lane web client (`npm run serve:web`, serving the lane's `dist/`) |
| 49364 | my isolated digest-probe backend instance |
| 49365 | my isolated trending-probe backend instance |

PIDs I started and the only ones I signalled — no `pkill`, no `killall`, no
pattern kill at any point:

- `25506` (`npm run backend`) → child `25539` (snapback4 binary), worker `25546`
- `28838` (`npm run serve:web`) → child `28871`
- digest-probe instances: `92140,92145,92148,92149`, then
  `92617,92618,92620,92621`, then `92949,92951,92954,92955` (restarted
  mid-period on purpose, see m8-a11) — all stopped by the probe itself, exit and
  port release confirmed
- trending-probe instance: `12165,12170,12175,12176` — stopped by the probe
  itself

Backend startup was clean and announced its own security posture: dev mode
admits loopback personas and an unauthenticated `/seed`, and prints the Argon2
slot count. `snapback4 check` reported `ok — 33 tables (18 synced), 54
operations, no problems, 13 notes`.

## Host load

| When | `uptime` load averages |
|---|---|
| backend start | 24.32 / 10.31 / 9.20 |
| first suite attempt | 29.64 / 17.89 / 12.43 |
| acceptance m1 | 33.67 / 20.35 / 13.58 |
| acceptance m2–m5 | 34.38 → 16.80 |
| acceptance m6, m8 | 19.62 / 18.37 |
| API grader batch | 4.09 / 6.43 / 10.10 |
| digest probe | 3.34 / 4.43 / 8.16 |
| browser grader passes | 4.88 → 3.19 |
| M5 ephemeral probe | 3.99 / 3.75 / 4.22 |
| trust-boundary probes | 2.54 / 2.97 / 3.67 |

Load fell sharply partway through, so the early suite runs and the later
grader-driven timing measurements were taken under materially different
conditions. This matters most for O5: the lane's own 10% and 50% checkpoint
probes were recorded under the high-load window while its final probes were not
(see *O5*).

## Phase 1 — builder suite, from the documented entrypoint

Started the backend and web client from `README.md` exactly as written, then ran
the documented entrypoint per milestone. `preacceptance` runs `snapback4 check`
and `postacceptance` regenerates `coverage-manifest.json`; both ran every time.

| Invocation | Result |
|---|---|
| `npm run acceptance -- --milestone m1` | `PASS m1 7` |
| `npm run acceptance -- --milestone m2` | 15 named checks pass (22 assertions) |
| `npm run acceptance -- --milestone m3` | 6 named checks pass (7 assertions) |
| `npm run acceptance -- --milestone m4` | 5 mapped + 2 extra checks pass |
| `npm run acceptance -- --milestone m5` | 6 mapped + 1 extra check pass |
| `npm run acceptance -- --milestone m6` | 4 named checks pass (5 assertions) |
| `npm run acceptance -- --milestone m8` | 6 named checks pass |

Every suite-required assertion of every attempted milestone passed in my
environment, on the first attempt, with no environment fixing needed beyond
starting the two documented servers. That is 58 of 58 suite-required mappings
green. `suiteResult` in the report reflects this per assertion. The m4 and m5
suites additionally self-check three grader-class obligations (post-window edit
refusal, media revocation after delete, no-client server expiry) — I re-verified
all three independently rather than crediting them.

Logs: `grading/work/acceptance-m{1..6,8}.log`.

## Phase 2 — coverage-manifest spot-verification → **honest**

`coverage-manifest.json` maps 58 suite-required assertions. I read every mapping
against its named test in `scripts/acceptance*.mjs`, then re-executed all 58
independently. Structural finding that raises the floor on honesty: the manifest
is not hand-written — `scripts/coverage.mjs` generates it from the labels the
suites themselves emit at runtime, and each suite ends with
`assert.deepEqual(Object.keys(checks).sort(), required)` against the
suite-required set read from the frozen `assertions.json`. A mapping therefore
cannot name a test that did not run, and cannot silently drop or add an
assertion.

Depth spot-checks chosen because each could have exposed a vacuous or dishonest
mapping:

- **m2-a22 / m2-a23 (the one that looked vacuous).** The mapped tests capture
  the feed-card count at the moment `Load more` first appears, then wait for the
  count to grow. If `Load more` appeared before the first page finished
  painting, growth to 20 would satisfy the wait with no pagination at all. I
  measured the count at that exact instant across 6 trials: 20 every time — the
  complete first page is always painted before the control renders, because it
  only renders when `hasMore` is known. Not vacuous.
- **m3-a15 (seed idempotency).** The mapped test compares a full state snapshot
  before and after re-seeding, not row counts. I reproduced it with my own
  independent 18-measure snapshot.
- **m8-a01 (insights totals).** The mapped test derives expected values from
  direct SQL over the store, not from the query it is checking.
- **m6-a13 (adapter conformance).** The mapped test invokes the fixture pack's
  own `instrument/fixtures/validate.mjs` and verifies 50/50 settled actions
  across all 13 verb classes in the log.

Two coverage weaknesses, recorded as notes rather than dishonesty because in
both cases the mapping is truthful and the underlying behaviour is genuinely
correct:

- **m2-a13** — the mapped test asserts
  `count([data-testid*="preview-card"]) === 0`. No node with such a test ID
  exists in the app or the frozen kit, so that clause cannot fail as written. I
  verified the real observable instead (below).
- **m2-a24** — the mapped test asserts cross-page uniqueness but not the
  assertion's "no gaps" clause. I verified no gaps independently.

No mapping was found dishonest, so **no milestone is adjudicated to
`capability-failure`** and O1 is not penalised on that ground.

## Phase 3 — independent checklist execution

101 of the 119 assertions were executed or scored by me directly; the other 18
are the 9 M7 and 9 simulator assertions that record `not-run` (below). I built
five of my own harnesses under `grading/work/` rather than re-using lane test
code: `g-api.mjs`, `g-api2.mjs`, `g-api3.mjs` (custom-client API),
`g-web*.mjs` (browser automation against the web build), `g-digest.mjs` and
`g-trust*.mjs` (isolated backend instances).

### Choreography (the `[choreo]` class)

Scored **only** from the harness's structured receipts, never re-driven by me
and never taken from builder assertions. All seven segment summaries are
`green: true` with `nonGreenCause: null`, receipts at harness version
`0.3.8-m8`, `typingObservationBoundaryVersion: v2`, suite receipt SHA-256 bound
into each summary, and `requiredUnimplemented: 0` everywhere:

| Segment | required / implemented / passed |
|---|---|
| m1 | 3 / 3 / 3 |
| m2 | 9 / 9 / 9 |
| m3 | 5 / 7 / 7 |
| m4 | 5 / 5 / 5 |
| m5 | 2 / 4 / 4 |
| m6 (web) | 1 / 1 / 1 |
| m8 (web) | 5 / 5 / 5 |

Nothing was skipped as "structurally unavailable": m3's
`sender-avatar-identity-when-rendered` ran and passed on the exact-identity path
because the app does mount `sm-convo-sender-avatar`, and the harness's own
guard rejects any test ID outside `CONTRACT.md`.

**One instrument gap I had to work around.** The frozen m2 segment's
`follow-unfollow-live-projection` observes the *Following-feed projection*, not
the follower count — I read the harness source and confirmed no follower-count
observation exists anywhere in `choreography.mjs`. So **m2-a07** ("Alice's
follower count updates live when Bob follows her") has no harness receipt. Rather
than record it unproven, I measured it myself by web automation, best-of-3, and
labelled the method departure in the assertion's note: on an already-open
profile view the count went 3 → 4 with no manual refresh in 268 / 243 / 274 ms
(best 243 ms).

### Source inspection — m1-a12, m1-a13

- **m1-a12 (pass).** `snapback/schema.q` line 1 is `use identity password` — the
  backend's built-in auth. The lane hand-rolls no hashing or token code: outside
  the login form field there is no password/hash/KDF reference anywhere in
  `snapback/`, `src/` or `app/`. The pinned backend binary carries the
  `argon2 0.5.3` crate and the encoded parameter string
  `$argon2id$v=19$m=19456,t=2,p=1` — argon2id at standard published parameters
  (19 MiB, t=2, p=1) — and `snapback4 dev` prints its Argon2 slot count at
  startup. The documented provider path was confirmed from
  `snapback4 guide personas`, not from provider internals.
- **m1-a13 (pass).** Searched all nine fixture passwords across server
  persistence (`.snapback4/store.sqlite` and `-wal`), the exported client bundle
  (`dist/`) and every lane log: **0 hits**. The store holds 20 `$argon2id$`
  digests. The fixture pack's own credential files are the declared exception.
  A hygiene nit is filed separately as **d-05**.

### Trust boundaries (grader-authored, standing in for the absent probe set)

All seven published categories covered; every one correctly denied. Full
transcript in `grading/work/g-trust.log`, `g-trust2.log`.

- **`tb-cross-user-dm-access`** — a non-member was refused a DM across 10
  independent read paths: `apiHistory`, raw `history`, `message` by id,
  `roster`, `searchChat`, `searchMessages`, `searchGrouped`,
  `conversationScreen`, the attached photo's asset grant (`E_ASSET_UNKNOWN`),
  and a raw `POST /q/apiHistory` with her own bearer, bypassing the SDK
  entirely. The secret string never appeared in any response body.
- **`tb-removed-member-delivery`** — after removal the removed member received 0
  new messages on four read paths, the chat left her inbox, and her attempted
  write was refused `NOT_MEMBER`. A raw HTTP history fetch with her bearer
  returned no post-removal content.
- **`tb-view-once-refetch`** — second grant refused `E_ASSET_VIEWED`; the
  previously issued direct URL no longer serves bytes; a third party is refused
  `E_ASSET_UNKNOWN`.
- **`tb-expired-edit-window`** — the post-window edit is refused
  `EDIT_WINDOW_CLOSED`, and **every** attempt to supply a caller-side clock is
  refused `E_INPUT`: `at`, `at`+`now`, `serverTimestamp`, `editWindow`, and a
  raw `POST /m/editMessage` carrying `at`+`now`. Stored text unchanged
  throughout. The 120 s delete window was still open and correctly still
  allowed the delete, confirming the two windows are independent rather than
  one blanket refusal.
- **`tb-session-invalidation`** — the bearer served `POST /q/me` with HTTP 200
  and the profile body before logout, then HTTP 401
  `E_AUTH: this session is not live; sign in again` at +0 / +1.5 / +5 s.
- **`tb-offline-bypass`** — the recipient viewed both an ordinary photo and a
  view-once photo (so both were cached), Alice then deleted the ordinary one.
  On an **offline cold reload** the client rendered **0** decoded non-avatar
  image nodes for either message, forced offline re-opens rendered nothing, and
  the client reported "no retained ordinary media is available offline".
  *Measurement correction:* a first pass counted 1 image node for the view-once
  bubble and I nearly recorded a leak; re-measuring with sender-avatar
  attribution showed the node was the avatar. Revocation survives the offline
  cache and view-once media is never durably cached.
- **`tb-digest-authorization`** — 7 messages across 2 chats the target is not a
  member of contributed exactly 0 to that user's digest; its unread counts
  stayed at the in-scope 2 messages / 1 chat, and a tombstoned message was
  excluded.

Authorization is server-side, not UI absence. Cleanest demonstration is m3-a14:
the server refuses a non-admin removal (`NOT_ADMIN`) even when the grader drives
the mutation straight past the UI.

### M8 scheduled digest — m8-a08 … m8-a12 (all pass)

Run on my own fresh instance (port 49364, `grading/work/digest-probe/`), never
the dev instance, under the frozen shortened digest config (`periodSeconds: 120`,
`oneDigestPerUserPerPeriod`). Five signed-up personas; I aligned to a clean
period boundary, generated in-period activity, **closed every client**, then
`SIGTERM`ed the backend mid-period and restarted it.

Expected for the target, computed by hand before observing anything:
`{newFollowers: 1, newPostsInFollowing: 2, unreadMessages: 2, unreadChats: 1}`.
Observed exactly that, in exactly one logged payload.

- **m8-a08** — exactly one digest per active user with every client closed, all
  four counts correct, tombstoned message excluded.
- **m8-a09** — the idle persona received no digest while 4 active users did.
- **m8-a10** — the next, activity-free period emitted 0 digests.
- **m8-a11** — after the mid-period `SIGTERM`+restart, still exactly one digest
  per user for that period (4 total), unchanged on the following tick. The
  mechanism is visible in `snapback/schema.q`: the job emits
  `once [p.principal, periodEnd]`.
- **m8-a12** — 7 outsider messages in 2 chats contributed 0. The schema scopes
  unread to `for member in members where .principal = p.principal`, so
  non-membership is structurally excluded rather than filtered late.

### M5 ephemeral — m5-a01, m5-a02, m5-a03 (all pass)

Under the lane's shortened profile the "24h" option is a **180 s** server TTL
(`config-profile.json`). A DM message with an attached photo was sent, its
server deadline read back, and the chat setting then changed to `off` — the
existing deadline was **not** rewritten, as `CONFIGURATION.md` claims.

- Two Bob web clients both rendered the message. One stayed connected across the
  deadline; the other was taken warm-offline beforehand. Before expiry, the
  offline-bound client's in-chat search **found** the message — establishing that
  its local index genuinely held it.
- **m5-a01** — with every client closed at the deadline, a fresh API client got
  `null` for the message, it was absent from the recipient's history and from
  server-side chat search, and the media grant was refused
  `E_ASSET_UNKNOWN`.
- **m5-a02** — the connected client no longer rendered it; the disconnected
  client no longer rendered it either (it enforced the deadline locally while
  disconnected, which is *stronger* than "immediately on reconnect") and stayed
  purged after reconnect; a third, cold-launched client never rendered it.
  *Honest caveat:* the 10 ms / 14 ms figures in my log are measured from the
  start of grader observation (deadline + 4 s), not from the deadline — the purge
  had already completed inside that buffer, so these are upper bounds on
  detection, not purge latencies.
- **m5-a03** — after the client synced the expiry, search returned 0 hits both
  online and with the context forced offline (`sm-search-offline` present, so the
  offline path was genuinely exercised). *Honest caveat:* my offline control
  query also returned 0 rows, so the negative rests on the pre-expiry positive
  hit rather than on a surviving offline control.

### m6-a12 — grader-written API.md-only client (pass)

Written from `API.md` alone, without reading lane source for the task
(`grading/work/m6a12/latest.mjs`): `login` → `createClient` → page `api.inbox`
matching `chat.title` → `api.apiHistory` → `data[0]`. **It worked first try.**
The doc's explicit warning that chat names need not be unique proved
load-bearing: "Weekend Plans" resolved to 11 conversations, so the script
reports every match rather than guessing. I independently verified the doc's
"newest server ordinal first" claim by paging each full history and comparing
`max(ordinal)` against `data[0].ordinal` — they agreed on every non-empty
conversation. One documentation error found, filed as **d-02**.

### Four results I initially got wrong, and how they resolved

Recorded because the report's notes cite the corrections and a reader should be
able to audit them. In all four the lane was right and my harness's assumption
was wrong.

| Assertion | My first reading | Resolution |
|---|---|---|
| m1-a07 | "revoked token still served data" | I reused a persona that had a second live client in the same process, so the SDK resolved a different live session. Isolated raw-HTTP re-run: HTTP 200 before logout, HTTP 401 `E_AUTH` at +0/+1/+3/+10 s after. **pass** |
| m2-a10 | "Bob still follows Alice" | `followState` returns `{followers, following, mine}`; `mine` is the viewer-follows flag, `following` is a count I misread as a boolean. With `mine:false`, Alice's post is in Bob's Global feed. **pass** |
| m3-a03 | "found 19 DM channels for the pair" | I filtered on `peer`, which the backend also populates for two-member groups. `chat.kind` histogram: 21 group / 2 dm — exactly **one** DM for the pair, and `openDirect` returned the identical ID from both directions and on re-open. **pass** (and the doc gap became **d-02**) |
| m4-a06 | "count undefined after switch" | `messageReactions` returns raw per-principal rows; the `{emoji,count,mine}` aggregate is on `apiHistory.reactions`. Re-measured: 👍→❤️ replaces in the **same row id**, count stays 1; a third user's ❤️ makes 2; clearing leaves 1. **pass** |

A fifth, **m2-a22/m2-a23**, took three attempts: a single programmatic
`scrollTop = scrollHeight` jump loaded the next page in only 1 of 6 trials, even
though the container was genuinely at the bottom (scrollTop 0 → 1373 of
scrollHeight 2023, clientHeight 650). Reading `src/Posts.tsx` showed infinite
scroll **is** implemented — an `onScroll` handler with
`scrollEventThrottle={100}` — so one synchronous jump produces too few scroll
events. Real mouse-wheel scrolling loaded the page **3/3 on both tabs** in
~1.15 s, and the always-present `Load more` control loaded it 3/3. Both
assertions **pass**; the throttling artifact is filed as cosmetic **d-06**. This
is also why I checked the suite's mapped test for a vacuous-pass path (Phase 2) —
it does not have one.

## The 18 `not-run` results

No assertion failed. All 18 non-passes are absences of evidence, in two groups.

**M7 — 9 assertions.** `ENVIRONMENT.md`, authoritative on environment facts,
scopes this session to M1–M6 plus M8 and states M7 "is a separate fresh session
run later by the orchestrator after grading; do not attempt it".
`milestones.json` and the run record both record M7 `not-run`. Per O1's frozen
rule these stay in the denominator and score not passed; the status distinction
matters for attribution only. `m7-a09` is recorded `not-run` rather than
`not-applicable`: the schema's `not-applicable` branch for that conditional
assertion applies when *no* milestone was previously green, whereas here M1–M6
and M8 were all green — the item simply never executed. For information only, I
re-ran every previously-green suite in this session and all passed.

**iOS-simulator native-artifact assertions — 9** (`m6-a01`…`m6-a07`,
`m8-a17`, `m8-a18`). Both segment summaries record
`supplementalExternal: [{"id": "ios-simulator-m6"|"ios-simulator-m8",
"pass": null, "receipt": null, "status": "not-recorded", "requiredForGreen":
false}]` — no simulator recording and no structured receipt was produced. The
only native artifacts in the lane are iOS **Hermes bundle exports**
(`evidence/native-artifacts.json`, `artifacts/m{1..6,8}-ios*`), which are
compiled output, not a simulator run. The frozen prompt forbids scoring these
from builder assertions or by re-running the simulator myself, so they record
`not-run` rather than pass or fail. Per the brief this is a permitted gap — it
"cannot support a native claim but does not block the web authoring-green
clock" — and M6/M8 web green is legitimate (`greenRequired: false`).

Worth stating plainly for O4: the harness's **web** m6 assertion
`offline-message-queue-flush-in-order` does demonstrate the same three
behaviours that `m6-a05`…`m6-a07` describe (two offline messages pending,
in-order flush, receipts reaching read), and the m8 web assertions demonstrate
multi-device convergence — but on web, so they cannot satisfy a
simulator-scoped assertion. They are scored as O4 input. The lane's own web
substitutes (`evidence/cold-web.json`, `m8-restart-web.json`,
`offline-actions.json`) are builder assertions, excluded from O4 by rule — but
they are labelled honestly (`"carrier": "web replica; native proof remains
Hermes artifact only"`), and `README.md` states that a native replica needs an
installed Expo module in a development or production native build. That candour
is what O4's "honesty of any gap between claim and guarantee" clause credits.

## O5 — scale replay

Scored strictly by the frozen band function, first-match in order 0, 30, 60, 90,
75, from the lane's replay artifacts. I recomputed every rule from the raw
checkpoint files rather than trusting the lane's summary.

**Band 0 does not fire.** The invariant manifest conforms *exactly* at all three
checkpoints: I diffed `evidence/scale-verify-{10pct,50pct,final}.json` against
the frozen `instrument/fixtures/invariant-manifest-combined.json` and every
`perEntityCount` and `followEdgeCount` matched at every checkpoint (final: 1008
profiles, 5921 follow edges, 50 228 posts, 100 015 messages, 2736 quoted
replies, 2000 active reactions, 0 disappearing settings). `namedO5Fixtures` is
true at 10%, 50% and 100%; `namedSpotEntities` is true at the final checkpoint.
The replay wall cap was not exhausted (`clocks.replay`: attempted true,
`wallSeconds` 4123.09, `probeWallSecondsExcluded` 12.284, `capExhausted` null; no
numeric replay cap is pinned in this DRAFT instrument).

**Band 30 fires** on "any degradation rule fails" — three mid-curve clauses fail:

| Rule | growth ratio (≤3) | line value at 50% | observed at 50% | verdict |
|---|---|---|---|---|
| `perf-search-scaling` | 0.241 ✓ | 7.202 ms | 10.468 ms | **fail** |
| `perf-aggregate-scaling` (Insights) | 0.256 ✓ | 1.231 ms | 2.117 ms | **fail** |
| `perf-aggregate-scaling` (Trending) | 0.313 ✓ | 2.231 ms | 3.800 ms | **fail** |

All other rules pass: `perf-deep-paging` 0.992, `perf-feed-follow-scaling`
0.904, `perf-celebrity-fanout` read 1.100 / write 1.418,
`perf-cold-start-sync` 1.1–4.7 s over 5 runs with bounded residency (~3.93 MB
logical, 28.6 MB wasm heap) and no timeout or unbounded growth, and
`perf-envelope-stability` — no probe timed out, errored or OOMed.

**Diagnostic context, recorded but deliberately not allowed to move the band**
(the function is exact and O5 is explicitly not interpolated): the curve is
monotonically **decreasing** — every final p95 is far below its 10% counterpart
— so these are mid-curve non-monotonicity failures, not the superlinear blow-up
the rule targets. The shape is consistent with measurement conditions: the 10%
and 50% checkpoint probes ran while the replay process was still resident on a
machine whose load average ran 16–34, whereas the final probes ran on a
quiescent instance (the 50% `history-page-1` p95 of 45.6 ms with a 66.8 ms max,
against 1.63 ms at the end, is the clearest fingerprint of that). The lane's own
`evidence/scale-performance-summary.json` reports `pass: false`, `score: null`
and `officialRotatedProbeSet: false` — it declined to self-score and agrees with
this reading. Absolute ceilings are uncalibrated in this DRAFT instrument
(`absoluteCeilingsNotCalibrated: true`), which is immaterial because ceilings
feed only the 60 and 90 bands and band 30 fires first.

One further observation: `evidence/scale-result.json` records a
`verificationRecovery` — an `E_OFFLINE` / `ECONNRESET` during **invariant
verification** (not during a probe), recovered in 2.99 s, after which the final
verification passed. Since it was not a probe, it does not independently trigger
band 30's second clause.

## Defects found beyond the checklist

Severity-bucketed in the report as **d-01 … d-06**: no blockers, no majors,
3 minor, 3 cosmetic.

- **d-01 (minor, M5)** — a consumed view-once photo reverts to `unopened` and
  re-enabled on the recipient's client after **any** page reload, and stays
  wrong indefinitely: `sm-convo-viewonce` reported
  `aria-valuetext="opened"`/`disabled=true` right after the first view, then
  `"unopened"`/`disabled=false` at +1, 3, 6, 10, 15, 25, 40 and 60 s after an
  ordinary online reload. `api.apiHistory` exposes `viewOnce` but no
  `opened`/`viewed` field, so the client has no server signal to restore the
  state from short of attempting the fetch. **Nothing leaks** — the forced
  second open renders nothing, the server refuses `E_ASSET_VIEWED`, and the
  media is never durably cached — but the client misreports which view-once
  photos have already been burned, which is the point of the feature. This is
  the single finding that keeps O2 out of the "only cosmetic nits" band.
- **d-02 (minor, M6)** — `API.md` documents the inbox row's `peer` as "the other
  member in a DM", but the backend also populates it for two-member groups: 22
  rows carried `peer=bob` where only 1 was `chat.kind="dm"`. A custom client
  following the docs misclassifies groups; the correct discriminator
  (`chat.kind`) is documented, so it is a one-line doc fix. It cost me one wrong
  measurement (m3-a03), which is exactly the failure mode m6-a12 is meant to
  price.
- **d-03 (minor)** — the run record omits the `performanceProbes` block O5 is
  defined to read. `clocks.replay` is present but `capSeconds`,
  `capFractionUsed` and `capExhausted` are all null, and there is no
  `performanceProbes.o5Inputs`, so a grader must reconstruct the band inputs by
  hand from loose `evidence/scale-*.json` files. The block is optional in
  `run-record-extension.schema.json`, so the record is schema-legal.
- **d-04 (cosmetic, M5)** — search group headers fall back to the literal
  placeholder `"Conversation"` while the per-chat title query loads, so two
  distinct groups can briefly show identical headers. Grouping itself is correct.
- **d-05 (cosmetic)** — `scripts/acceptance-m2.mjs` and `acceptance-m3.mjs`
  hard-code a fixture password inline instead of reading `personas.json` as
  `test-support.mjs` does. m1-a13 still passes: test code, not app persistence,
  bundles or logs.
- **d-06 (cosmetic, M2)** — infinite scroll needs successive scroll events; a
  single programmatic jump to the bottom loaded the next page 1/6 times. Real
  wheel scrolling 3/3, `Load more` 3/3, so no page is unreachable.

## Schema limitation and the prior measurement-coverage gap

Both are recorded here at the harness's request.

**Frozen schema limitation.** `grader-report.schema.json` constrains
`assertionResults` keys with the pattern `^m[1-7]-a[0-9]{2}$`, so the report can
carry only the **101** M1–M7 IDs — even though the frozen manifest
(`assertions.json` VERSION `0.3.0-m8`, whose own README describes the M8
milestone and marks M8 simulator assertions `greenRequired:false`) contains
**119** unique IDs, 18 of them `m8-*`. The report half of the instrument was
therefore not carried forward to the M8 amendment that the assertion half was.
Rather than drop M8 or break schema validity, all 119 were graded in this one
independent session and the 18 M8 results were written to
`grading/m8-assertion-results.json` using the same record shape and the same
`result`/`method` enums, with no ID duplicated across the two files. Validation
(AJV 8.20.0, 2020-12 dialect, from the lane's `choreography/node_modules`)
confirms: report schema-valid `true`; report keys exactly the 101 of
`GRADER_ASSERTIONS_101.txt`; M8 file keys exactly the manifest's 18 `m8-*` IDs;
union exactly equal to the manifest's 119; zero overlap.

**Prior measurement-coverage gap.** The September 5 and September 12 structured
`assertionResults` carried only those same 101 IDs. Their prose notes could and
did describe M8 observations, but they provided **no machine-comparable 18-ID M8
result set** — so no earlier run can be diffed against this one on M8 at
assertion granularity, and any cross-run M8 comparison before this session rests
on prose rather than on keyed results. This session is the first to emit the M8
18 as structured, individually keyed records.

**Instrument observation, not a lane defect.** The `counts` block inside the
frozen `assertions.json` is stale relative to its own content: it reports
`M2: 24` and `total: 116`, while the file actually enumerates 27 M2 IDs and 119
unique IDs. I graded the enumerated IDs, not the counts block.

## Subtotals

| Set | Pass | Not-run | Fail | Total |
|---|---|---|---|---|
| Prior-101 (M1–M7, in `grader-report.json`) | 85 | 16 | 0 | 101 |
| M8 (in `m8-assertion-results.json`) | 16 | 2 | 0 | 18 |
| **Complete** | **101** | **18** | **0** | **119** |

Per milestone: M1 13/13, M2 27/27, M3 15/15, M4 12/12, M5 12/12, M6 6/13,
M7 0/9, M8 16/18.

No weighted total, efficiency statistic or cross-lane comparison is computed or
reported here — those are the harness's and publisher's jobs.

## O-dimension scores

| Dim | Score | One-line basis |
|---|---|---|
| O1 | 78 | 101/119 pass, 0 fail; M1–M5 complete; held below the 90 anchor by the 9 absent platform-proof artifacts and by M7 (9 assertions) recorded not-run |
| O2 | 84 | No blockers or majors; 3 minor + 3 cosmetic, d-01 the only user-visible wrong state |
| O3 | 88 | All 7 published trust-boundary categories correctly denied, including asset access after view-once and after delete; marginally below the 90 anchor only because the evidence base is grader-authored public-category checks, not the wave's secret rotated probes |
| O4 | 65 | Ordered offline writes, correct receipts, warm-offline search and multi-device convergence all evidenced from harness receipts — but entirely on web; the native proof and all four cold-start offline observations are absent, with the gap honestly declared |
| O5 | band 30 | Manifest conforms and the cap was not exhausted, but three frozen mid-curve degradation clauses fail |

All five are applicable under `applicability.json` for this run's scope and
statuses, so none records null.
