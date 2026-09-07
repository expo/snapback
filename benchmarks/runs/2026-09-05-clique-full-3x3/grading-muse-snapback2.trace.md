# Grader evidence and action trace — lane `muse-snapback2`

Sanitized per LLP 0197's redaction posture. Fixture credentials are referenced
by persona id only and never reproduced; the raw grader session is retained
privately and is not published.

- **Backend:** `snapback2-0.0.4` (public npm `snapback2@0.0.4`), platform binary
  `snapback2-darwin-arm64`.
- **Run scope:** full (M1–M8).
- **Grader:** family `claude`, model `claude-opus-5`. Calibration gate **not**
  passed for this family (wave deviation 2) — this grade is labelled
  `uncalibrated-grader`.
- **Session outcome:** `completed`. No grader-abort; no re-runs consumed.
- **Contamination:** none. `diary.md`, `essay.md`, `final-report.md`,
  `run-log.md` and all other lanes were never opened.
- **Machine:** macOS arm64, Node 24.18.0. **Shared host** — load average
  sampled throughout (see §8); it never dropped below ~17 and peaked ~38.

---

## 1. Environment and processes

Ports used, all inside the assigned 49700–49719 band:

| Port | What | PID |
| --- | --- | --- |
| 49701 | lane backend, `snapback2 dev --port 49701` (documented `npm run dev-backend`) | 59639 |
| 49700 | lane web client, `npm run web-serve` (`serve dist -l 49700`) | 64944 (wrapper), 64973 (server) |
| 49702 | grader-local static server over the lane's `dist/` (see §1.1) | 66037 |
| 49711 | transient, spawned and reaped by the lane's own suite harness | — |
| 49712 | grader scale-replay instance (`--keep`), driver PID 84428 | 84537 |
| 49713 | grader M6 adapter-conformance instance (self-reaped) | — |

Every PID above was started by this session and is the only set killed at the
end. No `pkill`/`killall` was used. Nothing was written into
`/Users/ccheever/clique-full-20260905/instrument/`; the choreography copy used
for hash comparison was read-only.

### 1.1 Why a grader-local web server

The lane's documented `npm run web-serve` (`serve dist`) returns **404 for every
expo dynamic route** — `/conversation/{handle}`, `/profile/{handle}`,
`/conversation/group/{title}` — because the static export emits
`conversation/[handle].html` and `serve` does not rewrite. The choreography
harness deep-links to exactly those routes, so the recorded choreography cannot
have run against `web-serve`.

To avoid modifying the lane, a 45-line static server
(`grading/probes/webserver.mjs`) serves the same untouched `dist/` on 49702 with
expo `[param]` rewrites. Every finding below that could be reproduced on both
was reproduced on both; the one that matters most (feed pagination, §4.2) was
re-run against the lane's own `web-serve` on 49700 and behaved identically.

### 1.2 Artifact custody

Before running anything that writes, the lane's `coverage/` and `receipts/`
trees were copied to `grading/baseline/`. The lane's `npm run acceptance`
rewrites both, so all statements about *the builder's* artifacts below are read
from `grading/baseline/`.

### 1.3 Harness integrity

`instrument-tools/choreography/choreography.mjs` and `control-lane.mjs` are
byte-identical to the frozen instrument copies:

```
8caf5ebd…83177f  choreography.mjs   (instrument and lane copy match)
35383c39…2680a7  control-lane.mjs   (instrument and lane copy match)
```

A modified `choreography-debug.tmp.mjs` also exists in the lane; its only diff
against the frozen file is 14 lines of `process.stderr.write` diagnostics. All
`choreo-*.stderr.log` receipts are 0 bytes, so the published receipts were not
produced by the debug copy.

### 1.4 Missing lane inputs

- **`run-record.json` is absent.** This report is graded entirely from
  receipts, source, and independent execution. `lane.runRecordPath` records the
  absent path.
- **`API.md` is absent.** So is any lane-authored `README.md`. The only markdown
  in the lane is the four excluded builder documents plus vendored
  `ui-kit/`, `fixtures-snap/` and `instrument-tools/` READMEs.
- **`scripts/custom-client-demo.mjs` is absent**, though `package.json` declares
  `"custom-client-demo": "node scripts/custom-client-demo.mjs"`.
- **No native/simulator artifact of any kind.** `dist-ios-m1…m6, m8` are
  `expo export --platform ios` Hermes bundles (verified: `Hermes JavaScript
  bytecode, version 96`) — build artifacts, not recorded simulator proofs.

---

## 2. Phase 1 — builder suite from the documented entrypoint

`npm run acceptance -- --milestone mN`, against the running backend, one
milestone at a time. Logs: `grading/suite-m*.log`.

| Milestone | Result | Tests |
| --- | --- | --- |
| m1 | PASS | 7/7 |
| m2 | PASS | 33/33 |
| m3 | PASS | 13/13 |
| m4 | PASS | 15/15 |
| m5 | PASS | 9/9 |
| m6 | PASS | 7/7 |
| m7 | **no suite exists** (`ERR_MODULE_NOT_FOUND: scripts/suites/m7.mjs`) | — |
| m8 | PASS | 5/5 |

