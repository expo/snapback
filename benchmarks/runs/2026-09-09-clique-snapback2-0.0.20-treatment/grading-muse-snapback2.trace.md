# Grader evidence and action trace — lane `muse-snapback2`

Sanitized published artifact (LLP 0197 redaction posture; LLP 0198 rule —
raw transcripts are never published). Fixture-pack credentials are referenced
by persona id only; no password, bearer token, or session carrier value
appears below, and no absolute host path, machine name, or account identifier
is reproduced. Server-generated row ids are elided where they carry no
evidentiary weight.

- **Lane:** `lanes/muse-snapback2` — backend `snapback2 0.0.20` (public npm
  package), Expo/React-Native web client, `snapback/*.q` Quarry backend.
- **Run scope:** full (M1–M8 in the instrument's scope).
- **Instrument pin:** `social-messenger@0.3.6-m8`
  (`setup-identity.json`); assertion manifest
  `instrument/schema/social-messenger/assertions.json`.
- **Grader:** family `claude`, model `claude-opus-5`, fresh session, no
  builder context.
- **Grading window:** 2026-09-09T22:33Z – 2026-09-09T23:58Z (UTC).
- **Host:** macOS arm64, Node 24.18.0, Playwright 1.62.1 / chromium.
  Machine shared with other lanes throughout; `uptime` load recorded beside
  every timing-sensitive measurement.

## 0. Protocol deviations recorded for this run

1. **No holdout probe set was committed for this wave.** Execution-order
   phase 4 was skipped in full. `wave.probeSetSha256` is the literal string
   `none-uncommitted`; `probeResults` is empty with an explanatory note. No
   probe was invented or simulated. O3 records null for an independent
   structural reason (§8), so this deviation does not by itself change any
   score.
2. **This grader family has not passed the calibration gate**
   (`grader/calibration.md`). `grader.calibrationPassed = false`,
   `grader.sameFamilyGraded = false`. The grade is labelled
   `uncalibrated-grader` by the record.
3. Timing-sensitive checks are judged best-of-3; machine load is recorded
   beside each timing record.
4. **No lane run record exists.** `lanes/muse-snapback2/run-record.json` is
   absent. Milestone execution-time statuses were therefore never recorded by
   the lane, and this report grades from receipts and independent execution
   only, per the wrapper instruction. Where a status would normally be read
   from the run record, this trace states what the receipts show instead of
   asserting a status the lane never declared.
5. **Report-schema gap for M8.** `grader-report.schema.json`'s
   `assertionResults` accepts keys matching `^m[1-7]-a[0-9]{2}$` with
   `additionalProperties: false`, so M8 assertion IDs cannot be represented in
   a schema-valid report even though `applicability.json` (manifest 0.3.0-m8)
   puts M8 in full-run scope. M8 results are therefore recorded in this trace
   and in the report's `notes`, not in `assertionResults`. This is an
   instrument inconsistency, not a lane finding.

## 1. Exclusion compliance

`lanes/muse-snapback2` contains `diary.md`, `essay.md`, `final-report.md`, and
`run-log.md`. **None was opened.** Their names appear in directory listings
only. No other lane under `lanes/` was read. The grading session is not
contaminated.

## 2. Processes started, and teardown

All grader-started servers were confined to ports 50700–50719 and killed by
PID at the end. No `pkill`/`killall`/pattern kill was used.

| PID | What | Port |
| --- | --- | --- |
| 99112 | lane backend (`snapback2 dev --port 50700`) | 50700 |
| 99356 | lane web client (`node scripts/serve-dist.mjs dist 50710`) | 50710 |
| (transient) | grader choreography harness runs, acceptance suites, probes | — |

Teardown, performed at the end of the session and verified: the backend was
stopped with its own `snapback2 dev --stop` (`{"exited":"snapback2 dev
--stop","ok":true}`), the web client was killed by PID, every transient PID
was confirmed gone, and ports 50700–50719 were confirmed to have no listener.
Seven other snapback2 listeners belonging to other lanes were still running
and were not touched.

Every write the grader made landed under `lanes/muse-snapback2/grading/`,
except the two side effects the documented acceptance entrypoint itself
produces (recorded in §3.1).

## 3. Phase 1 — the builder's documented acceptance entrypoint

Entrypoint (`package.json`): `npm run acceptance -- --milestone mN`
→ `scripts/acceptance.mjs`, which runs `acceptance/<mN>/suite.mjs` under
`node --test`, writes `acceptance/<mN>/receipt.json`, validates the coverage
manifest against `instrument/schema/social-messenger/assertions.json`, and
refreshes the lane-root `suite-status.json`.

Backend and web client were started by the grader from the lane's own
documented paths (`snapback2 dev --port 50700`; `npm run web` →
`scripts/serve-dist.mjs dist 50710`), matching the URLs baked into `API.md`
and the suites' defaults.

### 3.1 Side effects of running the documented entrypoint

`scripts/acceptance.mjs` **overwrites** `acceptance/<mN>/receipt.json` and
`suite-status.json` on every invocation. Running the entrypoint as the
protocol requires therefore replaced the builder's own receipts. The
as-delivered state of those files was captured before the first run and is
reproduced here for the record:

```
suite-status.json (as delivered)
  m1 pass=true  m2 pass=true  m3 pass=true  m4 pass=true  m5 pass=true
  (no m6 entry)
acceptance/m1/receipt.json (as delivered)
  pass=true tests{passed:6,failed:0} coverage.unmapped=[] elapsedMs=14875
```
The lane's four choreography receipts under `choreography/receipts/` were not
written to and remain as delivered.

### 3.2 Results, first clean pass (backend + web client freshly started)

| Milestone | `npm run acceptance` | Detail |
| --- | --- | --- |
| m1 | **pass** | 6 tests pass, 0 fail, 0 unmapped |
| m2 | **pass** | 9 tests pass, 0 fail, 0 unmapped |
| m3 | **fail** | 4 pass / 1 fail |
| m4 | **fail** | 2 pass / 2 fail |
| m5 | **fail** | 4 pass / 1 fail |
| m6 | **fail** | 0 pass / 1 fail — the suite file does not load at all |

Two of those failures had a single shared root cause that is a lane defect,
and one is a lane defect on its own; §3.3–3.5 separate them.

### 3.3 M6 — the acceptance suite cannot execute (defect d-02)

`acceptance/m6/suite.mjs:16` imports

```
import { replayLogs } from "../scripts/replay.mjs";
```

Resolved from `acceptance/m6/`, that is `acceptance/scripts/replay.mjs`, which
does not exist; the file is at the lane root (`../../scripts/replay.mjs`).
Node fails with `ERR_MODULE_NOT_FOUND` before any test runs:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  .../lanes/muse-snapback2/acceptance/scripts/replay.mjs
  imported from .../lanes/muse-snapback2/acceptance/m6/suite.mjs
```

This is consistent with the delivered artifacts: there is no
`acceptance/m6/receipt.json` and no `m6` key in `suite-status.json`, so the
M6 suite has never completed a run. M6 cannot meet the brief's green bar.

For phase 3 the grader re-executed M6's suite-required assertions from a
grader-local copy (`grading/acc-m6/suite.mjs`) whose **only** difference is
the corrected relative import; the lane tree was not modified. Results in §6.

### 3.4 M4 / M3 first-pass failures — the pending-upload leak (defect d-01)

M4's first pass failed both media tests with a backend refusal:

```
send photo settled rejected: the owner pending object ceiling is full
(limit 40); your usage is 16 pending objects. Inspect client.listUploads();
discard only ids whose future use you have abandoned with
client.discardUpload(id) ...
```

and M3's seed-idempotency test failed with

```
post sp0014 did not settle: rejected the owner pending object ceiling
```

Investigation (`client.listUploads()` as each starter persona):

| persona | pending objects held | rows |
| --- | --- | --- |
| alice | 16 | 50 (34 released) |
| carol | 12 | 12 |
| erin | 6 | 6 |
| grace | 6 | 6 |
| bob, dave, frank, henry | 0 | 0 |
| **total held** | **40** | = the owner-wide ceiling, exactly saturated |

`createdAt` on the held objects shows **24 of the 40 pre-date this grading
session** (16:24Z–19:56Z, i.e. the lane's own session); 16 were added by the
grader's two M3 suite runs at 22:37Z/22:38Z, which is what tipped the pool
over the ceiling. Every one of the 40 was accepted by `client.discardUpload`
— a claimed id refuses with `E_ASSET_IN_USE`, so **none of the 40 was
attached to any row**. The leak is real, not an accounting artifact.

Root cause, in the lane's own source:

- `snapback/posts.q:53-58` — `createPost` returns the prior row on a
  duplicate `clientKey` **before** reading `images`/`clip`.
- `snapback/messages.q:110-115` — `sendPhoto` does the same
  (`return { id: prior.id, photo: prior.photo }`); `sendClip` and
  `sendOncePhoto` follow the pattern.
- The snapback2 client uploads asset arguments *before* invoking the
  mutation (package README, "Assets"). An early idempotency return therefore
  strands the freshly uploaded object: never claimed, never discarded.
- `scripts/replay.mjs:144-155` — `findPostByClientKey` scans only 10 pages of
  the global feed, so on a re-seed of an instance with more than ~200 posts
  the `skipExisting` short-circuit misses and the media is re-uploaded into
  that early-return path.

Consequence: `npm run acceptance -- --milestone m3` — which the brief
requires every milestone's suite to re-run (m3-a15) — leaks ~10 owner
slots per invocation. `snapback2 guide operator` records that cleanup starts
24 h after creation, so once 40 accumulate **every media send by every user
fails for a day**, with no in-app recovery path. Filed as **d-01**.

After the grader discarded the 40 unclaimed objects (an operator action, not
a code change), M4 and M5 passed cleanly:

| Milestone | re-run after pool recovery |
| --- | --- |
| m4 | **pass** — 4 tests pass, 0 fail |
| m5 | **pass** — 5 tests pass, 0 fail |
| m6 | fail (unchanged — the import bug is not state-dependent) |

### 3.5 M3 — reproducible suite failure

M3 failed on three consecutive runs (the protocol's one permitted re-run plus
one). Its failing test is `m3-a10/a11` (quoted reply excerpt + jump). Detail
and independent execution in §6.

## 4. Phase 2 — coverage-manifest spot-verification

The lane ships `acceptance/<mN>/coverage.json` for m1–m6. Completeness first,
mechanically against the assertion manifest:

| Milestone | suite-required assertions | mapped | unmapped | spurious |
| --- | --- | --- | --- | --- |
| M1 | 7 | 7 | 0 | 0 |
| M2 | 22 | 22 | 0 | 0 |
| M3 | 7 | 7 | 0 | 0 |
| M4 | 5 | 5 | 0 | 0 |
| M5 | 6 | 6 | 0 | 0 |
| M6 | 5 | 5 | 0 | 0 |
| M7 | 6 | — | *no manifest* | — |
| M8 | 6 | — | *no manifest* | — |

M7 is out of this session's scope by the run's environment overlay (a separate
fresh session runs it). M8 was in scope and has no manifest; see §8.

Honesty was then spot-verified by reading the mapped test bodies. Sampled
assertion IDs: **m1-a03, m1-a04, m1-a11, m2-a12, m2-a13, m2-a16, m2-a22,
m2-a24, m3-a15, m4-a09, m5-a09, m5-a11, m6-a11**.

Findings:

- **m1-a03** (duplicate handle rejected with a visible error) maps to a
  profile-save test rather than a signup test. The manifest declares this
  and explains why (the app registers email+password first, handle second).
  The test genuinely fills `alice` into `sm-profile-field-handle`, saves, and
  asserts a visible non-empty `sm-profile-error` and that the route did not
  advance. **Honest.**
- **m1-a04, m2-a12/a13, m3-a15, m4-a09, m5-a09** — the mapped tests exercise
  exactly the named observable, including UI-level checks where the assertion
  is UI-level (m2-a13 asserts zero `sm-feed-media` nodes in the card and that
  the link opens a real browser popup at the posted URL; m4-a09 asserts the
  rendered bubble matches `/edited/i`). **Honest.**
- **m2-a22 / m2-a23** ("with >20 seeded posts, *scrolling* loads the next
  page") map to an API-level `allPages` walk: 21 filler posts, first page
  exactly 20, more than one page, and every filler id reachable. It proves
  the substantive observable (20-per-page paging, no gaps) but not the scroll
  affordance. **Weak but not dishonest** — the mapped test does exercise the
  assertion's paging observable.
- **m5-a11** ("global message search **groups results by chat**") maps to a
  test that asserts only `rows.length > 0` and that every hit carries a
  `conversationId`. The manifest note claims "UI groups under
  `sm-search-group`", but no mapped test checks grouping.
  **Overstated.** The grader executed the grouping observable independently
  (§6, M5) rather than relying on the mapping.
- **m2-a16** ("feeds show the repost attributed *reposted by {display
  name}*") maps to a test that asserts only that a repost **head** is present
  in `globalReposts`. The attribution clause is not exercised by the mapped
  test. **Overstated** — but the observable itself holds: the frozen
  two-client harness's `repost-toggle-live-attribution` assertion passed under
  grader execution (§5).
- **m6-a11** maps to the demo-script test, which asserts the demo's own
  stdout markers for authenticate / list conversations / poll-receive plus a
  parsed JSON summary. **Honest** — but see §3.3: that suite never runs, so
  the mapping was never exercised by the lane.

**Verdict: `honest`.** No mapping points at a test that does not exercise its
assertion at all, and no mapping claims a test that does not exist. Three
mappings (m2-a16, m2-a22/a23, m5-a11) are weaker than their assertion text;
in every one of those cases the grader executed the missing clause
independently and found the underlying behavior present (m2-a16, m5-a11) or
substantively covered (m2-a22/a23). These are recorded as quality
observations, not as dishonesty. No milestone is adjudicated to
`capability-failure` on this ground.

## 5. Phase 3 method — how `[choreo]` assertions were executed

The lane ships four choreography receipts, written between 08:52Z and 13:46Z:
`choreography/receipts/m1.jsonl`, `m2.jsonl`, `m4.jsonl`, `m5.jsonl`, plus a
root `choreography/receipts.jsonl` holding a later m5 re-run.
**There is no m3 receipt anywhere in the lane** — M3's two-client segment was
never recorded, so M3 could not have met the brief's green bar as delivered.

As delivered, those receipts record:

| segment | green | assertions passed/failed | recorded cause |
| --- | --- | --- | --- |
| m1 | true | 3 / 0 | — |
| m2 | **false** | 1 / 8 | `choreography-failed` |
| m3 | *no receipt* | — | — |
| m4 | true | 5 / 0 | — |
| m5 | **false** | 1 / 3 | `choreography-failed` |

Those receipts are, however, **stale with respect to the delivered build**:
`dist/` was rebuilt at 15:27 local, hours after the m2 (09:40) and m4 (11:28)
receipts. Grading the delivered artifact on receipts written against an
earlier bundle would be unfair to the lane in one direction and unfair to the
benchmark in the other. The frozen prompt's no-re-drive rule is scoped to
**simulator / native-artifact** `[choreo]` assertions and to O4; phase 3
directs the grader to re-execute the checklist "via the custom-client API and
browser automation on the web build". The grader therefore:

1. copied `instrument/choreography` to `grading/choreo` and `npm install`ed
   there (never writing into `instrument/`), per the run's environment
   overlay; and
2. ran the **frozen harness itself**, unmodified, against the delivered
   `dist/` build on ports 50700/50710, for segments m1–m5.

Harness invocation (credentials supplied via environment, redacted):

```
node grading/choreo/choreography.mjs m1,m2,m3,m4,m5 \
  --lane-run-id grader-muse-snapback2 \
  --setup-identity setup-identity.json \
  --suite-status grading/suite-status-grader.json \
  --adapter choreography/adapter.json \
  --timeout 30000 \
  --receipts grading/work/choreo-receipts.jsonl
```

`--timeout 30000` was chosen deliberately: the harness default is 10 s, and a
first grader run at the default lost `session-persists-on-relaunch` purely to
machine load (this machine ran three lanes concurrently; load average was
5–13 throughout). 30 s is the most generous setting observed in the lane's own
recorded receipts, so the lane is judged at its own most-favourable timeout.
Every `bestOf: 3` assertion still records all three measurements.

The grader's `suite-status` input is a copy; it carries `outcomeClass`
`application` for the non-passing m3 entry because the harness requires that
field, and omits `m6` because the M6 suite cannot execute at all (§3.3).

Simulator / native-artifact assertions (`m6-a01..a07`) were **not** re-driven
and were not simulated. They are scored from lane artifacts only; see §8.

### 5.1 Mapping the harness's named assertions to checklist IDs

The frozen harness names its checks by behavior, not by assertion id. The
grader scored `[choreo]`-class assertions against these correspondences,
chosen by observable:

| harness assertion | checklist id(s) |
| --- | --- |
| `profile-edit-live-visibility` | m1-a09 |
| `session-persists-on-relaunch` | m1-a05 |
| `logout-remains-signed-out-on-relaunch` | m1-a06 |
| `feed-text/image/video-post-live-update` | m2-a04 (all three legs) |
| `feed-author-avatar-and-display-name` | m2-a05 |
| `like-unlike-live-count` | m2-a14 |
| `reply-live-thread-projection` | m2-a19 |
| `dm-live-messages` | m3-a01 |
| `sender-avatar-identity-when-rendered` | m3-a02 |
| `typing-*` | m3-a06, m3-a07 |
| `receipt-*` | m3-a08 |
| `group-aggregate-*` | m3-a09 |
| `member-removal-*` | m3-a12, m3-a13 |
| `photo-message-live-render` | m4-a02 |
| `video-message-live-playback` | m4-a04 |
| `reaction-live-replace-remove` | m4-a05 |
| `edit-live-visibility` | m4-a08 |
| `delete-live-tombstone` | m4-a11 |
| `chat-color-background-sync` | m5-a07 |
| `warm-offline-search-over-synced-messages` | m5-a12 |

`m2-a07` ("Alice's follower count updates live when Bob follows her") has no
exact harness counterpart — `follow-unfollow-live-projection` exercises the
live *Following-feed* projection, not the follower counter — so the grader
drove m2-a07 itself in Playwright, best-of-3 (§6).
`follow-unfollow-live-projection` and `repost-following-feed-surface`
correspond to suite-required assertions (m2-a06/a08/a09 and m2-a18) executed
live; their harness outcomes are reported as corroborating evidence in §6 but
those ids are scored on the grader's own execution.

## 6. Phase 3 — independent checklist execution, by milestone

Method key: `suite` = the lane's documented acceptance entrypoint;
`api` = grader script against the custom-client API on port 50700;
`web` = grader-driven Playwright against the delivered `dist/` on port 50710;
`choreo` = the frozen harness re-run by the grader (§5).

### M1 — Accounts and profiles: 13 of 13 pass

- **m1-a01 … m1-a04, m1-a08, m1-a10, m1-a11** — `suite`, all pass on a clean
  run (6 tests, 0 failures, coverage complete).
- **m1-a05, m1-a06** — `choreo`, `session-persists-on-relaunch` and
  `logout-remains-signed-out-on-relaunch` both pass (1745 ms, 3178 ms).
- **m1-a09** — `choreo`, timing-sensitive, best-of-3: **3340 / 2782 / 2968 ms**,
  all three passing (load 5–9).
- **m1-a07** *(grader, full-only)* — **pass**. A grader-created account signed
  up, captured its bearer, called `profiles.mine` successfully, then logged
  out. Replaying the captured bearer on a *fresh* client:
  `query -> refused, code E_AUTH_SUPERSEDED` ("operation belonged to a
  previous authentication generation"), `data` absent; a mutation with the
  same bearer -> `rejected, E_AUTH_REQUIRED`. Revocation is server-side.
- **m1-a12** *(grader, source inspection)* — **pass**. `snapback/schema.q:1`
  declares `use identity`; the app calls only `client.auth.signup` /
  `client.auth.login` (`app/auth.tsx:28-32`). No password column exists in
  the schema, and no app code touches a credential beyond handing it to the
  provider. `snapback2 guide auth` documents `use identity` +
  `client.auth.*` as *the* provider path, so the lane uses the documented
  path rather than provider internals.
- **m1-a13** *(grader, source inspection)* — **pass**. Targeted plaintext
  scans for four known fixture/test passwords returned **0 hits** in
  `.snapback/store.sqlite`, **0** in the built web bundle `dist/`, and **0**
  in `.snapback/log.jsonl`. (Credential strings are not reproduced here.)

### M6 grader-class assertion

- **m6-a12** *(grader, "following only API.md")* — **pass**. Working only
  from `API.md`, a grader script authenticated, walked `conversations.chatList`
  by cursor to find the conversation *named* "Weekend Plans", paged
  `messages.thread`, and returned its latest message with every documented
  field-manifest field resolving as described (`id`, `conversationId`,
  `authorId`, `at`, `body`, media leaf, `edited`, `tombstoned`, `quoteId`,
  and reactions via the separately documented `messages.reactionsFor`).
  API.md's "newest-first pages of up to 50" claim was checked against the
  returned timestamps and holds. The documentation was sufficient with no
  recourse to the lane's source.

### M3 — Messaging core

Suite-required (`suite`): m3-a03, m3-a04, m3-a05, m3-a14 **pass**.
m3-a10/a11 and m3-a15 fail in the lane's own suite; both were re-executed
independently and the results differ from the suite's — see below.

- **m3-a10, m3-a11** — **pass** on independent execution. The frozen
  harness's `quoted-reply-excerpt-and-jump` check passed **3 of 3** attempts
  (55 126 / 58 546 / 72 526 ms). The lane's own suite test fails the same
  observable because it waits only 20 s for the seeded quoted pair to appear,
  and that pair now sits on the *third* history page of a 138-message DM
  (see d-06). The behavior is present; the lane's test bound is too tight for
  its own history depth.
- **m3-a15** — the suite's seed-idempotency test failed under the saturated
  upload pool (d-01) and was re-run after recovery; result recorded below
  after the clean re-run.
- **m3-a01** (`dm-live-messages`) — **pass**, best-of-3
  **35 317 (fail) / 46 928 / 51 264 ms** — two of three attempts passed.
- **m3-a02** (`sender-avatar-identity-when-rendered`) — **pass** (253 ms).
- **m3-a06 / m3-a07** (typing indicator) — the harness failed 3/3, but the
  failure is *not* "no indicator": the log shows
  `waiting for getByTestId('sm-convo-typing') to be hidden ... locator
  resolved to visible <div ... aria-label="Bob Bennett is typing">`. The
  indicator **appears**; it does not **hide** inside the 5 s bound. These
  attempts ran at load averages of 30–78 (three lanes on one machine), so the
  grader re-measured both clauses itself, best-of-3, with load recorded.
- **m3-a08** (receipt transitions) — the harness ran this `bestOf: 1` and it
  timed out at 30 s waiting for the sent bubble under load ~30. The frozen
  prompt requires timing-sensitive checks to be judged best-of-3, so the
  grader re-measured it directly.
- **m3-a09** (group aggregate waits for the slowest member) — harness failed:
  `group delivered receipt did not expose semantic value delivered within
  30000ms`. Source inspection shows a genuine specification mismatch,
  confirmed by a load-independent API construction; see below.
- **m3-a12 / m3-a13** — the harness bundles these into
  `member-add-promote-remove-leave-and-live-cutoff`, which aborted at its
  *first* step (`addable group member did not expose semantic value dave`)
  and so never reached the removal observables. The add-member candidate list
  in `components/ChatSettings.tsx:186-204` is empty until the user types into
  a plain `TextInput` (`:205-215`) that carries **no contract testID**, so no
  conforming client can drive it. The grader executed the removal
  observables directly instead.

### M2 — Posts and the follow graph: 26 of 27 pass

All 22 suite-required assertions pass on a clean run (9 tests, 0 failures).
The five `[choreo]`-class assertions:

- **m2-a04** — **fail**. `feed-text-post-live-update` passes 3/3
  (28 548 / 4 617 / 11 308 ms) and `feed-image-post-live-update` passes 3/3
  (5 219 / 5 258 / 7 467 ms), but `feed-video-post-live-update` fails 3/3
  (30 896 / 56 693 / 51 527 ms) at a 30 s bound. The assertion requires **all
  three** created posts to render live, so it fails on the video leg. Root
  cause is d-04, confirmed independently.
- **m2-a05** — **pass**. The harness's check aborted waiting for
  `sm-feed-tab-global`, a cascade from the stuck composer, so the grader drove
  it directly: the feed card carries the author's display name and its
  `sm-feed-author-avatar` node has the correct `aria-valuetext` identity and
  renders the author's **uploaded avatar image** (a blob URL appears in the
  node's computed `background-image` about 5 s after the card mounts; the
  first 0 ms sample sees only the initials fallback, which is what a
  short-window check would misread).
- **m2-a07** — **pass**, best-of-3 **969 / 2 546 / 2 685 ms** at load 5–10.
  Bob follows Alice on his client; Alice's own profile follower count changes
  without any manual refresh. (No harness check covers this clause; §5.1.)
- **m2-a14** — **pass**. `like-unlike-live-count` passed in the harness. The
  grader's own best-of-3 measured **23 477 / 23 389 / 20 290 ms** — live and
  refresh-free, but slow; recorded as a diagnostic, not a failure, since the
  assertion sets no numeric bound.
- **m2-a19** — **pass**, best-of-3 **10 973 / (>30 000) / 20 100 ms**. The
  harness failed this deterministically on `strict mode violation:
  getByTestId('sm-compose-input') resolved to 2 elements` (d-03) — a selector
  defect, not a projection defect. Driven directly, the parent's reply count
  does increment live.

Two harness checks that map to suite-required assertions also failed, and both
were re-executed directly and found working:
`follow-unfollow-live-projection` (cascade from the composer) and
`repost-following-feed-surface` — for the latter the grader confirmed that
Carol's repost of Erin's post surfaces in Alice's Following feed in
**8 818 ms** when Alice follows Carol and not Erin, with the card rendering
`↻ Reposted by Carol Chen` under `sm-feed-repost-attribution` (m2-a16's
clause, which the coverage manifest does not exercise).

### M4 — Media messages, reactions, edit/delete: 12 of 12 pass

- **m4-a01, a03, a06, a07, a09** — `suite`, all pass once the leaked upload
  pool is cleared (§3.4).
- **m4-a02** — **pass**, 3/3 (42 635 / 37 677 / 51 838 ms, load 25–47).
- **m4-a04** — **pass** (47 604 ms).
- **m4-a05** — **pass**, 3/3 (45 918 / 39 151 / 61 356 ms).
- **m4-a08** — **pass**, best-of-3 **3 722 / 1 090 / 1 419 ms**, `edited`
  label present on every attempt. The harness failed this 0/3 at loads 25–47;
  it did not reproduce at loads 15–17, so the harness result is a load flake.
- **m4-a11** — **pass**, best-of-3 **917 / 1 102 / 1 093 ms**, with the
  "deleted" tombstone text observed on the recipient each time. Same story:
  the harness's single failing attempt was under load.
- **m4-a10** *(grader)* — **pass**. With the fixture pack's
  `windows.shortened.json` applied through the app's own `config.setWindows`
  (`editMs` 60 000, `deleteMs` 120 000, `dis24Ms` 180 000, `dis7Ms` 300 000),
  an in-window edit commits and an edit attempted 63 s later is rejected
  server-side with `EDIT_WINDOW_EXPIRED`; the stored body is unchanged.
  Server-side rule: `snapback/messages.q:189` /
  `require now - msg.at <= cfg.editMs`.
- **m4-a12** *(grader)* — **pass**. Before the delete, the message's asset URL
  served **HTTP 200, image/png, 2 110 B** with the client's auth header.
  After `unsend`, the identical URL returns **HTTP 404** both for the client
  that had already fetched it and for a freshly logged-in client, and
  `assetBlob` refuses with `E_ASSET_NOT_READY`.

### M5 — Ephemeral, chat config, search: 12 of 12 pass

- **m5-a04, a05, a08, a09, a10** — `suite`, all pass.
- **m5-a11** — **pass**. The suite's mapped test checks only that hits carry a
  `conversationId` (§4), so the grader executed the grouping clause: the same
  token placed in a DM and in a group produced **two distinct
  `sm-search-group` headers** over two `sm-search-result` rows.
- **m5-a12** — **pass** (`warm-offline-search-over-synced-messages`,
  20 562 ms).
- **m5-a07** — **pass**. The harness failed this for the lane *and* for the
  grader ("Carol's synchronized chat background did not become observable
  within 30000ms"), so the grader executed the observable directly: with the
  admin setting accent `#ff5a36` and a fixture background, Carol's client
  showed **both** — the background image and the accent tint on her own
  bubble — within **182 ms**, and Carol's server-side view carries both
  fields. The harness drives the *admin's* UI path, and the grader found that
  path unreachable from the `/c/<id>` route (d-07) though complete from the
  canonical `/conversation/group/<title>` route, where all eleven
  `sm-chatsettings-*` contract IDs are present.
- **m5-a01 … m5-a03** *(grader, shortened windows)* — **all pass**. A DM was
  set to disappearing `24h` (= 180 s under the fixture config), a marked
  message sent, and a real browser client opened the chat and confirmed the
  message both rendered and was searchable. Both clients were then closed for
  180 s + 30 s slack. After expiry:
  - **m5-a01**: `messages.messageById` → `denied`, `data` null; the thread no
    longer lists it; server-side search returns 0 hits for its marker; a
    control message in a non-expiring DM is still present.
  - **m5-a02**: the relaunched client does not render it.
  - **m5-a03**: it is absent from search both online and, after cutting
    connectivity, offline, while unrelated offline results still render.
- **m5-a06** *(grader)* — **pass**. During the first view the asset serves
  **HTTP 200 / 2 110 B**; after the view the same URL returns **HTTP 410**
  with `E_ASSET_VIEWED` for the viewer's own client *and* for a fresh client,
  and a non-member gets **404**. Enforced server-side, not by UI absence.

### M3 results (continued)

- **m3-a12** — **pass**. After the admin removed Carol, her API thread for
  that group returned `denied` with zero rows, and no post-removal message
  reached her open client within 25 s.
- **m3-a13** — **fail**. The assertion requires the removed member to still
  see her **local copy of pre-removal history**. Carol's client had synced the
  pre-removal message before the removal (verified), but after the removal her
  conversation showed **0 bubbles**, and a fresh client showed none either.
  The local copy is dropped rather than retained.
- **m3-a08** — **fail**, and **not** a load artifact. Across three attempts
  (74 477 / 73 114 / 68 528 ms, loads 12–20) the receipt sequence observed on
  Alice's own bubble was `["sent"]`, `["pending","sent"]`, `["sent"]` — it
  never reached `delivered` or `read`, even after Bob's client opened the
  conversation. A load-independent API construction identifies the cause:

  ```
  deliverySet(messageId) -> state "capped", rows 1
    [{ recipient: <alice, the author> , kind: "message" }]
  readStates(conversationId) -> state "complete", rows 2
    [ alice{fetchedAt,readAt}, bob{fetchedAt,readAt} ]   <- both present and advancing
  ```

  `snapback/schema.q:121` declares `deliveries` `read <- .recipient = viewer`,
  so a sender can only ever read **her own** delivery row.
  `aggregateReceipt` (`lib/data.tsx:29-53`) builds its recipient set from
  those rows minus the author — which is therefore always empty — and returns
  `"sent"` unconditionally. The read marks the feature needs are visible in
  `readStates`; the aggregate simply never consults them because it gates on
  `deliveries` first. Every message in the app is pinned at `sent` for its
  sender.
- **m3-a09** — **fail**, for the same root cause and for a second, independent
  reason. The constructed group case (Alice sends; only Bob fetches and reads;
  Carol never touches it) yields `recipientSet=0, fetched=0 -> "sent"`, and
  the UI bubble reads `"sent"`. Separately, `lib/data.tsx:43-51` computes
  `allRead = fetched.every(...)` over **only the members who have already
  fetched**, so if the delivery-read rule were fixed the aggregate would report
  `read` as soon as the fetched subset had read — the opposite of "it waits for
  the slowest member". The in-source comment acknowledges the deviation.
- **m3-a15** — **pass** on a clean pool. Re-running
  `npm run acceptance -- --milestone m3` after the upload pool was cleared
  gives **4 pass / 1 fail**, the single failure being the m3-a10/a11 test
  discussed above. That run leaked **10 fresh held upload objects**
  (alice 3, carol 3, erin 2, grace 2) — a live reproduction of d-01.

### M6 — Offline writes, push seam, custom-client API

The lane's M6 suite cannot load (d-02), so `suiteResult` is `fail` for all
five suite-required assertions. The grader executed them from a local copy
whose only change is the corrected relative import (§3.3):

- **m6-a09** — **pass**. A view-once photo's logged push payload previews as
  exactly `"Photo"`.
- **m6-a10** — **pass**. `scripts/custom-client-demo.mjs` exits 0 against the
  live backend and emits its `{ ok: true, ... }` summary.
- **m6-a11** — **pass**. The demo's stdout carries every listed operation:
  `authenticated with an access token`, `new DM appears in conversation list`,
  `sent a text message`, `received the sent message by polling history`, plus
  field checks on the returned history row.
- **m6-a13** — **pass**. The scale-replay adapter replayed the fixture pack's
  `sample-50.log` green: **50 actions, all settled, in 2 025 ms**.
- **m6-a08** — **fail**, and not for an environment reason. The push payload
  carries the correct `target`, `chatId` and `senderName`, but the **preview
  is not truncated to the first 80 characters**:

  ```
  expected (first 80 chars): "…with more than eighty characters to exercise preview truncatio"
  actual   (92 chars):       "…with more than eighty characters to exercise preview truncation rules fully"
  ```

  Source confirms there is no truncation anywhere on the path:
  `snapback/messages.q:107` calls `notifyMembers(conversationId, body, false)`
  with the whole body, and `sendPush` (`:22-29`) inserts `preview` verbatim
  into `pushLog`. The `'Photo'` / `'Video'` media previews are correct; only
  the 80-character text rule is missing.

- **m6-a01 … m6-a07** *(simulator / `native-artifact`, `greenRequired:false`)*
  — **not-run**. The grader did not and must not re-drive these. The lane's
  `native/` directory holds only per-milestone iOS Hermes **bundle exports**
  for m1 and m4 (`native/m1/metadata.json`, `native/m4/metadata.json`) — a
  build artifact, not a recorded simulator run. There is no cold-start
  offline recording, no offline-queue recording, and no
  `--simulator-status` file anywhere in the lane. Absent evidence is recorded
  as absent, never as passing (the brief's rule).

M6 therefore does not meet the green bar on any reading: its suite does not
execute, its web choreography segment was never run by the lane, and its
native artifact is absent.

### M7 — Day-2 evolution

**Not attempted, by the run's own design.** The environment overlay for this
run states that M7 is a separate fresh session executed by the orchestrator
*after* grading, and instructs the M1–M6 session not to attempt it. The lane
has no `acceptance/m7`, no M7 coverage manifest, and no M7 surface. All nine
M7 assertions record `not-run`. The grader made no pre-M7 snapshot comparison
(m7-a08) because there is no post-migration state to compare against.

### M8 — Insights, digest, and multi-device offline

**Not attempted.** M8 was inside this session's ordering (M1→…→M6→M8) and was
not reached. Evidence: `app/insights.tsx` is a literal placeholder whose whole
body renders the text *"Insights arrive at M8."*; there is no Insights or
Trending query in `snapback/*.q`; `digestConfig` exists as a table
(`snapback/schema.q:294`) and `config.q` can read/write it, but **no digest is
ever emitted** — the only `schedule` in the backend is
`expireMessage` (`snapback/messages.q:220`). There is no `acceptance/m8`, no
M8 coverage manifest, and no M8 choreography receipt. All eighteen M8
assertions are `not-run`.

M8 results cannot be expressed in `assertionResults`: the report schema's
`patternProperties` accepts only `^m[1-7]-a[0-9]{2}$` under
`additionalProperties: false`. They are recorded here and in the report's
`notes` instead (deviation 5 in §0).

### Scale replay (O5 input)

**Never attempted.** The lane ships a replay adapter (`scripts/replay.mjs`,
harness-validated against `sample-50.log` — m6-a13 above), but there is no
`scale.log` run, no invariant-manifest verification output, no checkpoint
data, and no settle-receipt accounting anywhere in the lane. `metering/` is an
unmodified copy of the instrument's tooling, not lane output. O5 is therefore
`null` per `applicability.json` ("Never-attempted replay records null").

## 7. Phase 5 — defect list (beyond the checklist)

Severity-bucketed, matching `grader-report.json` `defects` exactly. Defects
whose only consequence is a checklist assertion already scored under O1 are
**excluded** here to avoid double-counting, and are described in §6 instead:
the missing 80-character push-preview truncation (m6-a08), the receipt
aggregate pinned at `sent` (m3-a08/a09), and the removed member losing her
local history (m3-a13).

### d-01 — `blocker` (M4): unclaimed-upload leak takes down all media sending

Every media-carrying mutation returns early on a duplicate `clientKey`
*before* consuming its asset argument:

- `snapback/posts.q:53-58` — `createPost`:
  `prior = posts[clientKey = key]; if prior != null: return prior`
- `snapback/messages.q:110-115` — `sendPhoto`:
  `return { id: prior.id, photo: prior.photo }`
- `snapback/messages.q:125-140`, `:141-154` — `sendClip`, `sendOncePhoto`:
  the same shape.

The snapback2 client uploads asset arguments *before* invoking the mutation
(package README, "Assets"). An early idempotency return therefore strands the
uploaded object: never claimed, never discarded. The owner ceiling is 40
pending objects and, per `snapback2 guide operator`, cleanup begins only
**24 hours** after creation.

Evidence: `client.listUploads()` reported **exactly 40 held objects** across
the starter personas (alice 16, carol 12, erin 6, grace 6) — the pool exactly
saturated. **24 of the 40 were created during the lane's own session**
(16:24Z–19:56Z), before grading began. All 40 were accepted by
`client.discardUpload()`, which refuses claimed ids with `E_ASSET_IN_USE`, so
none was attached to any row.

Reproduced consequence: with the pool saturated, `sendPhoto` and `sendClip`
are rejected for **every** user — `"the owner pending object ceiling is full
(limit 40)"` — so M4's photo and video tests both failed and `scripts/seed.mjs`
could not replay a media post. The filling path is the benchmark's own
required one: `scripts/replay.mjs:144-155`'s `findPostByClientKey` scans only
10 pages of the global feed, so on an instance with more than ~200 posts the
`skipExisting` short-circuit misses and each re-seed re-uploads into the
early-return path. m3-a15 requires that re-seed at every milestone. After the
grader discarded the 40 objects, M4 and M5 passed immediately — and one later
`npm run acceptance -- --milestone m3` leaked **10 fresh held objects**, a
live reproduction.

### d-02 — `major` (M6): the M6 acceptance suite cannot be loaded

`acceptance/m6/suite.mjs:16` imports `"../scripts/replay.mjs"`, which resolves
to `acceptance/scripts/replay.mjs`; the file is at `../../scripts/replay.mjs`.
`node --test` aborts with `ERR_MODULE_NOT_FOUND` before the first test.
Corroborated by the delivered tree: no `acceptance/m6/receipt.json` and no
`m6` key in `suite-status.json`. A grader-local copy with only that import
corrected runs 3 of 4 tests green, so the features underneath are largely
present; the defect is one wrong relative path in the shipped deliverable, and
it costs M6 its green bar.

### d-03 — `major` (M2): duplicate contract testIDs on the reply screen

The post-thread/reply screen renders **two** elements carrying
`sm-compose-input` and **two** carrying `sm-compose-submit` at once. Grader
DOM scan across five screens:

```
feed (/)              {"sm-compose-input":1,"sm-compose-submit":1, ...}
compose (/compose)    {"sm-compose-input":1,"sm-compose-submit":1}
post thread (reply)   {"sm-compose-input":2,"sm-compose-submit":2, ...}  <-- duplicates
conversation          {"sm-convo-input":1}
search                {"sm-search-input":1}
```

The frozen harness fails deterministically with `strict mode violation:
getByTestId('sm-compose-input') resolved to 2 elements` (m2
`reply-live-thread-projection`, attempt 2); the other two attempts time out
filling an ambiguous match. CONTRACT.md testIDs are the lane's
machine-checkable interface, so duplicating one makes the reply-compose
surface undrivable by any conforming client.

### d-04 — `major` (M2): a video post cannot be created from the web composer

`app/compose.tsx:39` builds every attachment preview as
`URL.createObjectURL(file)` regardless of kind, and `:112` hands `{ uri, kind }`
to the frozen kit's `Composer`, which renders that `uri` in an `<Image>`
(`instrument/ui/src/Composer.tsx:75-79`, `testID="sm-compose-attachment-media"`)
with a ▶ overlay for `kind === 'video'`. A raw video blob URL cannot decode in
an image element.

Observed twice, at loads 5 and 28: after attaching `media/vid-01.mp4`,
`sm-compose-attachment` and `sm-compose-attachment-media` both exist but
contain **0 `<img>` nodes**, so the preview never renders — and after filling
the composer and pressing submit, a 12-page scan of the global feed found
**0 posts** carrying the marker body. The failure is not cosmetic: the post
never reaches the server. Image attachments are unaffected. This is the
proximate cause of `feed-video-post-live-update` failing 3/3 in both the
lane's own receipt and the grader's re-run, and of the cascade that left the
composer mounted so the following harness checks could not find the feed tabs.

### d-05 — `minor` (M1): the delivered instance ships probe residue on a fixture profile

`profiles.byHandle('alice')` returns `displayName "Alice"`, `bio "flip probe"`,
`location "Fixture City"`, and no `link`, against the fixture pack's
`"Alice Alvarez"` / `"Coffee, cameras, and neighborhood walks."` /
`"Oakland, CA"` / `https://example.com/alice`. All seven other starter personas
match their fixtures exactly. Observed before the grader ran anything that
writes profiles; the M1 suite's own edit test correctly restores its subject
(bob), so this is residue from unscripted manual probing rather than from the
suite.

### d-06 — `minor` (M3): conversation history paging is hard-capped

`components/Conversation.tsx:426-444` caps auto-paging with
`if (pagedPages.current >= 4) return;`, so a conversation screen loads at most
about five pages and offers no further affordance. The delivered alice↔bob DM
holds 138 messages and the seeded quoted pair (`Corner place` / `Six thirty`)
sits at positions 136–137; a grader client loaded 100 bubbles over 63 s and
never reached them. This is why the lane's own m3-a10/a11 suite test fails
while the behavior itself works (§6, M3).

### d-07 — `minor` (M5): the `/c/<id>` Settings affordance is a stub

`app/c/[id].tsx:26` wires `onOpenSettings={() => router.push("/chats")}`.
Clicking `sm-convo-settings` from a conversation opened by id therefore lands
on the chat list with **zero** `sm-chatsettings-*` nodes, so group settings —
rename, members, accent, background, disappearing — are unreachable from that
route. The canonical `/conversation/group/<title>` route is complete: all
eleven `sm-chatsettings-*` contract IDs are present there.

### d-08 — `minor` (M3): the add-member flow has no contract testID to drive

`components/ChatSettings.tsx:186-204` populates `addableMembers` only from a
query over `addQuery`, and `:205-215` renders that query as a bare
`TextInput` with no testID. The candidate list is therefore empty until a
human types into an element no conforming client can find. The frozen harness
aborts m3's member-lifecycle check at its very first step —
`addable group member did not expose semantic value dave within 30000ms` —
and so never reaches the removal observables, which the grader then had to
execute directly.

### d-09 — `cosmetic` (M3): `dmPairs` is declared publicly readable

`snapback/schema.q:40-50` declares `public 'dm dedupe is a public product
invariant'` on the table mapping every principal pair to its DM conversation
id — the "who direct-messages whom" graph. No exposed operation returns those
rows today (`dmPairs` is read only inside `conversations.q:10`, within
`dmCreate`), so nothing leaks in the delivered build; the declaration is
broader than the need and would leak on the first query that touches the table.

### d-10 — `cosmetic` (M5): `recordOnceView` returns the asset after consumption

`snapback/messages.q:155-163` returns `{ viewed: true, first: false, photo:
msg.oncePhoto }` on a repeat view. Not a disclosure — the platform refuses the
bytes (grader observed HTTP 410 / `E_ASSET_VIEWED` for the viewer and for a
fresh client, which is exactly what m5-a06 asserts and passes) — but handing
back a consumed view-once record leaves the deny decision to the caller
rather than making it structural.

## 8. Phases 4 and 6 — probes and O-dimension scores

### Phase 4 — holdout probes: skipped

No holdout probe set was committed for this wave, so execution-order phase 4
was skipped in full (deviation 1, §0). `wave.probeSetSha256` records the
literal string `none-uncommitted` and `probeResults` is empty. **No probe was
invented, approximated, or simulated**, and no anchor probe was run. The
trust-boundary and performance observations that do appear in this trace
(m1-a07, m4-a10, m4-a12, m5-a06, and the `dmPairs` note) are checklist
assertions and defect findings; none of them is scored as a probe and none
bears on O3.

### Phase 6 — O-dimension scores

Scored exactly the dimensions `applicability.json` makes applicable for this
run's scope and statuses.

| dim | weight | score | basis |
| --- | --- | --- | --- |
| O1 | 13 | **62** | interpolated against the 60 and 30 anchors |
| O2 | 7 | **34** | interpolated against the 30 and 60 anchors |
| O3 | 8 | **null** | predicate `m6-green-and-m1-m5-attempted` not met |
| O4 | 9 | **null** | predicate `m6-green` not met |
| O5 | 8 | **null** | predicate `replay-attempted` not met |

**O1 = 62.** Anchors cited: 60 — *"M1–M4 solid, later milestones patchy or
failed on cap"*; 30 — *"core features partially work; several checklist items
fail"*; 90 — *"every in-scope milestone green, including platform-proof
artifacts"* — not in reach. Over the 119 in-scope assertions: **80 pass, 5
fail, 34 not-run**. The front of the run beats the 60 anchor: M1 13/13, M4
12/12, M5 12/12 all clean, M2 26/27, M3 12/15 — 75 of 79 M1–M5 assertions
passing, i.e. M1–**M5** solid rather than the anchor's M1–M4. The tail is
worse than "patchy": M6 scores 5/13 with an acceptance suite that cannot load
at all and no native artifact of any kind, so no platform proof exists; M8 is
unbuilt; the scale replay was never attempted. M7's absence is structural to
this run's design, so it sits in the denominator but is not read as a lane
shortfall. Net: a little above 60.

**O2 = 34.** Anchors cited: 30 — *"multiple high-severity defects in core
flows"*; 60 — *"a few medium defects off the happy path"*. Ten defects beyond
the checklist: **1 blocker, 3 major, 4 minor, 2 cosmetic**. The blocker (d-01)
is squarely a core flow — all media sending, app-wide, for 24 hours, with no
in-app recovery — and it was observed already 60 % saturated in the delivered
state, took M4's suite down during grading, and was reproduced fresh. d-04 is
also core: a video post cannot be created from the app at all. That
combination is what the 30 anchor describes. Slightly above 30 because each
major is a single, precisely located mistake rather than systemic wrongness,
six of the ten are minor or cosmetic, and the app is otherwise correct across
75 of 79 M1–M5 assertions.

**O3 = null.** `applicability.json`'s predicate is
`m6-green-and-m1-m5-attempted`. M6 is not green on any reading. This is
independent of deviation 1: even with a probe set, O3 would record null here.

**O4 = null.** Predicate `m6-green`, not met. Separately, O4's only admissible
basis is the harness's simulator recordings and structured receipts, and the
lane has none.

**O5 = null.** Predicate `replay-attempted`, not met — no `scale.log` run, no
invariant-manifest verification, no checkpoint or settle-receipt accounting.
Per `applicability.json`, *"Never-attempted replay records null"*, so the band
function is not evaluated at all. The lane's harness-validated 50-action
adapter (m6-a13, green) is M6 checklist credit, not an O5 input.

Because three dimensions are null, this run publishes per-dimension scores and
efficiency statistics only — **no weighted total**. No weighted total,
efficiency statistic, or cross-lane comparison is computed anywhere in this
report or trace; those are the harness's and publisher's jobs.

## 9. Side effects of grading, and teardown

Disclosed in full so the next reader can tell the lane's state from the
grader's:

1. **`acceptance/<mN>/receipt.json` and `suite-status.json` were overwritten**
   by the documented acceptance entrypoint, which rewrites them on every
   invocation. The as-delivered contents are reproduced in §3.1. The lane's
   four choreography receipts under `choreography/receipts/` were not touched.
2. **Forty leaked unclaimed upload objects were discarded** (§3.4). This was
   necessary to separate d-01 from the assertions it was masking; without it
   M4 and M5 could not be executed at all. Twenty-four of the forty pre-dated
   grading. Subsequent grading work re-leaked ten, so the pool was left
   *less* saturated than it was found, not more.
3. **Alice's display name was changed by the frozen harness itself**, whose
   m1 `profile-edit-live-visibility` assertion edits it and does not restore
   it; it now reads `Alice Choreo <run-id> 3`. It was already non-fixture
   before grading began (d-05). Neither this nor item 2 was reverted, so the
   evidence stays inspectable.
4. **The shortened-windows fixture config is still applied** to the running
   instance (`editMs` 60 000, `deleteMs` 120 000, `dis24Ms` 180 000,
   `dis7Ms` 300 000), set through the app's own `config.setWindows` for
   m4-a10 and m5-a01..a03 as the frozen prompt requires.
5. Grader-created accounts, conversations, groups and messages carry `g-`,
   `grader-` or `suite`/`choreo` prefixes and remain in the instance.

Everything the grader wrote is under
`lanes/muse-snapback2/grading/` — `grader-report.json`, this trace,
`acc-m6/` (the one-line-corrected M6 suite copy), `choreo/` and `metering/`
(copies of the instrument, never written back), `acceptance/` (copies of the
receipts, for the harness's path resolution), `work/` (probe scripts and
receipts) and `logs/`. Nothing was written into `instrument/`.

### Processes

Only ports 50700–50719 were used. Every PID the grader started is listed in
`grading/work/pids.txt`; the two long-lived servers are killed by PID at the
end of the session, and no `pkill`, `killall`, or pattern kill was used at any
point. Other lanes' processes were never touched.

### Machine load

This machine ran three lanes concurrently throughout. One-minute load
averages recorded beside the measurements ranged from **5 to 78**. Every
timing-sensitive judgement in §6 is best-of-3 with its loads stated, and every
harness failure that plausibly stemmed from load was re-executed by the grader
before being recorded as a lane failure — which reversed the recorded outcome
for m3-a07, m4-a08, m4-a11, m5-a07, m2-a05, m2-a18 and m2-a19. The failures
that survived re-execution (m2-a04, m3-a08, m3-a09, m3-a13, m6-a08) each have
a load-independent root cause identified in source.

## 10. Session outcome

`completed`. One phase re-run was used (the M3 acceptance suite, per the
grader-abort protocol's single-re-run allowance); it reproduced, so no
`grader-abort` was recorded. The grading session is **not** contaminated: no
excluded builder artifact was opened. This grade is labelled
`uncalibrated-grader` — `grader.calibrationPassed` is `false` — per
deviation 2.
