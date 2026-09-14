# Grader trace — astra-snapback4 (social-messenger, full scope)

Sanitized evidence and action trace for one independent grading session. Credentials, session and service tokens, fixture email addresses and passwords are redacted or omitted. Principal IDs and message bodies appear only where they are grader-generated markers. Raw transcripts are not published.

- Grader: family `claude`, model `claude-opus-5`. Not same-family graded. Calibration **not passed**, so this grade is labeled **uncalibrated-grader**.
- Wave: `full-3models-astra`; probe set `none-uncommitted`. This is an N=1 calibration run, not claim-eligible.
- Lane: `snapback4-0.2.6` (npm snapback4@0.2.6, snapback4-expo@0.2.1); run scope `full`. Nothing is struck (ENVIRONMENT.md).
- Frozen inputs (sha256):
  - `assertions.json` e15c3952…32d04 (manifest 0.3.0-m8, 119 unique IDs)
  - `applicability.json` b3d45805…7a1
  - `grader-report.schema.json` 82d21337…30
  - `grader-prompt.md` 97ce0e44…ed6
- Session wall: start epoch 1789364868; servers stopped at 1789367217.
- Outputs:
  - `grading/grader-report.json` (101 M1–M7 IDs, schema-valid)
  - `grading/m8-assertion-results.json` (18 M8 IDs)
  - this trace
  - supporting evidence under `grading/evidence/`, `grading/checkout/evidence/` and `grading/checkout/grader-instance/evidence/`
  - grader scripts under `grading/grader-scripts/`

## 1. Contamination check

I did not open `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` or `run-log.md`, or any other lane. A directory listing showed those names, and a listing of `evidence/` showed `m5-diary-draft.md`; none of them were opened or read.

One count-only `grep -c`/`grep -l` for password strings ran over the lane's `evidence/` tree. It printed only counts and file names, all zero, so no content from any file reached the session.

`run-record.json` is absent. From `run-record.pending.json` I read only its key list, the milestone status block, `clocks.replay`, `deploymentPosture`, `termination` and `grading`; no self-scores or experience scores were read.

**Session outcome:** completed, not contaminated.

## 2. Environment, ports and processes

- macOS arm64, Node 24.18.0.
- Playwright 1.62.1 from the lane's copied choreography directory, run from my own copy. The browser was the chromium-1234 build already in the user cache; nothing was written into `instrument/`.
- Load averages were high throughout (other sessions): 1-minute load 11–24. Each timing record lists its load in §9.

**Clean checkout.** `grading/checkout/` holds APFS clones of the lane's product and tooling files:

- `app lib ui public snapback scripts config choreography metering node_modules`
- `package*.json API.md README.md app.json tsconfig.json .gitignore`
- a symlink to `instrument`

It has an empty `.snapback4/` (fresh store) and an empty `evidence/`. Narrative files, the lane's evidence and its instance directories were excluded. `diff -rq` of the source directories against the lane showed no differences.

**Servers started, documented commands, ports 49300–49319 only:**

| Name | Command (from checkout) | Port | PIDs recorded |
|---|---|---|---|
| backend (dev) | `CLIQUE_WINDOWS_CONFIG=…/windows.shortened.json CLIQUE_DIGEST_CONFIG=…/digest.shortened.json npm run backend` | 49300 | 5571 (npm), 5595 (sh), 5611 (snapback4 wrapper), 5614 (binary) |
| web | `npm start` (Expo web) | 49301 | 5722 (npm), 5739 (expo); no children |
| push worker | `node scripts/push-worker.mjs` (fresh service token) | — | 12397 |
| aging instance (needed by the m8 suite) | `node scripts/start-isolated.mjs aging-instance 49304` | 49304 | 38057, 38072 |
| grader digest instance | `snapback4 dev --port 49305` in `checkout/grader-instance` (copied `.q` files, replayMode false, shortened configs) | 49305 | 93022/93024 → 71292/71293 → 99328/99339 → 29484/29490 → 46356/46357 (restarts, see §5.4) |
| grader digest push worker | `push-worker.mjs` with `CLIQUE_BACKEND_URL=:49305` | — | 94591 |

