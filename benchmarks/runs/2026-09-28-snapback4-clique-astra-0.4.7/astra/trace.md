# Sanitized grading trace — lane `astra-snapback4`

Wave `full-3models-astra` · grader family `claude`, model `claude-opus-5` ·
session outcome `completed` · grade label **`uncalibrated-grader`**.

Machine: macOS arm64, Node 24.18.0 (absolute Volta toolchain path). Other
sessions shared the host throughout; 1-minute load averages during this session
ranged from **5.8 to 33.4** and are recorded beside every timing measurement
below.

**Redaction.** No credential appears in this file. Fixture passwords, the
issued user session tokens and the lane's push-provider service token were
read only as opaque values and are never printed, hashed or paraphrased here.
Asset and message identifiers are elided where they are not needed to follow
the argument. Raw session transcripts are retained privately and are not
published.

---

## Isolation and what was not read

The lane directory contains `diary.md`, `essay.md`, `final-report.md`,
`FINAL.md` and `run-log.md`. **None was opened.** `run-record.json` is a named
input and was read for its harness, timestamp and wall-clock fields; its
`diary` and `notes` string fields are builder narrative and were deliberately
not read past confirming their type. No other lane under `lanes/` was touched.
Nothing was written into `instrument/`. `grader.contaminated` is `false`.

## Recorded deviations from the frozen protocol

1. **No holdout probe set was committed for this wave.** Execution-order
   phase 4 was skipped. `wave.probeSetSha256` is the sentinel
   `none-uncommitted`; `probeResults` is empty. No probes were invented. O3
   was instead scored from a grader-authored sweep over the trust obligations
   the brief publishes (§ Trust sweep), and its justification says so.
2. **The grading family has not passed the calibration gate.**
   `grader.calibrationPassed` is `false`, `grader.sameFamilyGraded` is `false`.
   The lane was graded anyway; the record labels the grade `uncalibrated-grader`.
3. **Timing-sensitive checks judged best-of-3** with `uptime` recorded beside
   each measurement.
4. `grader.rerunsUsed` is **1**. The first M6 and M8 suite runs failed on the
   grader's own start-up omissions, were corrected, and re-ran green (§ Phase 1).
   They are reported as lane defects d-01/d-02 for *documentation quality*, not
   as suite failures.

## Two structural facts about measurement coverage

**The frozen schema cannot hold an M8 result.** `grader-report.schema.json`
constrains `assertionResults` with `patternProperties: "^m[1-7]-a[0-9]{2}$"`
and `additionalProperties: false`. The frozen assertion manifest
(`0.3.0-m8`, sha256 `e15c3952…32d04`) carries **119** unique assertions,
including 18 M8 ids added by LLP 0201's 2026-08-11 amendment. A schema-valid
report therefore cannot express them. All 119 were graded in this one session:
the 101 M1–M7 ids are in `grader-report.json`, the 18 M8 ids in the companion
`m8-assertion-results.json`. The two files were checked to partition the
manifest exactly — union 119, overlap 0, and the 101 set matches
`GRADER_ASSERTIONS_101.txt` element-for-element.

**The prior measurement-coverage gap.** The structured `assertionResults` of
the September 5 and September 12 runs carried only those same 101 ids. Their
notes could describe M8 observations in prose, but no machine-comparable 18-id
M8 result set was ever produced. Any comparison against those runs is therefore
a comparison of the 101-id subtotal, not of the complete 119. This run's
subtotals are stated at the end of this file so both are legible.

*(Incidental instrument observation, not a lane finding: the manifest's own
`counts.assertions` block is stale — it declares `M2: 24` and `total: 116`
where the milestone bodies actually contain 27 and 119. The assertion bodies,
not the counts block, were treated as authoritative.)*

---

## Environment brought up

Ports used: **49360** (backend) and **49361** (web), inside the assigned
49360–49379 range. Nothing outside it was touched; no pattern kill was used.

