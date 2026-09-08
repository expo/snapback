# Sanitized evidence/action trace

Publication derivative of the original grader trace (SHA-256
`07860153c42a2ef2957dd442fd25116f0f939397b0c57a5db44a6e127a82cff6`). This copy abstracts machine paths and adds
model/custody disclosures. Original findings remain the grader’s account;
see [root adjudication](../root-adjudication.md) for accepted claim limits.

Independent uncalibrated diagnostic of Clique on snapback2@0.0.19. Credentials, tokens, and generated emails are redacted. Raw transcripts are not published.

## Identity

- Grader family: Grok. Self-report: **Grok 4.6**. Requested/session model: `grok-4.6`; terminal usage model key: `grok-4.6-build`.
- Builder family (dispatch): Codex. sameFamilyGraded=false.
- calibrationPassed=false (declared). O1–O5 recorded null. probeSetSha256=`not-preregistered`; probeResults=[].
- Frozen assertion keys in grader-report.json: M1–M7 only. M8 companion: `results/m8-assertion-results.json`.
- Allowed work: the isolated remote assessment tree and fresh local staging directory. No sibling content, builder diary/transcript/self-scores, or Snapback source reached the assessor; contaminated=false. Custody exception: an early Playwright search attempted a broad home-directory find. It returned only running-task metadata and was immediately killed; no outside path/content or later task-output retrieval reached the assessor. The scope attempt is retained in the private raw transcript.
- Session start: 2026-09-08T13:57:36Z. Session outcome: completed.

## Environment

- Node 24.18.0.
- `node_modules/.bin/snapback2 version` → snapback2 0.0.19.
- Unset: SNAPBACK2_COMPILER, SNAPBACK_BIN, SNAPBACK2_BIN, CARGO_TARGET_DIR, CI.
- SNAPBACK_URL=http://127.0.0.1:53123
- CHOREO_BASE_URL=http://127.0.0.1:53124
- EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:53123
- Ports 53120/53121 were not contacted.

Owned processes (see `results/pids/owned-processes.txt`):

- Backend start: nohup PID 80444, snapback2 child 80452 listening on 53123.
- Web: `expo export --platform web` with EXPO_PUBLIC_SNAPBACK_URL, then `scripts/serve-web.mjs --dir artifacts/assessment-web --port 53124` PID 80772.
- For m8-a11: `snapback2 dev --stop` ended 80444/80452; restart nohup PID 88573, child 88576 on 53123.

## Phase 0 — failed environment, one rerun

First `npm run acceptance -- --milestone m1` failed immediately: missing `harness/benchmarks/tools/social-messenger/choreography/node_modules/playwright/index.mjs`. This was grader environment, not an app defect.

Rerun used (rerunsUsed=1): `npm ci` of the choreography package-lock (playwright 1.62.1, ajv 8.20.0) plus `npx playwright install chromium`. Second acceptance run succeeded.

## Phase 1 — builder suite

Seeded starter logs in order (`npm run seed -- --segment m1` then m2 then m3) against 53123:

- seed-m1: pass, 16 actions
- seed-m2: pass, 52 actions
- seed-m3: pass, 19 actions

Then `npm run acceptance -- --milestone mN` for m1, m2, m3, m4, m5, m6, m8 with SNAPBACK_URL and CHOREO_BASE_URL set. All seven passed in this session. Receipts copied to `results/suite/`:

- suite-m1-1788876102.json
- suite-m2-1788876107.json
- suite-m3-1788876116.json
- suite-m4-1788876120.json
- suite-m5-1788876124.json
- suite-m6-1788876130.json
- suite-m8-1788876134.json

Acceptance also ran `snapback2 check`, `tsc --noEmit`, and `snapback2 test --journeys-only` per milestone.

## Phase 2 — coverage spot-verification

Authority: `app/coverage/*.json` + `app/coverage/manifest.json`, sampled against `scripts/acceptance.mjs` bodies. Child hashes still match the coverage manifest pins after the suite rewrote the files.

Verdict: **dishonest** for M1, M2, M3, M5, M8. Sampled IDs and detail are in grader-report.json `coverageSpotVerification`.

## Phase 3 — independent checklist

### API (custom-client, API.md)

Script: `results/scripts/grader-api.mjs` → `results/api/grader-api.json` (63 pass / 2 fail on first pass: m6-a08 while Bob was connected; m8-a04 API omits zero days).