Every suite the lane ships reproduces green. One environment note, recorded for
honesty and not counted against the lane: the first `m1` attempt failed 2/7
because the web client was not yet up; it passed 7/7 once `web-serve` was
running. That was a grader environment loop, not a lane defect.

---

## 3. Phase 2 — coverage-manifest spot-verification

**Verdict: `dishonest`. Dishonest milestones: M3, M4, M5, M6, M8.**

### 3.1 What the registered format requires

`instrument-tools/metering/coverage-manifest.mjs` (the harness's own validator,
vendored in the lane) requires a manifest of format
`clique-coverage-manifest.v1` whose `milestones` map lists, per milestone,
**exactly the frozen `assertions.json` suite-required IDs for the run scope, in
registered order**:

```
M1 ["m1-a01","m1-a02","m1-a03","m1-a04","m1-a08","m1-a10","m1-a11"]
M2 ["m2-a01","m2-a02","m2-a03","m2-a06","m2-a08","m2-a09","m2-a10","m2-a11",
    "m2-a12","m2-a13","m2-a15","m2-a16","m2-a17","m2-a18","m2-a20","m2-a21",
    "m2-a22","m2-a23","m2-a24","m2-a25","m2-a26","m2-a27"]
M3 ["m3-a03","m3-a04","m3-a05","m3-a10","m3-a11","m3-a14","m3-a15"]
M4 ["m4-a01","m4-a03","m4-a06","m4-a07","m4-a09"]
M5 ["m5-a04","m5-a05","m5-a08","m5-a09","m5-a10","m5-a11"]
M6 ["m6-a08","m6-a09","m6-a10","m6-a11","m6-a13"]
M8 ["m8-a01","m8-a03","m8-a04","m8-a05","m8-a06","m8-a07"]
```

No file in that format exists in the lane. What exists is
`coverage/m{1..6,8}.json`, auto-emitted by `scripts/acceptance.mjs` from
whatever `assertionId` string each suite test passes to the registry, in the
shape `{milestone, coverage: {id → testName}}`.

### 3.2 Sampled mappings

M1 and M2 key against the frozen IDs. Sampled and confirmed honest by reading
the test bodies (`scripts/suites/m1.mjs`, `m2.mjs`):

| Frozen ID | Mapped test | Exercises the observable? |
| --- | --- | --- |
| m1-a01 | `signup-new-user` | yes |
| m1-a03 | `duplicate-handle-rejected-visible` | yes — API rejection **and** a visible UI error |
| m1-a10 | `avatar-upload-succeeds` | yes |
| m2-a13 | `no-preview-card` | yes |
| m2-a16 | `repost-attributed` | yes |
| m2-a24 | `pagination-no-dup-no-gap-both-tabs` | yes (dup-free full walk) |
| m2-a25/26/27 | implicit self-follow trio | yes |
| m2-a22/a23 | `following-pagination-20` / `global-pagination-20` | **partly** — API-only; never exercises the "scrolling loads the next page" clause, and the client in fact cannot page (§4.2) |

From M3 onward the lane re-uses the frozen ID namespace for its own,
differently-numbered assertions. The mapped tests are real and do pass — the
defect is that the ID they occupy denotes a different observable, which both
mis-states coverage and hides the milestone's true gaps:

| Frozen ID and observable | Test the manifest maps to it | Actually exercises the observable? |
| --- | --- | --- |
| m3-a04 "create a group with Alice, Bob, Carol" | `group-send-history-for-new-member` | no |
| m3-a05 "second identical-membership group coexists" | `receipts-monotonic` | no |
| m3-a11 "tapping the quoted excerpt jumps" | *unmapped* | no test |
| m4-a01 "photo message end-to-end" | `react-toggle-counts` | no |
| m4-a03 "video message end-to-end" | `react-deleted-refused` | no |
| m4-a09 "the edited bubble shows an 'edited' label" | `unsend-nonauthor-refused` | no |
| m5-a01 (a **`[grader]`**-class assertion) | `accent-roundtrip-sync` | no — a suite manifest cannot claim a grader-class ID at all |
| m5-a09 "people search 'car' → Carol" | `search-window-reaches-history` | no |
| m5-a10 / m5-a11 | *unmapped* | no test |
| m6-a08…a11, a13 (push payload, custom-client demo, adapter conformance) | *none of these IDs appear*; `m6-a01…a07` are occupied by API-level offline tests | no — and m6-a01…a07 are the **simulator** assertions, so the manifest presents native coverage that does not exist |
| m8-a03 "7-day bucket under today" | `same-principal-live-delivery` | no |
| m8-a05 "Trending ranks the most-liked 24 h post first" | `dual-offline-converge` | no |
| m8-a06 / m8-a07 | *unmapped* | no test |

**Line drawn.** M1 is honest and complete. M2 keys the right frozen IDs and 20
of 22 mappings genuinely exercise the observable; m2-a22/a23 are weak coverage
of a UI clause via the underlying mechanism, which I read as good-faith
under-testing rather than misrepresentation — so M2 stays out of the dishonest
set and the pagination failure is carried as a defect and as two failed
assertions instead. M3, M4, M5, M6 and M8 are a different thing: the ID keys do
not denote the assertions they claim, and the collision conceals whole
unimplemented checklist items.