| role | how started | PIDs |
|---|---|---|
| backend | `npx snapback4 dev --port 49360` per README | launcher 25486, listener 25583 |
| web | `PORT=49361 SNAPBACK_URL=… node scripts/serve.mjs` over the existing `dist/` | 26443 |
| push worker | `node scripts/push-worker.mjs` (README) | 78901 |
| backend, relaunched *by the M8 suite itself* | `scripts/backend-lifecycle.mjs` | 87093, then 16108 |
| grader-owned push worker | `grading/probes/grader-worker.mjs` | 57674 |

The served web build was **not** regenerated, per the README's instruction.
Window configuration was already the fixture pack's shortened-grading profile
and was verified byte-identical to `instrument/fixtures/config/windows.shortened.json`
and `digest.shortened.json` (edit 60 s, delete 120 s, 24h→180 s, 7d→300 s,
digest period 120 s) before any grading ran.

---

## Phase 1 — builder suite

`npm run acceptance -- --milestone mN`, the documented entrypoint, run against
the running backend for every executed milestone.

| milestone | result | tests |
|---|---|---|
| m1 | pass | 5/5 |
| m2 | pass | 8/8 |
| m3 | pass | 5/5 |
| m4 | pass | 6/6 |
| m5 | pass | 8/8 |
| m6 | pass **on re-run** | 4/4 |
| m8 | pass **on re-run** | 3/3 |

`scripts/acceptance.mjs` derives the required id list from the frozen manifest
itself and asserts coverage for every suite-required id before it will report a
pass, so a green suite cannot leave an assertion unmapped.

### defect d-01 — documented start leaves the M8 suite unrunnable

First `--milestone m8` run, started exactly as the README documents:

```
PASS six server-computed lifetime totals match independent stored corpus
PASS UTC today increments and all seven days including zero render
Error: kill ESRCH
    at stopBackend (scripts/backend-lifecycle.mjs:7:11)
    at Module.run (scripts/suite-m8.mjs:100:9)
```

`stopBackend()` reads the live backend PID from `evidence/backend-listener.pid`.
The documented start command (`npx snapback4 dev --port 49360`) never writes
that file — only `startBackend()` inside the suite does. A grader who follows
the README gets a stale PID from the builder's own session and the suite aborts
before the trailing-window Trending test. Writing the true listener PID into the
file made the suite pass. Severity **minor**: recoverable, but it breaks the
documented cold path and silently leaves m8-a05/a06/a07 unverified.

### defect d-02 — M6 suite needs a push worker, and says so only by failing

First `--milestone m6` run:

```
AssertionError [ERR_ASSERTION]: push-1790602252204 xxxxxxxx…xxxx
    at scripts/suite-m6.mjs:78:16
  actual: undefined, expected: true
```

The suite polls `evidence/push-payloads.jsonl` for 50 s and then asserts on the
payload it expected to find. If `scripts/push-worker.mjs` is not already
running, nothing ever writes that file, and the diagnostic the grader sees is
the 115-character padded probe body — no mention of the provider process. The
worker requirement *is* in README.md, but not in the acceptance entrypoint's own
path. Starting the worker made the suite pass. Severity **minor**.

Both failures are the grader's own set-up omissions and are recorded as
`rerunsUsed: 1`, not as lane suite failures. They are reported as defects only
because the brief scores diagnostics and documented reproducibility.

---

## Phase 2 — coverage-manifest spot-verification

**Verdict: honest.** No dishonest milestones.

Every one of the 51 suite-required mappings across the seven executed
milestones was read against its assertion's observable — the whole manifest,
not a sample. Sampled in depth (the ids recorded in
`coverageSpotVerification.sampledAssertionIds`):

- **m3-a11** (tapping the quoted excerpt jumps to the original) does not stop
  at clicking the preview. It waits for `#message-<originalId>` and then on a
  `getBoundingClientRect()` predicate requiring `top >= 0 && top < innerHeight`
  — it proves the target actually scrolled into view, across 24 intervening
  messages that force a second history page.
- **m3-a15** (seed idempotence) snapshots `SELECT id FROM messages` with a
  10 000-row limit, re-runs *every installed* starter segment, and requires
  byte-identical output.
