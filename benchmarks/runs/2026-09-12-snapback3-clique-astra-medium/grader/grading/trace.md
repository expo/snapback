# Sanitized grader evidence and action trace

Lane: `astra-snapback3-grade` (backend `snapback3-0.0.1-experimental.0`, private
immutable Linux x64 tarball, SHA-256 `719eba…fcb4e`).
Wave: `snapback3-clique-20260912`. Run scope: **full**.
Grader: family `claude`, model `claude-opus-5`, fresh session, no builder context.
Session outcome: `completed` (one phase re-run used; see Phase 1).

**Redaction posture.** Fixture and probe passwords, bearer tokens and session
identifiers are redacted or replaced by placeholders throughout. Raw transcripts
are not published. Persona e-mail addresses are fixture data and appear only as
`<persona>@example.com`. Generated probe accounts appear as `grader…@example.com`.

**Custody.** I read only the frozen instrument, the frozen fixtures, the lane's
source, scripts, receipts, evidence and artifacts, and `execution-input.json`.
I did not read `diary.md`, `essay.md`, `final-report.md`, `FINAL*.md`,
`run-log.md`, the original `run-record.json`, or any other lane. `README.md`
points at four of those narratives; the links were not followed. No excluded
builder context reached me, so this is **not** a contaminated session.
Note: starting the lane's server (`scripts/server.mjs`) appends one line to
`run-log.md`; that file was created by my own run in this grading copy and was
not read.

## 0. Environment and host

- Ubuntu Linux x86_64, AMD EPYC 9454, shared machine.
- Node v24.13.1 (`/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node`), npm 11.8.0.
- Playwright 1.62.1 / Chromium, installed into the lane's own `choreography/` copy
  (`npm ci` there). Nothing was written into `packet/instrument/`.
- Ports used: **54800** only (inside the assigned 54800–54819 range).
- Host load (`uptime` load average, 1 min) sampled beside every timing-relevant
  action: 0.27 – 1.70 across the session. Recorded per action below.

### Processes started and stopped

| Role | PID | Port | Disposition |
|---|---|---|---|
| `npm start` wrapper | 1456595 | – | killed at end of session |
| `snapback3 serve` child | 1456624 | 54800 | killed at end of session |

Only these two PIDs were started and only these two were killed. No `pkill`,
no `killall`. The PID recorded in the lane's own `evidence/server-pids.jsonl`
from the builder run (1430597) was not running and was not touched.

### Setup performed

```
npm ci                      # 580 packages (lane had no node_modules)
cd choreography && npm ci   # ajv 8.20.0, playwright 1.62.1
npm start                   # scripts/server.mjs -> snapback3 serve . --port 54800
```

`npm run check` → `{"ok":true,"operations":3,"schemaHash":"38ba6299…"}`.
`GET http://127.0.0.1:54800/` → 200, Expo web export titled "Clique".

## 1. Phase 1 — builder suite (documented entrypoint)

Documented sequence from `README.md`:

```
npm run seed -- --segment m1                        # intentionally nonzero
npm run seed -- --segment m1 --diagnostic-text-only
npm run acceptance -- --milestone m1
```

- `npm run seed -- --segment m1` exited nonzero with
  `S3_CAPABILITY_UNAVAILABLE: profile-set requires avatar media. Replay stopped
  at first unsupported action; segment not installed.` The starter M1 segment is
  therefore **not installed**.
- `npm run seed -- --segment m1 --diagnostic-text-only` **failed twice** with
  `SnapbackError: Too many authentication attempts. Wait a minute and try again.`
  (`grading/seed-retry.log`), then succeeded on the third attempt after a ~3 min
  quiescence, loading eight textual personas with `omitted: "avatar"` on every
  `profile-set`.
- **First acceptance run failed entirely** (`grading/acceptance-run1.log`, load
  avg 0.35): every one of a01, a02, a03, a04, a08 timed out; the end-of-run
  screenshot (`grading/acceptance-run1.png`) shows the app still on the sign-in
  screen. Cause established below: the backend's auth rate limiter, tripped by
  the immediately preceding seed.