Active configs, confirmed in `config/active-windows.json` and `active-digest.json`:

- Windows: edit 60 s, delete 120 s, disappearing 24h→180 s and 7d→300 s.
- Digest: every 2 min.

Seeds: `npm run seed -- --segment m1|m2|m3` gave 16, 52 and 18 settled lines.

## 3. Phase 1 — builder suite (`npm run acceptance -- --milestone mN`) on the clean checkout

| Milestone | Result | Load (1-min) | Notes |
|---|---|---|---|
| m1 | **pass** (rerun) | 19.9 → 17.2 | First attempt: `page.goto` timeout 30 s while Expo compiled the cold web bundle. That is a grader-environment failure; the phase was re-run once after warming the bundle and passed. |
| m2 | pass (22 IDs) | 22.20 | |
| m3 | pass (7) | 23.39 | |
| m4 | pass (5 + extra asset-revocation check) | 23.39 | |
| m5 | pass (6) | 22.88 | |
| m6 | pass (5) | 22.88 | Includes the 36 s presence wait, custom-client demo in an isolated directory, and the sample-50 replay with fixture validator. |
| m8 | pass (6) | 23.83 | m8-a06 uses the aging instance on 49304. |

Receipts: `grading/checkout/evidence/suite-mN.json`, `coverage-mN.json`, `grader-suite-mN.log`. Every suite-required assertion reported `pass`.

## 4. Phase 2 — coverage-manifest spot-verification

Verdict: **honest**.

**Sampled:** m1-a03, m1-a11, m2-a08, m2-a10, m2-a16, m2-a22, m2-a24, m3-a11, m3-a15, m4-a01, m4-a09, m5-a05, m5-a09, m6-a08, m6-a11, m6-a13, m8-a01, m8-a06.

**Method:** I read each `check([...ids], fn)` block in `scripts/acceptance-mN.mjs` and confirmed it exercises the assertion's observable.

Weak but honest mappings:

- m2-a10 and m2-a11 share the unfollow check; the unfollowed author stands in for a never-followed one.
- m2-a16 asserts repost attribution through the API entry kind and actor. The harness separately observed the rendered label.
- m3-a15 compares only DM message IDs; I verified broader idempotency independently (§5.5).
- m8-a06 injects a synthetic two-day-old post and its trending row through the dev-only `/seed` on an isolated backend. The brief's no-backdating replay rule makes this a reasonable fixture, and the source confirms trending rows expire at post time + 24 h.
- `custom-client-demo.mjs` authenticates (or uses a token), lists conversations, pages history with the cursor, sends text, and receives by polling, checking the full field manifest.

No milestone is adjudicated dishonest.

## 5. Phase 3 — independent checklist execution

### 5.1 Web choreography, grader-run harness (`node scripts/choreo.mjs mN`, receipts in `grading/checkout/evidence/choreo-mN.jsonl`)

| Segment | Green | Load start→end | Assertions |
|---|---|---|---|
| m1 | yes | 13.97→16.53 | profile-edit-live-visibility, session-persists-on-relaunch, logout-remains-signed-out-on-relaunch |
| m2 | yes | 16.53→18.27 | text, image and video live update; follow-unfollow-live-projection (attempt 1 timed out, 2 and 3 passed); feed avatar and name; like/unlike; repost attribution; repost Following surface; reply thread projection |
| m3 run 1 | yes | 18.27→15.66 | dm-live-messages; sender avatar; typing v2; receipt transitions; group receipt waits for slowest member; add/promote/remove/leave with live cutoff and retained history; quoted reply |
| m3 runs 2 and 3 | yes, yes | 22.49→20.84, 19.73→19.05 | re-run for three receipt-transition measurements (`choreo-m3-grader-attempt{1,2,3}.jsonl`) |
| m4 | yes | 15.66→14.93 | photo live; video playback; reaction replace/remove; edit live; delete tombstone |
| m5 run 1 | **no** | 14.93→12.07 | chat color/background sync, view-once and disappearing purge passed. **warm-offline-search-over-synced-messages failed**: synced results rendered offline, but `sm-search-offline` was not visible within 10 s. (`choreo-m5-grader-attempt1.jsonl`) |
| m5 rerun | **no** | 21.63→21.31 | same single failure, same mode (`choreo-m5.jsonl`) |
| m6 | yes | 12.07→12.15 | offline-message-queue-flush-in-order (web): pending, ordered flush, read. `supplementalExternal ios-simulator-m6` status **not-recorded** |
| m8 | yes | 12.15→11.81 | m8-a02 insights like refresh (6→7); a13 same-account live; a14 cross-device read; a15 dual-offline convergence; a16 receipts. `ios-simulator-m8` status **not-recorded** |