- **m2-a24** (no duplicates, no gaps) reads two pages of both feeds, asserts
  set-cardinality equals row count, and requires all 25 freshly written ids to
  be present across the pages.
- **m8-a01** recomputes all six lifetime totals from independent SQL over the
  stored corpus, asserts the server's `insights.summary` against them, and then
  re-asserts each against the rendered `sm-insights-total-*` node.
- **m6-a13** shells out to the frozen instrument validator
  (`instrument/fixtures/validate.mjs`) and the lane's sample verifier, and
  requires `verification.json.pass`.
- **m1-a03/a04**, **m2-a13**, **m2-a22**, **m2-a27**, **m4-a07**, **m4-a09**,
  **m5-a05**, **m5-a11**, **m6-a09**, **m6-a11**, **m8-a04**, **m8-a07** were
  each traced to a test that exercises the clause rather than a proxy.

No mapping was found pointing at a test that does not exercise its observable.

---

## Phase 3 — independent checklist execution

### Choreography-scored assertions

`[choreo]` assertions are scored from the harness's structured receipts, never
re-driven by the grader. All 7 final segment receipt files were validated
against the frozen `receipts.schema.json` with AJV 2020-12: **37 lines, 0
invalid**. Every segment summary carries `green: true`, `browserPass: true`,
`requiredUnimplemented: 0`, and a SHA-256 digest binding its suite receipt.

<a id="m1-choreography"></a><a id="m2-choreography"></a><a id="m3-choreography"></a><a id="m4-choreography"></a><a id="m5-choreography"></a><a id="m8-choreography"></a>
Per-segment: m1 3/3 · m2 9/9 · m3 7/7 · m4 5/5 · m5 4/4 · m6 1/1 (web queue
flush) · m8 5/5. Two intermediate attempts failed inside best-of-3 series
(m2 image/video composer attachment, one m3 quote attempt) and are retained in
the receipts; the frozen best-of-3 rule selects a passing attempt, and all
three attempts of every timing-bounded check were inside bound.

<a id="m3-a06-a07"></a>**Typing indicator.** Harness: appears
394.8 / 168.1 / **28.8** ms against the 2 000 ms bound; expires
4115 / 3782.9 / **3958.7** ms — all three inside the 5 000 ms bound, and none
degenerately instant.

### Independent corroboration of live behaviour (best-of-3, load recorded)

Driven by the grader against the same running build, separate from the harness:

| subject | measurements (ms) | best | bound | 1-min load |
|---|---|---|---|---|
| m1-a09 profile edit visible on the other client | 434 / 331 / 351 | 331 | — | 7.91 |
| m2-a04 post live in the other client's Global feed | 854 / 855 / 838 | 838 | — | 8.24 |
| m2-a14 like count live on the author's client | 431 / 376 / 618 | 376 | — | 9.48 |
| m3-a06 typing indicator appears | 7 / 5 / 9 | 5 | 2000 | 8.23 |
| m3-a07 typing indicator expires | 3356 / 3343 / 3382 | 3343 | 5000 | 8.23 |
| m4-a08 edit visible live on the other client | 3624 / 6480 / 7476 | 3624 | — | 8.86 |

Every series agrees with the harness receipt. No divergence to report.

### Grader-class assertions

<a id="m1-a12-a13"></a>**m1-a12 / m1-a13 — password storage.** `snapback/schema.q`
line 1 is `use identity password`: the lane uses the backend's built-in
password identity, the documented provider path, not a hand-rolled scheme.
Store rows carry the PHC header `$argon2id$v=19$m=19456,t=2,p=1` — Argon2id at
the published OWASP parameters (14 distinct headers). The backend announces
`Argon2 slots: 10 on this host` at start-up. For a13, all 9 fixture passwords
plus the suite's own password were searched as raw bytes across
`.snapback4/store.sqlite` (12.3 MB), the whole of `dist/`, `evidence/`,
`scale-instance/`, the run logs and the grading logs: **0 hits in 0 files**.
Both **pass**.

