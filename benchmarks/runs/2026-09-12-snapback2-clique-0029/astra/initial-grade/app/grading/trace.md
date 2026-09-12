# Sanitized grader evidence and action trace — lane `astra-snapback2`

Wave `astra` · backend `snapback2-0.0.29` · run scope **full** (M1–M8)
Grader: family `claude`, model `claude-opus-5` · session outcome **completed** · reruns used **1**
Report: [`grader-report.json`](grader-report.json) (schema-valid against
`instrument/grader/grader-report.schema.json`)

This is the published artifact. Fixture passwords, session tokens and issued
asset URLs are redacted throughout; the raw session is retained privately for
audit only. The grader's own token cache was written mode 0600 and deleted at
the end of the session.

---

## 0. Session setup, isolation and provenance

**Host (per this run's wrapper, which supersedes the frozen `ENVIRONMENT.md`
for host facts only):** Ubuntu Linux x86_64, AMD EPYC 9454, Node 24.18.0
(`/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node`), Playwright 1.62.1
with Chromium 151. Shared machine — `uptime` load average was sampled beside
every timing-sensitive run and ranged **0.47 – 3.01** across the session.

**Excluded inputs.** `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and
`run-log.md` exist in the lane and were **not read at any point**. No other lane
under `lanes/` was opened. The session is not contaminated.

**Harness integrity.** Before starting I diffed the lane's copies of the
choreography and metering harnesses against the frozen originals:

```
diff -rq instrument/choreography lanes/astra-snapback2/choreography --exclude=node_modules --exclude=package-lock.json   -> no differences
diff -rq instrument/metering     lanes/astra-snapback2/metering                                                          -> no differences
```

Nothing was written into `instrument/`.

**Ports and processes.** Everything ran inside the assigned range 53300–53319.
Every PID started was recorded in `grading/logs/pids.txt` and only those PIDs
were terminated at the end. No `pkill`/`killall` was used.

| Port | Role | PID |
|---|---|---|
| 53300 | lane backend (dev store) | 835973 |
| 53301 | lane Expo web client → 53300 | 836285 (npm) / 836299 (Metro) |
| 53302 | second Expo web client → 53303 | 1015503 |
| 53303 | owner over a **copy** of the settled scale replay store | 1012918 |
| 53304 | fresh instance for the scheduled-digest verification | 989208, then 1010820 after a deliberate restart |

**Configuration.** Grading ran the fixture pack's **shortened-windows** config
throughout, as the frozen prompt requires for expiry behaviour:

```
CLIQUE_WINDOWS_CONFIG=instrument/fixtures/config/windows.shortened.json npm run backend
-> snapback/windows.q: editWindowMs 60000, deleteWindowMs 120000,
   disappear24hMs 180000, disappear7dMs 300000