Follow-ups:

- `results/scripts/grader-push-digest.mjs` → `results/api/grader-push-digest.json` (m6-a08 retry pass with Bob disconnected; digest first wait too short).
- `results/scripts/grader-digest-poll.mjs` → `results/api/grader-digest-poll.json` (one new Bob digest then empty wait with zero additional).
- `results/scripts/grader-idle-restart.mjs` + after → `results/api/grader-idle-restart-after.json` (idle user 0 digests; restart duplicatePeriods=0, one new digest).

Notable API observations (fixture passwords not logged):

- Signup, collisions, profile edit, avatar bytes, token revocation after logout.
- Posts, follow graph, pagination (global and following, 20/page), implicit self-follow counts.
- DM reuse, two groups, quoted.body, non-admin memberRemove rejected.
- Photo/video messages, reaction replace/remove, edit window 60s rejected, delete tombstone, deleted asset URL refused.
- View-once first fetch then second denied (`once` image column).
- Disappearing 24h TTL=180s: message absent after wait.
- API.md named conversation: latest message of "Weekend Plans".
- Trending: higher like-count ranks first; like-count tie newest-first.
- Insights posts count matched profile-feed originals.

### Web (headless Playwright Chromium, no GUI)

Scripts: `results/scripts/grader-web.mjs`, `grader-web-retry.mjs`. Screenshots under `results/web/` (no credentials in images beyond the public fixture email on the signup error screen; that email is the published API.md example identity).

Observed:

- Duplicate-email signup shows visible `E_AUTH_EMAIL_TAKEN` (results/web/m1-duplicate-email-error.png).
- Sign-in lands on authenticated home; reload persists; logout+reload stays signed out.
- Live Global posts on a second client (best-of-3 429/137/160 ms).
- URL text is underlined; no preview card. FeedRow does not pass `onPressLink` (source).
- Insights six totals and 7 zero-filled day rows (results/web/m8-insights.png).
- Search `coffee` grouped by conversation id (results/web/m5-search.png).
- Quoted excerpt in Weekend Plans (results/web/m3-quote.png).
- Typing indicator best-of-3 appear 266/31/32 ms; expire 4337/4348/4354 ms.

Failed independent web attempts preserved: compose submit disabled until pressSequentially (retried); warm-offline search after a full reload; Clique home label timeout on receipt retry.

### Source inspection

- `use identity password` in schema.q.
- Shortened windows in source: edit 60000 ms, delete 120000 ms, disappearing 180000/300000 ms, digest period 120000 ms / `every 2m`.
- `onceImage: image <=10000000 once`.
- Replay adapter verbs match action-schema; settlement awaits `committed`. `verifyScale` compares only `namedO5Fixtures`.

### Choreography artifacts (not re-driven for simulator)

Bound receipts from `setup/assessment-input.json`:

- M1, M2, M4, M5, M6 (web offline-queue), M8 web: segment pass.
- M3: browserGreen false; `group-receipt-waits-for-slowest-member` failed (application).
- Native: `evidence/simulator-status.json` pass=null, receipt=null for m6 and m8. Launch PNGs under `evidence/native-m6` and `evidence/native-m8` were not used as proofs.

### Replay / digest proofs

- This session sample-50: `results/replay/replay-sample-50.json` pass, 50 settled actions.
- Historical scale replay `evidence/replay-scale-m6.json`: pass=true, actions=settledActions=167157, checkpoints 10%/50%/final namedO5Fixtures verified. Manifest sha256 a70c627cf32db9378861a2ff2e291311404e74e06ed02ead5908d565acde5a3f matches the assessment fixture copy. Full expectedState slices were not checked by the adapter.
- `evidence/digest-restart-proof.json` pass=true, duplicatePeriods=0; independently reproduced after an owned restart.

## What was not done

- No holdout probes.
- No O-dimension interpolation or weighted total.
- M7 not executed.
- Simulator was not launched. No replacement native evidence.
- Scale-copy port 53125 was not started (receipt + adapter source were sufficient for verification-scope inspection).
- Application source, tests, and instrument bytes were not patched.

## Redaction

Fixture passwords and session tokens do not appear in this trace. Assessment scripts under `results/scripts` use the same fixture identities documented in API.md as private inputs. Generated idle-user email is omitted here.