<a id="m1-a07"></a>**m1-a07 — logout revokes the token server-side.** A token
issued to a signed-in persona read `me` successfully. After the app's Log out
action, the *same* token was denied immediately and again after a further 3 s
(to rule out propagation lag). **pass**.

<a id="m4-a10"></a>**m4-a10 — edit after the window, server-side.** Under the
shortened 60 s edit window: an API edit inside the window succeeded; at +68 s
the identical API call failed with `EDIT_WINDOW_CLOSED` (rule refusal, site
`chat.q:271:3`) and the server-side text still held the in-window value. Checked
through the API, not through the absence of a UI affordance. **pass**.

<a id="m4-a12"></a>**m4-a12 — asset after delete-for-everyone.** The media URL
served `200` / 2 062 bytes before the delete; after `chat.deleteMessage` it
returned `404` for the sender *and* for the recipient, with the message
tombstoned and `media: null`. **pass**.

<a id="m5-a01-a03"></a>**m5-a01 / a02 / a03 — server-enforced expiry.** The
shortened `24h` option resolved to a 180 000 ms TTL, as the fixture config
specifies. The recipient was confirmed to hold the message in replica-local
search *before* expiry. **Both browser contexts were then closed** and left
closed across the whole expiry window. Afterwards, with no client having opened:
the API point read returned `null` and the message was absent from
`chat.apiHistory` (a01). Relaunching each persona in a fresh context showed zero
conversation bubbles carrying the canary (a02). `chat.searchHeld` — the
replica-local search — returned 0 hits on both clients, and again with the
browser context forced offline (a03). All three **pass**.