The builder's own m5 receipts passed the warm-offline check in about 0.77 s (lane `evidence/choreo-m5*.jsonl`). The difference is explained in §5.9.

### 5.2 API probes (`grader-scripts/api-probes.mjs`, output `grading/evidence/api-probes-49300.json`)

Four fresh grader accounts on 49300; load 16.02; about 122 s including window waits. Only API.md routes were used. Every check passed except the m6-a12 aggregate flag, which is explained below.

- **m1-a07:** after logout, the old bearer got 401 E_AUTH on `/q/me`, `custom.history`, `chat.send` and `POST /assets`; the sibling session was unaffected.
- **Auth extras:** refresh invalidates the old bearer; logout-all revoked 3 sessions; a wrong password and a 7-character signup password were both refused; a duplicate handle was refused E_CONSTRAINT.
- **Cross-user DM (non-member):**
  - Reads: `custom.history` NOT_MEMBER; `chat.history` / `historyRows` / `conversation` / `members` / `typers` / `search.*` / `inbox` returned nothing about the conversation.
  - Writes: send, react, ack, edit, delete, customize, typing, add-self, promote-self and remove-other were all refused.
  - Reusing the existing conversation id via createDM or createGroup was refused E_RULE.
  - Post-conditions held: still denied, 2 members, no intrusion text, no reactions, color unchanged.
- **Unauthenticated:** history, inbox and send all refused E_AUTH.
- **Acknowledge ahead of the server:** refused INVALID_SEQUENCE.
- **m5-a06 view-once (DM):**
  - Recipient: first fetch 200 (2081 B), second 410, Range 416.
  - Non-member 404; unauthenticated 401. The sender can still fetch (200).
- **Group view-once:** each member got 200 then 410; the non-member got 404.
- **m4-a12:** asset 200 before delete-for-everyone, then 404 for both recipient and sender. The row has `tombstone=true`, `media=null` and empty text. A non-author delete was refused; react and edit on the tombstone were refused MESSAGE_DELETED.
- **Group non-admin:** remove, add, rename, color, disappearing, promote-self, background and remove-admin were all refused NOT_ADMIN.
- **Removed member:** history NOT_MEMBER, no post-removal text via search, post-removal photo asset 404, send refused, and the group dropped from inbox.
- **m4-a10:** at 62 s, edit and editCaption were refused EDIT_WINDOW_CLOSED; extra timestamp arguments were refused E_INPUT; text unchanged. The in-window edit had succeeded and a non-author edit was refused. **Delete window:** at 122 s, refused DELETE_WINDOW_CLOSED.
- **m6-a12:** following API.md only, as a fixture persona:
  1. login, then paged `chat.inbox` (1 page)
  2. three conversations named "Weekend Plans": the starter group plus two empty groups the m3 suite creates
  3. `custom.history` on the starter group: `data[0].sequence` 9 = inbox `latestSequence` 9, newest-first, all 12 manifest fields present, receipt only on the caller's own messages

  The two empty groups returned `data: []`, exactly as API.md documents. My script's aggregate flag required messages in every match, so it printed FAIL. Judged on the named conversation, the assertion **passes**.

These non-checklist probes are grader-authored, not the wave's holdout probes, so they do not score O3.

### 5.3 Expiry probe m5-a01..a03 (`grader-scripts/expiry-probe.mjs`, output `grading/evidence/expiry-probe.json`, screens `grading/evidence/screens/expiry-*.png`)

Load 14.37→16.04.

**Setup:** four fresh accounts, two DMs. One non-creator member set disappearing to "24h" (TTL measured at 180 s). I sent a non-expiring control message before the setting change, then expiring text plus a photo.