- Per the grader-abort protocol I **re-ran the phase once** (`rerunsUsed: 1`).
  After a cooldown, `npm run acceptance -- --milestone m1` reproduced the lane's
  receipt exactly (`grading/acceptance-run2.log`, load avg 0.73, exit 1):

  | assertion | suite result |
  |---|---|
  | m1-a01, m1-a02, m1-a03, m1-a08, m1-a04 | pass |
  | m1-a10, m1-a11 | fail — `S3_CAPABILITY_UNAVAILABLE: runtime refuses image columns` |

  Suite `pass:false`; `suite-status.json` → `m1.pass=false`, `outcomeClass:"platform"`.

<a id="phase1-blocked"></a>
### Later milestones

```
npm run acceptance -- --milestone m2 … m8   # each exits 1:
  "mN: blocked-by-M1; no passing assertions claimed"
npm run seed -- --segment m2                # exits 1: "m2: blocked-by-M1; no segment installed"
ls scripts/custom-client-demo.mjs           # No such file or directory
```

No M2–M8 screen, route, Quarry operation, coverage entry, choreography receipt,
custom-client demo or scale-replay adapter exists. `app/` contains only
`index`, `settings`, `profile/[handle]`, `profile/edit`; `snapback/` declares one
table (`profiles`) and three operations.

## 2. Phase 2 — coverage-manifest spot verification

Verdict: **honest**. Sampled: all seven M1 suite-required IDs
(`m1-a01, a02, a03, a04, a08, a10, a11`) — the manifest
(`evidence/m1-coverage.json`) contains exactly those and no others.

- `scripts/acceptance.mjs` derives the required-ID list by reading the frozen
  `instrument/schema/social-messenger/assertions.json` and asserts
  `Object.keys(coverage).sort() == required.sort()`, so the manifest cannot
  silently under-declare, and each entry's status is taken from the live result.
- I re-executed the five mapped passing observables with my own Playwright
  script (Phase 3) and reproduced all five.
- Two honesty notes that do **not** rise to dishonest:
  1. `m1-a10`/`m1-a11` are recorded by constant — `scripts/acceptance.mjs` pushes
     hard-coded `{pass:false, outcomeClass:'platform', …}` records instead of
     attempting an upload. They declare **failure**, so no green is purchased;
     I confirmed the underlying platform limit myself (§3.4). Filed as `d-05`.
  2. `m1-a03` maps to duplicate-handle rejection at the mandatory post-signup
     profile step, because this app takes the handle there and not on the signup
     form. The observable is genuinely enforced (`unique byHandle` in
     `snapback/schema.q`) and I verified it independently. Its precondition is
     that a persona handle already exists, which only holds after the explicitly
     nonconforming `--diagnostic-text-only` seed.

M2–M8 produced no suite pass to verify.

## 3. Phase 3 — independent checklist execution

<a id="phase3-m1-web"></a>
### 3.1 Web automation (my own script, `grading/probe-m1-web.mjs`)

Fresh Chromium context against `http://127.0.0.1:54800`, load avg 0.4.
Results in `grading/probe-m1-web.json`; screenshots `grading/shot-01…05*.png`.

| assertion | observed | verdict |
|---|---|---|
| m1-a01 | signup with a 16-char password → profile-completion form appears | pass |
| m1-a02 | auth submit control gone (`count()==0`), authenticated surface visible | pass |
| m1-a03 | handle `alice` → visible error `E_CONSTRAINT: sealed unique conflict on profiles.byHandle`, still on form | pass |
| m1-a04 | re-signup with the same e-mail → visible error `E_AUTH_EMAIL_TAKEN: email is already registered` | pass |
| m1-a08 | display name + bio present after save **and after a full page reload** | pass |

Extra (not a checklist item): a 6-char password is rejected with
`E_AUTH_PASSWORD_WEAK: password must contain at least 8 characters…`.

<a id="phase3-media"></a>
### 3.4 Avatar (m1-a10 / m1-a11) and the platform limit

- Profile edit screen: **0** `input[type=file]` elements; pressing the avatar
  control produces the in-app message
  *"Avatar upload is unavailable: this Snapback 3 runtime does not support media."*
- Rendered profile: **0** `<img>` elements; only an initials placeholder
  (`grading/shot-04-profile.png`, profile text
  `GP | Edit profile | Grader Probe | @grader… | grader bio check | 0 Followers | 0 Following`).