No fabricated results were found. Every mapped test exists, runs, and reports
truthfully about what it actually tests.

---

## 4. Phase 3 — independent checklist execution

Method key: **api** = `snapback2/client` against 49701 (or 49712 for envelope
work); **web** = Playwright chromium on the built web client; **src** = source
inspection; **choreo** = the lane's harness receipts under
`grading/baseline/receipts/`, never re-driven by me.

### 4.1 M1 — 13/13 pass

- **m1-a01/a02** (api): signup returns a viewer and `auth.me()` matches; a
  7-character password is refused `E_AUTH_PASSWORD_WEAK`.
- **m1-a03/a04** (web): API rejection plus visible errors — "That handle is
  already taken." / "That email is already registered."
  (`shots/m1-a03-error.png`).
- **m1-a05/a06** (choreo): `session-persists-on-relaunch`,
  `logout-remains-signed-out-on-relaunch`, both passed.
- **m1-a07** (api, `[grader]`, full-only): raw HTTP replay of a captured bearer
  token. Before logout `POST /api/query` → 200; after `POST /api/auth/logout`
  the *same* token → **401 `E_AUTH_SESSION`** on both query and mutation.
  Server-side revocation confirmed.
- **m1-a08** (web): display name and bio edited through `/profile/edit` and both
  shown on own profile (`shots/m1-a08-profile.png`).
- **m1-a10/a11** (api + web): fixture avatar uploaded; the profile renders a
  72×72 `sm-avatar` image whose `src` is the backend asset URL
  (`shots/m1-a11-avatar.png`). Note the frozen `sm-profile-avatar` testID lives
  on the *edit* form; the profile view uses `sm-avatar`.
- **m1-a09** (choreo, timing-sensitive): `profile-edit-live-visibility`, three
  attempts, `visibleMs` **86.1 / 74 / 80.6**.
- **m1-a12** (src): the lane uses `snapback2`'s built-in password auth
  (`auth.password: true` in `/api/manifest`; `client.auth.signup/login` in
  `components/AuthScreen.tsx`), with no hand-rolled hashing anywhere in lane
  source. The platform binary embeds `argon2-0.5.3` and a dummy hash
  `$argon2id$v=19$m=19456,t=2,p=1` — **argon2id at the standard published
  parameter set**. The store holds 73 `$argon2id$…m=19456,t=2,p=1` records.
- **m1-a13** (src): the eight distinct fixture passwords appear **zero** times
  in `.snapback/store.sqlite` (via `strings`), `.snapback/log.jsonl`,
  `.snapback/blobs/`, and the whole of `dist/`.

### 4.2 M2 — 25/27 pass

All API-observable items re-executed from scratch with grader-created users
(`grading/probes/m2.mjs`): text/image(×2)/video posts, follow → Following feed,
unfollow removing older posts while Global retains them, Global/Following
membership for an unfollowed author, like/unlike with an idempotent set-state
retry, repost attribution and toggle, a followed user's repost surfacing the
original, reply-count increment, chronological thread, replies absent from both
feeds, and the implicit-self-follow trio (own posts and own reposts in own
Following feed with **zero** follows, follower/following counts unchanged at
0/0). All pass.

`m2-a24` re-verified over 25 seeded posts: Following walked 2 pages / 25 items,
Global 4 pages, **0 duplicates, 0 missing**, 20 per page.

`m2-a12/a13` (web): the URL renders as a single `sm-text-link` node; clicking it
opens `https://example.com/grader-link` in a new browser tab; the card's
testIDs contain no preview/unfurl node (`shots/m2-a12-link.png`).

**`m2-a22` and `m2-a23` FAIL.** The frozen observable is "scrolling loads the
next page (20 per page)". In the client:

- the real scroll container was located and driven to the bottom
  (`scrollTop 0 → 5457 of 6257`, viewport 800) — item count stayed at **20**;
- the app's actual affordance is a `sm-feed-more` "Load more" button, and
  **clicking it is a no-op**: instrumenting `POST /api/query` showed **zero**
  feed queries fired by the click, the button text never changed, and the row
  count stayed 20 after one click and after two;
- reproduced identically on the lane's own `web-serve` (49700) and on 49702.

The underlying query pagination is correct (proved above via the API), so this
is a client bug, not a data bug. Code pointer: `components/Feed.tsx:176–214` —
the `cursor` state is seeded from `headNext` while the head query is still
loading (`headNext` is `null` then), so `cursor` latches to `null`; the button
renders on `cursor || headNext` (true once the head resolves) but `loadMore`
computes `cur = cursor === undefined ? headNext : cursor` → `null` and returns
immediately.