**Both DM1 clients synced, then closed** (persistent Chromium profiles):

- Before expiry, the recipient's search found the expiring token.
- Both clients were closed 178 s before expiry.
- A DM2 recipient client stayed open throughout.

**Results:**

- **Server refusal:** at the first poll 0.864 s after `expiresAt`, the message was gone from both members' history, `search.message` and `search.allMessages`; the photo asset returned 404; the control was retained.
- **Connected purge:** the open DM2 client removed the expired bubble 0.853 s after expiry, and the control stayed.
- **Reconnect purge:** both DM1 clients, relaunched from their persistent profiles, showed the control and no expired bubble, within 0.24 s and 0.23 s of opening the chat.
- **Offline search after sync:** with the browser offline, the control token was found locally and the expired token returned 0 results. The `sm-search-offline` indicator did not appear within 20 s.

### 5.4 Digest probes m8-a08..a12 (grader instance on 49305; log `grading/checkout/grader-instance/evidence/digest-push.jsonl`; results `grading/evidence/digest-probe-rerun.json`)

No client ever connected to 49305.

**Seeded period [1789365600000, +120 s).** Seeding began 4 s into the period. `snapback4 doctor` recorded the dailyDigest run. Expected counts were computed independently from `starter-m1..m3.log`:

- **followers:** alice 4, bob 2, carol 1, dave 1, erin 1, frank 1, grace 2, henry 0
- **newPostsInFollowing:** alice 6, bob 6, carol 3, dave 3, erin 6, frank 3, grace 3, henry 6
- **unread messages / chats:** alice 9/2, bob 10/2, carol 5/1, others 0/0

Observed: exactly **8 digests, one per persona, every count equal**, including henry (0 followers but 6 posts in following).

**Activity period 1 (1789365960000), original run.** The grader performed:

- erin follows dave
- frank creates a private group with grace and henry, sends 3 messages, deletes 1
- bob sends 1 DM to alice
- grace posts

Then a mid-period restart. Observed 5 digests: dave {1,0,0,0}, grace {0,0,2,1}, henry {0,1,2,1}, frank {0,1,0,0}, alice {0,0,1,1}. No digest for bob, carol or erin.

The script then crashed on my side at the second restart (an uncaught Node fetch socket error, `setTypeOfService EINVAL`), leaving 49305 down for about 90 s. **This is a grader tooling failure.** I restarted the backend by hand and re-ran the phase once with the error handled.

**Activity period 2 (1789366320000), rerun.** Same pattern, but with the follow erin→grace. Expected erin {0,1,0,0}, grace {1,0,2,1}, henry {0,1,2,1}, frank {0,1,0,0}, alice {0,0,1,1}.

- Restart at 60 s into the period, and again right after emission.
- Observed exactly those 5 digests, all 20 counts matching. No digest for bob, carol or dave.
- Quiet periods before and after emitted 0.
- The seeded period still had 8 rows and activity period 1 still had 5, so nothing was re-emitted after the restarts or the outage.

**Results:** m8-a08 pass, m8-a09 pass, m8-a10 pass, m8-a11 pass, m8-a12 pass. For m8-a12:

- Private-group messages counted only for its members; alice's unread count is her DM only (1).
- The tombstoned message is excluded (2, not 3).

### 5.5 Seed idempotency m3-a15 (`grader-scripts/seed-idempotency.mjs`, output `grading/evidence/seed-idempotency.json`)

On 49305 I snapshotted per-persona state:

- profile handle and avatar
- follower and following counts
- authored post IDs
- like, repost and reply sums
- conversations, and per-conversation message and reaction counts
- global-feed entry uniqueness

Then I ran the documented seed for m1, m2 and m3 twice (6 runs, all pass) and took a second snapshot. **0 differences**; the global feed had 30 entries, all unique.

### 5.6 Live follower count m2-a07 (`grader-scripts/follower-count-live.mjs`, `follower-count-diagnostic.json`)

The frozen harness has no follower-count observation, so I ran a two-client web check.