- **Independent confirmation of the platform limit** (`grading/probe-media/`): I
  wrote a schema carrying `avatar: image <=10000000 ?` and ran the installed
  backend's own `snapback3 check`:
  `{"error":{"code":"S3_CAPABILITY_UNAVAILABLE","message":"this slice supports
  Quarry queries and mutations; effects, jobs, channels, schedules,
  clock-sensitive live queries and media need their runtime slice"},"ok":false}`.
  The installed `README.md` agrees ("supports the initial query/mutation product
  slice"). The abort reason in `execution-input.json` is therefore truthful.
- Both assertions are nevertheless scored **fail**: absent functionality is
  absent regardless of attribution.

<a id="phase3-choreo"></a>
### 3.2 Choreography (`[choreo]` assertions — harness receipts only)

I did not hand-drive these. I invoked the lane's documented wrapper
`node scripts/choreography.mjs`, which sets `CHOREO_BASE_URL`, reads persona
credentials from the frozen fixture file and runs the **unchanged** harness
(`choreography/choreography.mjs`, version 0.3.8-m8). Seven runs; receipts kept as
`grading/choreo-graderrun1.jsonl` … `choreo-graderrun7.jsonl`.

| harness assertion | checklist ID | runs 1-7 |
|---|---|---|
| `profile-edit-live-visibility` | m1-a09 | P P P P P P P |
| `session-persists-on-relaunch` | m1-a05 | P P P P P P P |
| `logout-remains-signed-out-on-relaunch` | m1-a06 | **F F P F F P P** |

- **m1-a09** (timing-sensitive, harness `bestOf: 3`): run 7 attempt metrics
  `visibleMs` = 101.0 / 97.4 / 87.2 (best 87.2 ms), load avg 0.39. The other
  client observed the new display name, bio, heading and feed navigation without
  a manual refresh. The lane's own receipt shows 106.8 / 106.2 / 104.2 at load
  avg comparable. No numeric bound is specified by the assertion. **pass**.
- **m1-a05**: passed in all 7 runs. **pass**.
- **m1-a06**: intermittent. All four failures are the same miss —
  `locator.waitFor: Timeout 10000ms exceeded … waiting for getByTestId('sm-auth-email')`
  after clicking the log-out control — and all four occurred on back-to-back
  harness invocations. After a ~2 minute quiescence the segment reproduced green
  (runs 3, 6, 7), matching the lane's receipt. Scored **pass** on the
  reproducible clean-condition behaviour; the intermittency is filed as defect
  `d-01` and feeds O2, not O1.
- Every run's segment summary is `green:false`. In runs 3, 6, 7 the cause is
  `suite-failed` (choreography passed, the red suite gates green) — identical to
  the lane's retained receipt. M1 is correctly **not green**.

<a id="phase3-api"></a>
### 3.3 API probing (`[grader]`, `grading/probe-m1a07.mjs`)

`m1-a07` — server-side session revocation, full-run only:

```
POST /api/auth/signup            -> 200, session expires in ~24 h (token redacted)
POST /api/query  (profiles.mine) -> 200            [before logout]
POST /api/auth/logout            -> 200
POST /api/query  (profiles.mine) -> 401  S3_AUTH "E_AUTH_SESSION: session is missing or expired"
```

The **same** bearer token is refused after logout. **pass**. (The lane's own
`evidence/auth-probe.json` makes the same claim; this is an independent check.)

<a id="phase3-source"></a>
### 3.5 Source inspection (`m1-a12`, `m1-a13`)

- `m1-a12` — `snapback/schema.q` line 1 is `use identity password`: the lane uses
  the backend's **built-in** auth rather than hand-rolled hashing, and never
  handles a password itself outside the `auth.signup/login` calls. The installed
  worker binary contains `argon2-0.5.3` symbols and the credential template
  `$argon2id$v=19$m=19456,t=2,p=1` — argon2id at standard published parameters.
  **pass**.
- `m1-a13` — searched `.snapback3/store.sqlite` and its WAL, the shipped web
  bundle `dist/_expo/static/js/web/entry-*.js`, and every lane log for the
  fixture and probe password byte-strings: **0 hits** in every location. The
  store holds 39 `$argon2id$v=19$m=19456,t=2,p=1` records. The fixture credential
  files themselves live outside the app and are the declared exception.
  **pass**.

### 3.6 Shortened-windows / expiry fixtures

`fixtures/config/windows.shortened.json` and `digest.shortened.json` were not
exercisable: the expiry, view-once, edit-window and digest behaviours they
configure belong to M4/M5/M8, none of which was built. Those assertions are
`not-run`, not `pass`.

### 3.7 Native / simulator

Apple simulator proof is unavailable on this Ubuntu x86_64 host and is graded
`not-run` / unavailable. `artifacts/native-status.json` records `m6` and `m8`
simulator artifacts as `pass:null, reason:"unavailable/not-run: Ubuntu Linux
x86_64 host cannot run an Apple iOS simulator."` The lane also ships
`artifacts/m1-ios/` (an Expo iOS export with a Hermes `.hbc` bundle) and its
`README.md` states plainly that it "is not native simulator proof". I agree and
did not accept it as one; a web or Expo export never supplies Apple native proof.

## 4. Phase 4 — holdout probes: **skipped**

No holdout probe set was committed for this wave (wrapper deviation 1).
`wave.probeSetSha256` is the sentinel `none-uncommitted`; `probeResults` is
empty and no probes were invented. O3's applicability predicate fails
independently (M6 is not green), so O3 would be null regardless.

## 5. Phase 5 — defects beyond the checklist

Six, severity-bucketed in `grading/grader-report.json` (`defects`):

| id | severity | summary | evidence |
|---|---|---|---|
| d-01 | major | Log out can silently do nothing — `await client.auth.logout(); router.replace('/')` has no try/catch and no error surface; harness assertion failed 4/7 runs | `grading/choreo-graderrun{1,2,4,5}.jsonl`; `src/screens.tsx` `Settings` |
| d-02 | major | Documented setup sequence is not reproducible: backend rate-limits auth to ~4 attempts/min; seed-then-acceptance as README orders it failed all five passing M1 assertions; no retry/backoff | `grading/acceptance-run1.log`, `grading/acceptance-run1.png`, `grading/seed-retry.log`, rate-limit probe (429 on the 5th login within a minute), `grading/acceptance-run2.log` |
| d-03 | minor | Raw backend error identifiers shown to end users (`E_CONSTRAINT: sealed unique conflict on profiles.byHandle`, `SnapbackError: E_AUTH_EMAIL_TAKEN…`) | `grading/probe-m1-web.json`, `shot-03/05*.png`, `src/screens.tsx` `setError(String(e))` |
| d-04 | minor | Dead affordances: Following/Global/Trending tabs wired to `onChange={()=>{}}`; Follow button `onPressFollow={()=>{}}`; literal `0 Followers / 0 Following` | `grading/probe-home.json` (`tabClickChangedAnything:false`), `shot-home.png`, `shot-otherprofile.png`, `src/screens.tsx` |
| d-05 | minor | Failing M1 assertions recorded by constant, not by execution (`acceptance.mjs` pushes hard-coded fail records; `seed.mjs` throws a lane-authored capability string before calling the backend) | `scripts/acceptance.mjs`, `scripts/seed.mjs`, independent confirmation in `grading/probe-media/` |
| d-06 | minor | Retained record-validation receipt shows the run record fails the frozen composed schema (6 missing required fields + an empty grading-sessions array) | `evidence/record-validation.json` (`composedPass:false`) |

Rate-limit measurement (`grading/probe-ratelimit.mjs`): the 5th `/api/auth/login`
within a rolling minute returns HTTP 429 *"Too many authentication attempts.
Wait a minute and try again."* Logout itself is **not** rate-limited (verified
separately, HTTP 200 while the limiter was engaged), so `d-01`'s exact trigger
was not fully isolated; what is established is the symptom, its 4/7 frequency
under the lane's own harness, and the missing error path in the handler.

