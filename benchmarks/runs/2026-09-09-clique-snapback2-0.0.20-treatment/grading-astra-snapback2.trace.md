# social-messenger — sanitized grader evidence and action trace

Lane: `lanes/astra-snapback2` · backend `snapback2-0.0.20` · run scope **full** (M1–M8)
Wave `astra` · grader family `claude`, model `claude-opus-5` · session outcome **completed**
Companion machine record: `grading/grader-report.json` (validated against
`instrument/grader/grader-report.schema.json` with AJV 8.20 draft-2020-12).

**Redaction posture.** Fixture persona passwords, session tokens, and the isolated
instances' control secrets are used but never reproduced here; they appear as
`<fixture password>`, `<token>`, `<control secret>`. Opaque row ids are quoted only
where they carry evidentiary weight. Raw session transcripts are not published.

---

## 0. Deviations from the frozen grader prompt (recorded, not chosen by me)

1. **No holdout probe set was committed for this wave.** Execution-order phase 4 was
   skipped; `wave.probeSetSha256` is the literal string `none-uncommitted` and
   `probeResults` is empty. No probes were invented. O3 therefore records `null` —
   see §7.
2. **The grading family has not passed the calibration gate.**
   `grader.calibrationPassed = false`, `grader.sameFamilyGraded = false`; the grade is
   labelled `uncalibrated-grader`.
3. **Timing-sensitive checks are best-of-3** with machine load recorded beside each
   measurement. This machine is shared with other sessions; `uptime` load average
   ranged from **5.98 to 13.25** across the session and is quoted at each timing point.

No excluded builder context reached me. `diary.md`, `essay.md`, `final-report.md`,
`FINAL.md` and `run-log.md` were never opened; `run-record.json` was read field-wise
and its `diary` and `correctionLoops` fields were never printed. `grader.contaminated`
is `false`.

---

## 1. Environment and processes

macOS arm64, Node v24.18.0 (`/Users/ccheever/.volta/...`), Playwright chromium from the
lane's own `choreography/node_modules`. Ports confirmed free before starting; nothing
outside **50100–50119** was touched and no other lane's processes were signalled.

Started by me, from `README.md`:

| Port | Process | PID |
|---|---|---|
| 50100 | `npx snapback2 dev --port 50100 --serve` (lane backend) | 36817 → 36860 |
| 50101 | `npm run dev -- --web --port 50101` (Expo web) | 37074 |
| 50102 | `node scripts/gateway.mjs` | 37176 → 37180 |
| 50104 | `node scripts/push-provider.mjs` | 40230 |
| 50106 | `npx snapback2 dev --port 50106` in `test-instance/` | 65380, later 69859 |
| 50107 | `npx snapback2 dev --port 50107` in `grading/run/rank-instance/` (grader-created clean instance) | 67781 |

Two further processes were descendants of the above and were stopped with them: the Expo
child 37100, and 70900, the 50106 backend that `scripts/digest-proof.ts` re-spawns as
part of its restart-idempotence proof.

`npx snapback2 check` → `ok 5ce1a57b 56 ops`. All PIDs are listed in
`grading/run/pids.txt` and only those were killed at the end.

`config/windows.json` and `config/digest.json` are byte-identical to the fixture pack's
`windows.shortened.json` and `digest.shortened.json`, so grading ran on the shortened
windows as required (edit 60 s, delete-for-everyone 120 s, "24h" → 180 s, "7d" → 300 s,
digest period 120 s).