**Check** (load 15.03→12.73): Alice watched `sm-profile-follower-count` on her own profile while Bob tapped `sm-profile-follow` on it. All 3 attempts failed: Alice's count stayed at 4 for 10 s.

**Diagnostic** (load 11.04): sampled 0.5, 2, 5, 10 and 15 s after each click.

- The server `followState.followers` changed 4→3 and 3→4 within 0.5 s.
- Bob's view changed with it.
- Alice's view did not change within 15 s, and after a reload it showed the new value.

**Source:** `follows` rows sync only to `.followerId`, and `followerCounts` is a maintain over follows grouped by `followedId`, so it never reaches the followed user's device.

**Result: fail** (d-01).

### 5.7 Source inspection

**m1-a12:**

- `snapback/schema.q:1` is `use identity password`, the platform's built-in password accounts.
- The snapback4 README (§4 Sign-in) documents bounded Argon2 work.
- Stored credential hashes in the grader instance store carry the prefix `$argon2id$v=19$m=19456,t=2,p=1`, the OWASP-published parameters.

**m1-a13.** Count-only scans for the eight fixture passwords, the acceptance-suite password and the grader probe passwords found **0** hits, and no `"password":` key, in:

- the grader dev store and WAL
- the grader digest-instance store and WAL
- the lane's dev store and WAL
- the served web dev bundle (6.65 MB)
- the M8 iOS Hermes bundle
- all .log/.jsonl/.json files under the checkout and the lane's evidence

`lib/state.tsx` clears the password after submit, and only the session is persisted (SecureStore on native, localStorage on web).

**Server rules reviewed:** `chat.q`, `schema.q`, `timeline.q`, `insights.q`, `digest.q`, `search.q`, `custom.q`.

- Windows are enforced against `now` in the mutations.
- Expiry uses `expire at`; view-once uses an `image … once` column; the notify effect is emitted only when the member has no connected client.
- Clients reach tables only through `/m/<op>` mutations (README §2 and the wire section). The permissive table rules are therefore not a direct-write bypass.
- `/seed` is dev-only and same-machine (README §5). It is a documented platform dev surface, used here only by the m8-a06 fixture.

**Hardcoded fixture identifiers** in shipped UI (d-06): `app/search.tsx:31` falls back to `"d-alice-bob"`, and `lib/chat.tsx:121` special-cases `"g-starter"`.

### 5.8 Insights semantics (`grading/tmp/insights-semantics.mjs`, output `grading/evidence/insights-semantics.json`)

**Setup:** two fresh accounts. U posted, then liked, replied to and reposted their own post. V then liked, replied to and reposted it, and followed U.

**U's totals:**

| Step | posts | likesReceived | repostsReceived | repliesReceived | followers |
|---|---|---|---|---|---|
| Fresh | 0 | 0 | 0 | 0 | 0 |
| After own post | 1 | 0 | 0 | 0 | 0 |
| After self-like, self-reply, self-repost | 2 | 1 | 1 | 1 | 0 |
| After V's activity | 2 | 2 | 2 | 2 | 1 |

`days` had 7 rows, today's counts matched, and prior days were zero. Trending returned 10 rows with no replies.

**Findings:** self-activity counts as "received", and replies count as posts (d-05, minor). m8-a03 and m8-a04 are corroborated.

### 5.9 Offline-state latency and search routing

**`grader-scripts/offline-latency.mjs`** (`grading/evidence/offline-latency.json`, load 16.65→14.61). Alice sat on `/search`; I cut connectivity and typed a synced token. Results appeared about 1 ms later in all three attempts (4, 1 and 4 results).

| Attempt | `sm-search-offline` appeared after the cut | Cleared after reconnect |
|---|---|---|
| 1 | 22,071 ms | 1.9 s |
| 2 | 18,512 ms | 1.0 s |
| 3 | 1,743 ms | 1.0 s |

Interpretation:

- Offline search works from the local device store.
- The app's offline link state often surfaces only after an in-flight request fails, beyond the harness's 10 s ceiling. That explains the 2/2 harness red on this assertion and the builder's fast pass.
- **m5-a12** is graded **pass** on its observable ("search over previously synced messages still returns results"). The late signal is filed as d-04 (minor).