Choreo-scored: `m2-a04` (text/image/video live feed update, `visibleMs`
108.4/95.5/100.1, 104.5/103.5/102.8, 103.2/98.6/95.2), `m2-a05`
(`feed-author-avatar-and-display-name`), `m2-a07`
(`follow-unfollow-live-projection`), `m2-a14` (`like-unlike-live-count`,
`likeVisibleMs` 58.1/56.8/56.3), `m2-a19` (`reply-live-thread-projection`,
`replyCountVisibleMs` 55.5/54.8/55.1). All passed.

### 4.3 M3 — 15/15 pass

- **m3-a03** (api): `dmOpen` returns the same channel on re-open and from the
  counterpart (`reused: true`); exactly one membership row per pair.
- **m3-a04/a05** (api): a 3-member group is created with the expected roster; a
  second group with identical membership coexists as a distinct id, both
  readable.
- **m3-a14** (api): a non-admin's `memberRemove` is rejected `ADMIN_REQUIRED`
  and the roster is unchanged.
- **m3-a15** (api): all three installed starter segments re-seeded; DM 30,
  group 30, roster 50 before and after — byte-identical counts.
- **m3-a02** (web): the harness **skipped** `sender-avatar-identity-when-rendered`
  with `outcomeClass: "instrument"` because it looks for
  `sm-convo-sender-avatar` *inside* the `sm-convo-bubble` node, while the kit
  renders the avatar as a sibling in the outer row. Executed independently: with
  an incoming message from the counterpart present, exactly one
  `sm-convo-sender-avatar` node renders beside it
  (`shots/m3-a02-incoming.png`). **Pass** — the instrument, not the lane, was
  the limiting factor.
- **m3-a10** (web): the quoting bubble renders the quoted excerpt inline
  (`shots/m3-a10-quote.png`).
- **m3-a11** (web): with the original scrolled far out of view
  (`top 1252`, `inViewport false`), clicking `sm-convo-quote-preview` moved it
  to `top 293`, `inViewport true` (`shots/m3-a11-after-jump.png`).
- Choreo-scored and passed: **m3-a01** (`dm-live-messages`, `visibleMs`
  307.6/358.2/271.2), **m3-a06/a07**
  (`typing-indicator-within-2s-expires-within-5s`:
  `visibleAfterLastKeystrokeMs` **10.6/11.6/10.6** against a 2 000 ms bound and
  `expiresAfterLastKeystrokeMs` **3309.3/3814.5/3812** against a 5 000 ms
  bound), **m3-a08** (`receipt-sent-delivered-read-transitions`, one attempt,
  2276.8 ms), **m3-a09** (`group-receipt-waits-for-slowest-member`),
  **m3-a12/a13** (`member-add-promote-remove-leave-and-live-cutoff`).

### 4.4 M4 — 12/12 pass

- **m4-a01** (api + web): photo message sent and served (2 125 bytes to the
  recipient); through the composer, a fixture image picked with
  `sm-convo-file` renders as a real `sm-convo-media` node in the sent bubble
  (`shots/m4-a01-photo.png`).
- **m4-a03** (api): fixture video sent as a message; 49 779 bytes served to the
  recipient.
- **m4-a06/a07** (api): 👍 → ❤️ replaces (exactly one reaction row per user);
  ❤️ again removes it.
- **m4-a09** (web): after editing through the composer the bubble reads
  "… -EDITED … **edited** …" (`shots/m4-a09-edited.png`).
- **m4-a10** (api, `[grader]`, shortened windows): with `editWindowSeconds = 60`
  an in-window edit commits; after a 63 s wait the same edit is refused
  **`EDIT_WINDOW_EXPIRED`** and the recipient still reads the in-window body.
- **m4-a12** (api, `[grader]`): a photo message's bytes are served before
  `unsend`; after `unsend` the recipient's authenticated asset fetch is refused
  `E_ASSET_NOT_READY` and a direct GET of the previously minted URL returns
  **404**. Delete-side asset revocation works correctly.
- Choreo-scored and passed: **m4-a02** (`photo-message-live-render`, `visibleMs`
  229.1/237/234.8), **m4-a04** (`video-message-live-playback`), **m4-a05**
  (`reaction-live-replace-remove`, 121.4/127.8/130.8), **m4-a08**
  (`edit-live-visibility`, 97.5/112.9/106.3), **m4-a11**
  (`delete-live-tombstone`).

### 4.5 M5 — 9/12 pass

Grading ran the fixture pack's shortened-windows profile. `config/windows.json`
is byte-equivalent to `fixtures-snap/config/windows.shortened.json`
(edit 60 s, delete-for-everyone 120 s, 24h → 180 s, 7d → 300 s) and was live on
the server throughout.

- **m5-a01** (api, `[grader]`) **pass**: a DM switched to `24h`, one ephemeral
  message, both clients logged out **before** expiry, then a fresh login 205 s
  later — the server returns `denied` for the message by id and the thread no
  longer contains it.
- **m5-a02** (web, `[grader]`) **pass**, with a proper control: a keeper message
  sent *before* disappearing was enabled, then the ephemeral one. A **connected**
  browser held open across expiry showed `ghost bubbles 0, keeper bubbles 1`;
  a **cold-launched** browser context showed the same
  (`shots/m5-a02-connected.png`). The purge is scoped to the expired row.
