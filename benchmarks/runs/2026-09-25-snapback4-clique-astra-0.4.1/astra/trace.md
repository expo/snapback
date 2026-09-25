# Grader evidence and action trace — lane `astra-snapback4`

Sanitized, publishable. Credentials are redacted as `<redacted>`; no bearer
token, raw transcript, or personal datum appears here. Raw session material is
retained privately for audit only (LLP 0197 redaction posture, LLP 0198 rule).

- **Lane:** `/Users/ccheever/clique-sb4-20260924-astra-cal20/lanes/astra-snapback4`, backend `snapback4-0.4.1` (`snapback4@0.4.1`, `snapback4-expo@0.4.1`).
- **Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder context.
- **Wave:** `full-3models-astra`. Run scope `full`. Nothing struck by environment.
- **Machine:** macOS arm64, Node 24.18.0 (`~/.volta/tools/image/node/24.18.0/bin/node`). Shared host: 1-minute load average ranged **14.8 – 31.7** across the session, with ~85 login sessions and other lanes running. Load is quoted beside every timing record below.
- **Ports used (all inside 49360–49379):** 49360 lane backend, 49361 static web client, 49362 scale instance, 49364 M8 analytics-test instance.
- **Outputs:** `grading/grader-report.json` (the 101 M1–M7 ids the frozen schema admits), `grading/m8-assertion-results.json` (the 18 M8 ids), this trace, `grading/DONE`.

## Exclusions honoured

`diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and `run-log.md` were never
opened. One incidental exposure is recorded for completeness: a repository-wide
`grep` for the string `49364` (run to find how the M8 analytics backend is
started) returned two operational lines from `run-log.md` — a server-start line
with a PID and port, and a line naming the same PID and port. No diary content,
self-score, or transcript material was in that output, and the grep pattern was
narrowed for every subsequent search. This is **not** treated as a contaminated
session; `grader.contaminated` is `false`.

## Deviations from the frozen protocol (recorded per the wrapper)

1. **No holdout probe set was hash-committed for this wave.** Execution-order
   phase 4 was skipped, `wave.probeSetSha256` is the literal
   `none-uncommitted`, `probeResults` is empty, and no probe was invented.
   O3 is scored instead from a grader-authored sweep of the trust-boundary
   categories the brief publishes — explicitly not the scored probe set, and
   labelled as such in the report.
2. **The `claude` family has not passed the grader calibration gate.**
   `calibrationPassed: false`, `sameFamilyGraded: false` (the builder harness
   records model `gpt-6-astra`); the record labels this grade
   `uncalibrated-grader`.
3. **Timing-sensitive checks judged best-of-3**, with host load recorded beside
   each measurement.

## Frozen-schema limitation and the prior measurement-coverage gap

The frozen grader report schema constrains `assertionResults` to
`^m[1-7]-a[0-9]{2}$` with `additionalProperties: false`, so **no M8 result can
live in a schema-valid `grader-report.json`** even though `assertions.json`
`0.3.0-m8` carries 18 M8 assertions and `applicability.json` puts M8 in the
full-run observing set for O1, O2, B1, B3, B4 and B7. This grading session
executed all 119 frozen assertions and partitions them across two files:
`grader-report.json` holds exactly the 101 M1–M7 ids listed in
`GRADER_ASSERTIONS_101.txt`, and `m8-assertion-results.json` holds exactly the
18 M8 ids, with no id in both.

The prior measurement-coverage gap is recorded here as instructed: the
structured `assertionResults` of the **September 5** and **September 12** runs
carried only those same 101 ids. Their prose notes could describe M8
observations, but neither run produced a machine-comparable 18-id M8 result
set, so no M8 subtotal from those runs is comparable with this one. This is a
measurement-coverage gap in the earlier records, not a finding about any lane.

## Environment brought up

All processes were started by the grader from the lane's documented
instructions and recorded by PID; only those PIDs were signalled at the end.
No `pkill`, `killall`, or pattern kill was used.

| What | Command (as documented) | Port | PID(s) |
|---|---|---|---|
| Lane backend | `npx snapback4 dev --port 49360` | 49360 | 70056, then 79817 after the deliberate m8-a11 restart |
| Static web client | `npm run build:web` then `node scripts/serve.mjs` | 49361 | 82710 |
| Push-seam worker | `node scripts/push-worker.mjs` (CONFIGURATION.md) | — | 7955 |
| M8 analytics-test backend | `snapback4 dev --port 49364 --replay --no-watch` in `analytics-test/` | 49364 | 22014, then 39484 on a fresh store |
| Scale instance | `snapback4 dev --port 49362 --replay --no-watch` in `scale-instance/` | 49362 | 91677 |

`npm run build:web` was re-run from the delivered source before any suite, so
every browser assertion was judged against a bundle rebuilt from the tree as
delivered. The web export succeeded (`Exported: dist`, `web-shell: 23 files`).

### Harness and UI-kit integrity

`diff -r` of the lane's `choreography/` against the frozen
`instrument/choreography` (excluding `node_modules` and `browsers`) reports a
single difference: `package-lock.json`, added by `npm install`. `diff -r` of the
lane's `ui/` against `instrument/ui` reports no difference. The acceptance suite
and the choreography segments therefore ran against an unmodified frozen
harness and an unmodified frozen UI kit.

### Effect on the lane's delivered evidence

The lane's documented entrypoints write into `evidence/` with hard-coded paths,
so running them necessarily overwrites delivered receipts. Before the first run
the delivered `evidence/*.json` and `evidence/*.jsonl` were snapshotted to
`grading/baseline/`; the grader-run receipts were then copied to
`grading/grader-runs/`, and the builder's delivered receipts were restored into
`evidence/`. `analytics-test/.snapback4` was moved to
`grading/analytics-store-backup` for the fresh-store re-run and restored
afterwards. Nothing under `instrument/` was written.

<a id="p1-suites"></a>
## Phase 1 — the lane's documented acceptance entrypoint

`npm run acceptance -- --milestone mN` for m1–m6 and m8, against the running
backend and the rebuilt web client.

| Milestone | First run | Outcome | Cause |
|---|---|---|---|
| m1 | pass | pass | — |
| m2 | pass | pass | — |
| m3 | **fail** | **fail on re-run too** | lane defect d-04 — `quoted excerpt and jump` |
| m4 | **fail** | **fail on re-run too** | lane defect d-01 — `video picker sends fixture` |
| m5 | pass | pass | — |
| m6 | fail | **pass on re-run** | grader environment: the documented push-seam worker was not yet started |
| m8 | fail | **pass on the third run** | defect d-06 (undocumented analytics backend) then defect d-07 (stale clock-offset store) |

M6's first failure was a grader-environment omission, not a lane defect: `CONFIGURATION.md`
documents `scripts/push-worker.mjs` as the push provider and `README.md` does not
mention it. Once started, `absent-recipient push payload text photo video` and
`view-once push is Photo` both passed. This is the one re-run counted in
`grader.rerunsUsed`.

M8's first failure was `the server is unreachable`: `scripts/suite-m8.mjs`
drives a second backend at `127.0.0.1:49364` that no documented instruction
mentions (defect d-06). With that instance running, the trending test then
failed on an assertion mismatch; investigation (`grading/probe-trending.mjs`)
showed the cause was store state, not product logic — the test advances the dev
clock by 25 h on every run, and rows stamped under an earlier run's offset stay
inside the new trailing-24 h window, so a stale `Old popular` post with 5 likes
ranked first. `snapback4`'s own operations guide requires a fresh store per
offset test. On a fresh analytics store the whole m8 suite passes, and the
trending behaviour (recency window, tie break, originals only) is correct
(defect d-07).

M3's and M4's failures reproduced on re-run and are lane defects; they were not
re-run away, and the affected assertions were verified independently instead.

Final suite receipts from the grader's runs: m1 pass, m2 pass, m3 fail, m4 fail,
m5 pass, m6 pass, m8 pass (`grading/grader-runs/suite-*.json`).

<a id="p2-coverage"></a>
## Phase 2 — coverage-manifest spot-verification — **verdict: honest**

`evidence/coverage-manifest.json` maps **exactly** the 58 suite-required
assertions of M1–M6 and M8: no suite-required assertion is unmapped, and no
mapped id is anything other than suite-required (checked programmatically
against `assertions.json`).

22 mappings were sampled and each mapped test was read in source to confirm it
exercises the assertion's own observable rather than a proxy:

- `m2-a13` (no unfurling) — asserts zero `iframe` and zero `sm-feed-media` inside the URL post's card.
- `m2-a24` (pagination) — asserts first page length exactly 20, a non-null cursor, set-size equality across the full traversal, and that the viewer's own posts all appear.
- `m2-a27` (implicit self-follow changes no counts) — `assert.deepEqual` of `followStats` before and after the sequence.
- `m3-a15` (seed idempotency) — re-runs every installed starter segment and compares corpus size.
- `m5-a05` (second view denied) — asserts the `E_ASSET_VIEWED` refusal server-side **and** again after a page reload, plus zero viewer images.
- `m6-a11` (demo exercises every operation) — asserts `historyPages >= 2`, i.e. the demo actually traversed pages rather than claiming it.
- `m6-a13` (adapter conformance) — asserts 50 actions and 13 verbs through the frozen fixture grammar validator.
- `m8-a07` (tie break) — asserts index order of two equally-liked posts.
- Also sampled: `m1-a03`, `m1-a10`, `m2-a12`, `m2-a18`, `m2-a21`, `m2-a25`, `m3-a05`, `m3-a14`, `m4-a06`, `m4-a09`, `m5-a08`, `m5-a11`, `m6-a08`, `m8-a01`.

Two mappings are broader than strictly necessary — `m2-a16` and `m2-a20` are
each claimed by two different tests — but both tests do exercise them. **No
dishonest mapping was found; no milestone is adjudicated to capability-failure.**

<a id="p3-choreo"></a>
## Phase 3a — frozen choreography, re-run by the grader

`CHOREO_BASE_URL=http://127.0.0.1:49361 node scripts/choreo.mjs mN` for m1–m6, m8.

Every assertion-level check passed in the grader's runs. Two structural notes:

- **m3 and m4 segments exit non-zero** while every one of their assertion
  receipts is `passed`. The cause is the harness's green-bar composition: it
  reads `--suite-status`, and the grader's m3/m4 suite runs were failing
  (defects d-01, d-04). The segment summary records
  `nonGreenCause: "suite-failed"`, not a choreography failure.
- **m2's first segment run failed** `repost-following-feed-surface` 3/3
  attempts; three subsequent runs passed it on attempt 1 and failed attempts 2
  and 3. See d-02 — the builder's own delivered receipt shows the same pattern.

Per-attempt timing metrics used as the best-of-3 records (host 1-min load in
parentheses at the time of the run):

| Assertion | Check | Attempts (ms) | Best | Bound | Load |
|---|---|---|---|---|---|
| m1-a09 | profile-edit-live-visibility | 93.1 / 77.5 / 101.6 | 77.5 | none stated | 31.4 |
| m2-a04 | feed-text-post-live-update | 813.1 / 820.4 / 815.9 | 813.1 | none stated | 31.7 |
| m2-a07 | follow-unfollow-live-projection | 610.7 / 1296.8 / 1275.8 | 610.7 | none stated | 31.7 |
| m2-a14 | like-unlike-live-count | 951.8 / 579.0 / 927.5 | 579.0 | none stated | 31.7 |
| m2-a19 | reply-live-thread-projection | 695.0 / 552.3 / 503.8 | 503.8 | none stated | 31.7 |
| m3-a01 | dm-live-messages | 1141.3 / 2157.4 / 2249.5 | 1141.3 | none stated | 31.4 |
| m3-a06 | typing visible after last keystroke | 27.8 / 19.2 / 22.6 | 19.2 | **2000** | 31.4 |
| m3-a07 | typing expires after last keystroke | 4358.8 / 3835.9 / 4320.4 | 3835.9 | **5000** | 31.4 |
| m4-a02 | photo-message-live-render | 2947.6 / 2718.8 / 1898.1 | 1898.1 | none stated | 31.4 |
| m4-a05 | reaction-live-replace-remove | 1388.6 / 841.8 / 844.4 | 841.8 | none stated | 31.4 |
| m4-a08 | edit-live-visibility | 1842.2 / *failed* / 1353.7 | 1353.7 | none stated | 31.4 |
| m5-a07 | chat-color-background-sync | 209.9 (bestOf 1) | 209.9 | none stated | 31.4 |
| m6 queue | offline-message-queue-flush-in-order | flush 1079.6 (bestOf 1) | 1079.6 | none stated | 25.1 |
| m8-a02 | insights-like-refresh | refresh 332.9 (bestOf 1) | 332.9 | none stated | 25.1 |
| m8-a13 | same-account-message-live | 1129.6 (bestOf 1) | 1129.6 | none stated | 25.1 |
| m8-a14 | cross-device-read-state | clear 160.9 (bestOf 1) | 160.9 | none stated | 25.1 |
| m8-a15 | dual-offline-convergence | first 786.6 / second 1824.9 | 786.6 | none stated | 25.1 |

Both bounded timing checks pass with wide margin even on a loaded host.

<a id="p3-api"></a>
## Phase 3b — independent execution over the documented API

All probes were written against `API.md`'s documented HTTP JSON protocol
(`POST /auth/*`, `POST /q/<op>`, `POST /m/<op>`, `POST /assets`,
`GET /assets/<id>`). Scripts live under `grading/`.

| Check | Result |
|---|---|
| **m1-a07** session revocation | `POST /auth/logout` then `/q/whoAmI` → **HTTP 401 `E_AUTH`**. Pass. |
| **m2-a18/a26** repost projection | With the viewer not following the author: `home` returns nothing for the post; after the viewer reposts, `home` returns exactly one row, `repost: true`, actor = the viewer. `global` keeps the original throughout. Pass. |
| **m3-a15** seed idempotency | Re-seeding m1+m2+m3 left conversations 33, messages 222, global rows 493, people 25 — byte-identical before and after. Pass. |
| **m4-a06/a07** reactions | 👍 → ❤️ replaces (one row per user); a retried write id does not double-apply; `emoji: null` clears to zero rows. Pass. |
| **m4-a09** edit | `edited: true`, `editedAt` set, caption changed, `mediaReference.id` unchanged. Pass. |
| **m4-a10** edit window | Edit inside the shortened 60 s window succeeds; at +65 s it is refused **server-side** with `EDIT_WINDOW_CLOSED`. Pass. |
| **m4-a12** asset after delete | `GET /assets/<id>` 200 for the recipient before delete, **404** after; the tombstone clears `text` and `mediaReference`. Pass. |
| **m5-a01** disappearing expiry | Shortened window measured from the server itself: `expiresAt - at` = **180000 ms**. With no client connected across expiry: `apiMessageById` → null, absent from `apiHistory`, zero `searchChat` hits. Pass. |
| **m5-a06** view-once | `GET /assets/<id>`: **200** (2081 bytes) → **410** → **410**. A non-participant gets **404** at every point. Pass. |
| **m6-a12** grader-written API variation | Written from `API.md` alone: page `apiConversations` matching `room.name`, then `apiHistory` page 1 element 0. Returned the latest message with **every one of the 17 documented field-manifest keys present** (0 missing). Pass — and the documentation was followable without reading lane source. |

<a id="p3-web"></a>
## Phase 3c — independent execution through browser automation

Playwright chromium from the lane's frozen choreography copy, against the
rebuilt web client on 49361.

| Check | Result |
|---|---|
| **m3-a10** quoted excerpt | The reply bubble renders the source message's text in `sm-convo-quote-preview`. Pass. |
| **m3-a11** jump to original | After 8 filler messages, tapping the excerpt scrolled the original into the viewport; no error affordance, no "unavailable" toast. Pass. |
| **m4-a03** video message | A fixture video attaches and sends end-to-end **as the first pick in a freshly mounted composer**; the recipient bubble carries one media element. Pass. The lane suite's failure is d-01, a repeat-pick defect, not a video defect. |
| **m4-a09** "edited" label | The edited bubble renders `… | edited | …`. Pass. |
| **m5-a02** purge on relaunch | Client closed before expiry, relaunched after: the bubble is absent and the text appears nowhere in the rendered conversation. Pass. |
| **m5-a03** expired content out of search | After the relaunch, in-chat search returns the expired message neither online nor with the browser context forced offline. Pass. *Limitation:* the pre-expiry control search used a hyphenated needle and returned 0 hits, so the "before" half of that control is inconclusive; m5-a01 and m5-a02 carry the positive evidence, and the lane's own in-chat-search test (m5-a10) passed. |

<a id="p3-source"></a>
## Phase 3d — source inspection (m1-a12, m1-a13)

- `snapback/schema.q:1` declares `use identity password` — the backend's
  built-in password identity. There is no lane-authored password storage path:
  the only application-side mention of a password is the sign-in form passing
  the value to `auth.login` / `auth.signup`.
- The backend announces `Argon2 slots: 16 on this host` at startup, and the
  store contains only digests of the form
  `$argon2id$v=19$m=19456,t=2,p=1$…` — **argon2id at the standard published
  parameters**. **m1-a12 passes.**
- Plaintext search for the fixture passwords: **0 hits** in
  `.snapback4/store.sqlite`, `-shm` and `-wal`; **0 hits** in the exported
  `dist/` web bundle; **0 hits** in the backend's own log. **m1-a13 passes.**
- Separately filed as **d-05**: a builder debug probe logs every POST body and
  wrote one fixture persona's password in cleartext into
  `evidence/remove-ui-probe.log` (line 1) and `evidence/remove-ui-probe-fixed.log`.
  The value is `<redacted>` here. This is not server persistence, a client
  bundle, or an app/server log, so it does not fail m1-a13, but it is a
  credential-hygiene failure in a published artifact directory.

<a id="p3-native"></a>
## Phase 3e — native / simulator assertions (m6-a01…a07, m8-a17, m8-a18)

The frozen prompt scores simulator assertions and O4 **only** from the
harness's recordings and structured receipts, never from builder assertions and
never by the grader re-running a simulator.

**No simulator recording or structured simulator receipt exists for this lane.**
`evidence/native-artifacts.json` lists seven entries, one per milestone, and
each is a **Hermes bundle export** (`artifacts/ios-mN/.../entry-*.hbc`) with a
size and a SHA-256 — a build artifact, not a run recording.
`evidence/web-cold-offline.json` and `evidence/web-durable-offline.json` record
web service-worker proofs and both explicitly set `nativeProofClaimed: false`;
`CONFIGURATION.md` says "The lane exports Hermes bundles without claiming
simulator validation", and the run record's notes repeat it.

The brief's M6 acceptance items 1 and 2 are tagged `[native-artifact]` and read
"Cold-start offline (**iOS simulator**, backend stopped)". The required
executor produced nothing, so these nine assertions are recorded **fail** — not
demonstrated on the required executor. The lane's honesty about the gap is
credited in O4's justification rather than by passing the assertions.

<a id="p3-digest"></a>
## Phase 3f — scheduled digest (m8-a08 … m8-a12)

The installed configuration is the shortened one: `snapback/schedule.q` reads
`schedule dailyDigest every 120s: digest.daily`, generated from
`config/digest.shortened.json`; `snapback/windows.q` gives edit 60 s, delete
120 s, disappearing 180 s / 300 s. The push worker appends each emitted payload
to `evidence/push-payloads.jsonl` with a stable effect id.

Rather than trust the app's own numbers, the four digest counts were
**recomputed independently** from the documented API for each persona over the
exact period window (`newFollowers` from `followers` rows in-window;
`newPostsInFollowing` from in-window originals by the reader or anyone they
follow; `unreadMessages`/`unreadChats` from each membership's history above its
read watermark, excluding the reader's own and deleted messages), then compared
with the emitted payloads.

- **m8-a10** — a deliberately quiet period (ending `2026-09-25T06:54:00Z`)
  emitted **zero** digest rows. Pass.
- **m8-a08** — a controlled active period (ending `2026-09-25T06:58:00Z`)
  emitted **4 rows, one per active persona, no duplicate target**, and every
  one of the four counts matched the recomputed value exactly:
  alice `0/1/0/0`, bob `0/0/2/1`, carol `1/1/0/0`, dave `0/1/1/1`. Pass.
- **m8-a09** — erin, frank, grace and henry had zero activity in that period
  and received **no** digest. Pass.
- **m8-a12** — the period's only non-DM message activity was in a group that
  **excludes bob**. Bob's emitted `unreadMessages`/`unreadChats` were `2/1`,
  exactly his membership-scoped recomputed value: the chat he cannot read
  contributed nothing. Pass.
- **m8-a11** — the backend was SIGTERMed and restarted **45 s into** a period
  carrying activity. That period emitted **4 rows, no duplicate target**, and
  across the whole 85-row digest log there are **0 duplicate effect ids** and
  **0 duplicate (user, periodEnd) pairs**. Pass.

<a id="p3-trust"></a>
## Phase 3g — trust-boundary sweep (basis for O3; **not** the wave's probe set)

No probe set was committed for this wave, so this is a grader-authored sweep of
the categories the brief publishes. Every one was denied **server-side**, not by
UI absence.

| Category | Observation |
|---|---|
| Cross-user DM access via the API | A non-member reading the alice↔bob DM: `apiHistory` 0 rows, `apiMessageById` null, `history` 0 rows, `searchChat` 0 rows, and the private text does **not** surface in global `searchMessages`. |
| Removed-member delivery | After removal: the post-removal message is invisible to the removed member, their `send` is refused `NOT_MEMBER`, the conversation no longer lists, and pre-removal local history is retained (the M3 behaviour, not a leak). |
| View-once re-fetch | 200 → 410 → 410 for the recipient; 404 for a non-participant throughout. |
| Expired edit window | `EDIT_WINDOW_CLOSED` at +65 s under the shortened config, enforced against server `now`. |
| Session invalidation after logout | HTTP 401 `E_AUTH` on the revoked token. |
| Server-side denials surviving the offline cache | The expired message is purged from the client on relaunch and absent from its offline search; the consumed view-once photo is refused again after a page reload (lane suite m5-a05). |
| Scheduled-digest authorization | Activity in a chat the target cannot read contributed nothing to that target's digest counts (m8-a12 above). |
| Ownership boundaries | Foreign `editMessage` and `deleteMessage` refused `NOT_AUTHOR`; outsider `customize` refused `NOT_FOUND`. |
| Token scoping | A bearer resolves to exactly one principal; a forged bearer is refused `E_AUTH`; an unauthenticated asset fetch is **401**, a non-participant's is **404**. |

<a id="p5-o5"></a>
## Phase 3h — scale replay and O5 inputs

**Invariant-manifest conformance — exact.** All 18 per-entity counts in
`evidence/scale-receipt.json` `finalCounts` equal
`fixtures/invariant-manifest-combined.json` `expectedState.perEntityCounts`
(users 1008, posts 50228, messages 100015, followEdges 5921, conversations 1002,
memberships 2053, activeReactions 2000, quotedReplies 2736, …). The action-log
SHA-256 matches `scale.log`; `actionCount` 167157 matches; `settledPrefix` 167157
with `failedActions` 0. Both checkpoints match the manifest on settled prefix
(24777, 88057), on prefix SHA-256, and on every per-entity count.

**Named O5 fixtures — verified live by the grader** against the restarted scale
instance on 49362: `u0500` following **500** and **100** conversations, `u0005`
following **5**, `u0901` following **5**, `u0900` followers **900**,
`Busy Group 0001` roster **50**.

**Degradation rules, re-measured independently** (k=20 after 3 warm-ups,
sequential, 30 s timeout; host 1-min load 23.3):

| Probe | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|
| following-5 (`u0005` home) | 2.182 | 2.621 | 2.947 |
| following-500 (`u0500` home) | 2.480 | 2.844 | 2.897 |
| following, celebrity-follower (`u0901`) | 2.400 | 3.311 | 3.777 |
| busy chat page 1 | 3.828 | 4.371 | 4.415 |
| busy chat page 50 | 4.038 | 4.704 | 4.722 |
| global message search | 2.918 | 3.358 | 4.135 |
| in-chat search, busy chat | 2.157 | 2.980 | 3.498 |
| Insights, probe user | 1.732 | 2.202 | 2.265 |
| Trending | 1.954 | 2.435 | 2.503 |
| global feed | 2.605 | 3.159 | 3.166 |

- Following feed, 500-follow vs 5-follow: **1.09×** (bound 3×). Pass.
- Celebrity read path, celebrity-follower vs 5-follow: **1.26×** (bound 3×). Pass.
- Deep paging, page 50 vs page 1 of the 10 k chat: **1.08×** (bound 3×). Pass.
- No probe timed out, errored, or OOMed; every p95 is under 5 ms.

**Unevaluated in both directions:** the celebrity write path (measuring it would
require creating posts on the scale store and would break the exact-count
conformance this same dimension depends on), and the Insights/Trending
checkpoint curves and the probe user's cold-start sync wall time, which neither
party recorded at the 10 % and 50 % checkpoints.

**The lane's own recorded probes disagree with this re-measurement** — see d-09.
`evidence/scale-receipt.json` records final-corpus following-500 p95 **28.53 ms**
against following-5 p95 **4.73 ms**, a **6.03×** ratio that would fail the rule
as written. Every probe in that receipt shows a maximum of ~27–31 ms, i.e. one
host stall per k=20 batch landing squarely on p95; at the 50 % checkpoint the
stall lands on the *other* probe (following-5 p95 26.12 vs following-500 p95
5.41, ratio 0.21×). The receipt's numbers are measurement noise on a shared
host, not growth. The independent re-measurement is used for scoring and both
are published.

**Absolute ceilings and the replay cap do not exist.** The frozen brief's
"Budget caps and performance ceilings" table is still the P3 placeholder
(*pilot-calibrated*), for both the per-probe absolute p95 ceiling and the scale
replay's wall cap. O5's 60 and 90 branches both depend on them, which is why
first-match evaluation falls through to **75**. The replay's own recorded window
is ~520 s wall (start/end are epoch seconds in that file — d-10), with 8.7 s of
probe time excluded.

## Defects filed

`d-01` major — second media pick in one mounted conversation composer drops the
attachment and wedges Send (reproduced 2/2, both orders; this is what fails the
lane's own m4 suite).
`d-02` major — Following-feed client projection misses an unfollow on repeat
within a session; present in the builder's own delivered receipt (`PFF`), masked
by the harness's best-of-3 rule; server-side projection verified exact.
`d-03` major — M4's green suite receipt (04:59:03Z) predates the `src/Chats.tsx`
edit (05:48Z) that broke it; the recorded green does not describe the shipped tree.
`d-04` minor — quote-jump degrades on repeat and on history paged in from beyond
the retained window ("The original is unavailable on this device").
`d-05` minor — a fixture persona password written in cleartext into a retained
evidence log by a builder debug probe.
`d-06` minor — the documented instructions omit the M8 analytics-test backend
the m8 entrypoint requires.
`d-07` minor — the m8 trending test is not re-runnable against a non-fresh
analytics store (accumulated dev-clock offset).
`d-08` minor — the run record is the base builder schema: no milestone statuses,
no token accounting, no `performanceProbes.o5Inputs`, so O5's declared input is
absent and had to be reconstructed.
`d-09` minor — the replay receipt's own p95s are host-stall-dominated and, as
recorded, violate a published degradation rule that independent re-measurement
passes at 1.09×.
`d-10` cosmetic — `scale-receipt.json` records `start`/`end` in epoch seconds
where neighbouring fields are milliseconds.

## Result tally

119 frozen assertions, all executed in this one session: **101 pass, 9 fail,
9 not-run.** The 9 failures are exactly the nine `[native-artifact]` simulator
assertions (m6-a01…a07, m8-a17, m8-a18). The 9 not-run are all of M7, which the
environment overlay defers to a separate fresh session; they remain in O1's
denominator as not passed, which is attribution, not a lane failure.

No weighted total, efficiency statistic, or cross-lane comparison is computed
here — those are the harness's and publisher's jobs.

## Note on the grader's own working artifacts

`grading/*.mjs` are the probe scripts this trace refers to, kept so the method
is reproducible. They take fixture-pack persona credentials as test inputs, the
same way the lane's own `scripts/suite-*.mjs` do — the fixture pack's credential
files are the brief's declared test-fixture exception. The published artifacts
(`trace.md`, `grader-report.json`, `m8-assertion-results.json`) contain no
credential and no bearer token; this was checked by scan before finishing. d-05
is filed against a captured `/auth/login` **request body** in a retained log,
which is a different thing from a test script's declared fixture input.

`grading/baseline/` holds the lane's delivered receipts as snapshotted before
any grader run; `grading/grader-runs/` holds the receipts the grader's own runs
produced; `grading/logs/` holds the raw stdout of every command; and
`grading/analytics-store-graderfresh/` is the fresh M8 analytics store used to
establish that the trending failure was store state and not product logic. The
lane's `evidence/` directory and `analytics-test/.snapback4` were restored to
their delivered contents afterwards.

## Shutdown

Every PID listed above was signalled individually at the end of the session. No
pattern kill was used; no port outside 49360–49379 was touched.
