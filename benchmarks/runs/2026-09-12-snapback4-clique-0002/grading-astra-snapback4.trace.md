# Sanitized grading trace — lane `astra-snapback4`

Backend `snapback4-0.0.2` · run scope **full** (M1–M6 + M8; M7 excluded by `ENVIRONMENT.md`)
Grader: claude / `claude-opus-5`, fresh session, no builder context.
Machine record: macOS arm64, 18 cores, Node 24.18.0. **The host was heavily shared
throughout**; the 1-minute load average is recorded beside every timing-sensitive
observation below and ranged from 10 to 166.

**Redaction posture.** No fixture password, persona credential, session token or
bearer header appears in this trace or in `grader-report.json`. Personas are named
(Alice, Bob, Carol, Dave) and their principals are written `<principal>`. Grader-created
throwaway accounts used a local-only password, redacted from the retained probe scripts.
This is the published artifact; the raw session is not published.

**Contamination control.** `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and
`run-log.md` exist in the lane and were **not read**; no wildcard read could have pulled
them in, and no other lane under `lanes/` was accessed. `experience-scores.json` was not
opened. `run-record.json` is a sanctioned input and was read through a key-filtered
projection that excluded every experience/self-score field. The grading session is not
contaminated.

---

## 1. Environment brought up (all PIDs recorded, only these killed)

| Process | PID | Port | Log |
|---|---|---|---|
| lane backend (`snapback4 dev`) | 15817 (binary child 15819) | 49200 | `grading/logs/backend.log` |
| lane web client (`expo start --web`) | 18199 | 49201 | `grading/logs/web.log` |
| scale-instance backend (read-only probing) | 39127 (binary child 39135) | 49202 | `grading/logs/scale-backend.log` |

Only ports 49200–49202 were used. The scale backend was stopped after O5 probing; the
other two were stopped at the end of the session. No `pkill`/`killall` was used at any
point. I did not use the lane's `scripts/start-backend.mjs` / `start-web.mjs` launchers
because they append to `run-log.md`, which I must not touch; I started the same commands
myself with my own logs under `grading/logs/`.

Starter segments replayed through the app's own write path before grading:
`m1` 16 actions, `m2` 52 actions, `m3` 18 actions — all `pass:true`.

**What grading mutated.** The documented suites and choreography append to `evidence/`
and rewrite `suite-status.json`, as designed. For the M4/M5 window checks I switched
`config/windows.json` and `snapback/schema.q` to the fixture **shortened-windows**
profile via the documented `npm run windows -- --profile shortened`, then restored
`--profile production`; both files were afterwards verified **byte-identical** to their
pre-grading state (`diff -q` against copies taken beforehand). The retained
`scale-instance` corpus was read **only** — no writes.

---

## 2. Phase 1 — the lane's documented acceptance suite

`npm run acceptance -- --milestone mN`, the same invocation shape for every milestone.

| Milestone | Result | Checks |
|---|---|---|
| m1 | pass | 6/6 |
| m2 | pass | 11/11 |
| m3 | pass | 6/6 |
| m4 | pass | 4/4 |
| m5 | pass | 4/4 |
| m6 | **fail**, then pass on the protocol re-run | 2/3 → 3/3 |
| m8 | pass | 3/3 |

The single M6 failure was `offline-recipient-push-outbox` (`assert.ok(p)` — no push row).
Receipt timestamps show it ran **1.1 s** after the M5 segment closed its browser
(m5 receipt 16:23:59.069Z, failed m6 receipt 16:24:00.171Z), i.e. inside the presence
lease `API.md` documents ("abrupt disconnection is recognized after 15 seconds"). The
re-run passed. I later confirmed the mechanism directly — see §7, defect **d-03**.

---

## 3. Phase 2 — coverage-manifest verification: **honest**

I did not sample: I checked **every** suite-required assertion in scope. For each, I read
the mapped test body in `scripts/acceptance*.mjs` and then re-executed the assertion's
observable myself (§5, §6). No mapping claims an observable its test does not exercise.
The M8 `six-server-totals-match-independent-current-corpus` test is notably strong — it
recomputes the expected totals from raw store rows via the published data CLI rather than
trusting the server's own aggregate.

Two weaknesses worth recording, neither dishonest:

- `m1-a08` maps to `profile-edit-persists`, which asserts the **bio** but not the
  **display name** the assertion also names. I verified display-name persistence
  independently: it passes.
- `m2-a12` maps to a test asserting a `role=link` element, which does not by itself prove
  the system browser opens. Source inspection confirms `onPressLink={Linking.openURL}` in
  `src/Social.tsx`, which is the real mechanism.

Strikes are declared consistently and match `ENVIRONMENT.md` item by item. The one
grader-class assertion the lane could not satisfy (`m5-a01`) is carried in `knownGaps`
with status `platform-gap` and a pointer to its own reproduction evidence, **not** mapped
to a passing test. `POST /seed`, used by the M8 test to plant an aged post, is a
documented dev-only facility of the `snapback4` package itself (package README §5), not a
lane-introduced trust-boundary hole — I checked before treating it as one.

**Harness integrity.** I diffed the lane's copied `choreography/` against the frozen
`instrument/choreography/`. `control-lane.mjs`, `receipts.schema.json`, `package.json` and
`VERSION` are identical. The only changes to `choreography.mjs` are the fixture-path
relocation and an `environmentStrikes` set that records five struck media checks as
`implemented=false, required=false, pass=null`; `setup-identity.mjs` differs only in an
AJV import fix. No assertion, timing ceiling, receipt emitter or green-aggregation rule
was altered. `evidence/instrument-repairs.md` describes exactly these diffs and nothing is
undisclosed.

---

## 4. Phase 3 — choreography re-run by the grader

I ran the harness myself for every segment, writing receipts to `grading/evidence/`
(the builder's receipts were left untouched), with `--setup-identity` regenerated for my
own Node runtime because the harness hash-binds the runner's Node path and version.

| Segment | load (1-min) | Grader outcome |
|---|---|---|
| m1 | 17.60 | green |
| m2 | 17.71 | green |
| m3 | 18.28, re-run 166.44 | **not green** — `group-receipt-waits-for-slowest-member` failed both runs |
| m4 | 25.26, re-run 85.36 | first run **not green** (`reaction-live-replace-remove` 3/3 attempts failed); re-run green |
| m5 | 21.86 (shortened windows + adapter) | green |
| m6 | 19.12 | green |
| m8 | 19.83 | green |

Timing-sensitive metrics from my receipts (all three attempts retained):

- typing indicator visible after last keystroke **24.1 / 20.2 / 20.7 ms** (ceiling 2000 ms)
- typing indicator expiry after last keystroke **2833.5 / 2853.7 / 2822.9 ms** (ceiling 5000 ms)
- profile edit live **62.5 / 105.5 / 104.6 ms** · feed text post live **188 / 100 / 90.9 ms**
- like/unlike live **109.9 / 109.3 / 107.8 ms** · reply count live **55.2 / 55.4 / 55.3 ms**
- edit live **835.9 / 797.7 / 861.4 ms** · dual-offline convergence flush **823.6 / 1791 ms**

---

## 5. Independent re-execution — API (36 checks, 0 failures)

`grading/probe-checklist-api.mjs` → `grading/evidence/checklist-api.json`. Highlights:

- **M1.** An 8+ char password issues a session; a 6-char password is refused (`E_AUTH`).
  Duplicate handle refused `HANDLE_TAKEN` with the caller's own handle unchanged and
  Alice's profile intact (`grading/evidence/m1-duplicates.json`). Duplicate-email signup
  issues no session. Display name **and** bio both persist and re-read via `/q/me`.
- **M2.** Unfollow is projection-scoped (post leaves Following, stays in Global). Like is
  an idempotent set-state toggle (double-set → 1, clear → 0). Repost toggles and is
  attributed to the reposter; a followed user's repost surfaces the original author's
  post. Thread shows exactly the two direct replies in order, nested reply excluded;
  replies appear in neither feed. Page 1 = 20 rows with a continuation cursor in both
  tabs, and **25/25** seeded page posts recovered with all row ids unique — no duplicates,
  no gaps. Implicit self-follow feed membership changes no counts, and an explicit
  self-follow edge is refused.
- **M3.** `createDM` from either ordering returns one channel. Two same-membership groups
  coexist. Non-admin `removeMember` refused `ADMIN_REQUIRED`. All three starter segments
  replay twice with the inbox unchanged (28 → 28).
- **M4.** A second emoji replaces the first; re-tapping removes it. Non-author edit
  refused `NOT_AUTHOR`; delete leaves `deleted=true` with the fixed tombstone body and a
  later edit refused `MESSAGE_DELETED`.
- **M5.** Non-admin `configureChat` refused `ADMIN_REQUIRED`; admin title/description/
  accent stored.

*Two corrections I made to my own tooling mid-phase, recorded for honesty:* my first
duplicate-handle attempt used a nonexistent operation name and then an invalid `link`
field, so its early refusals were mine, not the app's — the result above is from the
corrected probe. Likewise my first `globalSearch` O5 probe named an operation the schema
does not define (§8).

## 6. Independent re-execution — web automation (6 checks, 0 failures)

`grading/evidence/checklist-ui.json`:

- `m2-a12` the URL renders as a tappable `role=link` element (press-handler based via
  `Linking.openURL`, no anchor `href`); `m2-a13` no embedded img/video/iframe and no
  unfurled title/description block.
- `m4-a09` the edited bubble renders an "edited" label.
- `m5-a09` people search: `car` → Carol, `CAR` → Carol (case-insensitive), mid-word
  `arol` → empty state. Word-prefix, not substring — exactly as specified.
- `m5-a10` in-chat search on `cof` finds the seeded "Coffee after work?".
- `m5-a11` global search returns the seeded hit under **2** `sm-search-group` chat headings.

---

## 7. Grader-class assertions

### Password storage — `m1-a12`, `m1-a13`: pass

`snapback/schema.q` line 1 is `use identity password`; `src/App.tsx` imports `signup`/
`login` from `snapback4/auth`. That is the package's **built-in auth** on its documented
provider path, which is what `m1-a12` asks me to verify — not provider internals. The
store additionally carries PHC-format digests `$argon2id$v=19$m=19456,t=2,p=1`, i.e.
argon2id at standard published parameters. The app's own `users` table holds profile
fields only; no credential column exists.

For `m1-a13` I searched for the fixture passwords across `.snapback4/store.sqlite` and its
WAL, `evidence/`, my own `grading/logs/`, the lane source (`src app ui scripts snapback
config`) and all seven exported Hermes/web bundles under `artifacts/`: **zero hits**.

### Session revocation — `m1-a07`: pass

`grading/evidence/api-m1a07-m6a12.json`. Pre-logout `/q/me` authorized; after
`POST /auth/logout` the same token returns **HTTP 401 `E_AUTH`** ("this session is not
live; sign in again"). A second, independently issued session remains valid, matching
`API.md`'s per-token revocation claim.

### Documentation-only custom client — `m6-a12`: pass

`grading/probe-api-m1a07-m6a12.mjs` was written from `API.md` alone, with no lane imports.
Fetching the latest message of the **named** conversation "Weekend Plans" worked on the
first attempt: `/q/inbox` → match `row.conversation.title` → `/q/history` with `c:null` →
`data[0]`. Newest-first ordering held across the page. The page returned 32 rows with
`complete:false` and no continuation — which `API.md` predicts verbatim ("false without a
continuation indicates a platform execution bound, not an empty complete history").
The documentation carried the probe through its own edge case, which is the bar this
assertion is really testing.

### Edit window — `m4-a10`: pass

Under the fixture shortened-windows profile (`editMs=60000`), verified from the server's
own `windowConfig`: an in-window edit succeeded; after **64 s of real elapsed time** the
edit was refused server-side with `EDIT_WINDOW_CLOSED`; an edit carrying a caller-supplied
`at` was denied outright; the stored body remained the in-window edit.
(`grading/evidence/m4a10-edit-window.json`)

### Disappearing messages — `m5-a01`: **fail**; `m5-a02`, `m5-a03`: pass

`grading/evidence/m5a01-expiry.json`. A DM set to disappearing stamped a 180 s TTL.
With **no client connected at expiry**, 188 s later:

| Read path | Result |
|---|---|
| `POST /q/history` | **returned the expired message with its body verbatim** |
| `POST /q/guardedMessage` | refused `MESSAGE_EXPIRED` (`schema.q:421`) |
| `POST /q/history` after a client called `/m/purgeExpired` | no longer returned |

`ENVIRONMENT.md` requires that "the server refuses expired content **on any read**". The
ordinary read path does not. This independently reproduces the lane's own disclosure in
`platform-gaps.md` — the package's rule language has no time comparison operator
(`E_QUARRY_UNKNOWN: > is not a rule operator`), so the guarantee was implemented as a
guarded point read plus client-triggered purge. The lane recorded this as a platform gap
and explicitly warned against reading its passing expiry choreography as proof of the
stronger requirement. That is the honest disposition of a real failure, and I have scored
the assertion as failed on its own terms.

The client-side halves pass cleanly (`grading/evidence/m5a02a03.json`): the continuously
connected client dropped the expired bubble at expiry (+2 ms on the first post-expiry
poll); a client that was offline **across** expiry purged 2 ms after reconnect; and after
the expiry synced, offline in-chat search returned 0 hits with the empty state rendered
and offline global search returned 0 hits — for a token that matched before expiry.

### Group aggregate receipt — `m3-a09`: **fail** (defect d-01)

The harness's required check failed in **both** my M3 runs: "group delivered receipt did
not expose semantic value delivered within 10000ms". I then characterised it rather than
accepting the timeout at face value:

1. **Server state is correct.** `grading/evidence/group-server-state.json`: for each probe
   message, Carol = delivered(1), Bob = read(2), both `member:true` → the aggregate
   (min over live members, per `src/Messaging.tsx:24`) is `delivered`.
2. **Delivery acks are fast.** `grading/evidence/delivery-latency.json`: Carol's client,
   signed in but **not** viewing the group, acknowledged delivery in **264 / 263 / 264 ms**.
   So nothing is waiting on a slow member.
3. **The sender's UI is stuck.** `grading/evidence/group-ui-receipt.json`: with Alice and
   Bob viewing the group and Carol online elsewhere, Alice's `sm-convo-receipt` went
   `pending` → `sent` and then never changed for **25 s**, in **3/3** trials.
4. **A fresh replica is correct.** From a clean browser profile the same messages read
   `delivered` immediately.
5. **Not a corpus artifact.** `grading/evidence/fresh-group-receipt.json`: in a group
   created seconds earlier, the UI showed `sent` while the server held Bob=read,
   Carol=delivered — and still `sent` **after a page reload**; a clean profile read
   `delivered`.

So the aggregate *semantics* are right and the persistence is right; receipt-row **updates**
never reach an already-established local replica for group conversations, leaving the
sender's indicator at `sent` indefinitely. DM receipts (`m3-a08`) propagate live correctly
in the same runs, so the fault is specific to the group path.

### Live reactions — `m4-a05`: pass on best-of-3 (defect d-02)

Across two grader M4 runs only **1 of 6** harness attempts passed. Attempt 1 of the first
run timed out waiting for the ❤️ chip to become hidden after removal while it stayed
visible with `aria-label="❤️ 1"` — the removal never reached Alice — and the following
attempts then failed too. I separated the two write paths:

| Path | Trial 1 | Trial 2 | Trial 3 |
|---|---|---|---|
| API-driven (`grading/evidence/reaction-live.json`) add / replace / clear | 107 / 311 / 211 ms | 225 / 311 / 222 ms | 257 / 314 / 209 ms |
| UI-driven (`grading/evidence/reaction-ui.json`) set / replace / remove | remove **never seen in 10 s** | remove 3666 ms | set **never seen in 10 s** |

The API path is clean 3/3; the UI path — which goes through the local mutation queue the
lane's own `platform-gaps.md` flags as occasionally staying pending — missed on 2 of 3
trials. Judged pass under the frozen best-of-3 rule, filed as a major defect.

### Push payload — `m6-a08`: pass (defect d-03)

`grading/evidence/push-lease.json`. With no Bob client, `/m/send` appended a push row with
the correct `targetUserId`, `chatId`, `senderDisplayName` and an **80-character** preview —
the assertion's full observable. Characterising the suite flake from §2, after an abrupt
client close:

| Send at | Push row emitted? |
|---|---|
| client live | no (correct — suppressed by an active lease) |
| t+1 s / t+5 s / t+9 s | **no** |
| t+13 s / t+18 s | yes |
| all three suppressed messages, re-checked 20 s later | **still none** |

So the notification for a message arriving in the ~10–12 s stale-lease window is dropped
permanently, never re-emitted once the lease expires. The message itself is delivered; only
the notification is lost. Bounded and mechanically documented, so filed **minor**.

---

## 8. O5 — scale envelope

### Manifest conformance (the band-0 gate): conforms

`grading/verify-scale-independent.mjs` → `grading/evidence/scale-verify-grader.json`.
Grader-independent full-table enumeration of the retained `scale-instance` store via the
published data CLI, compared against `instrument/fixtures/invariant-manifest-combined.json`.
**28 checks, 1 apparent failure**, resolved below.

- Every per-entity count exact: users 1008, followEdges 5921, posts 50228, topLevelPosts
  48224, replies 2004, activeLikes 5008, activeReposts 1004, conversations 1002, dms 901,
  groups 101, memberships 2053, text messages 99105, disappearing-enabled 0.
- Custody: the replayed log's sha256 `b26bf1ae…` equals the manifest's pinned `scale.log`
  digest; `actionCount` 167157 matches; both checkpoint prefix digests (10% `f1f4abf9…`,
  50% `f3ce5872…`) match; `settledPrefix` = 167157 = the full action count;
  `failedActions` 0.
- Named O5 fixtures: u0500 following 500 and 100 conversations · u0005 following 5 ·
  u0900 followers **900** and 200 posts · u0901's exact 5-account following list ·
  g0001's 50-member roster — all exact.
- The one apparent failure was `named:g0001.messageCount` (9990 vs 10000), alongside 901
  per-chat count deltas. `grading/evidence/strike-accounting.json` resolves it: parsing the
  pinned `scale.log` directly, there are exactly **910 `send-media` actions**, and **all 901
  chats with a delta are short by exactly the number of `send-media` actions in that chat**,
  summing to precisely 910 — equal to the manifest's `mediaMessages` and the receipt's
  `struckMediaMessages`. g0001's shortfall is exactly its 10 struck media messages.
  `ENVIRONMENT.md` authorises recording media-dependent invariants as
  `struck-by-environment`, so this is **not** a named-fixture mismatch.
- Replay clock: 209.4 s of a 14400 s cap = **1.45%**. Not exhausted, not >80%, ≤50%.

### Degradation rules (grader-run, k=20 after 3 warm-ups, sequential, 30 s timeout)

No rotated probe set was committed for this wave, so these are grader-authored
substitutes, labelled as such. Posture: local dev binary on the retained corpus, port
49202, **read-only**. `grading/evidence/o5-probes.json`, `o5-feed-rule.json`.

| Rule | Measurement | Limit | Verdict |
|---|---|---|---|
| deep paging: p95 page 50 ≤ 3× p95 page 1 | 33.08 vs 34.41 ms = **0.96×** | 3× | pass |
| celebrity read path: celebrity-follower feed ≤ 3× 5-follow feed | 4.51 vs 3.21 ms = **1.40×** | 3× | pass |
| following feed: 500-follow ≤ 3× 5-follow | **8.98× / 11.53× / 10.07×** | 3× | **fail** |

The failing rule was re-measured over 3 **interleaved** rounds (alternating the two users
inside each round) specifically to neutralise load drift on a shared host; best-of-3 ratio
**8.98×**. Both queries return 20-row first pages, so the comparison is apples-to-apples.
The lane's own recorded probe data agrees (23.65 ms vs 1.45 ms ≈ 16×).

No probe timed out, errored or OOMed. Absolute p95 values are healthy throughout — every
probe ≤ 55 ms (inbox over 100 conversations 7.94 ms, Insights at the full corpus 2.46 ms,
Trending 4.47 ms) — so this is a **growth-shape** failure, not a viability failure. The
rule is nonetheless frozen and hardware-independent, and it fails.

*Two probes excluded from the verdict as grader-tooling issues, not lane results:* my
`globalSearch`/`searchMessages` probe was denied 20/20 because no such operation exists —
the schema defines no server-side message search, which `platform-gaps.md` discloses by
design ("Search scans already-synced rows… this is not a server index and does not
establish the scale performance bar"); and my `people` probe was refused `E_INPUT` for a
wrong argument name. Not re-measured at all: the celebrity **write** path and the
50-member-group receipt-stall rule (both need writes, and I kept the corpus read-only),
and the mid-curve 10%/50% comparisons for search, Insights and Trending (those checkpoint
states are not reproducible once replay has completed).

Absolute p95 ceilings are `pilot-calibrated` placeholders in this instrument snapshot, so
no ceiling can be exceeded and none can be affirmed at ≤50% utilisation. Both are moot:
first-match band order stops at **30**.

---

## 9. M8 results (reported here because the report schema cannot key them)

`assertionResults` is constrained to `^m[1-7]-a[0-9]{2}$` with `additionalProperties:false`,
so M8 cannot be carried in the machine record even though it is in scope. All 18 are
included in the O1 tally.

| Assertion | Result | Evidence |
|---|---|---|
| m8-a01 six lifetime totals | pass | grader recomputed all six from raw store rows via the data CLI; server `insights` matched exactly (posts 236, likesReceived 51, repostsReceived 11, repliesReceived 24, followers 4, following 2), `complete:true` |
| m8-a02 like increments Insights | pass | my `m8-choreo.jsonl`: beforeLikes 50 → afterLikes 51, refresh 154.4 ms |
| m8-a03 UTC day bucketing | pass | 7 day rows; last key = server UTC today; today's posts incremented by exactly 1 |
| m8-a04 zero days rendered | pass | 5 explicit zero-days present, day keys contiguous (20702…20708) |
| m8-a05 Trending ranks by 24 h likes | pass | server order matched my independent likes-desc/newest-first recomputation |
| m8-a06 older heavily-liked post excluded | pass | the heaviest >24 h post (8 likes, more than any in-window post's 7) absent from the window |
| m8-a07 tie breaks newest-first | pass | 7 like-count tie pairs observed, all newest-first |
| m8-a08…a12 digest | struck | `ENVIRONMENT.md`: the schedule-driven daily digest is struck |
| m8-a13 same-account live message | pass | my `m8-choreo.jsonl`, 845.2 ms |
| m8-a14 cross-device read state | pass | my `m8-choreo.jsonl`, unread cleared on client 2 in 235.6 ms |
| m8-a15 dual-offline convergence | pass | my `m8-choreo.jsonl`, flush 823.6 / 1791 ms, server-arrival order, no duplicates |
| m8-a16 receipts after dual flush | pass | my `m8-choreo.jsonl`, 4.5 / 409.7 ms |
| m8-a17, m8-a18 durable queue across restart | struck | `ENVIRONMENT.md`: simulator artifacts are not required |

---

## 10. Scope strikes

28 of 119 in-scope assertions are `struck-by-environment` per `ENVIRONMENT.md`. The report
schema's `result` enum has no such value, so they are recorded as **`not-applicable`** — a
run-scope exclusion, never a failure — each with a note naming the strike.

- **Media (19):** m1-a10, m1-a11 · m2-a02, m2-a03 · m3-a02 · m4-a01–a04, m4-a12 ·
  m5-a04–a06 · m6-a02, m6-a04, m6-a09. Two assertions are *partially* struck and scored on
  their surviving half: `m2-a05` (avatar struck; the harness's required author-identity
  check passed) and `m5-a07` (chat background struck; every accent-colour assertion
  retained and passed).
- **Simulator (7 of those 19 overlap; net additional):** m6-a01, m6-a03, m6-a05–a07 ·
  m8-a17, m8-a18.
- **Scheduled work (5):** m8-a08–a12, the daily digest.
- **Not in this session (9):** all of M7, recorded `not-run` and scoring not-passed in O1.

---

## 11. Cleanup

Killed exactly the PIDs I started: 39127 and its child 39135 (scale backend, after O5),
then 15817 with child 15819 (lane backend) and 18199 (web client). No pattern kill was
used; no other lane's ports were touched.