- **m5-a03** (web, `[grader]`) **pass**: on the search screen the expired body
  returned 1 hit before expiry and **0** after, while the control body still
  returned 1 (`shots/m5-a03-after.png`).
- **m5-a04/a05** (api) **pass**: first `openViewOnce` commits and serves 2 119
  bytes; the second is refused `VIEW_ONCE_CONSUMED`; a non-member's open is
  refused.
- **m5-a06** (api, `[grader]`) **FAIL** — see §6, defect d-02. View-once media
  is not gated at the asset layer.
- **m5-a07** (choreo) **pass**: `chat-color-background-sync`, `visibleMs` 303.5.
- **m5-a08** (api) **pass**: a non-admin's `groupUpdate` is refused
  `ADMIN_REQUIRED` and the title is unchanged.
- **m5-a09** (web) **FAIL**: searching `car` returns **0 results** and renders
  the empty state. There is no people search: `app/search.tsx` searches message
  bodies only. Carol is unreachable by search (`shots/m5-search.png`).
- **m5-a10** (web) **pass**, with a note: searching `route map` returns the
  seeded DM line attributed to its sender. There is no chat-scoped search
  affordance — the app ships one global scope only — but the atomic observable
  ("in-chat search finds a known seeded string") holds.
- **m5-a11** (web) **FAIL**: searching `coffee` returns 3 results spanning two
  chats as a **flat list**; `sm-search-group` header count is **0**. The kit
  supports grouping via `SearchResultItem.groupLabel`; the app never sets it.
- **m5-a12** (choreo) **pass**:
  `warm-offline-search-over-synced-messages`, 2061.9 ms.

### 4.6 M6 — 1/13 pass

- **m6-a01…a07** (`[choreo]`, `simulator`/`native-artifact`) — **not passed.**
  No simulator recording or structured native receipt exists anywhere in the
  lane. Per the brief, "missing evidence leaves native/O4 proof absent rather
  than passing it." The M6 web choreography segment that *does* exist contains a
  single assertion, `offline-message-queue-flush-in-order` (passed,
  `flushMs` 262.1) — which is not one of the seven frozen simulator assertions.
- **m6-a08/a09** (push payload) — **FAIL.** `snapback/deliveries.q` declares
  `effect notify from delivery`, but no rule anywhere invokes it. Empirically: a
  message was sent to a recipient whose clients were closed; the marker string
  appears **0** times in `.snapback/log.jsonl`, and `snapback2 logs` contains
  only `kind: "mutation"` (100) and `kind: "schedule"` (86) records — **0**
  occurrences of `notify`, `targetUserId`, `senderDisplayName` or `preview`.
  There is no push seam.
- **m6-a10/a11** — **FAIL.** `npm run custom-client-demo` exits with
  `MODULE_NOT_FOUND`; `scripts/custom-client-demo.mjs` does not exist, so no
  listed API operation is exercised by a demo.
- **m6-a12** (`[grader]`) — **FAIL.** The assertion is "following **only
  API.md**, fetch the latest message of a named conversation". There is no
  `API.md` and no lane-authored documentation of any kind. The task is not
  attemptable on the terms the assertion sets.
- **m6-a13** — **pass.** The lane's own adapter was run over the fixture pack's
  50-action conformance sample: `scale replay PASS: 137 actions in 1s`
  (87 starter + 50 sample), every action settled, no failures. The fixture
  validator independently confirms the sample is 50 actions / 13 verbs. One
  deviation noted: the brief places this check "on the dev instance"; the lane's
  adapter always spins its own fresh instance. The observable — the adapter
  replays the sample green — holds.

### 4.7 M7 — not run

M7 was never attempted. There is no `scripts/suites/m7.mjs`, no `dist-ios-m7`
bundle, no poll or vote operation in `/api/manifest`, no poll table in
`snapback/schema.q`, and `components/Chat.tsx:1427` passes
`messageCount={undefined}` into chat settings. All nine m7 assertions record
`not-run`.

### 4.8 M8 — 6/18 pass

The grader report schema's `assertionResults` key pattern is `^m[1-7]-a[0-9]{2}$`
with `additionalProperties: false`, so M8 results cannot be keyed there. They
are recorded here and summarised in the report's `notes`.