**`grader-scripts/search-route-check.mjs`, then `search-route-recheck.mjs`** (`grading/evidence/search-route-recheck.json`):

- The first check was inconclusive because the target DM message sat outside the 50-message rendered window.
- The recheck sent a fresh unique DM token. Tapping its global-search result navigated to `/conversation/group/d-alice-bob`, and the DM rendered with the token bubble and composer.
- The group result also rendered correctly.
- The DM-through-group-route URL is cosmetic (d-07).

### 5.10 Native (simulator) artifacts, scored from artifacts only

No simulator was driven by the grader.

**What exists:**

- `artifacts/m{1,2,3,4,5,6,8}-ios` contain only Hermes bundle exports: hashes in the lane's `evidence/native-artifacts.json`, plus `metadata.json`, assets and `device.wasm`.
- The builder's and my harness summaries both carry `supplementalExternal`: `ios-simulator-m6` and `ios-simulator-m8` are `status: not-recorded`, with pass `null` and receipt `null`.
- No recording or structured native receipt exists.

The builder's web probe PNGs (for example `m8-restarted-queue.png`) are builder assertions, not harness artifacts, and were not used.

**Result:** m6-a01..a07 and m8-a17/a18 **fail** (d-02, d-03). Per the brief, missing native evidence leaves the proof absent; it does not pass.

### 5.11 Scale replay record, the O5 input

Sources: lane `evidence/scale-clock.json`, `scale-verify-final.json`, `scale-entity-totals.json`, `scale-settlement-accounting.json`, `scale-probes-{10pct,50pct,final}.json`, `scale-performance-summary.json`, `scale-browser-*.json`; run-record `clocks.replay`.

**Replay:**

- Attempted. Replay wall 3481 s against a 14400 s cap (24.2%); probe wall of 87.8 s excluded; cap not exhausted.
- Settle accounting: 167,157 unique scale actions plus 86 starter receipts.
- Final verification passed every check, including the named fixtures: u0500 has 500 follows and 100 conversations, u0005 5 follows, u0900 900 followers and 200 posts, u0901 exactly [u0001..u0004, u0900], g0001 50 members and 10,000 messages.
- Entity totals equal expected: 1,008 users, 50,228 posts, 100,015 messages, and so on.
- The hidden seeded sample could not run because no wave seed was committed.

**Degradation rules**, recomputed from the checkpoint p95s (k=20 after 3 warm-ups):

| Rule | Numbers | Result |
|---|---|---|
| History page 50 / page 1 | 3.21 / 2.56 = 1.25× | pass |
| Following 500 / 5 | 0.02× | pass |
| Celebrity follower / 5-follow | 0.71× | pass |
| Celebrity write | 1.49× | pass |
| Search full / 10% | 0.96× | pass |
| Search mid-curve | 12.82 ≤ 14.10 | pass |
| Insights full / 10% | 0.88× | pass |
| **Insights mid-curve** | 50% p95 1.440 ms; line value 1.157 + (1.020 − 1.157) × 40/90 = 1.096 | **fail** |
| Trending full / 10% | 0.82× | pass |
| **Trending mid-curve** | 50% p95 2.106 ms; line value 2.252 + (1.852 − 2.252) × 40/90 = 2.074 | **fail** |
| 50-member send/render | without timeout | pass |
| 100-conversation cold sync | 10.1, 14.3 and 21.4 s | completed |

The first 50% attempt also had a browser probe **time out** after 30 s (`scale-clock.json priorFailure`; `scale-browser-50pct-attempt1.json`). The lane changed its implementation after the 10% checkpoint, and its own summary says `pass:false` and claims no O5 grade.

## 6. Phase 4 — holdout probes: skipped (deviation 1)

No holdout probe set was committed for this wave; `probes/rotation-log.md` has no rows. `probeSetSha256` = `none-uncommitted`, `probeResults` = `[]`, and no probes were invented. The frozen `probeResults` array has no container-level note field, so this note appears in the report's `notes` and here.

## 7. Defects (severity-bucketed)

