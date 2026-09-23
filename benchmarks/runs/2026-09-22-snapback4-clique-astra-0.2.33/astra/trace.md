# Sanitized evidence and action trace — lane `astra-snapback4`

Grader: `claude` / `claude-opus-5`, fresh session, no builder context.
Wave `full-3models-astra`. Instrument commit `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`,
assertion manifest `0.3.0-m8`, sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
Machine: macOS arm64, Node 24.18.0. Session ran 2026-09-22 21:02–21:52 local.

**Redaction posture (LLP 0197).** Fixture passwords are never reproduced here. Where a
credential was used it is written as `<fixture-password>`. Raw session transcripts are not
published; this file is the published artifact. Handles, display names and message bodies
shown below are fixture or grader-authored content only — no incidental personal data was
encountered. Bearer tokens, service tokens and session ids are redacted throughout.

**Reading guide.** Anchors used as evidence pointers from `grader-report.json` and
`m8-assertion-results.json` are the `##`/`###` headings below (`trace.md#m2-api`, etc.).

---

## 0. Scope, deviations, and what was deliberately not read

### Complete grade and comparable subtotal

All **119** frozen assertions were graded in this one independent session: M1–M8, including
M7's pre-evolution not-run/conditional results and the 18 M8 results.

The frozen `grader-report.schema.json` constrains `assertionResults` keys with the pattern
`^m[1-7]-a[0-9]{2}$`, so it structurally cannot carry an M8 id. `grader-report.json`
therefore holds exactly the 101 M1–M7 ids and stays schema-valid; the 18 M8 results are
written with identical record shape and enum values to
`grading/m8-assertion-results.json`. The two files partition the 119 ids exactly, with no
id in both (verified mechanically — see §9).

**Prior measurement-coverage gap, recorded as instructed.** The actual September 5 and
September 12 structured `assertionResults` carried only the 101 ids listed in
`GRADER_ASSERTIONS_101.txt`. Those runs' notes could describe M8 observations in prose, but
they did not provide a machine-comparable 18-id M8 result set. This session is the first to
produce one. Consequently:

| Set | Count | pass | not-run |
|---|---|---|---|
| Prior-101 subtotal (`grader-report.json`, comparable with Sep 5 / Sep 12) | 101 | 85 | 16 |
| M8 results (`m8-assertion-results.json`, new) | 18 | 16 | 2 |
| **Complete 119 total** | **119** | **101** | **18** |

### Recorded deviations from the frozen protocol

This run is N=1 calibration, not a claim-eligible wave.

1. **No holdout probe set was committed for this wave.** Execution-order phase 4 was
   skipped entirely. `wave.probeSetSha256` is the literal string `none-uncommitted`,
   `probeResults` is `[]`, and no probe was invented. The consequence for O3 is in §8.
2. **The grading family has not passed the calibration gate** (`grader/calibration.md`).
   `grader.calibrationPassed = false`, `grader.sameFamilyGraded = false` (the builder is
   not a Claude lane, so this is a cross-family grade, just an uncalibrated one). The
   record labels this grade `uncalibrated-grader`.
3. **Timing-sensitive checks are judged best-of-3**, with `uptime` recorded beside each
   timing measurement because this machine is shared. Observed 1-minute load averages
   during grading ranged **13.6 – 65.1**; each timing section below states the load at the
   moment of measurement.

### Not read

`diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and `run-log.md` were never opened.
`README.md` and `API.md` were read as run instructions, as the frozen prompt requires; both
contain pointers to the excluded files, which were not followed. No other lane under
`lanes/` was listed or read. **The session is not contaminated** (`grader.contaminated = false`).

### No run record

`lanes/astra-snapback4/run-record.json` does not exist — the lane wrote no run record. This
grade is therefore derived from the lane's coverage manifests, suite receipts, choreography
receipts and scale evidence under `evidence/`, plus the grader's own re-execution. In
particular there is no `performanceProbes.o5Inputs` block, so O5's inputs were read directly
from the scale evidence files and re-verified independently (§8, O5).

---

## 1. Environment the grader stood up

Ports were confined to the assigned range 49360–49379. Every PID below was started by the
grader and only those were killed at the end; no `pkill`/`killall`/pattern kill was used.

| Port | What | PIDs | Log |
|---|---|---|---|
| 49360 | lane backend, `snapback4 dev` (documented entrypoint) | 53624 → 53628 | `grading/raw/grader-backend.log` |
| 49361 | lane web client, `expo start --web` | 57186 | `grading/raw/grader-web.log` |
| 49362 | delivered **retained scale instance**, `snapback4 dev --replay --no-watch` (read-only use) | 65821 → 65825 | `grading/raw/grader-scale-server.log` |
| 49364 | grader-only isolated digest instance (own store under `/tmp`) | 80833 → 80848, then restarts | `/tmp/grader-digest/server.log` |
| 49365 | grader-only isolated digest instance #2 (real-time restart test) | 24735 → 24736 | `/tmp/grader-digest2/server.log` |
| 49366 | grader-only ephemeral `--fresh --replay` instance for the Trending clock probe | short-lived | — |
| — | grader-owned push worker (lane backend) | 63837 | `grading/raw/grader-push-worker.log` |
| — | grader-owned push worker (digest instance #2) | 6888 | `/tmp/grader-digest2/worker.log` |

The lane's own m8 acceptance test additionally spawns and kills a transient backend on
**49363** — also inside the assigned range.

Preflight: `snapback4 check` on the lane's schema reports `ok — 26 tables (16 synced), 46
operations, no problems, 4 notes`. The active window configuration is the fixture pack's
**shortened** profile: `snapback/config.q` compiles `editWindow 60000`, `deleteWindow
120000`, disappearing `24h → 180000` / `7d → 300000`, and `snapback/digest-config.q`
compiles a 120 s digest period anchored at 00:00 UTC. `config/windows.shortened.json` and
`config/digest.shortened.json` in the lane are **byte-identical** to
`instrument/fixtures/config/`.

A copy of `.snapback4/store.sqlite` was taken before any grading write
(`grading/raw/store.sqlite.pre-grading.bak`). Nothing under `instrument/` was modified.

---

## 2. Phase 1 — the builder suite

Invocation is the lane's documented entrypoint, unchanged, once per milestone:
`npm run acceptance -- --milestone mN`. Load at start: `21:05 … load averages: 25.54 21.72 23.56`.

| Milestone | Result | Tests |
|---|---|---|
| m1 | pass | 7/7 |
| m2 | pass | 12/12 |
| m3 | pass | 8/8 |
| m4 | pass | 7/7 |
| m5 | pass | 8/8 |
| m6 | **fail → pass on re-run** | 6/6 after the re-run |
| m8 | pass | 6/6 |

**The one M6 failure was the grader's environment, not the lane.** `closed recipient push
payload and once preview` failed because the grader had not started the lane's documented
logged push seam (`README.md` → "Notifications, API, and replay": `node
scripts/start-push.mjs` mints a store-scoped service token and starts the provider seam
that writes `evidence/push.jsonl`). With the seam running the test passed. Per the
grader-abort protocol this consumed the one permitted phase re-run
(`grader.rerunsUsed = 1`); **no defect was filed against the lane for it**.

No milestone-7 suite exists: `ENVIRONMENT.md` directs the lane not to attempt M7.

### Grader side effects on the lane artifact (disclosed)

Re-running the suites rewrote `evidence/mN-suite.json` (the acceptance runner's mutable
"latest" alias), rewrote `evidence/sample-receipts.jsonl` / `evidence/sample-result.json`
(the m6 test re-runs the 50-action replay), added timestamped suite snapshots
`evidence/mN-suite-1790136*.json`, and appended to `evidence/push.jsonl`. The grader's
probes also wrote content into the dev store. **The delivered retained scale store was read
but never written to.** This has one evidence consequence, recorded as defect d-02 in §7.

---

## 3. Phase 2 — coverage-manifest spot-verification

**Verdict: honest.** No milestone adjudicated to `capability-failure`.

Completeness first, mechanically: every suite-required assertion of each attempted milestone
appears in that milestone's coverage manifest with `missing: []` —
M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5, M8 6/6 (**58 of 58**). M7 has no manifest
because M7 was never attempted.

Honesty second: for **26 sampled ids** the grader read the mapped test's source in
`scripts/acceptance.mjs` and `scripts/test-m{2,3,4,5,6,8}.mjs`, then re-executed the same
observable independently (§4–§6). Sampled:
`m1-a01, m1-a03, m1-a10, m1-a11, m2-a06, m2-a08, m2-a12, m2-a13, m2-a22, m2-a24, m2-a25,
m2-a26, m2-a27, m3-a03, m3-a05, m3-a11, m3-a15, m4-a06, m4-a09, m5-a05, m5-a11, m6-a09,
m6-a11, m6-a13, m8-a01, m8-a07`.

Every sampled mapping exercises the assertion it claims, and every independent result agreed
with the suite's. No mapping was a no-op, a tautology, or an assertion on a different
observable. Examples of mappings that are substantively more than the minimum: `m8-a05/a06/a07`
spins up an isolated `--fresh --replay` backend and advances its dev clock 25 h to age a
heavily-liked post out of the 24 h window before asserting rank order; `m6-a13` validates the
frozen sample log with the fixture pack's own validator, replays it, and then spot-checks the
resulting state against the log's named entities; `m8-a01` recomputes all six totals from
independent fully-paged queries before looking at the screen.

Two mappings are **honest but thin**, reported for the record, not as dishonesty:

- `m3-a15` (seed idempotency) maps to a test whose only observable is deep-equality of
  **Alice's `chat.inbox`** before and after a double re-seed — narrower than "no duplicates"
  across the corpus. The grader widened it (§5, m3-a15) to a corpus-wide census and it still
  passed identically.
- `m2-a12` maps to a test asserting that an element with `role=link` exists, but not that
  tapping it opens the system browser. The grader verified the tap behaviour separately
  (§4, m2-a12).

**Digest-binding caveat.** The final choreography segment summaries hash-bind
`suite.receiptSha256` over `evidence/mN-suite.json`. For m2/m3/m4/m6 those are the mutable
alias files, which the grader's phase-1 re-run overwrote, so their byte-level bindings can no
longer be re-checked — a grader side effect, disclosed, not a lane finding. What *can* still
be checked: the m1 binding (`sha256:8f18d5…`) and the m5 binding (`sha256:5665b4…`) both
resolve and verify against `evidence/suite-archive/`, and m8's binding (`sha256:6ace65…`)
verifies against its immutable timestamped snapshot `evidence/m8-suite-1790135333915.json`.
The substance is independently confirmed regardless: the grader re-ran all seven suites and
every test passed with the same coverage. The underlying design weakness this exposes —
binding to a mutable filename — is defect d-02, and its pre-existing evidence (an m2 receipt
the lane itself could not recover) predates anything the grader did.

---

## 4. Phase 3 — independent execution, M1 and M2

### m1-api

Fresh signup with a ≥8-char grader password → `ok:true`; a 6-char password → refused
`E_AUTH` (**m1-a01**). The issued session answered `api.me` immediately (**m1-a02**).
Duplicate handle `alice` → `saveProfile` failed `HANDLE_TAKEN` (**m1-a03**); signup with
`alice@example.com` → `E_AUTH` "that email already has an account; sign in instead"
(**m1-a04**).

**m1-a07** (grader, full-only): a second client constructed with the *same bearer* answered
`api.me` before `signOut()`, and after `signOut()` was refused
`{"denied":{"code":"E_AUTH","family":"auth","message":"sign in to continue"}}`. Revocation
is server-side, not a local token drop.

### m1-web

Screenshots: `grading/raw/m1-a03-duplicate-handle-error.png`,
`m1-a04-duplicate-email-error.png`, `m1-a10-a11-avatar-profile.png`.

- **m1-a03**: `sm-profile-error` renders `Error: HANDLE_TAKEN: That handle is taken.` — a
  visible error, not a silent no-op.
- **m1-a04**: the client stays on the auth screen and shows
  `Error: E_AUTH: that email already has an account; sign in instead`.
- **m1-a10 / m1-a11**: fixture avatar uploaded through the real file chooser; the profile
  image node then exposes a resolved `blob:http://…` `data-source-uri`, i.e. actual bytes
  render rather than a placeholder.

### m1-a08

`saveProfile` with a new display name and bio, then a **new client** (no local cache) read
them back unchanged, and `/profile/{handle}` renders both.
Screenshot `grading/raw/m1-a08-profile-edit.png`.

### m1-source