| Assertion | Result | Evidence |
| --- | --- | --- |
| m8-a01 six lifetime totals | **pass** | Insights shows `23 Posts / 7 Likes received / 4 Reposts received / 4 Replies received / 4 Followers / 2 Following`, exactly matching an independent API walk of Alice's `profilePosts` and `followState` (`shots/m8-insights.png`) |
| m8-a02 likes-received increments on refresh | **pass** | choreo `m8-a02-insights-like-refresh`, `beforeLikes 6 → afterLikes 7`, `refreshMs 353` |
| m8-a03 7-day bucket under today | **fail** | 0 `sm-insights-day-row` nodes; `app/insights.tsx` renders `InsightsSummary` only |
| m8-a04 zero days rendered, not omitted | **fail** | same — no breakdown exists |
| m8-a05 Trending ranks most-liked 24 h first | **fail** | the Trending tab renders the literal string "Trending lands in M8." (`app/index.tsx:33`); 0 `sm-trending-rank` and 0 `sm-feed-item` rows (`shots/m8-trending.png`) |
| m8-a06 older heavily-liked post absent | **fail** | no Trending implementation |
| m8-a07 tie breaks newest-first | **fail** | no Trending implementation |
| m8-a08…a11 digest payloads | **fail** | no digest implementation: zero matches for "digest" across `snapback/`, `app/`, `components/`, `lib/`, `scripts/`; no digest config applied |
| m8-a12 non-member activity never contributes | **fail** | no digest to contribute to |
| m8-a13 same-account cross-device live | **pass** | choreo `m8-a13-same-account-message-live`, `visibleMs` 451.1 |
| m8-a14 cross-device read state | **pass** | choreo `m8-a14-cross-device-read-state`, `clearVisibleMs` 1625 |
| m8-a15 dual-offline convergence | **pass** | choreo `m8-a15-dual-offline-convergence`, `firstFlushMs` 183.4, `secondFlushMs` 293.3 |
| m8-a16 receipts advance after flush | **pass** | choreo `m8-a16-dual-offline-receipts` |
| m8-a17/a18 durable offline queue across restart | **fail** | native-artifact class; no simulator artifact exists |

---

## 5. Scale replay and the O5 envelope

The builder's `receipts/scale-replay.json` was **independently reproduced**. A
copy of `scripts/scale-replay.mjs` (patched only for path roots, an output path
under `grading/`, and a `--keep` flag that leaves the instance up for probing)
replayed the full fixture log on a fresh instance on 49712:

```
checkpoint 10% at 24777: posts=4844  followEdges=5921 perUserFollowing ok (1008)
                         perUserConversations ok (1008) messages=10015
                         perChatMessages ok (1002) spotProfiles ok o5 ok
checkpoint 50% at 88057: posts=24124 … messages=50015 … o5 ok
final:                   posts=48224 … messages=100015 … o5 ok
scale replay PASS: 167244 actions in 1063s
```

Every figure matches the builder's receipt. The invariant manifest conforms at
all three checkpoints, including the named O5 fixtures; confirmed again through
the app's own reads: `u0500 followingCount = 500` (manifest 500),
`u0900 followerCount = 900` (manifest 900), `u0500` lists exactly 100
memberships (manifest 100) in 60 ms.

Two integrity notes on the builder's receipt: `failedActions: 0` and
`pass: true` are **hardcoded literals** in `scripts/scale-replay.mjs:428–433`,
not derived from outcomes. The receipt is only written on a completed run, so
`pass` is not false here — but neither field is evidence.

### 5.1 Published degradation rules, measured

Sequential, 3 warm-ups, k=20, 30 s timeout, against the live 49712 corpus. No
probe timed out, errored or OOMed. Absolute values are diagnostics only.

| Rule | Measurement | Bound | Result |
| --- | --- | --- | --- |
| deep paging in the 10 k chat, p95 page 50 / page 1 | 19 ms / 22 ms = **0.86** | ≤ 3 | pass — but see §5.2, page 50 is unreachable and the "page 50" call re-reads page 1 |
| Following feed, p95 u0500 (500 follows) / u0005 (5 follows) | four rounds: **3.80, 1.13, 8.77, 3.36** → best-of-3 **1.13** | ≤ 3 | pass on best-of-3; extremely load-sensitive (host load 22–38 across rounds) |
| celebrity read path, p95 u0901 / u0005 | 11 ms / 10 ms = **1.10** | ≤ 3 | pass |
| celebrity write path, p95 u0900 / u0005 post-create | 3 ms / 3 ms = **1.00** | ≤ 3 | pass |
| global message search at the full corpus | p95 **27 ms** | ratio rule | no superlinear growth observed |
| **Insights at the full corpus** | p95 10 ms for page 1 — but the screen is a client-side page-and-count | "a page-and-count-client-side implementation **fails structurally**, not just on latency" | **FAIL** |
| **Trending at the full corpus** | not implemented | ≤ 3× the 10 % checkpoint | **FAIL — nothing to measure** |
| cold-start sync of the probe user's 100 conversations | 100 memberships in 60 ms, no timeout | no timeout / unbounded memory | pass |

### 5.2 Two structural findings at the envelope

**The Following feed is truncated to 40 followed accounts.**
`snapback/feeds.q` builds `followingFeed` as
`merge posts … [f.followed] for f in follows[viewer] first 40 by byFollower`.
Measured at the named O5 fixture: `u0500` follows **500** accounts;
walking **every** page of its Following feed surfaces **41 distinct authors**
(u0500 itself plus 40 followed accounts). 460 followed accounts' posts never
appear, silently. Reproduced independently on the dev instance with a
purpose-built 45-follow user: 45 targets, 45 posts, `followingCount = 45`,
**5 authors missing** — and the missing indices were 6, 16, 17, 27, 39, i.e. an
arbitrary 40 of the 45 edges, not the newest 40. The follow-fanout latency rule
above passes partly because the read declines to do most of the work.