| ID | Severity | Milestone | Summary | Evidence |
|---|---|---|---|---|
| d-01 | major | M2 | Follower count not live on the followed user's own client (aggregate never reaches that device) | §5.6 |
| d-02 | major | M6 | No native simulator artifact for the M6 offline proofs | §5.10 |
| d-03 | major | M8 | No native simulator artifact for the M8 durable-queue restart | §5.10 |
| d-04 | minor | M5 | Offline link state surfaces 1.7–22 s after connectivity loss; the harness warm-offline check fails at 10 s although offline search works | §5.1, §5.9 |
| d-05 | minor | M8 | Insights "received" totals include self-likes, self-replies and self-reposts; posts totals include replies | §5.8 |
| d-06 | minor | M5 | Starter-fixture conversation IDs hardcoded in shipped search and group-route code | §5.7 |
| d-07 | cosmetic | M5 | DM search results route through `/conversation/group/<dmId>` (renders correctly) | §5.9 |

No crash, data loss, authorization bypass or wrong digest count was found.

## 8. O-dimension scoring

**O1 — 74.**
- Anchors: between ~60 ("M1–M4 solid, later milestones patchy or failed on cap") and ~90 ("every in-scope milestone green, including platform-proof artifacts").
- 119 full-scope results: 100 pass, 10 fail, 9 not-run (M7, which counts as not passed).
- The only functional failure is m2-a07; the other 9 failures are absent native artifacts.

**O2 — 76.**
- Anchors: between ~60 ("a few medium defects off the happy path") and ~90 ("only cosmetic nits").
- Beyond the checklist: 3 minor and 1 cosmetic defect.
- Extensive negative probing found no further faults.

**O3 — null.**
- Applicable (M6 green, M1–M5 attempted), but its only admissible basis is the wave's holdout probes, which do not exist (deviation 1).
- The grader trust-boundary probes in §5.2 all passed but are non-scored.

**O4 — 35.**
- Anchors: just above ~30 ("cold-start offline shows an empty or broken app"), well below ~60 ("reads work; offline writes lost or mis-ordered, or receipts wrong after flush"). ~90 needs the native proof.
- No native proof exists.
- Web artifacts demonstrate warm-offline queued writes flushing in order to read, and two-client offline convergence with receipts.
- Warm-offline search works, but its offline-state proof failed the harness twice.
- The gap is honestly recorded as not-recorded rather than claimed.

**O5 — band 30**, first match in order 0, 30, 60, 90, 75.
- 0 does not fire: manifest conformance holds on available evidence and the cap was not exhausted.
- 30 fires: the insights and trending mid-curve degradation rules fail, and one probe timed out at the 50% checkpoint in the first attempt.

No weighted total, efficiency statistic or cross-lane comparison is computed.

## 9. Timing records (best-of-3), with machine load

Load is the 1-minute load average at the start and end of the measuring run, from `uptime`. Live-update bounds use the harness's 10 s observation ceiling, since the brief sets no number; typing uses the brief's 2 s and 5 s.

| Subject | Measurements (ms) | Best | Bound | Pass | Load |
|---|---|---|---|---|---|
| m1-a09 (other client sees name/bio) | 131.3, 116.3, 235.8 | 116.3 | 10000 | yes | 13.97→16.53 |
| m2-a04 text post live | 105.6, 92.5, 93.8 | 92.5 | 10000 | yes | 16.53→18.27 |
| m2-a04/image | 120.7, 106.2, 102.4 | 102.4 | 10000 | yes | 16.53→18.27 |
| m2-a04/video | 101.3, 95.7, 98.5 | 95.7 | 10000 | yes | 16.53→18.27 |
| m2-a07 follower count live on Alice's client | 10000, 10000, 10000 (censored: no change before timeout; diagnostic showed none by 15 s) | — | 10000 | **no** | 15.03→12.73 (diagnostic 11.04) |
| m2-a14 like count live | 113.1, 56.0, 57.5 | 56.0 | 10000 | yes | 16.53→18.27 |
| m2-a19 reply count live | 54.4, 56.5, 54.7 | 54.4 | 10000 | yes | 16.53→18.27 |
| m3-a01 DM live | 365.9, 343.6, 444.6 | 343.6 | 10000 | yes | 18.27→15.66 |
| m3-a06 typing visible after last keystroke | 10.7, 21.8, 25.0 | 10.7 | 2000 | yes | 18.27→15.66 |
| m3-a07 typing expiry after last keystroke | 4305.2, 4315.8, 3820.5 | 3820.5 | 5000 | yes | 18.27→15.66 |
| m3-a08 receipt transitions (check wall, 3 separate m3 runs) | 2331.5, 2745.1, 3367.7 | 2331.5 | 10000 | yes | 18.27→15.66 / 22.49→20.84 / 19.73→19.05 |
| m4-a02 photo live render | 446.6, 357.8, 467.2 | 357.8 | 10000 | yes | 15.66→14.93 |
| m4-a05 reaction live | 183.1, 199.8, 157.2 | 157.2 | 10000 | yes | 15.66→14.93 |
| m4-a08 edit live | 178.5, 230.5, 272.6 | 178.5 | 10000 | yes | 15.66→14.93 |