Documented seeds re-run: `npm run seed -- --segment m1|m2|m3` — all three replayed
(the receipt-based skip correctly refused to short-circuit, because the receipts on disk
recorded a different instance's principal). See §3.9 for the duplicate check.

---

## 2. Phase 1 — the builder's acceptance suite

Invocation shape as documented: `npm run acceptance -- --milestone mN`.

| Milestone | Result | Load avg at start |
|---|---|---|
| m1 | **pass** (7/7 suite-required recorded) | 8.53 |
| m2 | **fail** — aborts at m2-a22/a23 | 6.46 (re-run) |
| m3 | **fail** — aborts at m3-a10 | 6.14 (re-run) |
| m4 | **pass** (5/5) | — |
| m5 | **pass** (6/6) | — |
| m6 | **pass** (5/5) | — |
| m8 | 6/6 suite-required recorded; suite exits non-zero in a non-assertion step | 5.98 |

Two re-runs were used, both on lane-caused failures, both reproducing identically. No
grader-environment failure occurred, so this is not a `grader-abort`.

### 2.1 m1
`START/PASS` for `[m1-a01,m1-a02]`, `[m1-a03]`, `[m1-a08,m1-a10,m1-a11]`, `[m1-a04]`.

### 2.2 m2 (fail, reproduced)
Both runs abort with
`locator.waitFor: Timeout 30000ms exceeded — waiting for getByText('Page probe <run> 0', {exact:true})`.
The suite receipt records 18 assertions passing before the abort; `m2-a22`/`m2-a23` fail
and `m2-a12`/`m2-a13` are never reached. Root cause established in §3.6.

### 2.3 m3 (fail, reproduced)
Both runs abort at the quoted-reply check with
`actual: 'Quoted response <run>\n◷\nPending'` — the suite reads the last matching bubble
while the send is still queued in the outbox. Independent execution in §3.7 shows the
observable itself passes once the send settles; the underlying cause is the send latency
in §3.16.

### 2.4–2.5 m4, m5, m6
All pass with every suite-required assertion recorded.

### 2.6 m8 — required an undocumented second backend, and a clean one
First attempt: `ENOENT: test-instance/.snapback/owner.json` at `scripts/acceptance-m8.ts:16`.
The M8 ranking proof needs a second backend on port 50106 whose clock it drives through
`POST /control/clock` with `<control secret>`; neither `README.md` nor `API.md` says to
start it. (Defect **d-04**.)

Second attempt, with the builder's `test-instance` state in place: fails at
`acceptance-m8.ts:21` — `ranked[0]` is a residual post, not the fresh one. Inspection of
that instance (`grading/run/probe-trending.mjs`) shows why: server clock
`2026-09-10T17:36:51Z`, but two residual score-0 Trending rows dated `2026-09-12T16:50Z`
and `2026-09-12T16:52Z` from the builder's own run. `byRank` is (score, at, id), so
future-dated rows outrank a fresh post. The digest proof advances the clock and the
advance does not survive the instance restart. (Defect **d-05**.)

Third attempt: I moved `test-instance/.snapback` aside to
`grading/run/test-instance-snapback.builder` (**moved, not deleted**; restored afterwards
— §6) and started a clean instance on 50106. All six M8 suite-required assertions then
recorded pass, including `m8-a05/a06/a07`. The suite still exits non-zero, in
`digest-proof.ts` — a read-before-write race, not an assertion failure (§3.17, defect **d-06**).

### 2.7 What the suite mutates
The entrypoint rewrites `coverage-manifest.json`, `suite-status.json`,
`evidence/coverage-m*.json` and `evidence/seed-m*.json`, and appends to `run-log.md`.
The builder's copies were saved before the first run and restored afterwards (§6).

---

## 3. Phase 3 — independent checklist execution

All grader scripts live under `grading/run/`. API work goes through the public
`snapback2@0.0.20` client, as `API.md` prescribes; browser work drives the served web
build at `http://127.0.0.1:50102`.

### 3.1 M1 signup path — `probe-m1-signup.mjs`, `probe-m1-dupemail.mjs`
- Signup with a fresh email lands directly on the authenticated profile-creation form → **m1-a01, m1-a02 pass**.
- Handle `alice` at profile creation is rejected with a visible error → **m1-a03 pass**.
  The message shown is the raw backend string `E_CONSTRAINT: sealed unique conflict on profiles.byHandle` (defect **d-07**).
- Password `short` → `"password must contain at least 8 characters"`; `alice@example.com` → `"email is already registered"` → **m1-a04 pass**, and the ≥8-char rule is enforced server-side.

### 3.2 m1-a07 session revocation — `probe-m1a07.mjs`
A second client constructed with the issued `<token>` answers `auth.me()` before logout.
After `logout()` on the first client: `auth.me()` → *session is missing or expired*, and
`groups.list` → `{state:"refused", code:"E_AUTH_REQUIRED"}`. **Pass.**

### 3.3 m1-a12 / m1-a13 password storage — source inspection
`snapback/schema.q:1` is `use identity password`: the built-in auth identity, with no
hand-rolled credential storage anywhere in `snapback/` or `src/` (the only `password`
references in app code are the auth form's controlled input). **m1-a12 pass.**
Fixture passwords appear **zero** times in `.snapback/store.sqlite` (strings scan),
`.snapback/log.jsonl`, the backend's stdout log, `test-instance/.snapback/store.sqlite`,
and the 4.65 MB bundle the web client actually loads. **m1-a13 pass.**

### 3.4 M2–M5, M8 API observables — `probe-checklist.mjs`
Independent execution, 31 assertions, all pass:
m2-a01/a02/a03 (text, 2-image, video posts), a06, a08 (older posts leave the Following
feed too), a09, a15 (unlike clears and decrements), a16 (attribution "Bob Bennett"),
a17, a18, a20 (parent + 2 direct replies, chronological), a21, a24 (263 entries, 263
unique ids, page 1 = 20 with a next cursor, all 23 probe posts present exactly once),
a25/a26/a27 (implicit self-follow membership with follower/following counts unchanged at
3/2); m3-a03/a04/a05/a14; m4-a06/a07; m5-a08/a09 ("car" and "CAR" both find Carol)/a10/a11;
m8-a01 (Insights equalled an independently paged oracle on all six totals:
216/6/4/13/4/2), m8-a03, m8-a04.
`probe-m2a11.mjs` re-ran m2-a10/a11 against `henry`, an author Bob genuinely does not
follow (my first attempt used `dave`, whom Bob follows in the seed): present in Global,
absent from Following. **Both pass.**

### 3.5 m2-a12 / m2-a13 — `probe-m2-links.mjs`
On the thread page for seeded post `sp0001`: the URL renders with the `link` role and
clicking it opens a new browsing context at `https://example.com/cafe` → **m2-a12 pass**.
The card contains 0 iframes, 0 non-blob/data images, and no unfurl metadata; card text is
exactly author, handle, timestamp, body and the counters → **m2-a13 pass**.

### 3.6 m2-a22 / m2-a23 — **FAIL** (defect d-01)
- `web-feed-probe1.mjs`: 6 scroll-to-end cycles on each tab leave the list at exactly 20 items; `scrollHeight` stays 1940 px against a 650 px viewport, i.e. the scroller is at the end.
- `web-feed-probe6.mjs`: 15 aggressive wheel + scroll cycles on Global still render exactly 20 items, probe indices **22 down to 3**; probes 0–2 and the oldest starter post are never reachable.
- `web-feed-probe3.mjs` / `probe-feed-loadmore.mjs`: the single `Load more` control in the DOM belongs to the Chats list (clicking it issues `op=groups.list`), not the feed; the feed's `hasMore` is false.
- `probe-author-page.mjs`: `/profile/alice` renders 20 of Alice's **216** posts with no control at all.
- `probe-feed-confirm.mjs`: reproduced for two further personas in fresh browser contexts — Alice and Carol each have **238** Following entries over 12 API pages server-side, and each web client renders exactly **20** after six scroll-to-end cycles.
- Contrast that isolates the fault to the client: `probe1.mjs` pages the same `feeds.globalFeed` to 263 unique entries over 14 API pages, and `probe-history-page.mjs` shows chat history paging *works* (10 → 18 of 18 via "Older messages").

`src/Posts.tsx:21` builds the feed from `usePage(...)`; `hasMore` is false after the first
page for every `feeds.*` query while `messages.thread` pages normally. The M2 green
receipt (`evidence/suite-m2.json`, 13:49 UTC) predates the M8-era edits to
`src/Posts.tsx`, `snapback/feeds.q` and `snapback/schema.q` (16:15–16:17 UTC); I record
the observable on the delivered app without asserting a cause for the change.

### 3.7 m3-a10 / m3-a11 — `web-quote-probe.mjs` — **pass**
With an explicit settle wait: original settles at 9588 ms, reply at 13787 ms, and the
reply bubble then reads `Reply / <original> / <reply> / … / ✓`. The quoted excerpt
renders (**m3-a10 pass**) and clicking `sm-convo-quote-preview` brings the original fully
into the viewport (**m3-a11 pass**). The builder suite's failure here is a consequence of
the send latency in §3.16, not of the quoting feature.

### 3.8 Membership cutoff — `probe-trust.mjs`
A grader-created group: Carol reads pre-removal history; after `memberRemove` commits,
her `messages.thread` on the same conversation returns `state=denied` and she never sees
the post-removal message. Corroborates **m3-a12 / m3-a13** alongside the choreography receipt.

### 3.9 m3-a15 seed idempotence — `probe2.mjs` — **pass**
After a second full run of the m1/m2/m3 seeds: 194 distinct posts in the global feed,
202 feed entries, and **no** starter body resolves to more than one post id
("The tomatoes are showing off." → 1, "Basil has officially taken over." → 1, etc.; the
apparent duplicates are the four seeded reposts, which are second *entries* on the same
post). `posts.byKey('sp0019')` returns the pre-existing row id. Zero duplicates.

### 3.10 m4-a10 / m4-a12 — `probe-m4.mjs` — **pass**
- Edit inside the 60 s window commits. Edit at **t+65 s** → `rejected EDIT_WINDOW_CLOSED`, and the stored body is still the in-window text. Server-side, not UI absence. **m4-a10 pass.**
- Media message: recipient fetches 2110 bytes; after delete-for-everyone the recipient's `assetBlob` fails with *asset is unavailable*, an unauthenticated GET of the same URL returns **HTTP 404**, and the recipient row shows `tombstone: true`, `photo: null`. **m4-a12 pass.**

### 3.11 m5-a01 / m5-a06 — `probe-m5.mjs` — **pass**
- View-once: first recipient fetch 2104 bytes; second fetch refused (*asset … was already delivered*); unauthenticated GET → HTTP 404. **m5-a06 pass.**
- Disappearing DM set to "24h" → 180 s TTL confirmed on the returned row. Both clients closed, 200 s elapsed: `messages.byKey` returns `null`, the thread omits the message, and in-chat search does not find it. **m5-a01 pass** (and the server-side half of m5-a03).

### 3.12 m5-a02 / m5-a03 — `probe-m5-web.mjs`, `probe-m5-web2.mjs`, `probe-offline-search.mjs` — **pass**
- Connected client: message purged from the UI at **180 232 ms** against a 180 000 ms TTL — within tolerance.
- Disconnected client: still rendered locally through 200 s offline, then purged **2 050 ms** after reconnect. **m5-a02 pass** on both halves.
- Warm-offline search control: with the transport cut, "coffee" returns **3** results and the page shows the seeded "Coffee after work?"; the expired term returns **0**. **m5-a03 pass** with a valid positive control (which also reproduces m5-a12's observable independently).

### 3.13 m6-a08 / m6-a09 — `probe-m6-push.mjs` — **pass**
With Bob's clients closed, Alice sends a 138-char message: the provider log records
`targetUserId` = Bob's principal, `chatId` = the DM, `senderDisplayName` = "Alice Alvarez",
`preview` = the first exactly-80 characters. A view-once send logs `preview: "Photo"`.

### 3.14 m6-a10 / m6-a11 — `grading/run/clean-demo/` — **pass**
`scripts/custom-client-demo.mjs` run from an independent directory containing only
`API.md`, `scripts/`, `package.json` and the public package: `pass: true`, operations
`[authenticate, conversations, history, history-next, send, receive-poll]`, all 12
documented message fields present. Also run in the documented `CLIQUE_URL/EMAIL/PASSWORD`
form from the lane root: exit 0.

### 3.15 m6-a12 grader-written variation — `m6a12-grader-variation.mjs` — **pass**
Written from `API.md` alone, no lane source read for it. It authenticated, walked
`conversations()` pages looking for the title `"Weekend Plans"`, called
`history(chat.conversation.id)` and read `data[0]`. First try, no corrections: newest
message returned with all 12 fields, `receiptState: "read"`, and `data[0].serverTimestamp
>= data[1].serverTimestamp` confirming the documented newest-first ordering. The
documentation was sufficient.

### 3.16 Web-client write latency — `probe-send-breakdown.mjs`, `lat-probe.mjs` (defect d-02)
Best-of-3, load average **13.25** recorded at the measurement:

| send | click → visible to a second client | click → sender leaves "Pending" |
|---|---|---|
| 0 | 5 833 ms | 7 435 ms |
| 1 | 6 754 ms | 9 430 ms |
| 2 | 5 299 ms | 8 775 ms |

The same `messages.send` mutation from the Node client on the same backend commits in
**52, 51, 27, 27, 23 ms**, and `messages.thread` answers in 6–9 ms. The delay is in the
web client's path to the server, not in server work or in UI reconciliation. For scale,
the builder-run choreography receipt recorded 1 488–2 323 ms for the equivalent live path
at a smaller corpus.

### 3.17 M8 digest assertions — grader-verified from the provider log
The clean-instance run of `digest-proof.ts` produced, for period `1789062000000`:

| target | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
|---|---|---|---|---|
| followed-poster's follower | 0 | 1 | 1 | 1 |
| the followed poster | 1 | 0 | 0 | 0 |
| the hidden DM's recipient | 0 | 0 | 1 | 1 |
| the hidden DM's sender | *no digest* | | | |
| the idle persona | *no digest* | | | |

- **m8-a08 pass** — exactly one payload per active user with the counts above; the first payload matched the suite's `deepEqual` exactly.
- **m8-a09 pass** — the idle persona received nothing.
- **m8-a11 pass** — the owner process was SIGTERMed and restarted mid-period and no user received two digests for any period.
- **m8-a12 pass** — activity in the chat the first user is not a member of contributed nothing to that user's counts (`unreadMessages` 1, from the DM she *is* in).
- **m8-a10 pass** — `digest-quiet.mjs` advanced the clock one further period: **0** digests emitted for period `1789062120000`.

The suite nevertheless reported failure because `digest-proof.ts:19` reads the log
immediately after the first payload arrives; the payload it wanted was appended **17 ms**
later. Defect **d-06**, not an application defect.

### 3.18 Trust-boundary observations (reported as defect material, not as O3 probes)
`probe-trust.mjs` and `probe-asset.mjs`, with a persona outside the target conversations.
Every one correctly denied server-side:

| probe | outcome |
|---|---|
| outsider `messages.thread` / `api.history` / `groups.details` / `searchChat` on a private DM | `denied` |
| outsider `messages.byKey` on a private message | `null` |
| outsider `messages.receipt` / `messages.reactions` on a foreign message | `denied` |
| outsider `messages.send` into a private DM | `rejected NOT_MEMBER` |
| outsider react / edit / unsend of a foreign message | `rejected MESSAGE_REQUIRED` |
| outsider `groups.configure`, outsider self-add to a group | `rejected CHAT_REQUIRED` / `GROUP_REQUIRED` |
| unauthenticated GET of a leaked private asset URL | HTTP 404 |
| outsider `assetBlob` on the leaked URL, and raw GET with the outsider's own auth header | *asset is unavailable* / HTTP 404 |
| non-author `insights.expireTrending` on a foreign Trending row | `rejected E_OPERATOR_REQUIRED`, row still ranked |
| removed member reading post-removal messages | `denied` |

The only schema-level looseness found is `trending`'s `update <- exists profiles[viewer]`
rule, which no exposed mutation can reach today (defect **d-08**, cosmetic).

---

## 4. M8 assertion results (recorded here because the report schema cannot key them)

`grader-report.schema.json`'s `assertionResults` admits only `^m[1-7]-a[0-9]{2}$` with
`additionalProperties: false`, so M8 cannot be keyed in the machine record even though it
is in this run's scope and was graded. Results, all counted in O1's denominator:

| id | result | how |
|---|---|---|
| m8-a01 | pass | API, matched an independently paged oracle on all six totals |
| m8-a02 | pass | `evidence/choreo-m8.jsonl` `m8-a02-insights-like-refresh` (5 → 6 likes, refresh 513.9 ms) |
| m8-a03 | pass | API, today's bucket carries today's post, 7 consecutive UTC days |
| m8-a04 | pass | API, empty days render as 0 and are not omitted |
| m8-a05 | pass | `rank-proof.mjs` on a clean instance: most-liked ranks first |
| m8-a06 | pass | same: after +24 h the heavily-liked originals are retired and absent |
| m8-a07 | pass | same: a 3–3 tie ranks newest first |
| m8-a08 | pass | §3.17 |
| m8-a09 | pass | §3.17 |
| m8-a10 | pass | §3.17 |
| m8-a11 | pass | §3.17, across a real mid-period owner restart |
| m8-a12 | pass | §3.17 |
| m8-a13 | pass | `evidence/choreo-m8.jsonl` `m8-a13-same-account-message-live` (visible 1 782 ms) |
| m8-a14 | pass | `m8-a14-cross-device-read-state` (cleared 1 090 ms) |
| m8-a15 | pass | `m8-a15-dual-offline-convergence` (flushes 2 103 / 2 226 ms, server-arrival order, no loss) |
| m8-a16 | pass | `m8-a16-dual-offline-receipts` |
| m8-a17 | **fail** | `artifacts/m8-native/m8-ios-run.json` `pass:false` after 5 attempts — durable queue across restart unproven |
| m8-a18 | **fail** | same receipt — ordered flush to `read` after the offline restart unproven |

**16 / 18.**

---

## 5. O5 inputs (band-mapped, never interpolated)

From the lane's replay record and receipts, not from perceived speed:

- **Invariant manifest conforms.** `evidence/scale-replay-receipt.json` carries `actionLog.sha256 = sha256:b26bf1ae…`, matching `instrument/fixtures/invariant-manifest-combined.json` for `scale.log`; `settledPrefix` 167 157 equals the manifest's `actionCount`; all **18** `expectedState` per-entity counts equal the manifest's `perEntityCounts` (users 1008, posts 50228, messages 100015, conversations 1002, memberships 2054, …); both checkpoints (24 777 and 88 057) line up with the manifest's checkpoint line numbers; named-fixture verification recorded as passed. A verifier correction is disclosed with `attribution: agent-error` and its pre-fix evidence retained.
- **Cap not exhausted.** `derived.wallSeconds` 1 042.25 of `capSeconds` 14 400 = **7.24 %**, `capExhausted: false`.
- **Degradation ratios pass**, comfortably: page50 4.74 ms vs page1 5.16 ms; following500 12.39 ms vs following5 5.09 ms; celebrity write 8.49 ms vs 5-follower write 8.50 ms; celebrity read 5.04 ms; globalSearch 2.98 ms, insights 3.35 ms, trending 3.40 ms at full corpus, each within 3× its 10 % checkpoint with the 50 % checkpoint on or below the line (`within3x: true`, `midCurve: true`).
- **A probe times out with unbounded memory growth.** `evidence/scale-cold-browser.json`: `pass:false`, `completedMeasured: 0` of k=20, `p95Ms: null`, `error: "Cold sync exceeded 30-second total timeout"`, heap sawtoothing from 31 MB to ~364 MB across the window. `run-record.json` `scalePerformance.pass:false`, `failedPaths: ["cold-browser-sync","group-send-render"]`.

First-match in the frozen order 0, 30, 60, 90, 75: band 0 does not fire, **band 30 fires**
on the failed cold-start rule and on "no probe may time out, error, or OOM". No later
branch is reached. **O5 = 30.**

---

## 6. Restoration and cleanup

Restored to the builder's state at the end of the session:
`coverage-manifest.json`, `suite-status.json`, `evidence/coverage-m4|m5|m6|m8.json`, and
`test-instance/.snapback` (moved aside during §2.6 and moved back). One honest caveat on
that last one: the directory I set aside was the builder's state **plus** the writes my
second m8 suite attempt had already made against it before I set it aside (four signup
accounts, the ranking-proof posts and likes, and its clock advance) — `store.sqlite` grew
from 5 005 312 to 5 529 600 bytes. That is the state now in place; nothing of the
builder's was deleted, and the clean instance I ran the third attempt against was mine
and is gone.
Left in place as new grader-produced artifacts: `evidence/suite-m*-<ts>.json` receipts
from my runs, `evidence/seed-m*.json` (regenerated by the documented seed step, not
backed up beforehand — disclosed), new `evidence/seed-m*-<ts>.jsonl` replay logs, new
rows in `evidence/push-provider.jsonl`, and progress lines appended to `run-log.md` by
`digest-proof.ts` (defect d-09; that file was never read). Application data written by
the suites and probes remains in the lane database, as the lane's own README says those
writes are expected to share it.

Every process I started was killed by PID from `grading/run/pids.txt`, plus two
descendants they spawned: the Expo child (37100, child of 37074) and the backend the M8
digest proof re-spawned on 50106 (70900, verified by its `--project` path to be this
lane's `test-instance`). Ports 50100–50119 are confirmed empty afterwards, and the other
lanes' listeners (49100, 49101, 50400, 50700, 51000) are confirmed still running. No
`pkill`, `killall`, or signal to any process I did not start.

---

## 7. Why O3 records null

`applicability.json` makes O3 applicable for this run (M6 green with M1–M5 attempted).
But O3's own rule is that it is *"Scored from the wave's secret rotated holdout probes
only"*, and deviation 1 records that no probe set was committed for this wave. There is
therefore no admissible input, and scoring O3 from checks I improvised would breach the
frozen rule as surely as inventing probes would. O3 is `null`; the trust-boundary
evidence I gathered is reported instead in §3.18 and folded into O2's justification.
Per `applicability.json`'s `nullDimensionRule`, a run with a null dimension publishes
per-dimension scores only — no weighted total. I compute no total, no efficiency
statistic, and no cross-lane comparison.

---

## 8. Summary of scored outcome

| dimension | score | one-line basis |
|---|---|---|
| O1 Functional completeness | **66** | 99 / 119 assertions pass; M1–M5 solid and M6/M8 complete on the web layer, but every native platform proof fails, M7 was never attempted, and feed pagination is broken |
| O2 Correctness under grading | **45** | two major happy-path defects (feed cap, 5–9 s web send) plus the cold-start timeout, against exact data correctness and 15 of 15 trust boundaries holding |
| O3 Trust boundaries | **null** | no holdout probe set committed for this wave (§7) |
| O4 Observed offline behavior | **55** | ordered offline flush, dual-device convergence, receipts and warm-offline search all demonstrated and receipt-backed; the entire native cold-start/durable-restart proof is absent, and honestly disclosed |
| O5 Performance at the envelope | **band 30** | invariants conform and 7.24 % of cap used, but the cold-start sync probe times out with unbounded heap growth |

Defects: 3 major, 4 minor, 2 cosmetic — enumerated with evidence pointers in
`grading/grader-report.json`.