**Conversation history is unreachable past 30 messages.**
`messages.thread` is `messages[conversationId] after c last 30 by byConvTime`;
`last N` carries no cursor. On the busy fixture chat `g0001` (10 000 messages)
page 1 returns 30 rows with `next = null` — deep paging "ran out of pages at 1".
On the dev instance, `d-alice-bob` holds **547** messages; the conversation
screen renders **30** bubbles, scrolling the container to `scrollTop 0` loads
nothing more, and there is no load-earlier control of any kind
(`shots/convo-history-top.png`). The lane's own comment in `app/search.tsx`
acknowledges it ("the display thread pages backward (`last N` carries no
cursor)"), and `components/Chat.tsx` threads a `headCursor` that is structurally
always `null`.

Also relevant to the envelope: the search screen mounts one `ChatDrain` per
membership with `{ drain: true }`, pulling every message of every chat into the
client before filtering. Measured: draining `g0001` alone is 10 000 messages
over 100 pages in 2 589 ms. For `u0500`'s 100 conversations, opening Search
means draining all of them.

---

## 6. Defects beyond the checklist

Severity-bucketed; ids match the report's `defects` array.

- **d-01 blocker — Following feed silently drops all but 40 followed accounts.**
  §5.2. Wrong data in a core read path, with no error and no indication.
- **d-02 major — view-once media is not gated at the asset layer.** Measured
  (`grading/probes/m5-a06b.mjs`): *before* any `openViewOnce` call the recipient
  can already fetch the bytes (`SERVED 2104 bytes`); after the second open is
  refused `VIEW_ONCE_CONSUMED`, `messages.messageById` still exposes
  `message.photo`, and both the **recipient** and the **sender** fetch the bytes
  again (`SERVED 2104 bytes` each) from a freshly minted URL on a fresh session.
  A non-member is correctly refused (`E_ASSET_NOT_READY`), so this is not a
  cross-user leak — but the single-view guarantee is UI-only. Contrast
  `unsend`, which does revoke correctly (m4-a12).
- **d-03 major — any signed-in user can rewrite the global edit/delete windows
  and disappearing TTLs.** `snapback/schema.q:329–330, 342–343` guard
  `cliqueConfig` and `disappearingTtls` with `insert/update <- exists
  profiles[viewer]`. Demonstrated end to end: a message past its 60 s window was
  refused `EDIT_WINDOW_EXPIRED`; a **second, unrelated** user then called
  `setWindowConfig(999999, 999999)`; the same edit then **committed** and the
  recipient read the rewritten body. The same surface lets any user change every
  chat's disappearing TTL. (I restored the fixture values immediately — verified
  `edit=60s delete=120s`, TTLs `off/180/300`.)
- **d-04 major — conversation history unreachable past 30 messages.** §5.2.
- **d-05 major — the feed's "Load more" affordance is dead.** §4.2. Page 2 of
  Following and Global is unreachable in the client although the API pages
  correctly.
- **d-06 major — Insights lifetime totals are capped at 60 posts.**
  `app/insights.tsx` chains exactly three 20-row `profilePosts` pages in the
  client and sums them. Demonstrated: a user with **65** posts (API full paging
  confirms 65) is shown **"60 Posts"** (`shots/m8-insights-cap.png`). This is
  also the structural failure of the M8 Insights degradation rule (§5.1).
- **d-07 major — Search transfers whole chat corpora to the client.** §5.2.
- **d-08 minor — no registered-format coverage manifest.** No
  `clique-coverage-manifest.v1` file exists; the harness's own validator
  (vendored at `instrument-tools/metering/coverage-manifest.mjs`) rejects the
  lane's per-milestone shape on `format` alone, so coverage validation cannot
  have been satisfied for any milestone.
- **d-09 minor — scale-replay receipt fields are hardcoded.**
  `scripts/scale-replay.mjs:428–433` writes `failedActions: 0, pass: true` as
  literals.
- **d-10 minor — `npm run custom-client-demo` is a broken advertised script**
  and there is no lane README or API.md; `web-serve` 404s on every dynamic
  route (§1.1), so the documented start path cannot reach a conversation.