- **m1-a12**: `snapback/schema.q` line 1 is `use identity password` — the backend's
  documented built-in auth path. `node_modules/snapback4/CLIENT-AND-OPERATIONS.md` documents
  that path as Argon2-based ("concurrent Argon2 work is bounded by the host … `dev` allows as
  many concurrent Argon2 slots as the host's available cores, capped at 16"), and the running
  server prints its Argon2 slot count at startup. The lane hand-rolls no KDF and implements
  no password storage of its own.
- **m1-a13**: no fixture password string occurs in `.snapback4/store.sqlite` or its WAL, in
  any file under `evidence/`, in `src/`, `app/`, `ui/src/` or `snapback/`, or in **any of the
  seven exported iOS Hermes bundles** (`artifacts/m*-ios/**/*.hbc`, 0 hits each).
  `src/client.ts` hands the password straight to the SDK `login`/`signup` call and persists
  only the returned session (`localStorageSessionStore()` on web, `expo-secure-store` on
  native). Fixture credentials appear only in test and harness scripts — the declared
  test-fixture exception.

### m2-api

All via the custom-client API against port 49360.

| id | observed |
|---|---|
| m2-a01 | text post round-trips its exact body through `postThread` |
| m2-a02 | two distinct fixture images stored as `image1` + `image2`; both fetch as authorized assets from the recipient |
| m2-a03 | video post stored with `duration 5000` ms |
| m2-a06 | after follow, the author's post is in the follower's Following feed |
| m2-a08 | after unfollow, neither that post nor an older one remains in Following |
| m2-a09 | the same post is still in Global — projection-scoped, not revocation |
| m2-a10 / m2-a11 | a non-followed author's post is in Global and absent from Following |
| m2-a15 | `like(set:true)` twice → count stays 1; `like(set:false)` → 0 (idempotent set-state) |
| m2-a16 | repost carries `actorProfile.handle = "bob"` — identity, not a string |
| m2-a17 | `repost(set:false)` removes it (toggle) |
| m2-a18 | a followed user's repost surfaces the original author's post in the follower's Following feed |
| m2-a20 / m2-a21 | thread shows parent + direct replies in creation order; the reply is in neither feed |
| m2-a25 / m2-a26 | own post and own repost are in own Following feed with no follow edge |
| m2-a27 | follower/following counts unchanged (3/1 → 3/1); an explicit self-follow mutation is refused `SELF_FOLLOW`, so no hidden edge exists |
| m2-a22 / m2-a23 | Following and Global: page 1 exactly 20 with a cursor, page 2 another 20 |
| m2-a24 | 4 pages × 20 = 80 items per tab, 80 distinct ids, timestamps monotonically non-increasing |

Stronger completeness check for **m2-a24**: 25 freshly created posts were each found
**exactly once** across 12 Global pages — no duplicates and no gaps.

### m2-web

Screenshots: `m2-a12-a13-link-no-preview.png`, `m2-a12-link-tap.png`,
`m2-a16-repost-attribution.png`.

- **m2-a12**: the URL is auto-detected and rendered as tappable text carrying `role="link"`
  (`sm-text-link`). It has no `href` — this is the React Native Web idiom — so the grader
  instrumented `window.open` and clicked: `window.open` was called with **the exact URL**.
  `ui/src/linkify.tsx` + `src/Posts.tsx` confirm the handler is `Linking.openURL`. The link is
  handed to the system browser rather than navigated in-app.
- **m2-a13**: `sm-feed-media` count is 0 on the thread screen — no unfurl card.
- **m2-a22 / m2-a23**: in-browser, each tab renders exactly 20 `sm-feed-item` rows and the
  `Load more` control grows the list to 60.
- **m2-a16** (UI half): the feed renders `sm-feed-repost-attribution` reading
  `↻ Reposted by Bob Bennett`.

---

## 5. Phase 3 — M3, M4, M5

### m3-api

`chat.dm` returned the **identical** channel id for A→B, B→A and a repeat call (**m3-a03**).
A group with three members has roster 3 (**m3-a04**); a second group with the same name and
same three members gets a distinct id (**m3-a05**). A non-admin's `chat.remove` is refused
`ADMIN_REQUIRED` (**m3-a14**).

**m3-a15**, widened beyond the mapped test: the grader took a corpus-wide census — chat
count, fully paged corpus post count, per-chat message count for **every** chat in the
inbox, and follower/following counts — re-ran all three installed starter segments, and
re-censused. Before and after are byte-identical: `{"chats":17,"posts":245,"hist":…,
"followers":…,"following":…}`. Idempotent per installed segment.

### m3-web

Screenshot `m3-a10-a11-quote-jump.png`. The reply bubble renders `sm-convo-quote-preview`
containing the quoted original's text (**m3-a10**); clicking it brings `#message-<id>` into
view (**m3-a11**).

### m4-api

Photo and video messages send and are queryable with their media references (**m4-a01**,
**m4-a03**). Reactions: 👍 → ❤️ leaves `ownReaction = ❤️` with exactly **one** distinct
reaction (**m4-a06**); re-tapping ❤️ clears it to `ownReaction = null`, 0 reactions
(**m4-a07**). An edit sets `edited: true` and the new body on the recipient's query.

### m4-web

Screenshot `m4-a09-edited-label.png` — the edited bubble reads
`GRADER editlabel edited … edited 9:17:07 PM ✓ …`, i.e. an `edited` label (**m4-a09**).

### m4-window

**m4-a10** (grader, shortened windows). With `editWindow 60000` compiled into the schema, the
grader sent a message, waited **65 s**, and attempted an edit: refused server-side
`failed EDIT_WINDOW`, and the stored body was unchanged on the recipient's query. Enforcement
is on server `now` (`require now - m.at <= editWindow()` in `snapback/chat.q`), not on a
caller-supplied timestamp and not by hiding the affordance.

### m4-asset

**m4-a12** (grader). A first reading was a **grader instrumentation error**, corrected and
recorded here in full because it changes the verdict. `client.asset(id)` returns a
*client-local* `blob:nodedata:` object URL wrapping bytes already downloaded into the client
process (`node_modules/snapback4/dist/assets.js`: `URL.createObjectURL(blob)`); fetching that
handle after a delete still succeeds until `revoke()` because it is in-process memory. The
media URL is the server route `GET {base}/assets/{id}` with the viewer's auth headers.
Re-tested correctly:

```
pre-delete   GET /assets/{id}  (recipient bearer) -> 200
post-delete  GET /assets/{id}  (recipient bearer) -> 404 E_ASSET_UNKNOWN
post-delete  GET /assets/{id}  (author bearer)    -> 404
post-delete  client.asset(id)  (fresh client)     -> denied E_ASSET_UNKNOWN
```

After delete-for-everyone the server serves the asset to nobody. **m4-a12 passes.** The
recipient's query also reports `tombstone: true`.

### m5-expiry

**m5-a01** (grader, shortened windows). A DM was set to disappearing `24h` — 180 s under the
fixture config — a message was sent, and then **every client was closed for 195 s**, so no
client was connected at the expiry instant. On reconnect: the message is absent from
history; a server operation on its id is refused `failed MESSAGE_MISSING`; server-side
in-chat search for its body returns 0 rows. Expiry is declarative in the schema
(`expire at .expires` on `table messages`), so it needs no client present.

**m5-a02** (grader, web). Two browser clients rendered the ephemeral bubble
(`m5-a02-before-expiry.png`). The **connected** client purged it at the expiry instant with
no reload (`m5-a02-after-expiry-connected.png`); a second client that was closed across the
whole TTL and **relaunched** afterwards rendered **0** copies
(`m5-a02-relaunch-client.png`).

**m5-a03** (grader, web). With the browser context set offline — the app showed its
`sm-search-offline` "searching this device" banner, so the query really was device-held —
the expired body returned **0** hits while a still-live body **in the same chat** returned
**1**. The index was genuinely queried, not merely empty.
Screenshot `m5-a03-offline-search.png`. This same observation independently reproduces the
warm-offline search of **m5-a12**.

### m5-once

```
first  GET /assets/{id} (recipient bearer) -> 200, 2080 bytes      (m5-a04)
second GET /assets/{id} (recipient bearer) -> 410 E_ASSET_VIEWED   (m5-a05, m5-a06)
SDK client.asset(id) after the view       -> denied E_ASSET_VIEWED
```

In the web client the first tap on `sm-convo-viewonce` opens the media viewer
(`m5-a04-viewonce-first-open.png`); the second tap shows no image and the bubble reads
`◌ Opened` (`m5-a05-viewonce-second-open.png`). **m5-a06** confirms the refusal is
server-side, not UI absence.

### m5-api

Non-admin rename → `failed ADMIN_REQUIRED` (**m5-a08**). `people('car')`, `people('CAR')` and
the surname word-prefix `people('Chen')` all return Carol — case-insensitive word-prefix
matching (**m5-a09**; UI confirmed under the People scope,
`m5-a09-people-search.png`). In-chat search `'cof'` returns the seeded
`"Coffee after work?"` (**m5-a10**). `searchAll('cof')` returns 3 hits across 2 chats, every
hit carrying its `conversation`, and the search screen renders them under **2** chat group
headings (**m5-a11**, `m5-a11-search-groups.png`).

---

## 6. Phase 3 — M6, M7, M8

### m6-push

The grader replaced the lane's push worker with its **own** worker writing to
`grading/raw/grader-push.jsonl`, so the payloads scored here were captured by grader-owned
code. With the recipient's clients closed, one long text and three media messages were sent:

- **m6-a08**: the text payload carries `targetUserId` = the recipient's principal, the
  correct `chatId`, `senderDisplayName` equal to the sender's profile display name, and
  `preview` exactly the **first 80 characters** of the body (measured length 80).
- **m6-a09**: the view-once photo's preview is exactly `"Photo"` — the caption
  (`GRADER once caption …`) is **not** leaked into the notification. Media previews in the
  window: `Photo ×2, Video ×1`.

### m6-demo

**Clean-room reconstruction for m6-a10 / m6-a11 / m6-a12.** A new directory outside the lane
(`/tmp/grader-custom-client`) with only `{"dependencies":{"snapback4":"0.2.33"}}`, a fresh
`npm install`, and the two files `API.md` says to copy (`snapback/generated/api.ts`,
`scripts/custom-client-demo.mjs`). No lane `node_modules`, no app code.

- **m6-a10**: `node custom-client-demo.mjs` runs green: `{"pass":true, …}`.
- **m6-a11**: the run exercises all six listed operations — `authenticate` (`login`), `list`
  (`chat.inbox`), `history`, `cursor`, `send` (mutation reaching `state:"sent"`), `poll`
  (history polled until the sent id is received). The grader forced a **real** second page
  (the default conversation had only 42 live messages, so no cursor existed) by topping the
  chat to 56 messages; the demo then reported `pages: 2`, so the cursor path is genuinely
  walked, not stubbed.
- **m6-a12** (grader-written variation, documentation quality is the bar): a new script
  written from **`API.md` alone**, following its documented recipe verbatim — "For a named
  group, page through inbox until `row.conversation.name === name` … Then call history with
  `row.chat`; `data[0]` is the latest message." It resolved `Weekend Plans` in one inbox page
  and returned the latest message with the full documented field manifest, **first attempt**,
  with no need to read lane source. Result (sanitized):

  ```json
  {"inboxPages":1,"conversation":{"name":"Weekend Plans","kind":"group"},
   "historyPageSize":18,
   "latest":{"ordinal":6,"edited":false,"tombstone":false,"receipt":"read","type":"text", …}}
  ```

  `API.md` is accurate and sufficient: field names, the `'data' in result` check, the
  `complete:false` warning, the cursor contract and the message field manifest all matched
  what the server actually returned.

### m6-replay

**m6-a13**: the fixture pack's own validator accepts the frozen log —
`valid sample-50.log: 50 actions, 0 markers, 13 verbs` — and the lane's adapter replays it
green on the dev instance. The emitted receipts are 50 lines, 13 distinct verbs, **every
action settled before the next started** (`receipts[i].started >= receipts[i-1].settled` for
all i), every action settled. The suite's post-replay state spot-checks (profile + avatar,
follow count, DM/group message counts, the quoted-reply link, reaction counts, 4-member
roster, a 4-image post) all pass.