<a id="m5-a06"></a>**m5-a06 — view-once asset re-fetch.** After the recipient's
single view, a direct asset fetch with the recipient's own token returned
**410**; unauthenticated, **401**. The sender's fetch of their own upload still
returns 200, which the brief scopes correctly ("each *recipient* can open it
exactly once"). **pass**.

<a id="m6-a12"></a>**m6-a12 — grader-written variation from API.md alone.** A
fresh client was written from `API.md` only, with no reference to lane source,
to fetch the latest message of the named conversation "Weekend Plans":
`chat.inbox` cursor paging located it, `chat.apiHistory` returned newest-first,
and **all 14 documented message fields were present** with nothing undocumented
required. It worked on the first attempt. **pass** — and the documentation
quality the assertion is really measuring is high.

<a id="m8-a08-a12"></a><a id="m8-a11"></a>**m8-a08 … m8-a12 — scheduled digest.**
Graded through a **grader-owned push worker with no provider-side dedupe**
(`grading/probes/grader-worker.mjs`), so a server-side double emission could not
be masked by the lane's own provider-key dedupe. Under the shortened 120 s
period, with every client closed before the boundary:

- **a08** — exactly one digest per active user (`maxPerUser: 1`, one distinct
  `periodEnd`). The target persona's payload was `newFollowers 1,
  newPostsInFollowing 2, unreadMessages 3, unreadChats 1`, matching the seeded
  activity exactly.
- **a09** — a freshly registered persona with no graph, no content and no
  inbound messages received no digest.
- **a10** — the following period ran with zero activity and emitted **zero**
  payloads.
- **a11** — the backend was stopped and restarted *mid-period*, and again after
  emission. Exactly one digest per `(user, periodEnd)`, one distinct effect id.
- **a12** — five messages were sent into a group the target is **not** a member
  of. The target's digest still reported `unreadMessages 3 / unreadChats 1` from
  the DM alone: the off-limits chat contributed nothing.

All five **pass**.

<a id="m6-native-artifact"></a><a id="m8-native-artifact"></a>
### The native-artifact assertions — m6-a01…a07, m8-a17, m8-a18

These nine have **no scoreable artifact**. The M6 and M8 segment summaries
record:

```json
{"id":"ios-simulator-m6","pass":null,"receipt":null,
 "status":"not-recorded","requiredForGreen":false,
 "reason":"M6 simulator evidence is recorded separately from web green"}
```

and the same for `ios-simulator-m8`. `artifacts/m6-ios/` and
`artifacts/m8-ios/` hold a Hermes bundle export — `metadata.json` plus hashed
assets — not the `*-ios-screen.mp4` + `*-ios-receipts.jsonl` + `*-ios-run.json`
triple that `simulator.md` requires ("a recording without passing structured
receipts is not a pass"). The lane states this itself in README.md: the iOS
artifacts "are Hermes bundle exports, not simulator interaction proofs."

Simulator proofs are not grader-driven, so these were not re-run. They are
recorded **not passed**, and never inferred from the web carrier — which is
exactly what the frozen rule demands. The lane's honesty here is credited in O4.

<a id="m7-not-attempted"></a>
### M7 — not attempted

`instrument/ENVIRONMENT.md` scopes this session to M1→M6 plus M8 and says M7
"is a separate fresh session run later by the orchestrator after grading; do not
attempt it." All nine M7 assertions are recorded `not-run`. They stay in O1's
denominator and score not passed, per the brief's partial-credit design.
`m7-a09`'s `not-applicable` branch does not apply: it requires that no milestone
was previously green, and M1–M6 and M8 were green.

---

<a id="trust-sweep"></a>
## Trust-boundary sweep (basis for O3)

No holdout probe set exists for this wave, so O3 rests on this grader-authored
sweep over every trust-boundary category the brief publishes. An outsider
persona was used against a private conversation between two others.

| # | probe | observed | verdict |
|---|---|---|---|
| P1 | cross-user DM history via the API | 0 rows, canary absent | no leak |
| P2 | cross-user point read of the message | `null` | no leak |
| P3 | non-member send into the conversation | failed `NOT_MEMBER` | denied |
| P4 | edit another user's message | failed `NOT_FOUND`, text intact | denied |
| P5 | delete another user's message | failed `NOT_FOUND` | denied |
| P6 | global message search for the canary | 0 hits | no leak |
| P7 | private asset fetch | outsider 404 · member 200 · anonymous 401 | denied |
| P8 | removed-member delivery cutoff | keeps pre-removal history; post-removal message never served | denied |
| P9 | non-admin group rename | failed `NOT_FOUND` | denied |
| P10 | reaction on an unreadable message | failed `NOT_FOUND` | denied |
| P11 | bogus bearer token | denied | denied |

Every boundary holds **server-side**, not by UI absence. Combined with the
grader assertions above — post-logout revocation, expired-edit refusal,
asset-after-delete, view-once re-fetch 410, expiry surviving the replica and its
offline search, and digest authorization — the published trust set is fully
covered and fully denied.

<a id="defect-d-04"></a>One shape note (cosmetic, d-04): P1 returns a
*successful empty page* rather than a denial. Nothing leaks, but a client cannot
distinguish "chat you may not read" from "chat with no messages", unlike the
mutation paths which name their refusal.

---

## Defect hunt beyond the checklist (basis for O2)

| # | probe | observed |
|---|---|---|
| D1 | retry the same write id twice | 1 message, no duplicate |
| D2 | self-follow | failed `CANNOT_FOLLOW_SELF`; followers/following unchanged |
| D3 | edit a tombstoned message | failed `MESSAGE_DELETED`; tombstone held, text empty |
| D4 | search semantics | word-prefix ✓ · case-insensitive ✓ · mid-word correctly **not** matched ✓ · NFC and NFD both match ✓ |
| D5 | three concurrent reactions from one user | exactly one survives (`mine: 1`) |
| D6 | five pages of history | 100 unique rows, **0** duplicates |
| D7 | 6-character password at signup | refused: "E_AUTH: a password needs at least 8 characters" |

No crashes, no wrong data, no broken flows.

<a id="defect-d-05"></a>Cosmetic (d-05): `posts.removed` is declared in
`snapback/schema.q:37` and read by every feed and Insights projection
(`:83`), but no mutation in the generated API can set it — unreachable dead
surface. The brief does not require post deletion, so no checklist item is
affected.

---

<a id="o5"></a>
## Scale replay and O5

Independently verified from `evidence/replay-scale/`:

- `scale.log` sha256 `b26bf1ae…abba9` **matches** the pinned
  `instrument/fixtures/scale-log.sha256`; 167 157 actions.
- Receipt audit: 167 157 actions, 167 157 unique, `allSent: true`, 0 failures.
- All 18 `perEntityCounts` in `verification-final.json` are **identical** to
  `invariant-manifest-combined.json` (users 1008 · followEdges 5921 ·
  posts 50228 · messages 100015 · memberships 2053 · activeReactions 2000 …);
  27 named spot entities checked; all three checkpoint verifications `pass: true`.
- Replay used **4 156.4 s of its 14 400 s cap (28.9 %)**; checkpoint
  verification wall (28.98 s) excluded as the contract allows.
- Probe-user cold start over 100 conversations completed in 11.6 s with heap
  samples 38 MB → 42 MB → 17 MB: no timeout, no unbounded growth.

Band function, first-match over `0, 30, 60, 90, 75`:

- **0** does not fire — the manifest conforms exactly, the named fixtures match,
  and the cap was not exhausted.
- **30 fires** — two frozen mid-curve degradation rules fail at the 50 %
  checkpoint. Recomputed independently by the grader from the three
  `verification-*.json` files, ceiling = `p95₁₀% + (p95₁₀₀% − p95₁₀%)·4/9`:

| rule | 10 % | 50 % measured | 50 % ceiling | 100 % | verdict |
|---|---|---|---|---|---|
| global message search | 8.987 ms | **16.326 ms** | 15.193 ms | 22.952 ms | **fail** |
| Insights | 2.286 ms | **5.007 ms** | 4.260 ms | 6.727 ms | **fail** |
| Trending | 7.851 ms | 4.609 ms | 9.890 ms | 12.439 ms | pass |

  This matches the lane's own `builder-envelope.json`, which records
  `allBuilderChecksPass: false` — the lane measured and recorded its own
  shortfall rather than hiding it.

Every 3× full-corpus ratio passes (deep paging 1.04 · following-500 2.89 ·
celebrity read 0.69 · celebrity write 1.01 · search 2.55 · Insights 2.94 ·
Trending 1.58) and no probe timed out, errored or OOMed. But the band function
is first-match and does not weigh how many rules failed: **O5 = 30**.

Absolute p95 ceilings remain `pilot-calibrated` placeholders in the frozen
brief, so the "any absolute ceiling exceeded" test could not be evaluated; it is
moot here because band 30 fires first. Absolute latencies (4–64 ms across every
probe at the full corpus) publish as diagnostics only, never as a cross-backend
comparison. One methodology note on the lane's own probe harness: its checkpoint
probes use k=10, not the brief's k=20 — the grader's own probe set, which would
have used k=20, was not committed for this wave.

---

## Result

| milestone | passed | of |
|---|---|---|
| M1 | 13 | 13 |
| M2 | 27 | 27 |
| M3 | 15 | 15 |
| M4 | 12 | 12 |
| M5 | 12 | 12 |
| M6 | 6 | 13 |
| M7 | 0 | 9 |
| M8 | 16 | 18 |

- **prior-101 subtotal (M1–M7): 85 / 101**
- **M8: 16 / 18**
- **complete total: 101 / 119**

O-dimensions: **O1 76 · O2 84 · O3 88 · O4 55 · O5 band 30.** Anchors cited in
`grader-report.json`. No weighted total, efficiency statistic or cross-lane
comparison is computed here — those are the harness's and publisher's.

## Artifacts

`grading/grader-report.json` (schema-valid against the frozen
`grader-report.schema.json`) · `grading/m8-assertion-results.json` ·
`grading/probes/` (grader-written probe scripts and their `results.jsonl`) ·
`grading/logs/` (server logs, PID ledger, builder receipts snapshotted before
the grader's re-runs).