Trust-boundary sweep (`grading/probes/authz.mjs`, 20 probes, feeding O2 only —
these are **not** the wave's holdout probes): 18 of 20 correctly denied,
including reading a stranger's DM thread/message/settings/typing/history,
posting, reacting, marking read, minting a delete token, unsending, editing,
restyling, enabling disappearing, self-adding to a chat, rewriting another
user's profile, and fetching private chat media. The two allowed ones are
d-03.

---

## 7. Dimension scoring notes

- **O1 = 30.** Independent execution passes **81 of 119** in-scope assertions
  (M1 13/13, M2 25/27, M3 15/15, M4 12/12, M5 9/12, M6 1/13, M7 0/9, M8 6/18) =
  68 %. Applying §3's adjudication — M3, M4, M5, M6, M8 score their checklists
  not-passed — leaves **38 of 119** = 32 %. (The 119 denominator is counted from
  the assertion arrays themselves; `assertions.json`'s own `counts` block
  predates the m2-a25/a26/a27 additions and understates M2 as 24.)
  Placement sits at the 30 anchor
  ("core features partially work; several checklist items fail"); it is dominated
  by the adjudication and by M7 never being attempted, not by product breadth.
  Platform-proof artifacts are present for every attempted milestone (real
  Hermes bundles), but the M6/M8 native offline proofs are absent entirely.
- **O2 = 25.** One blocker and six majors, most of them in core flows (feed
  correctness, chat history, feed pagination, Insights numbers, view-once
  confidentiality, global config authority). That is worse than the 30 anchor's
  "multiple high-severity defects in core flows".
- **O3 = null.** Two independent reasons: no holdout probe set was committed for
  this wave (deviation 1), and O3's rule permits **only** those probes as input;
  and the M6 adjudication removes the `m6-green` predicate.
- **O4 = null.** The `m6-green` predicate fails under the M6 adjudication. Had
  it held, the only permitted input — mechanically checkable simulator
  choreography artifacts — does not exist for this lane at all, so no observation
  of offline behaviour on the native proof was available to score.
- **O5 = 30.** First-match band order 0 → 30. Band 0 does **not** fire: I
  reproduced the replay end to end and the invariant manifest conforms at 10 %,
  50 % and final including the named O5 fixtures, and the replay completed
  (1 063 s) rather than exhausting a cap. Band 30 fires on "any degradation rule
  fails": the M8 **Insights** rule fails structurally — the brief states that a
  page-and-count-client-side implementation "fails structurally, not just on
  latency", and `app/insights.tsx` is exactly that (§5.1, d-06) — and the M8
  **Trending** rule has no implementation to measure at any checkpoint. No probe
  timed out, errored or OOMed.

---

## 8. Machine load (deviation 3)

The host is shared with other sessions. `uptime` 1-minute load averages sampled
across the session:

| Local time | 1 / 5 / 15 min load | What was running |
| --- | --- | --- |
| 19:56 | 23.03 / 27.04 / 26.59 | session start, port survey |
| 19:57 | 19.12 / 25.43 / 26.03 | suite m1 (re-run, green) |
| 19:57 | 18.63 / 25.23 / 25.95 | suite m2 |
| 19:57 | 18.34 / 25.06 / 25.89 | suite m3 |
| 19:57 | 17.91 / 24.74 / 25.77 | suite m4 |
| 19:57 | 24.87 / 25.93 / 26.17 | suite m5 |
| 19:58 | 24.61 / 25.85 / 26.14 | suite m6 |
| 19:58 | 23.60 / 25.62 / 26.06 | suite m8 |
| 20:08 | 27.50 / 24.03 / 24.49 | M4 grader probes (incl. the 63 s edit-window wait) |
| 20:17 | 22.09 / 25.60 / 25.14 | M6 adapter conformance; full replay started |
| 20:26 | 21.42 / 23.42 / 24.15 | replay at ~80 k actions |
| 20:35 | 17.87 / 20.76 / 22.21 | replay finished (1 063 s) |
| 20:36 | 37.62 / 26.52 / 24.30 | O5 envelope round 1 |
| 20:38 | 34.66 / 28.98 / 25.54 | O5 envelope rounds 2–4 |
| 20:39 | 35.52 / 32.81 / 27.49 | session wrap-up |

**Timing records and load.** Every timing-sensitive assertion in scope is
`[choreo]` class and is scored from the harness's own best-of-3 receipts, which
the builder produced on **2026-09-06T08:17–08:26 UTC** — before this session.
Those measurements therefore carry the builder's host load, which I cannot
observe; the load table above covers only my own execution window and applies to
the O5 envelope measurements in §5.1, which I did take. The one degradation
ratio that varied materially with load (Following-feed fanout: 3.80 / 1.13 /
8.77 / 3.36 across four rounds at loads 22–38) is judged best-of-3 as the frozen
prompt directs, and all four measurements are recorded.

---

## 9. Deviations from the frozen protocol (this run)

1. **Execution-order phase 4 (holdout probes) skipped.** No probe set was
   committed for this wave. `wave.probeSetSha256` records the literal
   `none-uncommitted`; `probeResults` is empty with a note. No probes were
   invented. The O5 envelope measurements in §5.1 exercise the brief's
   **published** degradation contract and are explicitly not a substitute for
   the secret rotated probe set — they are not reported as `probeResults` and
   they do not bear on O3.
2. **Grader family calibration gate not passed.** `calibrationPassed: false`,
   `sameFamilyGraded: false`; the record labels this grade
   `uncalibrated-grader`.
3. **Timing-sensitive checks judged best-of-3** with machine load recorded
   beside them, per §8.
4. **N = 1 calibration run**, not a claim-eligible wave.

Independently of the deviations, this lane could not carry a weighted total in
any case: M7 was never attempted, so it is not a complete lane, and three
O-dimensions record null.

---

## 10. Cleanup

All five grader-started processes (59639, 64944/64973, 66037, 84428/84537) were
terminated by PID at the end of the session. No other process was signalled.