m3 runs 2 and 3 also passed typing: visible after 24.5–76.5 ms, expired after 3884–4406 ms. DM live took 780–1450 ms under the higher load.

## 10. Result partition, schema limitation, and measurement-coverage gap

**Totals.** The frozen manifest has **119** unique assertion IDs: M1 13, M2 27, M3 15, M4 12, M5 12, M6 13, M7 9, M8 18. All 119 were graded in this one session.

**Frozen schema limitation.** `grader-report.schema.json` restricts `assertionResults` keys to `^m[1-7]-a[0-9]{2}$`. So:

- `grader-report.json` carries exactly the 101 IDs in `GRADER_ASSERTIONS_101.txt`: **84 pass, 8 fail, 9 not-run**.
- The 18 M8 results are in `m8-assertion-results.json`, using the same record shape and enums: **16 pass, 2 fail**.
- No ID appears in both files.
- **Complete 119:** 100 pass, 10 fail, 9 not-run.

**M7.** Not attempted in this continuous session: the orchestrator runs it later as a fresh session. All 9 M7 IDs are `not-run` (pre-evolution state), and m7-a09's conditional regression item applies only once M7 runs.

**Prior measurement-coverage gap.** The September 5 and September 12 grader reports' structured `assertionResults` carried only these same 101 M1–M7 IDs, because of the same schema pattern. Their notes could describe M8 observations, but they provided no machine-comparable 18-ID M8 result set. Comparisons with those waves can therefore use only the prior-101 subtotal. This session's 18 M8 results are new structured measurements with no structured prior counterpart.

## 11. Grader-abort accounting

Two grader-environment failures occurred, in different phases. Each phase was re-run once and succeeded, so no `grader-abort` was recorded.

1. **Phase 1, M1 suite.** Cold Expo bundle page-load timeout; succeeded after warming the bundle.
2. **Phase 3, digest probe.** An uncaught Node fetch socket error during a scripted backend restart left the grader instance down for about 90 s. I restarted it by hand (PIDs recorded) and re-ran the probe with the error handled, on a fresh activity period. The original run's surviving log data is consistent with the rerun.

The report records `rerunsUsed: 1`, meaning one rerun per failed phase. Neither failure is a lane defect.

## 12. Cleanup and redaction

**Processes.** Every PID in §2 still alive at the end got SIGTERM at 1789367202:

- 5614, 5611, 5595, 5571 (dev backend tree)
- 5739, 5722 (Expo web)
- 12397 (dev push worker)
- 38072, 38057 (aging instance)
- 46357, 46356 (grader digest backend)
- 94591 (grader digest push worker)

All exited, and no listeners remained on 49300–49319 at 1789367217. An earlier kill loop sent nothing: zsh does not word-split an unquoted PID variable, and the loop was corrected. Grader-instance PIDs from earlier restarts were already gone. No `pkill` or `killall` was used, and no other process was signalled.

**Credential files.** The service-token files, seed session caches (`seed-sessions.json`, `replay-state.json`), persistent browser profiles and the downloaded web bundle were deleted from `grading/`. Before deletion, a scan found none of those token values in any grading output. The SQLite stores stay under `grading/checkout` for audit; they hold hashed credentials only.