### native

**No iOS-simulator artifact exists for M6 or M8.** Both segment summaries record it
explicitly:

```json
"supplementalExternal": [{"id":"ios-simulator-m6","pass":null,"receipt":null,
                          "status":"not-recorded",
                          "reason":"M6 simulator evidence is recorded separately from web green",
                          "requiredForGreen":false}]
```

— and the same for `ios-simulator-m8`. `evidence/native-artifacts.json` lists **only** Hermes
`.hbc` bundle exports (one per milestone, 2.78–2.84 MB, with digests). `choreography/simulator.md`
requires a bound uninterrupted recording **plus** schema-valid receipts **plus** a run
manifest, and states that "a recording without passing structured receipts is not a pass" and
that missing evidence "is never inferred from web behavior or silently reported as a native
pass". None of those artifacts exist.

`scripts/offline-proof.mjs` does exercise the same durable local-replica behaviour, and its
receipt `evidence/m8-offline-proof.json` reports `coldHistory`, `coldSearch`,
`normalMediaKept`, `onceMediaAbsent`, `durablePending`, `orderedFlush`, `noDuplicates`,
`read` all true. But it records its own runtime as
`"published Node processDevice (not iOS simulator)"`, and the frozen prompt is explicit that
simulator-class assertions are scored from harness recordings and receipts, **never from
builder assertions and never by the grader re-running the simulator**. So
`m6-a01 … m6-a07`, `m8-a17`, `m8-a18` are recorded **not-run** — nine assertions with no
admissible evidence.

