# Grader evidence and action trace: social-messenger lane `muse-snapback4`

Sanitized for publication. Passwords, bearer and service tokens are never
printed here, and the two service-token lines in `logs/backend*.err` are
redacted. Test accounts are synthetic `grader*@example.com` users or the
fixture-pack personas (`alice`…`henry@example.com`). Raw session transcripts
are not published.

| Field | Value |
|---|---|
| Grader | family `claude`, model `claude-opus-5`, fresh session, frozen `instrument/grader/grader-prompt.md` (sha256 `97ce0e44…e0ded6`) |
| Lane | `muse-snapback4`, backend `snapback4-0.2.10` (npm snapback4@0.2.10 + snapback4-expo@0.2.3), run scope `full` |
| Wave | `full-3models-muse`, probe set `none-uncommitted` |
| Assertion manifest | `instrument/schema/social-messenger/assertions.json`, version `0.3.0-m8`, sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`, 119 assertions |
| Session window (UTC) | 2026-09-15 00:06 – 00:50 |
| Session outcome | completed, 0 grader re-runs, not contaminated |

## Deviations from the frozen protocol (N=1 calibration run, not claim-eligible)

1. **No holdout probe set was committed.** `grader/probes/rotation-log.md`
   has no rows, so phase 4 was skipped. `wave.probeSetSha256 =
   "none-uncommitted"` and `probeResults` is empty. No probes were invented.
   O3 is defined only over rotated holdout probes, so it is **null** even
   though its predicate (M6 green, M1–M5 attempted) holds. The grader's own
   trust-boundary exploration fed the defect list and O2, never O3.
2. **Uncalibrated grader.** The claude family has not passed `calibration.md`.
   `calibrationPassed=false` and `sameFamilyGraded=false`, so the grade is
   labelled `uncalibrated-grader`.
3. **Shared host.** Timing-sensitive checks are judged best-of-3, and the load
   average (`uptime`) is recorded beside every timing record below. Load ran
   from 14 to 83 during grading.

### Report-shape limitation and the prior measurement-coverage gap

- The frozen `grader-report.schema.json` only admits `^m[1-7]-a[0-9]{2}$` keys.
  `grader-report.json` therefore holds exactly the 101 M1–M7 results, which
  match `GRADER_ASSERTIONS_101.txt` (checked in `build-report.mjs`). The 18 M8
  results are in `m8-assertion-results.json`, using the same record shape and
  enum values, validated per record against the schema's assertion-record
  definition. The two files partition all 119 ids with no overlap.
- The structured `assertionResults` of the actual September 5 and September 12
  gradings carried only those 101 ids. Their prose notes could mention M8, but
  they produced no machine-comparable 18-id M8 result set. This session's
  101-id subtotal is comparable to those records. The 18 M8 results and the
  119 total have no structured predecessor.

## Inputs read, and inputs not read

**Read:** grader prompt, `assertions.json`, `applicability.json`,
`grader-report.schema.json`, the brief `social-messenger.md`, `ENVIRONMENT.md`,
`calibration.md`, the grader README, probes README and rotation log,
`CONTRACT.md` (test-id list), fixture README, personas (passwords loaded
programmatically, never printed), configs, choreography harness source,
`metering/coverage-manifest.mjs`, snapback4 package README. From the lane:
`API.md`, `package.json`, `adapter.json`, `setup-identity.json`,
`suite-status.json`, `scripts/*`, `snapback/schema.q`, `snapback/worker.mjs`,
`lib/*`, `app/*`, parts of `ui-kit/src`, and the choreography receipt files
`receipts-*.jsonl`.

**Not read:** `diary.md`, `essay.md`, `final-report.md` and `run-log.md`
appeared only as names in a directory listing; their contents were never
opened. No `FINAL.md` exists. No other lane was touched. The lane's
`.snapback4/store.sqlite` and `push.log` were byte-scanned for plaintext
passwords only (M1-7) and were not otherwise read.

**Absent:** `run-record.json`, any `coverage*.json` in the registered
`clique-coverage-manifest.v1` format, `receipts/`, `evidence/`, `artifacts/`,
and any simulator or native artifact. Coverage was taken from each suite
receipt's `coverage` array.

## Environment, ports, processes

- Grading ran in a grader-made copy of the lane, `grading/checkout`. Source,
  `dist-web` and `dist-ios` were copied with rsync; `node_modules` was
  APFS-cloned. The builder's narrative files, store, push.log, receipts and
  acceptance outputs were excluded. `config/windows.json` and
  `config/digest.json` were replaced with the fixture pack's
  `windows.shortened.json` (edit 60 s, delete 120 s, '24h' = 180 s,
  '7d' = 300 s) and `digest.shortened.json` (120 s periods, anchor 00:00:00Z).
  The worker synced these values into `sysconfig`, confirmed via
  `myWindows = {editWin 60, deleteWin 120, ttlA 180, ttlB 300}`.
- The grader's own harness copy lives in `grading/harness/{choreography,metering}`
  (from `instrument/`, `npm install` of pinned ajv 8.20.0 and playwright
  1.62.1), plus a grader-written `grading/lib/json-schema.mjs` AJV helper for
  the harness's `../../lib/json-schema.mjs` import. The existing Playwright
  chromium cache was used.
- Ports: backend `127.0.0.1:49340` (`snapback4 dev --port 49340`, the lane's
  documented `npm run backend`) and web `127.0.0.1:49341`
  (`node scripts/serve.mjs 49341`). Both ports were free beforehand, and
  49340 is the backend URL baked into `dist-web`.
- PIDs started (see `logs/pids.txt`): backend wrapper 69676 (binary 69724,
  worker 69814), web 69677. For the M8-11 restart, 69676 was SIGTERMed at
  00:32:50Z and replaced by wrapper 83535 (binary 83537, worker 83546). At the
  end, 83535 and 69677 were stopped by PID; every child exited and no listener
  remained in 49340–49359. No pkill or killall was used.

<a id="phase1-seed"></a>
## Seed (M3-15 evidence)

`node scripts/seed.mjs --segment m3` gave `applied=86 skipped=0`. Table counts
from `snapback4 sql` on the grader store:
profiles 8, follows 12, posts 24, likes 8, reposts 4, replies 4,
conversations 2, memberships 5, messages 15, reactions 0, feed 71,
globalfeed 28. These match `invariant-manifest-starter.json`: 8 users,
12 edges, 24 top-level posts, 4 replies, 8 likes, 4 reposts, 2 conversations,
5 memberships, 15 messages. A second identical run left every count unchanged,
so the seed is idempotent.

<a id="phase1"></a>
## Phase 1: builder suite from a clean checkout

`npm run acceptance -- --milestone mN` for m1, m2, m3, m4, m5, m6 and m8,
between 00:11:09Z and 00:11:21Z (load avg 14.4–16.3). Every milestone
reported `pass=true` with an empty `uncovered` list. Per-test output is in
`evidence/phase1-builder-suite.txt` and coverage arrays in
`evidence/phase2-coverage-manifests.txt`. The m6 suite ran
`scripts/custom-client-demo.mjs` (green) and replayed `sample-50.log`
(`applied=50 skipped=0`, plus profile, login and DM spot checks) on the grader
dev instance.

## Phase 2: coverage-manifest spot verification, verdict `dishonest` (M3)

All 58 suite-required coverage entries were compared with their test bodies
in `scripts/acceptance.mjs`. A mapping counts as **honest** when the test
exercises the assertion's behavior, even at API rather than UI level, and as
**dishonest** when it exercises a different behavior.

**M3 is dishonest.** Five of its seven entries point at tests of other
behaviors:

| Assertion | Its observable | Mapped test |
|---|---|---|
| m3-a03 | same DM reused | "markDelivered advances to delivered" |
| m3-a04 | create group A/B/C | "markRead advances to read" |
| m3-a05 | second same-member group coexists | "second DM create reuses the same channel" |
| m3-a11 | tap quoted excerpt jumps to original | "typing expires within the ceiling" |
| m3-a15 | seed idempotent | "admin adds a member" |

No suite test exercises m3-a11 or m3-a15 at all. The labels look like a
different ID numbering scheme rather than intentional misreporting, but the
frozen rule is observable-based. M3 is therefore adjudicated
`capability-failure` (scoring-only, non-retroactive) and O1 scores its
checklist not-passed. The per-assertion M3 results still record what the
grader observed.

Honest but weak mappings, all re-executed independently (see below):
- m1-a02, m1-a03, m1-a11, m2-a12, m2-a13 and m4-a09 assert server state
  rather than rendering.
- m8-a06 is structural, because no post older than 24 h exists.
- m6-a11 pages an empty DM history.
- m8-a01 uses fresh users instead of seeded content.

<a id="choreography"></a>
## Phase 3a: two-client choreography, grader-run frozen harness

The command was `node grading/run-choreo.mjs all …`, i.e. `choreography.mjs`
with `--suite-status` from the grader's suite receipts, the lane's
`setup-identity.json`, and `grading/grader-adapter.json`. The adapter keeps the
lane's routes, points fixtures at `instrument/fixtures`, and sets
`disappearing {24h, waitMs 200000}` for the shortened config.

**Run 1** (all segments), 00:12:38Z–00:18:28Z, load avg 16.49 at start and
20.54 at end: **M1, M2, M3, M4, M5, M6 and M8 all green**
(`evidence/choreo-run1.jsonl`). Best-of-3 timings, with the harness running
three attempts on every bestOf check:

| Assertion (check) | Attempts (ms) | Bound | Result |
|---|---|---|---|
| m1-a09 profile-edit-live-visibility (visibleMs) | 82, 78.4, 80.8 | – | pass |
| m2-a04 feed text / image / video live (visibleMs) | 812.4, 220.8, 216.3 / 131.5, 125.1, 220.1 / 101.7, 112.2, 112.9 | – | pass |
| m2-a14 like-unlike-live-count (likeVisibleMs) | 1975.4, 1901.7, 1899.0 | – | pass |
| m2-a19 reply-live-thread-projection (replyCountVisibleMs) | 1912.6, 1838.2, 1895.2 | – | pass |
| m3-a01 dm-live-messages (visibleMs) | 121.3, 120.8, 336.7 | – | pass |
| m3-a06 typing visibleAfterLastKeystrokeMs | 8.1, 4.8, 4.8 | 2000 | pass |
| m3-a07 typing expiresAfterLastKeystrokeMs | 3810.9, 3803.9, 3805.9 | 5000 | pass |
| m4-a02 photo-message-live-render (visibleMs) | 138.7, 113.1, 118.8 | – | pass |
| m4-a05 reaction-live-replace-remove (visibleMs) | 156.0, 131.2, 128.1 | – | pass |
| m4-a08 edit-live-visibility (visibleMs) | 96.0, 96.7, 102.7 | – | pass |

Other run-1 observations:
- `m2:repost-toggle-live-attribution`: attempts pass, pass, fail (10 s timeout).
- `m2:repost-following-feed-surface`: attempts fail, pass, fail. The failures
  read "viewer-repost of an unfollowed author was counted as a direct
  follow-projection hit" (defect d-06).
- `m3:sender-avatar-identity-when-rendered`: skipped. The lane mounts no
  `sm-convo-sender-avatar` (m3-a02 fail).
- `m5:disappearing-message-expiry-and-purge`: passed after the 200 s wait
  under shortened windows.
- `m6:offline-message-queue-flush-in-order`: pass, flushMs 86.3.
- M8: m8-a02 likes 2 → 3, m8-a14 clearVisibleMs 3339.5, m8-a15 flushes
  81.4 / 199.1 ms, m8-a16 read in 2904.6 ms.
- Every segment summary has `simulator = null`.

**Reruns** (`evidence/choreo-m6m8-reruns.meta`):

| Run | Segments | Start (UTC) | Load at start | Load at end | Outcome |
|---|---|---|---|---|---|
| 2 | m3, m6, m8 | 00:37:02Z | 26.21 | 83.06 | M3 green; M6 queue check failed (flushed bubble not visible within 10 s); M8 m8-a02 failed, others passed |
| 3 | m3, m6, m8 | 00:38:32Z | 83.06 | 32.29 | same pattern as run 2 |
| 4 | m6 | 00:40:36Z | 27.83 | 26.32 | pass, flushMs 222.5 |
| 5 | m6 | 00:40:42Z | 26.32 | 25.25 | pass, flushMs 219.3 |

The m8-a02 failures in runs 2 and 3 read "Global feed exposed no observably
unliked Alice post for Bob". **This was grader-induced.** The grader's 205
Trending filler posts (see #m8) had just filled Bob's first Global page, so
it is not scored against the lane. In runs 2 and 3, m3 receipt transitions
took 6284 ms and 10399 ms (run 1: 6235 ms), and dm-live visibleMs rose to
about 5 s on attempts 2–3 under the load spike.

For comparison, the lane's own receipts (read-only, lane root) show the M3
receipt-transition check failing in 7 builder runs and the M6 queue check
failing in 6 of 12, before the final `receipts-all5.jsonl` went fully green.

<a id="m1"></a>
## M1: accounts and profiles

- **UI signup** (`probes/ui-sweep.mjs`): the new account landed on the
  authenticated Chats shell with feed tabs (`evidence/ui/m1-signup-landing.png`).
- **Duplicate email** in the UI: visible `sm-auth-error` reading
  "Authentication failed: E_AUTH".
- **Duplicate handle** in the UI, as persona dave setting handle `alice`:
  visible `sm-profile-error` reading "Save failed: E_CONSTRAINT"
  (`probes/ui-two-client.mjs`).
- **Profile edit** as dave: display name and bio changed and shown on
  `/profile/dave`. `avatar-bob.png` uploaded through the form's file input
  rendered as a 256×256 image, and the server profile carries the asset.
- **New UI signup cannot make a profile** (`probes/new-user-profile.mjs`,
  defect d-01). `/profile/edit` still showed "Edit profile Loading…" after
  15 s, Settings read "Signed in as …", and there is no "My profile" link.
  The new user's post rendered author "?".
- **m1-a07** (`probes/timed-api.mjs`): after `POST /auth/logout` the old
  bearer got 401 `E_AUTH` on `/q/myProfile`, `/m/upsertProfile`, `/assets`,
  `/auth/refresh` and `/sync`. Sessions otherwise expire after 7.00 days.
- **UI logout** then relaunch in the same browser context: auth form shown,
  no stored session keys.

<a id="m1-source"></a>
### M1-12 / M1-13 source inspection

- `snapback/schema.q:7` declares `use identity password`, the platform's
  built-in accounts. The client calls `snapback4/auth` `signup` and `login`
  (`lib/client.tsx`), and no lane code hashes, stores or logs passwords.
- The snapback4 README (§4 Sign-in) documents Argon2. The grader store
  contains `$argon2id$v=19$m=19456,t=2,p=1` hashes, i.e. 19 MiB, t=2, p=1.
- A byte scan for every fixture, acceptance and demo password found **no
  plaintext** in the grader store and WAL, the lane's dev store and WAL,
  `push.log` (lane and grader), backend logs, or the web bundle.
- Web sessions persist via `localStorageSessionStore()`, which the platform
  documents as an explicit opt-in. That holds tokens, not passwords.

<a id="m2"></a>
## M2: posts and follow graph

- **Link post via UI**: the URL rendered as `role=link` and clicking it opened
  a popup at the exact URL. The card contained no `sm-feed-media` and no
  `img`, so there is no preview.
- **Pagination via UI** (viewport 420×800, as alice):
  - Global: 20 rows rendered at first, 97 after scrolling, equal to the API's
    97 unique entries.
  - Following: 18 rows at first, 30 after scrolling. The API has 32 unique
    entries; the 2 missing are orphaned reposts the client hides (d-05).
- **m2-a07**, two clients: Alice watched `sm-profile-follower-count` on her own
  profile while Erin tapped follow on hers.

  | Attempt | Action | Count | Visible (ms) | Load avg |
  |---|---|---|---|---|
  | 1 | unfollow | 4 → 3 | 116 | 26.43 |
  | 2 | follow | 3 → 4 | 117 | 26.43 |
  | 3 | unfollow | 4 → 3 | 121 | 24.87 |

- **Projection exploration** (`probes/functional-api.mjs`):
  - X reposts Z's post, then Y unfollows X: X's repost **stays** in Y's
    Following (d-03).
  - Y follows X and Z, X reposts Z's post, then Y unfollows Z: X's repost is
    **removed** (d-04).
  - X un-reposts: Y's Following keeps an entry with `repostBy=X, rp=null`
    (d-05).
  - Self-follow is refused `CANNOT_FOLLOW_SELF`, and counts exclude self.
  - Repeated follow and like intents are idempotent.
  - Validation refuses an uppercase or short handle, empty display name,
    bio over 200, bad link, location over 50, post over 500, mixed media, and
    a 7-character password.
- **Server-side replay** of the harness's repost-following sequence
  (`probes/reproj.mjs`, 5 attempts × 8 samples): never showed a direct hit
  after unfollow, so d-06 is client-side.

<a id="m3"></a>
## M3: messaging core (graded; checklist voided for O1 by the coverage verdict)

- **API:** `dmCreate` from either side returns the same id with
  `duplicate:true`. Two groups with roster alice, bob, carol are distinct.
  A non-admin's remove, add, rename, colour, promote, description and
  disappearing changes are all refused `NOT_ADMIN`.
- **Removed member:**
  - `threadMessages` is refused `NOT_MEMBER`.
  - `searchAll` for post-removal text returns 0 rows.
  - `quotesFor` exposes no bodies.
  - The post-removal photo asset returns 404.
  - `sendText` is refused `NOT_MEMBER`.
- **Group aggregate** (functional probe):
  - sent, then one member delivered: still `sent`.
  - All delivered: `delivered`.
  - One member read: still `delivered`.
  - A later joiner does not block the state.
  - The slowest member is removed: `read`.
  - A redundant deliver after read does not downgrade.
- **Harness:** see #choreography. m3-a02 fails because no sender avatars are
  rendered.

<a id="m4"></a>
## M4: media, reactions, edit/delete

All from `probes/timed-api.mjs`, under shortened windows.

- **Edit window:**
  - Edit at 0 s: `sent`.
  - Edit at 64.9 s after send: `EDIT_WINDOW`, body unchanged, no `editedAt`.
  - Edit by the other participant: `NOT_AUTHOR`. Edit by an outsider:
    `NOT_FOUND`.
- **Delete window:** delete at 125 s is refused `DELETE_WINDOW`.
- **Delete-for-everyone, image and video:**

  | Fetch | Before delete | After delete |
  |---|---|---|
  | Recipient | 200 (2087 / 49779 bytes, `private, no-store`) | 404 `E_ASSET_UNKNOWN` |
  | Sender | – | 404 `E_ASSET_UNKNOWN` |
  | Outsider | 404 | – |
  | No auth | 401 | – |

  After deletion the row is a tombstone with photo, clip and body cleared.

<a id="m5"></a>
## M5: ephemeral, config, search

**Server refusal with no client** (`probes/expiry-web.mjs`, part 1):
- DM creator set `24h` (TTL 180 s), sent text plus a photo, then set `off`
  and sent a control message.
- On the first poll after expiry (45.6 s later, within the 5 min bound), the
  expired text and photo were absent for recipient and sender from
  `threadMessages`, `historyPage`, `searchChat`, `searchAll` and `quotesFor`.
  The asset returned 404, and the control message remained.
- The DM counterpart's `setDisappearing`, `setChatColor` and
  `setChatBackground` were refused `E_RULE` (d-02). The first timed-api
  attempt also hit this, so m5-a01 was re-run with the creator.

**Client purge**, part 2 (grace ↔ henry, five henry browser contexts; the
first run crashed on grader navigation code and was re-run):

| Client | Observation |
|---|---|
| Connected | Bubble gone 0.5 s after expiry |
| Warm-offline (`setOffline`) | Before expiry: bubble shown, offline search 1 result with offline banner. After expiry, still offline: 0 bubbles, 0 search results. On reconnect: 0 bubbles, 0 results |
| Closed, relaunched online | Expired bubble never rendered in 10 s; search 0 |
| Closed, relaunched with backend aborted (web assets served) | Conversation opened from the device store; expired bubble never rendered; offline search 0 |

**View-once:**
- Recipient's first asset fetch: 200. Second: 410 `E_ASSET_VIEWED`.
- A second `openViewOnce`: `ALREADY_VIEWED`.
- Fetching twice without calling `openViewOnce` also returns 200 then 410.
- An outsider's open is refused and their fetch returns 404.

**Search UI** (as alice):
- People scope `car` → "Carol Chen @carol" first. `CAR` gives the same result.
- All-messages `coffee` → 3 results grouped under "WEEKEND PLANS" and
  "DIRECT MESSAGE".
- In-chat (Weekend Plans) `coffee` → the two seeded coffee messages.
- The API matches `cof` and `COFFEE` but not mid-word `offee`, which is not
  required.

<a id="m6"></a>
## M6: push seam, custom-client API, adapter

- **Push, group of three** (`probes/functional-api.mjs`): 6 `notify` payloads,
  one per non-sender member per message, with keys
  `{chatId, preview, senderDisplayName, targetUserId}`. Text preview is the
  first 80 characters, including multi-byte `é`; media previews are
  `Video` and `Photo`. The grader-run suite also covered the offline-peer
  payload and the view-once `Photo` preview.
- **`custom-client-demo.mjs`**, run directly: `STEP=AUTH/LIST/PAGE/SEND/RECEIVE`,
  green (`evidence/m6-a10-demo.txt`). The PAGE step pages an empty,
  just-created DM.
- **m6-a12 variation** (`probes/m6-a12.mjs`, API.md operations only): as
  Bob, `login` → `profileByHandle(alice)` → `inbox` → `membersOf` per DM →
  `threadMessages` → `data[0]`, which is the newest row (checked against max
  `at`). The doc's own Weekend Plans example also works.
- **Documentation and field gaps:**
  - API.md never states token expiry or revocation (d-08).
  - History rows lack reaction aggregates and receipt state (d-09).

<a id="native"></a>
## Native / simulator artifacts (M6-1..7, M8-17/18, O4)

- No simulator-status file, native receipt or recording exists. All grader
  and lane segment summaries carry `simulator = null`, and
  `requiredExternal = []`.
- `dist-ios*` holds iOS Hermes `.hbc` exports for M1, M2, M3 and one final
  export only.
- The native assertions are recorded `not-run` (not-passed). The web warm-offline
  checks and the grader's own backend-down web relaunch are **not** used as
  native or O4 evidence.

<a id="m7"></a>
## M7

M7 is the later fresh-session milestone (ENVIRONMENT.md) and had not been
attempted, so all nine assertions are `not-run`. m7-a09's condition does hold,
since the lane recorded prior greens, but its milestone never ran.

<a id="m8"></a>
## M8: insights and trending

**Insights** (as alice):
- UI tiles read 18 posts / 3 likes / 4 reposts / 4 replies / 4 followers /
  2 following. These equal `myInsights` and independent `snapback4 sql`
  counts over posts, likes, reposts, replies and follows.
- There are 7 day rows, and empty days render as 0.
- **Buckets are rolling 24 h windows:** `dayStart` was
  2026-09-14T00:19:36Z, not midnight UTC. Rows are labelled with the browser's
  local weekday, so posts created 2026-09-15 UTC (Tuesday) show under "Mon"
  (m8-a03 fail, `evidence/ui/m8-insights.png`).

**Trending** (`probes/trending-window.mjs`):
- A post with 4 likes ranked #1.
- After the same author posted 205 newer posts, it was **absent** from
  Trending: top-10 likes were all 0 and `complete: false`.
- Cause: `trending()` only reads `posts[at >= cutoff] last 200 by byTime`
  (m8-a05 fail).
- Tie order `sort('-likes','-at')` and the 24 h cutoff match the brief
  (source inspection).

<a id="m8-digest"></a>
## M8: scheduled digest (`probes/digest.mjs`; no clients for these users)

**Setup.** Periods are P1 = 00:30–00:32Z, P2 = 00:32–00:34Z and
P3 = 00:34–00:36Z. Users: dA, dB, dC, and dQ (who does nothing).

**P1 activity (00:30:03Z):**
- dB and dC follow dA. dA posts twice.
- dB ↔ dA DM: dB sends 3 messages, dA sends 1, then dB marks the DM read.
- G1 (dC admin, with dA): dC sends 3 messages and deletes 1.
- G2 (dB and dC; dA not a member): 5 messages.
- G3 (dB admin): dB removes dA, then sends 2 messages.

**Emitted P1 digests** (logged 00:32:00.31Z, exactly one per user):

| User | newFollowers | newPostsInFollowing | unreadMessages | unreadChats |
|---|---|---|---|---|
| dA | 2 | 2 | 5 | 2 |
| dB | 0 | 2 | 1 | 1 |
| dC | 0 | 2 | 4 | 1 |
| dQ | – | – | – | – (no digest) |

- dA's unread count excludes the tombstoned message, G2 and post-removal G3.
- dA's `newPostsInFollowing = 2` counts dA's own posts. That is consistent
  with the Following feed including the viewer's own posts.

**Restart and later periods:**
- **P2:** dA follows dB. At 00:32:50Z (mid-P2) the backend was SIGTERMed and
  restarted, down 0.8 s.
- **Tick 00:33Z** re-evaluated P1 and emitted nothing new.
- **P2 digest:** only dB {nf 1, np 0, um 0, uc 0}, logged 00:34:00.80Z.
- **P3:** no activity and no digests.
- **Final tally:** each (user, period) pair has exactly one digest. The
  restart caused no double emission.

<a id="defects"></a>
## Defects beyond the checklist

| Id | Severity | Milestone | Summary | Evidence |
|---|---|---|---|---|
| d-01 | major | M1 | A new web signup can never create a profile: the edit screen waits forever on a null `myProfile` | `evidence/new-user-profile-*.jsonl`, `ui/m1-new-user-profile-edit.png`, `app/profile/edit.tsx:21` |
| d-02 | major | M5 | The DM counterpart cannot set disappearing, colour or background (`E_RULE`; `conversations.update` requires admin) | `expiry-web-*.jsonl` `dm-member-setting-rights`, `schema.q:220,695` |
| d-03 | major | M2 | Unfollow leaves the unfollowed account's reposts in Following (delete keyed by original author) | `functional-api-*.jsonl`, `schema.q:607-609` |
| d-04 | minor | M2 | Unfollowing an author removes a still-followed account's repost of that author | `functional-api-*.jsonl` |
| d-05 | minor | M2 | Un-repost leaves orphaned follower feed rows; the UI hides them, so pages come up short | `functional-api-*.jsonl`, `schema.q:658-665` |
| d-06 | minor | M2 | Web client intermittently shows a stale direct hit after unfollow plus repost (server correct) | `choreo-run1.jsonl`, `reproj-*.jsonl` |
| d-07 | minor | M6 | Warm-offline flush intermittently not visible within 10 s (grader 3/5; lane 6/12 failing) | `choreo-run2/3`, reruns meta |
| d-08 | minor | M6 | API.md lacks the token expiry and revocation story | `API.md` |
| d-09 | minor | M6 | History rows lack reaction aggregates and receipt state from the field manifest | `functional-api-*.jsonl` `field-manifest` |
| d-10 | cosmetic | M1 | Duplicate-handle and duplicate-email errors show raw codes | UI screenshots |

**Trust boundaries that held** (exploration only, not scored probes):
- Outsider reads of a DM via `threadMessages`, `historyPage`,
  `convoReactions`, `convoAggregates`, `typingIn`, `membersOf`, `myViews` and
  `searchChat` were all `NOT_MEMBER`.
- Outsider `quotesFor`, `searchAll` and `searchAllOnline` returned 0 rows.
- The `/sync` snapshot leaked 0 DM events.
- Outsider writes (send, react, markRead, colour, disappearing, typing) were
  refused.
- Also held: removed-member cutoff, asset refusal after view-once, delete and
  expiry, edit and delete windows, logout revocation, and digest authorization.

<a id="o1"></a>
## O-dimension scores

- **O1 = 58.** Credited 84 of 119: M1 13, M2 27, M3 0 (14/15 observed),
  M4 12, M5 12, M6 6, M7 0, M8 14. Observed passes total 98 of 119. The score
  interpolates between the ~30 and ~60 anchors, just below "M1–M4 solid, later
  milestones patchy": M3 is voided by the coverage verdict, native proofs are
  absent, and M7 was not run.
- **O2 = 45.** Three majors, one of them in core onboarding, plus six minor and
  one cosmetic. Between ~30 "multiple high-severity defects in core flows" and
  ~60 "a few medium defects off the happy path".
- **O3 = null.** No committed holdout probe set (deviation 1).
- **O4 = 25.** M6 is green, so O4 applies, but no native artifact exists. Near
  the ~30 anchor. The web warm-offline evidence (ordered flush that is flaky,
  M8 dual-offline convergence and receipts, warm-offline search) is partial and
  not native.
- **O5 = null.** No run record and no scale-replay evidence, so the replay was
  never attempted. Only the M6 sample-50 conformance replay ran.

No weighted total, efficiency statistic or cross-lane comparison is computed.

## Files produced (all under `grading/`)

- `grader-report.json`: 101 M1–M7 results, schema-validated with AJV 2020 by
  `build-report.mjs`.
- `m8-assertion-results.json`: 18 M8 results, record-validated.
- `trace.md`: this file.
- `DONE`.
- Supporting material:
  - `evidence/`: receipts, probe JSONL, screenshots.
  - `probes/`: grader scripts.
  - `logs/`: process logs with service tokens redacted, and `pids.txt`.
  - `harness/`, `lib/`: grader harness copy.
  - `checkout/`: working copy of the lane.
  - `run-choreo.mjs`, `grader-adapter.json`, `build-report.mjs`.