Honest-reporting credits worth recording alongside the defects: the lane labels
its own suite red rather than claiming green; the iOS export is explicitly
disclaimed as non-proof; `native-status.json` records the simulator as
unavailable; `README.md` opens with "This is a partial account/profile app, not
a completed messenger"; and the diagnostic seed is explicitly marked
"NOT an installed starter segment".

## 6. Phase 6 — O-dimension scores

Per `applicability.json` (full-run scope), with `execution-input.json` recording
M1 `aborted`, all remaining continuous milestones `blocked-by-M1`, M7 `not-run`:

| dim | applicable? | score |
|---|---|---|
| O1 Functional completeness | yes (`grading-phase-ran`) | **10** |
| O2 Correctness under grading | yes (`grading-phase-ran`) | **45** |
| O3 Trust boundaries | **no** — predicate `m6-green-and-m1-m5-attempted` unmet (M6 never attempted); no holdout probes committed | null |
| O4 Observed offline behavior | **no** — predicate `m6-green` unmet; no simulator artifacts; native proof unavailable on this host | null |
| O5 Performance at the scale envelope | **no** — predicate `replay-attempted` unmet; no scale-replay adapter exists (m6-a13 not built), so the replay was never attempted | null |

Anchors cited and the concrete justification for each score are in
`grading/grader-report.json` → `oDimensionScores`. In short:

- **O1 = 10.** Denominator is the full 119 frozen assertions (M1–M8). 11 pass,
  all in M1; 2 fail (avatars); 106 of M2–M8 never built; 1 (`m7-a09`) is
  not-applicable because no milestone was ever green. 11/119 = 9.2%. The 30
  anchor ("core features partially work") overstates a lane with no posts, no
  feeds and no messaging; credit above zero is earned by M1's genuinely working
  account, session, profile-edit, live two-client visibility, server-side
  revocation and argon2id password storage.
- **O2 = 45.** Two major and four minor defects beyond the checklist, on a
  one-screen-set surface; between the 30 and 60 anchors, tempered by the small
  territory available to search.

**No weighted total, efficiency statistic or cross-lane comparison is computed
or reported** — the frozen prompt forbids it, and three null dimensions would
block a total in any case.

## 7. Schema split (M8) and manifest arithmetic

The frozen `assertions.json` physically contains **119** assertions
(M1:13 M2:27 M3:15 M4:12 M5:12 M6:13 M7:9 M8:18); its own `counts` block and
README say 116 and record M2:24. The frozen bytes were preserved and not
corrected. The frozen grader-report schema's `assertionResults` key pattern is
`^m[1-7]-a[0-9]{2}$`, which cannot express M8. Therefore:

- `grading/grader-report.json` carries all **101** M1–M7 assertion results
  (11 pass, 2 fail, 87 not-run, 1 not-applicable) and validates against the
  frozen schema (AJV 8.20.0, 2020-12 dialect: **valid**).
- `grading/m8-supplement.json` carries all **18** M8 assertion results
  (all `not-run`) with IDs, status, executor class and evidence.
- 101 + 18 = 119. Nothing was dropped and M8 is not silently omitted; O1's
  denominator above is the full 119.

## 8. Wave deviations recorded for this run (N=1 diagnostic)

1. No holdout probe set committed → phase 4 skipped, `probeSetSha256` =
   `none-uncommitted`, `probeResults` empty with an explanatory note. No probes
   invented.
2. This grading family has **not** passed the calibration gate →
   `calibrationPassed: false`, `sameFamilyGraded: false`. The grade is labelled
   **uncalibrated-grader** and is graded anyway.
3. Timing-sensitive checks judged best-of-3 with host load recorded beside each
   measurement (shared machine; load average 0.27–1.70 across the session).

Cap enforcement in this wave was prompt-only and raw native usage is retained but
unjoined, so **no efficiency or comparative-win claim is available** and none is
made. No cap-enforcement or metering evidence was created.

## 9. Artifact index (all under `grading/`)

`grader-report.json`, `m8-supplement.json`, `trace.md`, `DONE`,
`acceptance-run1.log`, `acceptance-run1.png`, `acceptance-run2.log`,
`acceptance-run2.png`, `seed-retry.log`, `choreo-graderrun1..7.jsonl`,
`probe-m1-web.mjs|.json`, `probe-m1a07.mjs|.json`, `probe-home.mjs|.json`,
`probe-logout.mjs|.json`, `probe-logout-seq.mjs|.json`,
`probe-choreo-mirror.mjs|.json`, `probe-logout-underlimit.mjs|.json`,
`probe-ratelimit.mjs`, `probe-logout-429.mjs`, `probe-media/`,
`shot-*.png`, `build-report.mjs`, `validate.mjs`,
`evidence-as-received/` (the lane's evidence directory copied before my runs
mutated it), `suite-status.as-received.json`, `server-grader.log`,
`server-wrapper.pid`.