```

**Side effects on the lane, disclosed.** Running the lane's own documented
entrypoints had three unavoidable effects: `npm run backend` appends a start
line to `run-log.md` (written, never read); `npm run acceptance` rewrites
`suite-status.json` and `evidence/<m>-coverage.json`; and my suite runs added
new timestamped receipts under `evidence/`. The builder's original timestamped
receipts are immutable and were left intact — all coverage analysis below reads
those, and my own runs are distinguishable by timestamp (> 1789205000000).

---

## 1. Phase 1 — the builder's acceptance suite

Invoked exactly as documented, `npm run acceptance -- --milestone mN`, against
the running backend and web client.

| Milestone | First pass | Re-run | Result used |
|---|---|---|---|
| m1 | pass | — | pass |
| m2 | pass | — | pass |
| m3 | pass | — | pass |
| m4 | **fail** | pass | pass (see [d-01](#d-01)) |
| m5 | pass | — | pass |
| m6 | **fail** | pass | pass (see [d-03](#d-03)) |
| m8 | pass | — | pass |

M7 has no suite: the milestone was never attempted.

The two first-pass failures were re-run once under the grader-abort protocol and
both passed. Neither was a grader environment fault, so neither records an
abort; both are reported as lane behaviour. To size them I then ran three more
repeats of each:

- **m4** — 5 grader runs total, **2 pass / 3 fail**, every failure the same
  `sm-convo-media` timeout on `m4-a01`.
- **m6** — 5 grader runs total, **3 pass / 2 fail**. One failure was the
  `m6-a08` push-seam race; the other was `RefusalError: too many password
  authentication attempts`, caused by my own back-to-back repeats hitting the
  auth rate limiter. That one is **attributed to the grader, not the lane**.

---

## 2. Phase 2 — coverage-manifest spot-verification

**Verdict: honest.** No milestone is adjudicated `capability-failure` on
coverage grounds.

Structural check, against the latest *passing* receipt per milestone:

| Milestone | suite-required in `assertions.json` | receipt `required` | `covered` | `missing` |
|---|---|---|---|---|
| m1 | 7 | 7 | 7 | 0 |
| m2 | 22 | 22 | 22 | 0 |
| m3 | 7 | 7 | 7 | 0 |
| m4 | 5 | 5 | 5 | 0 |
| m5 | 6 | 6 | 6 | 0 |
| m6 | 5 | 5 | 5 | 0 |
| m8 | 6 | 6 | 6 | 0 |

The design resists dishonesty by construction: `scripts/acceptance.ts` derives
`required` at run time from `assertions.json` rather than from a hand-maintained
list, and pushes into `covered` only from tests that actually passed.

Sampled mappings (12), each read in `scripts/acceptance*.ts` and checked against
the assertion's stated observable:

| Assertion | Mapped test | Does it exercise the observable? |
|---|---|---|
| m1-a03 | duplicate handle shown | Yes — waits for `sm-profile-error`, asserts `/HANDLE_TAKEN/`. |
| m1-a11 | profile and avatar write renders | Yes — waits for a decoded `<img>` (`naturalWidth>0`) inside `sm-profile`. |
| m2-a13 | URL opens browser without preview | Yes — asserts zero `sm-feed-media` nodes on the card. |
| m2-a24 | pagination no gaps or duplicates | Duplicates yes, gaps only implicitly — see note below. |
| m2-a27 | follow projections and implicit self | Yes — compares social counts across a repost. |
| m3-a15 | installed starter segments idempotent | Yes — deep-equals group detail and DM history across a full re-seed. |
| m4-a09 | edited label and own-only edits | Yes — matches `/edited/` in the bubble, plus a rejected foreign edit. |
| m5-a05 | closing ends view and second open refused | Yes — affordance turns `opened`, viewer node gone. |
| m5-a11 | global results grouped by chat | Yes — waits for grouped result nodes. |
| m6-a11 | documented headless demo | Indirect — trusts the demo's own operations list; see note below. |
| m6-a13 | frozen 50-action replay conformance | Yes — runs the real adapter over the frozen sample log. |
| m8-a01 | six server totals | Strong — recomputes all six from raw tables via the admin `data` CLI and compares to `insights.mine`. |

Two mappings are **thinner than their assertion text, but not dishonest**, and I
closed both gaps myself:

- `m2-a24` checks duplicate row ids but not gaps. I added an independent
  cross-page ordering check over both tabs fully paged — 0 duplicate ids and
  monotonically non-increasing timestamps across every page boundary. Passed.
- `m6-a11` asserts `r.operations.length === 5` from the demo's own output. I ran
  the demo independently on both documented auth paths and confirmed the five
  named operations really execute.

---

## 3. Phase 3 — independent checklist execution

Re-executed assertion by assertion from `assertions.json`, via the custom-client
API and Playwright against the web build — written against the checklist, not
against the lane's acceptance scripts.

**Totals: 101 of the 119 enumerated in-scope assertions pass.** The 18 that do
not are all `not-run`: M6's seven simulator assertions, M7's nine (milestone
never attempted), and M8's two simulator assertions.

### <a id="m1"></a>M1 — accounts and profiles · 13/13 pass

44 API assertions were executed in one independent pass
(`grading/probes/g-checklist-api.mjs`). M1 highlights:

- **m1-a01** signup issued a session token; an under-8-character password was
  refused server-side (`password must contain at least 8 characters …`).
- **m1-a03 / m1-a04** duplicate handle → `HANDLE_TAKEN`; duplicate email →
  `email is already registered`.
- **m1-a07** *(grader-class, full-run only)* — server-side session revocation.
  Before logout the token read 26 conversations. After `auth.logout()`, a brand
  new client carrying the same token got `auth.me` →
  `session is missing or expired` and `groups.mine` → `state refused`,
  `E_AUTH_REQUIRED`. **Revoked server-side, not merely dropped client-side.**
- **m1-a11** the avatar `<img>` decoded on the profile screen at natural size
  256×256, and the authorized asset fetch returned real bytes.
- **m1-a12** *(source inspection)* — `snapback/schema.q` line 1 declares
  `use identity password`, the backend's documented built-in password identity
  provider (`node_modules/snapback2/dist/guide/auth.md`). The lane uses the
  documented provider path and hand-rolls no KDF, which is what this assertion
  asks me to verify — not provider internals.
- **m1-a13** *(source inspection)* — I searched `.snapback/` (`store.sqlite`,
  the WAL, `log.jsonl`, blobs), `evidence/`, `artifacts/` and `.replays/` for
  each fixture, suite and scale password in **plaintext, base64 and hex**.
  **Zero hits in every location.** The fixture credential files live outside the
  app and are the declared test-fixture exception.

### <a id="m2"></a>M2 — posts and the follow graph · 27/27 pass

Notable independent confirmations:

- **m2-a08** after unfollow, Alice's originals — *including older ones* — are
  gone from Bob's Following feed (0 remaining), while **m2-a09** confirms they
  are still in Global. Unfollow is projection-scoped, not content revocation.
- **m2-a15** like is an idempotent set-state toggle: a **replayed mutation id**
  left the count at 1 rather than incrementing.
- **m2-a24** both tabs fully paged: 40 rows (Following) and 146 rows (Global),
  0 duplicate ids, ordering monotonic across page boundaries.
- **m2-a25/a26/a27** implicit self-follow holds with **zero** explicit follow
  edges, covers own reposts, and moves neither follower nor following count.
- **m2-a12** in the browser, the link renders as the raw URL text and clicking
  it opened a **separate browser context** at the target — the system-browser
  seam — and **m2-a13** zero preview cards rendered.

*Instrument note:* `assertions.json` 0.3.0-m8 declares `counts.assertions.M2 = 24`
but M2 actually enumerates **27** assertions (`m2-a01`…`m2-a27`), making the real
total **119**, not the declared 116. This is an inconsistency in the frozen
instrument, not in the lane. I keyed results against the enumerated assertions,
which the manifest itself calls the authority.

### <a id="m3"></a>M3 — messaging core · 15/15 pass

- **m3-a03** both directions of `dmCreate` resolved to the same channel id
  (`d-alice-bob`) — at most one DM channel per pair.
- **m3-a06 / m3-a07** typing indicator became visible **36.4 ms / 33 ms** after
  the last keystroke (bound 2 s) and expired at **4851 ms / 4338.8 ms** (bound
  5 s). Both comfortably inside, best-of-3.
- **m3-a12 / m3-a13** the harness cutoff assertion passed; I additionally
  confirmed the **server** side myself — after removal, Carol's `richThread`
  read of the group is `denied` and she never sees a post-removal message, while
  `choreography.mjs` asserts she still renders her local pre-removal copy.
- **m3-a15** I re-ran all three installed starter segments myself: DM history
  230/230, starter-group history 45/45, conversations 34/34, global feed 153/153,
  people 19/19 — byte-identical, group detail deep-equal. Genuinely idempotent.

### <a id="m4"></a>M4 — media messages, reactions, edit/delete · 12/12 pass

- **m4-a06/a07** reaction is at most one per user per message: 👍 → ❤️ replaced
  rather than accumulated (1 reaction, ❤️), a **replayed mutation id** did not
  resurrect the old emoji, and `none` cleared it.
- **m4-a10** *(grader-class, shortened windows)* — an edit inside the 60 s
  window committed; an edit at **+70 s** was rejected server-side with
  `EDIT_WINDOW_EXPIRED`, and the stored body still held the in-window text. The
  window is enforced by the server, not by hiding the UI affordance.
- **m4-a12** *(grader-class)* — before delete, an authorized `assetBlob` served
  2110 bytes while an unauthenticated raw GET already returned 404. After
  `messages.unsend` the row is tombstoned and the asset is refused
  (`asset is unavailable`) on **both** the previously issued URL **and** a
  freshly issued one; raw GET 404. No stale-URL escape hatch.

### <a id="m5"></a>M5 — ephemeral, chat config, search · 12/12 pass

All four grader-class expiry and asset assertions were executed end to end.

- **m5-a01** — a DM set to the `24h` option under shortened windows produced
  `expiresAt − at` of **exactly 180000 ms**. I then **closed every client** and
  waited 205 s. On reconnect the message was absent from `richThread` and
  `history`, an addressed `receipts` read was `denied`, server-side search
  returned **0 hits**, and a control message sent afterwards was present — so
  the channel still worked and only the expired row was gone.
- **m5-a02** — persistent browser profile. Session 1 rendered and searched the
  expiring message (1 search hit). Context closed for **191 s** past the TTL. On
  relaunch the expired message rendered **0** times while the non-expiring
  control still rendered.
- **m5-a03** — the same relaunched profile taken **offline**: offline search
  returned 1 hit for the retained control and **0** for the expired message, and
  the page body never mentioned it.
- **m5-a06** — after the single view, a re-read with a new viewing object was
  refused (`already delivered to this principal`); a **freshly issued URL** was
  refused identically; unauthenticated `HEAD` and `Range` requests returned 404.
  No bypass via a new token, a new URL, or a conditional request.
- **m5-a09** case-insensitive word-prefix matching confirmed in both directions
  (`car` and `CAR` find Carol) and, correctly, `arol` does **not** match.

### <a id="m6"></a>M6 — offline writes, push seam, custom-client API · 6/13 pass, 7 not-run

**m6-a01 … m6-a07 — `not-run`.** These are `simulator` / `native-artifact`
assertions. This host cannot run an Apple simulator; the lane records this
honestly in `simulator-status.json` (`pass: null`, reason
`unavailable / not-run`). **Web export was not accepted as native proof**, per
the run wrapper. All seven are `greenRequired: false`, so M6's green receipt is
unaffected.

- **m6-a08** verified independently with the recipient's clients closed: the
  logged payload carried the correct `targetUserId`, `chatId`,
  `senderDisplayName`, and a preview of **exactly 80 characters**.
- **m6-a09** a view-once photo previewed as the literal `Photo`, not the caption.
- **m6-a10 / m6-a11** I ran `scripts/custom-client-demo.mjs` myself on both
  documented auth paths — credentials and token — and both returned
  `pass: true` with all five operations (`authenticate`, `list-conversations`,
  `page-history`, `send-text`, `poll-receive`). It prints no secret.
- **m6-a12** *(grader-written variation)* — I wrote a client using **only
  `API.md`**, no lane source. The documented recipe ("page `groups.mine`, select
  `row.conversation.title`, then query `messages.richThread` for its id with
  `c:null`; `data[0].message` is newest") worked **verbatim**. Two documentation
  claims were independently borne out: the warning that group names can be
  ambiguous (5 conversations shared my probe title, and the doc tells you to fall
  back to the id), and the "all history is newest first by server timestamp and
  id" ordering claim. Documentation quality here is genuinely good.
- **m6-a13** I re-ran the adapter on the frozen 50-action sample: schema-valid
  against `0.1.0-p1`, **50 actions, 13 verbs — every verb in the schema**, all 50
  settled, and `verify-sample.mjs` passed **142** state assertions.

### <a id="m7"></a>M7 — day-2 evolution · 0/9, all `not-run`

`milestone-results.json` records M7 `status: not-run`, "Separate fresh session
explicitly excluded from this continuous run." Under O1's partial-credit design
these nine assertions score **not passed** and stay in the denominator. The
pre-M7 snapshot comparison (`m7-a08`) has no M7 state to compare against.

### <a id="m8"></a>M8 — insights, digest, multi-device offline · 16/18 pass, 2 not-run

**These results cannot be keyed in the report JSON.** The frozen report schema's
`assertionResults` accepts only keys matching `^m[1-7]-a[0-9]{2}$`, which
predates the 2026-08-11 M8 amendment. M8 is in full-run scope and was graded, so
its results are recorded here and are included in the O1 reasoning.

| Assertion | Result | Basis |
|---|---|---|
| m8-a01 | pass | Six lifetime totals present and internally consistent; followers/following match the profile read. |
| m8-a02 | pass | Harness `m8-a02-insights-like-refresh` (190 → 191 likes, 1866.5 ms). |
| m8-a03 / m8-a04 | pass | Today's bucket incremented, 7 buckets returned, UTC day index correct, 5 zero-days rendered rather than omitted. |
| m8-a05 | pass | With 8 likes my post ranked first among a field that already contained other 8-like posts. |
| m8-a06 | pass | A grader-authored admin mutation created a **36 h-old** post with 8 likes; it was **absent** from Trending immediately. |
| m8-a07 | pass | At an 8–8 tie the **newer** post ranked first. |
| m8-a08 – m8-a12 | pass | Fresh-instance digest verification, below. |
| m8-a13 – m8-a16 | pass | Harness receipts: live cross-device delivery 1903.5 ms; cross-device read-state clear 1554.1 ms; dual-offline convergence flushes 1963.2 / 980.6 ms with no loss and no duplicates; receipts advance after reconnect. |
| m8-a17 / m8-a18 | **not-run** | Simulator / native-artifact; same missing-simulator reason as M6. |

**Scheduled-digest verification (m8-a08 … m8-a12), grader-run.** Because
changing the digest config on existing data is unsafe, I built a **fresh
instance** (`grading/digest-verify`, port 53304) from the lane's `snapback/*.q`
with the frozen `digest.shortened.json` installed from its first write
(period 120 s, anchor 00:00:00 UTC). I created five fresh personas — an author,
a follower, a deliberately **quiet** user, and **two outsiders** talking in a
chat neither of the first two belongs to — generated activity inside one period,
**closed every client**, and let the period end.

| Check | Observed | Verdict |
|---|---|---|
| m8-a08 exactly one digest per active user | author 1, follower 1, outsider-recipient 1; no user appeared twice | pass |
| m8-a08 counts | author `newFollowers 1, newPostsInFollowing 2, unreadMessages 0, unreadChats 0`; follower `newFollowers 0, newPostsInFollowing 2, unreadMessages 2, unreadChats 1` | pass |
| m8-a09 quiet persona | **0** digests | pass |
| m8-a10 following quiet period | **0** digests emitted for the next period | pass |
| m8-a12 outsider chat | the 4 outsider messages contributed **nothing** to either target's counts | pass |
| m8-a11 mid-period restart | see below | pass |

For **m8-a11** my first attempt did not actually restart anything — the CLI
re-attached and returned the same PID. I redid it with a genuine termination:
owner PID 989208 was terminated **46.7 s before** the period boundary and a new
owner (PID 1010820) started. Result: **exactly one digest per user** for that
period, and re-driving the sweep for the same cutoff produced **no duplicates**
— `digestReceipts[principal, cutoff]` is a real exactly-once guard.

*Interpretation recorded:* the author's `newPostsInFollowing` counts her own two
posts. That follows from the app's implicit self-follow, which M2's checklist
(`m2-a25`/`m2-a26`) positively requires, so the Following-feed definition and
the digest definition agree. `README.md` documents this explicitly.

### Authorization checks — informational only, **not** O3 input

Because no holdout probe set exists for this wave (see §6), these 13
grader-written checks bear on O2 and the defect list only. **All were correctly
denied server-side:**

| Check | Result |
|---|---|
| Non-member reads DM thread / history / detail | `denied` (×3) |
| Non-member sends into a DM | `rejected NOT_MEMBER` |
| Non-member searches inside a chat | `denied` |
| Another user edits / deletes a message | `rejected NOT_AUTHOR` (×2) |
| Handle squatting on an existing user | `rejected E_CONSTRAINT` |
| Anonymous reads a DM | `refused E_AUTH_REQUIRED` |
| Anonymous reads the global feed | `refused` (stricter than required) |
| Removed member reads post-removal messages | `denied`, never saw the message |
| Token acts only as its own principal | viewer bound to the token owner |

---

## 4. Timing records (best-of-3)

All from the lane's latest green choreography receipts, which retain **all
three** attempts. Machine load during the session: 0.47 – 3.01.

| Assertion | Measurements (ms) | Best | Bound | Passed |
|---|---|---|---|---|
| m1-a09 profile edit live | 893.7 / 814.2 / 491.3 | 491.3 | 10 000 | yes |
| m2-a04 feed post live | 1019.2 / 318 / 269.8 | 269.8 | 10 000 | yes |
| m2-a07 follower count live | 2064.9 / 2241.5 / **12 079** | 2064.9 | 10 000 | yes |
| m2-a14 like count live | 555.1 / 347.2 / 334.7 | 334.7 | 10 000 | yes |
| m2-a19 reply count live | 265.2 / 329.2 / **30 613** | 265.2 | 10 000 | yes |
| m3-a01 DM live | 904.4 / 2418.9 / 3316.2 | 904.4 | 10 000 | yes |
| m3-a06 typing appears | 36.4 / 33 / **8 894** | 33 | 2 000 | yes |
| m3-a07 typing expires | 4851 / 4338.8 / **8 894** | 4338.8 | 5 000 | yes |
| m4-a02 photo live render | 2499.6 / 2069.9 / 2084.4 | 2069.9 | 10 000 | yes |
| m4-a05 reaction live | 1928 / 2212.5 / **13 376** | 1928 | 10 000 | yes |
| m4-a08 edit live | 1098.1 / 1089.3 / 670.1 | 670.1 | 10 000 | yes |
| O5 cold-start initial sync | 30 097 / 30 233 / 30 053 | 30 053 | 30 000 | **no** |

**How to read the bolded values.** Where an attempt never observed the event, I
recorded that attempt's whole wall time in place of a latency, because no
latency exists to record. Those attempts are genuine misses, not slow successes
— they are the subject of defect [d-04](#d-04). Best-of-3 still passes each
assertion, which is the frozen rule.

---

## 5. Defects beyond the checklist

### <a id="d-01"></a>d-01 — major (M4): the sender's own photo often never renders, and never recovers

**What happens.** Send a photo from the web client. The bubble and caption
appear immediately, but `sm-convo-media` never appears — not after 30 s, not
ever — on the **sender's** client. A page reload always brings it back.

**Reproduction** (`grading/probes/g-photo-render.mjs`, 6 runs, independent of
the lane's suite): **3 of 6** runs failed; in all 3 the console showed a **404**
on the asset fetch, and a reload recovered the image in **3 of 3**. The lane's
own suite shows the same rate — 3 of 5 grader runs of `m4` failed on exactly
this locator.

**Scope.** The **recipient** path is healthy: 4 of 4 runs rendered inline in
852–2131 ms with the image decoded. The failure is specific to the sender's view
of their own just-committed message.

**Root cause, from source.** `src/asset-uri.web.ts` resolves the blob exactly
once inside a `useEffect` keyed only on `[client, source]`:

```
client.assetBlob(source).then(blob => { … }).catch(() => { if (alive) R(undefined); })
```

There is no retry. When the asset is briefly not yet readable — the 404 seen in
the console — the `catch` fires and the effect will not run again unless the
client or the source identity changes. `ui/src/MessageBubble.tsx`'s `mediaBlock`
then returns `null` for a non-video with no `mediaUri`, so the whole media node
is absent rather than showing a placeholder or a retry affordance.

**Why major and not blocker.** Server state is intact, the recipient sees the
photo, and a reload fixes it — but it is on the happy path of a core flow and
fires about half the time.

### <a id="d-02"></a>d-02 — major: cold-start initial sync misses the 30 s scale envelope

The brief's degradation rule requires that "cold-start initial sync of the probe
user's account (100 conversations) completes without timeout or unbounded memory
growth."

The lane's own artifact already records the failure —
`performance.browserProbes.pass = false`, `probes.coldStart` `pass: false`,
`TimeoutError`, `elapsedMs 30251`. I reproduced it independently against a copy
of the settled scale store, **best-of-3**:

| Run | Authenticated | Outcome | Peak JS heap |
|---|---|---|---|
| 1 | 4904 ms | timed out at 30 097 ms, status still "Syncing message history…" | 446 MB |
| 2 | 1850 ms | timed out at 30 233 ms | 465 MB |
| 3 | 1868 ms | timed out at 30 053 ms | 448 MB |

Lifting the budget to 240 s showed the sync **does** complete — at **62 217 ms**,
2.07× the envelope, with a **748 MB** heap peak. This is the input that drives
O5 to its 30 band.

*A correction worth recording:* my first long run reported the chats list
stalling at 50 of 100 conversations, which would have been a second defect. On a
focused re-test it reached the full **100** (50 → 100 after one "More
conversations" page). My earlier loop had simply exited before the second page
rendered. **No chats-list defect is filed.**

### <a id="d-03"></a>d-03 — minor (M6): push-seam log is not readable in the same turn as the send

A `notifications.mine` read issued immediately after a committed send can miss
the payload it produced. The lane's M6 suite does exactly this and failed on
`assert.ok(row)` in 1 of 5 grader runs. My own `m6-a08` check polls for up to
10 s and passes reliably, so the payload is produced correctly — it is just not
synchronously visible. Affects any test or client that reads the seam in the
same turn as the send.

### <a id="d-04"></a>d-04 — minor: intermittent live-update latency tail

Across the lane's own latest green choreography receipts, **4 of 64** retained
best-of-3 attempts failed, all classed `application` — about a 6% per-attempt
miss rate on core live updates:

- `follow-unfollow-live-projection` — "Bob's Following projection after follow
  toggle did not become observable within 10000ms"
- `reply-live-thread-projection` — 30 s compose-submit click timeout
- `typing-indicator-within-2s-expires-within-5s` — indicator never appeared
- `reaction-live-replace-remove` — 10 s timeout

Best-of-3 makes each assertion pass, which is the frozen rule. The tail is still
user-visible.

### <a id="d-05"></a>d-05 — minor (M8): digest unread fan-out silently truncates past 50 members

`snapback/digest.q`'s sweep walks
`for member in memberships[m.conversationId] first 50 by byConversationPrincipal`.
In a group with more than 50 members, everyone past the cap silently receives no
`unreadMessages`/`unreadChats` credit. The frozen envelope's busy group has
**exactly** 50 members, so the checklist never crosses the boundary and every
digest assertion passes. The truncation is silent rather than surfaced.

### <a id="d-06"></a>d-06 — minor (M3): `groups.detail` caps the roster at 50 with no continuation

`snapback/groups.q`'s `detail` returns
`members: memberships[conversationId] first 50 …` with **no cursor argument**,
while sibling list queries expose one. Chat settings for a group larger than 50
members would silently show a truncated roster. Verified benign at the envelope:
the frozen 50-member group `g0001` returned its full 50-handle roster, exactly
matching the invariant manifest.

---

## 6. Phase 4 — holdout probes: not run

**No holdout probe set was hash-committed for this wave.** Per this run's
wrapper, execution-order phase 4 is skipped, `wave.probeSetSha256` records the
literal `none-uncommitted`, and `probeResults` is empty. **No probes were
invented.**

This is why **O3 is recorded `null`**. Its applicability predicate is satisfied
(M6 green, M1–M5 attempted), but its scoring rule states that scores "read only
the wave's secret rotated probes" — with none committed there is no admissible
input, and substituting my own ad-hoc checks would break the rule the dimension
is defined by. The 13 authorization checks in §3 all passed and are reported as
information and as O2 input, explicitly not as O3.

---

## 7. O-dimension scores

| Dimension | Score | One-line basis |
|---|---|---|
| O1 Functional completeness | **73** | 101/119 assertions; 7 of 8 milestones green; M7 absent and no native proof. |
| O2 Correctness under grading | **55** | Two major defects, one on a core happy path; no wrong data anywhere. |
| O3 Trust boundaries | **null** | No holdout probe set committed for this wave. |
| O4 Observed offline behavior | **65** | Everything observed behaved as specced; cold-start offline never observed; gap honestly declared. |
| O5 Performance at the envelope | **band 30** | Manifest conforms exactly; cold-start rule fails and its probe times out. |

Full anchor citations and justifications are in `grader-report.json`. The
reasoning for O5's band is worth restating here because it is an exact function,
not a judgement:

**Band 0 does not fire.** I verified the invariant manifest myself rather than
trusting the lane's receipt:

- All **18** per-entity counts match `invariant-manifest-combined.json` at the
  **10%**, **50%** and **final** checkpoints — exact, no tolerance.
- The frozen `scale.log` sha256 matches the recorded `logSha256`
  (`b26bf1ae…6abba9`).
- All **167 157** actions settled (`settledReceipts == actions`).
- All **9 named O5 fixtures** verified against a **copy** of the settled store,
  so the frozen artifact was never mutated: `u0500` following 500 and 100
  conversation memberships; `u0005` following 5; `u0900` **900** followers and
  **200** posts; `u0901` following 5; `g0001` 50 members with the **exact
  50-handle roster** and **10 000** messages.
- No wall cap could be exhausted: this DRAFT instrument leaves the replay wall
  cap pilot-calibrated and `capSeconds` is `null`.

**Band 30 fires on both of its clauses** — the cold-start degradation rule fails
and a probe times out (defect [d-02](#d-02)).

For the record, **every ratio-based degradation rule passes**: deep paging
1.02×, following fan-in 1.03–1.05×, celebrity read path 0.99–1.00×, celebrity
write path 0.83×, global search 0.995× end-to-end with the 50% point below the
interpolated line, Insights 1.13× with the 50% point below the line, Trending
0.994×. Trending's 50% point sits **0.033 ms (0.07%)** above the line between
its endpoints on a flat-to-declining curve — measurement noise, not the
superlinear blow-up that rule tests. It does not change the band.

Absolute latency ceilings are **not calibrated** in this DRAFT instrument, so
the 60 and 90 bands' ceiling-utilisation conditions could not be established
either way; the first-match order makes that moot, since band 30 fires first.

---

## 8. Recorded deviations from the frozen grader prompt

1. **No holdout probe set** — phase 4 skipped, `probeSetSha256` =
   `none-uncommitted`, `probeResults` empty, O3 null. See §6.
2. **Grader family has not passed calibration** — `calibrationPassed: false`,
   `sameFamilyGraded: false`. The lane was graded anyway; the record labels this
   grade **uncalibrated-grader**. This run is N=1 calibration, not a
   claim-eligible wave.
3. **Timing checks judged best-of-3**, with machine load recorded beside each
   run (load average 0.47–3.01 on this shared host). See §4.
4. **`rerunsUsed: 1`** — the M4 and M6 suites failed on first pass and were
   re-run once under the grader-abort protocol. Both passed; neither was a
   grader environment fault, so both are reported as lane behaviour rather than
   as an abort.

No weighted total, efficiency statistic, or cross-lane comparison is computed or
reported here — those are the harness's and publisher's jobs.

---

## 9. Cleanup

Every PID recorded in `grading/logs/pids.txt` was terminated at the end of the
session, and only those. `grading/scale-verify` (the 4.9 GB working copy of the
settled replay store) was removed. The grader's mode-0600 token cache was
deleted. The frozen artifacts under `instrument/` and `.replays/` were never
written to.