The lane is **honest** about this, which matters for O4's second half: `README.md` states
"No simulator behavior is claimed by a bundle export alone", the proof script is labelled a
process-device test in both the README and the receipt, and the harness status is left at
`pass:null` rather than asserted.

### m7

M7 was never attempted. `ENVIRONMENT.md` directs the lane not to attempt it: "M7 is a
separate fresh session run later by the orchestrator after grading; do not attempt it."
There is no M7 coverage manifest, no M7 suite receipt, and no M7 choreography segment.
`m7-a01 … m7-a09` are recorded **not-run**, and under O1's applicability rule they score as
not passed in the denominator regardless — "the status distinction matters for attribution,
not for completeness credit".

`m7-a09` is `conditionalOn: previously-green-milestones`. M1–M6 and M8 **were** green before
M7 would have run, so the condition would have been live; it is recorded `not-run` (never
executed) rather than `not-applicable` (which the schema reserves for the case where no
milestone was previously green).

### m8-insights

Screenshot `m8-a01-insights.png`. `/insights` renders all six lifetime totals
(`sm-insights-total-posts`, `-likes-received`, `-reposts-received`, `-replies-received`,
`-followers`, `-following`): `88 Posts · 6 Likes received · 9 Reposts received ·
21 Replies received · 4 Followers · 2 Following`. Each was cross-checked against an
independent computation — followers/following against fully paged `followersList` /
`followingList` and `socialProfile`, and posts/likes/reposts/replies against the author's
fully paged post history — and all agreed (**m8-a01**).

`insights.summary` returns exactly **7** day buckets; the newest bucket's key equals
`floor(serverNow / 86400000)` = UTC day index **20719**, and a post created now increments
that bucket (**m8-a03**). The six inactive days render as numeric `0` for posts and likes
rather than being omitted, and the screen renders 7 `sm-insights-day-row` nodes (**m8-a04**):
`[{20713,0,0},{20714,0,0},{20715,0,0},{20716,0,0},{20717,0,0},{20718,0,0},{20719,90,6}]`.

### m8-trending

Reproduced independently on a grader-run isolated instance (port 49366,
`--fresh --replay`, in-memory store, so the lane's data was untouched):

- a post with 3 likes was created, the dev clock advanced **25 h**, then two posts were
  created a few ms apart and each given **1** like;
- **m8-a07**: with the like counts tied, Trending's head is the **newer** post;
- **m8-a06**: the 3-like post from before the 24 h cut is **absent** from Trending;
- **m8-a05**: once the older post reached **2** likes it took the head — most likes in the
  trailing 24 h ranks first.

The Trending tab is present on the pinned Feed screen (`sm-feed-tab-trending`).

### m8-digest

All five digest assertions were reproduced on **grader-owned isolated instances** compiled
from the lane's own shortened digest config (period 120 s, anchor 00:00 UTC), with a
grader-written worker capturing `notify` effects. The lane's dev store was not used.

**Period 1** (`/tmp/grader-digest`, port 49364). Seeded activity: bob follows alice; alice
creates 3 top-level posts; alice sends 3 DMs to bob; **carol and dave exchange 4 messages in
a group alice and bob are not members of**; erin registers and does nothing. All clients were
then closed and the period closed.

Emitted digests — exactly **one per active user**, and none for anyone else:

| user | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
|---|---|---|---|---|
| alice | 1 | 0 | 0 | 0 |
| bob | 0 | 3 | 3 | 1 |
| dave | 0 | 0 | 4 | 1 |

- **m8-a08**: every count matches the seeded activity exactly.
- **m8-a09**: erin, with no activity in the period, received **no** digest.
- **m8-a10**: the following period, with no new activity, emitted **0** digests.
- **m8-a12** (trust boundary): the 4 messages in the carol/dave group contributed **nothing**
  to bob (3/1 — only his own DMs) or alice (0/0), while dave, a member, counted 4/1.
  Structurally the job iterates `members[principal = p.principal]`, so a non-member chat is
  unreachable.

**m8-a11** (restart idempotence) was measured in **real time with no clock manipulation**, on
a fresh persistent instance (`/tmp/grader-digest2`, port 49365) — an earlier attempt that
combined a restart with `snapback4 clock advance` was discarded because the dev clock offset
does not survive a restart, which is a property of the grader's test method, not of the lane.
Corrected sequence: seed activity → **kill and restart the backend mid-period** → let the
real 120 s boundary pass → **3 users, 3 digests, 1 period, no user twice** → **restart the
backend again** and observe another scheduler tick → **0 re-emissions** for that period.
Idempotence is carried by the persisted `digestMarkers` unique key `(principal, periodEnd)`,
checked before emission, which survives process restart.

### Choreography artifacts (scored, not re-driven)

`[choreo]` assertions were scored from the lane's retained harness receipts. All 49 receipt
lines across the five operative files validate against the frozen
`choreography/receipts.schema.json` (`0 invalid`).

<a id="choreo-m1"></a>**M1** — `evidence/m1-choreography.jsonl`, green, 3/3 required:
`profile-edit-live-visibility` (**m1-a09**, best-of-3 **78.1 / 71.1 / 72.4 ms**, the other
client observing name + bio with no manual refresh), `session-persists-on-relaunch`
(**m1-a05**), `logout-remains-signed-out-on-relaunch` (**m1-a06**).

<a id="choreo-m2"></a>**M2** — `evidence/m2,m3,m4,m6-choreography-1790134899125.jsonl`, green,
9/9 required. `feed-text/image/video-post-live-update` (**m2-a04**; text
206.1/201.5/206.0, image 205.8/166.8/166.0, video 206.4/170.2/196.6 ms),
`feed-author-avatar-and-display-name` (**m2-a05**, "structural profile heading plus exact
feed-author avatar identity" — matched, not glyph-inferred), `follow-unfollow-live-projection`
(**m2-a07**, live projection at 1373.7 and 1166.2 ms; attempt 1 recorded no metric, so
`bestOf3Ms` is omitted rather than padded), `like-unlike-live-count` (**m2-a14**,
319.5/200.2/265.1 ms), `repost-toggle-live-attribution`, `repost-following-feed-surface`,
`reply-live-thread-projection` (**m2-a19**, 252.2/294.8/238.2 ms).

<a id="choreo-m3"></a>**M3** — `evidence/m3-choreography-1790135060295.jsonl`, green, 7/7:
`dm-live-messages` (**m3-a01**, 799/801/977.5 ms), `sender-avatar-identity-when-rendered`
(**m3-a02**, "exact sender identity on an app-rendered avatar node" — the app does mount
`sm-convo-sender-avatar`, so the harness's conditional-skip branch was not taken),
`typing-indicator-within-2s-expires-within-5s` (**m3-a06 / m3-a07**, see below),
`receipt-sent-delivered-read-transitions` (**m3-a08**, "exact semantic sent/delivered/read
tokens; no glyph matching"), `group-receipt-waits-for-slowest-member` (**m3-a09**, "group read
remains delivered until the slowest retained member reads"; corroborated in source —
`messages.recipients` is captured at send time and declared `immutable`, so the aggregate is
over membership-at-send), `member-add-promote-remove-leave-and-live-cutoff` (**m3-a12 /
m3-a13**; the cutoff is checked only after a later direct message reaches the removed member,
so it is a real delivery cutoff, and `table messages` declares `retain delivered-history` for
the removed member's local copy), `quoted-reply-excerpt-and-jump`.

<a id="choreo-m4"></a>**M4** — same combined file, green, 5/5: `photo-message-live-render`
(**m4-a02**, 968.0/1009.4/953.1 ms, rendered from a query result, not a placeholder),
`video-message-live-playback` (**m4-a04**), `reaction-live-replace-remove` (**m4-a05**,
902.0/970.7/913.3 ms), `edit-live-visibility` (**m4-a08**, 301.2/318.0/295.9 ms),
`delete-live-tombstone` (**m4-a11**).

<a id="choreo-m5"></a>**M5** — `evidence/m5-choreography-1790132900163.jsonl`, green:
`chat-color-background-sync` (**m5-a07**, admin's accent colour and background reaching Carol
in 193.2 ms), `warm-offline-search-over-synced-messages` (**m5-a12**, independently
reproduced by the grader in §5).

<a id="choreo-m8"></a>**M8** — `evidence/m8-choreography-1790135399042.jsonl`, green, 5/5:
`m8-a02-insights-like-refresh` (likes-received 5 → 6 in 431.6 ms),
`m8-a13-same-account-message-live` (608.2 ms), `m8-a14-cross-device-read-state`
(`sm-chats-unread` cleared on client 2 in 396.7 ms),
`m8-a15-dual-offline-convergence` (two warm-offline clients, flushes at 334.0 and 427.5 ms,
server-arrival order, no loss, no duplicates), `m8-a16-dual-offline-receipts`.

---

## 7. Phase 5 — defects beyond the checklist

No blocker. No major. Reported severity-bucketed with evidence pointers.

<a id="d-01"></a>### d-01 — minor (M3): the typing-expiry bound has ~1.7 s of margin and was missed 3/3 under load

In `evidence/m2,m3,m4,m6-choreography-1790134899125.jsonl` (03:42 UTC) the **required**
assertion `typing-indicator-within-2s-expires-within-5s` failed on all three retained
attempts, each with

```
locator.waitFor: Timeout ~4.93–4.96 s exceeded.
  - waiting for getByTestId('sm-convo-typing') to be hidden
  - 14 × locator resolved to visible <div data-testid="sm-convo-typing" aria-label="… is typing">
```

The harness classified `outcomeClass: "application"` and that run's M3 segment closed
non-green (`nonGreenCause: "choreography-failed"`).

Why it is a real margin problem and not just a flake: `mutation type` sets
`expires: now + 3000`, so the whole budget between the 3 s server TTL and the brief's 5 s
bound is **~2 s** for expiry sweep plus sync propagation to the peer. The retained green M3
receipt (a later solo re-run) clears at **3314 / 3329 / 3329 ms** and the grader's own
best-of-3 at 1-minute load **30.97** cleared at **2878 / 3374 / 3362 ms** — so the steady
state sits ~1.7 s inside the bound, and it was exhausted three times consecutively when the
machine was busier. The failure is load-sensitive, not random.

Scoring: under the frozen best-of-3 rule and the retained green receipt, **m3-a06 and m3-a07
score pass**. This defect records the margin, not a failed assertion.

<a id="d-02"></a>### d-02 — minor: green receipts are hash-bound to a mutable filename

The choreography segment summaries record `suite.receiptSha256` over
`evidence/mN-suite.json`, which `scripts/acceptance.mjs` overwrites on every later run. The
binding therefore does not pin an artifact, only a path.

This already cost the lane a receipt **during its own session**, before the grader touched
anything: `evidence/suite-archive/index.json` records the m2 entry
`sha256:472b90cf376d235dd4bbfeedf309b82504559e17f913fe65e52498790c3c2291` with
`"recovered": false` — a suite receipt a choreography run had bound, which could not be
recovered afterwards. The other archive entries are reconstructions matched by SHA-256 after
the fact (`"method": "Exact SHA-256 match; only historical epoch varied against unchanged
suite results"`), not the originally written files.

The lane fixed the pattern for **M8 only**: `evidence/m8-suite-1790135333915.json` is an
immutable timestamped snapshot and its digest still verifies exactly. M1–M6 still bind the
alias.

Grader disclosure, kept separate from the finding: the grader's phase-1 re-run overwrote the
m2/m3/m4/m6 alias files, so *their* bindings cannot now be re-checked by anyone. That is a
grader side effect. The finding above rests only on the lane's own `recovered:false` record
and on the binding design, both of which predate the grader.

<a id="d-03"></a>### d-03 — cosmetic: legacy `ordinal: 0` rows in the delivered dev store

```
lane dev store    : ordinal != 0 → 37 messages ; ordinal = 0 → 50 messages
retained scale store: ordinal != 0 → 100,015 messages ; ordinal = 0 → 0
```

`API.md` documents `ordinal` as the "server arrival sequence", so on the delivered dev store
it is not a total order — residue of the `messages.ordinal` column being added while the dev
server was live-adopting schema changes. Impact is negligible and the lane handled it
deliberately: `fn receipt` carries an explicit `m.ordinal = 0` timestamp branch, history
orders by `(chat, ordinal, id)` with ULID ids so the rendered order is still correct, and
`API.md` tells custom clients to deduplicate by message id. A fresh install is unaffected —
the scale instance, built by a clean replay, has no such rows.

### Beyond-the-checklist trust-boundary sweep — no defects found

Sixteen cross-principal probes, all correctly refused server-side with a specific code
(these are **diagnostics only**; see §8, O3, for why they are not an O3 input):

| probe | result |
|---|---|
| non-member `chat.history` | 0 rows |
| non-member `chat.roster` | 0 rows |
| non-member `chat.conversation` | `data: null` |
| non-member `chat.send` | `failed NOT_MEMBER` |
| non-member `chat.searchChat` | 0 rows |
| outsider `chat.searchAll` for the secret body | 0 rows |
| recipient edits the sender's message | `failed NOT_AUTHOR` |
| recipient delete-for-everyone on the sender's message | `failed NOT_AUTHOR` |
| non-member reacts | `failed MESSAGE_MISSING` |
| non-member `chat.mark` | `failed NOT_MEMBER` |
| non-member `GET /assets/{id}` | `404 E_ASSET_UNKNOWN` |
| unauthenticated `GET /assets/{id}` | `401` |
| taking another user's handle | `failed HANDLE_TAKEN` |
| non-admin self-promote | `failed ADMIN_REQUIRED` |
| outsider adds self to a group | `failed ADMIN_REQUIRED` |
| a new account's Insights totals | its own (0/0), not global |

---

## 8. Phase 6 — O-dimension scores

Applicability was read from `instrument/schema/social-messenger/applicability.json` for a
**full**-scope run.

### O1 — Functional completeness: 78

Anchors: *30* core features partially work, several checklist items fail; *60* M1–M4 solid,
later milestones patchy or failed on cap; *90* every in-scope milestone green, **including
platform-proof artifacts**. Interpolated between 60 and 90, nearer 90.

101 of 119 assertions pass under independent execution; 18 are not-run. Well above the 60
anchor — M1–M4 are not merely "solid", and M5, M6 and M8 are green too, so the later
milestones are not patchy. Every suite-required assertion (58) and every web-choreography
assertion passes, and the grader's own re-execution diverged from the suite and receipts on
**zero** assertions. Short of 90 on exactly the two clauses that anchor names: M7's nine
assertions are entirely not-run, and the platform-proof artifacts do not exist, which
removes nine more (all of M6 checklist items 1–2, plus `m8-a17/a18`). 84.9% of assertions
passing, seven of eight attempted milestones green, the whole shortfall concentrated in the
90-anchor's own two clauses → **78**.

### O2 — Correctness under grading: 82

Anchors: *30* multiple high-severity defects in core flows; *60* a few medium defects off the
happy path; *90* only cosmetic nits. Interpolated between 60 and 90, nearer 90.

No blocker and no major defect. Sixteen grader-authored cross-principal boundary probes were
all correctly refused. Independent re-execution of all 101 evidenced assertions produced zero
divergences, and the widened corpus-wide seed-idempotency census was byte-identical. Against
90 the gap is two **minor** defects rather than only cosmetic nits: d-01 is a genuine miss of
a brief-specified 5 s bound, observed 3/3 under load with ~1.7 s of steady-state margin, and
d-02 is an evidence-integrity weakness that already lost one bound receipt during the lane's
own run. d-03 is genuinely cosmetic → **82**.

### O3 — Trust boundaries: null (and this is *not* an applicability null)

`applicability.json`'s O3 predicate, `m6-green-and-m1-m5-attempted`, **is** satisfied here:
M6 is green and M1–M5 were all attempted. But O3's scoring rule admits exactly one input —
"Scored from the wave's secret rotated holdout probes only; anchor probes are non-scored
continuity diagnostics and never bear on O3" — and recorded deviation (1) is that no probe
set was committed for this wave, so that input does not exist. Scoring O3 from the grader's
own trust-boundary probing would substitute an inadmissible input for the frozen one and
would be indistinguishable, downstream, from a real probe result. **Null is recorded rather
than a fabricated score**, and the reason is carried in the report's `notes` so it is not
mistaken for an applicability null.

For the record and explicitly **not** as an O3 input: the sixteen boundary probes in §7 and
the five `[grader]` trust-boundary checklist assertions — `m1-a07` token revocation,
`m4-a10` post-window edit, `m4-a12` post-delete asset, `m5-a06` post-view asset, `m8-a12`
digest membership scoping — were all correctly refused server-side.

Because a null dimension is present, `applicability.json`'s `nullDimensionRule` forbids
computing a weighted total from this report. No weighted total, efficiency statistic or
cross-lane comparison is reported here in any case.

### O4 — Observed offline behavior: 60

Anchors: *30* cold-start offline shows an empty or broken app; *60* reads work, offline
writes lost or mis-ordered, or receipts wrong after flush; *90* reads, ordered queued writes,
receipt transitions and offline search all behave as specced **on the native proof** — on
full runs including M8's durable-queue restart and multi-device convergence evidence.

Gate satisfied (M6 green). Scored only from the harness's mechanically checkable artifacts.
What those artifacts show is good: M6's `offline-message-queue-flush-in-order` passed (two
messages composed offline show pending, flush **in order** on reconnect at 676.9 ms, and
reach read); M8's `m8-a15`/`m8-a16` passed (two warm-offline clients converge in
server-arrival order with no loss or duplicates, flushes at 334.0 and 427.5 ms, receipts
advancing normally), alongside `m8-a13`/`m8-a14` multi-device live delivery and cross-device
read state; and M5's warm-offline search passed, which the grader independently reproduced
with the browser context offline. **None of the 60 anchor's failure conditions occurred** —
no offline write was lost or mis-ordered, no receipt was wrong after flush.

But the 90 anchor is conditioned on the native proof, and there is none (§6, *native*). Both
segment summaries record `ios-simulator-m6`/`m8` as `{pass:null, receipt:null,
status:"not-recorded"}`. So cold-start offline — previously synced history and media
rendering, cold-offline search, and the view-once asset correctly **not** rendering — and
M8's durable-queue-across-restart were never demonstrated to the harness at all: nine
assertions with no evidence.

The honesty half of this dimension is strong and is what keeps it from falling below 60. The
lane never claimed a simulator pass: `README.md` states "No simulator behavior is claimed by
a bundle export alone", `evidence/native-artifacts.json` lists only `.hbc` exports, and the
Node durable-store proof records its own runtime as "published Node processDevice (not iOS
simulator)". Everything the harness could observe behaves as specced, but the dimension's
defining artefact is missing and the cold-start half of the offline acceptance is
undemonstrated → **60**.

### O5 — Performance at the scale envelope: band 30 (band-mapped, not interpolated)

First-match evaluation in the frozen order **0, 30, 60, 90, 75**.

**Band 0 does not fire.** The invariant manifest conforms exactly: the lane's end-state audit
(`evidence/scale-final-full-audit.json`) has all 18 per-entity counts **byte-identical** to
`instrument/fixtures/invariant-manifest-combined.json` → `expectedState.perEntityCounts`
(users 1008, profiles 1008, followEdges 5921, posts 50228, topLevelPosts 48224, replies 2004,
activeLikes 5008, activeReposts 1004, conversations 1002, dms 901, groups 101, memberships
2053, messages 100015, textMessages 99105, mediaMessages 910, quotedReplies 2736,
activeReactions 2000, disappearingSettingsEnabled 0). The grader **independently re-verified
every named O5 fixture on the delivered retained store** (port 49362, read-only), through the
app's own API with fixture credentials:

| named fixture | expected | observed |
|---|---|---|
| u0500 following | 500 | 500 |
| u0500 conversations | 100 | 100 |
| u0005 following | 5 | 5 |
| u0900 followers | 900 | 900 |
| u0900 top-level posts | 200 | 200 |
| u0901 following | 5 | 5 |
| g0001 roster | 50 | 50 |
| g0001 messages (counted by full paging, 200 pages) | 10000 | 10000 |

No named-fixture mismatch. `evidence/scale-clock.json` records `replayWallSeconds 539.954`
with `excludedProbeMs 70046`, and the frozen instrument leaves the replay wall cap an
uninstantiated P3 placeholder ("Budget caps and performance ceilings (placeholder — set at P3
from pilot)"), so no cap could be exhausted. The same placeholder status applies to the
absolute p95 ceilings the 60- and 90-branches reference.

**Band 30 fires: a degradation rule fails.** The published global-message-search rule is
"latency at the full corpus ≤ 3× the same query at the 10% checkpoint, **with the 50%
checkpoint on or below the line between them** (no superlinear blow-up mid-curve)". Recorded
search p95: **3.5248 ms at 10%, 3.4709 ms at 50%, 2.6094 ms at full**. The 3× clause passes.
The mid-curve clause **fails** — the line interpolated by corpus fraction gives **3.1180 ms**
at the 50% checkpoint and the observed 3.4709 ms sits above it. The lane's own harness
computed the identical predicate and recorded `"midpointAtOrBelowLine": false` and
`"allMeasuredRelativeRulesPass": false` in `evidence/scale-performance-summary.json`, so this
is not a grader-invented reading. The failure is robust to the alternative reading of "the
line": the unweighted midpoint of the endpoints is 3.0671 ms, also below 3.4709 ms.

Every other rule passes, from `evidence/scale-{10pct,50pct,final}-probes.json`:

| rule | observed | bound |
|---|---|---|
| deep paging (page 50 vs page 1) | 18.78 vs 19.32 ms | ≤ 3× |
| Following feed (500-follow vs 5-follow) | 6.5485 vs 2.9553 ms | ≤ 3× |
| celebrity write (celebrity vs 5-follower author) | 2.4713 vs 2.9228 ms | ≤ 3× |
| celebrity read (celebrity-follower vs 5-follow) | 2.4513 vs 2.9553 ms | ≤ 3× |
| Insights 10% → 50% → full | 2.1175 → 1.8795 → 1.756 ms | 3× ✓, mid-curve ✓ (line 1.9568) |
| Trending 10% → 50% → full | 2.8038 → 2.5842 → 2.7304 ms | 3× ✓, mid-curve ✓ (line 2.7712) |
| cold-start sync, 100-conversation probe user | 629.6 ms, acquired, bounded memory | no timeout / unbounded growth |

**No probe timed out, errored or OOMed.** The grader re-ran the full-corpus **read** probes
independently on the retained store (k=20 after 3 warm-ups, sequential, 30 s timeout,
asserting `complete !== false` and no denial on every call) at 1-minute load **65.05** —
higher absolute numbers, as expected on a shared machine, same ordering, all rules passing:

```
following5 4.811 | following500 12.044 | celebrityFollower 4.322 | search 4.237
insights 2.858   | trending 3.536       | history1 37.096       | history50 33.720
cold inbox acquisition 33.6 ms for 100 conversations
rule checks: {"deepPaging":true,"following":true,"celebrityRead":true}
```

Write-path probes were **not** re-run, to avoid perturbing the delivered artifact; the
celebrity/small write comparison is taken from the lane's recorded probes, where it passes.

**Diagnostic, explicitly not scored.** The failing predicate is a sub-millisecond
non-monotonicity on a curve that is globally flat-to-decreasing — search is *faster* at the
full corpus than at 10% — so the exact function fires without any pathological growth being
present. O5 is band-mapped and "the rubric-wide 'interpolate' instruction does not apply", so
**band 30** is recorded regardless; the observation belongs in the diagnostics, not in the
band.

---

## 9. Verification of the outputs

```
grader-report.json: SCHEMA VALID against
  https://snapback.dev/benchmarks/social-messenger/grader-report.schema.json
report ids: 101 | m8 file ids: 18 | union: 119 | manifest: 119
partition exact: true
overlap: []
report ids == the prior-wave 101: true
prior-101 subtotal: {"pass":85,"not-run":16}
m8 18 results:      {"pass":16,"not-run":2}
complete 119 total: {"pass":101,"not-run":18}
```

Validated with the AJV that the choreography copy installs
(`grading/scripts/validate-report.mjs`). The same AJV validated all 49 retained choreography
receipt lines against the frozen `receipts.schema.json` (0 invalid).

## 10. Cleanup

Every PID the grader started (§1) was terminated at the end of the session, and only those.
No `pkill`, `killall` or pattern kill was used at any point; other lanes' processes and
ports were left untouched. Nothing under `instrument/` was written.
