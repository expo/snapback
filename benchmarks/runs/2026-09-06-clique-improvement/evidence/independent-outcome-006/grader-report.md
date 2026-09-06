# Independent outcome grading — astra-006 (diagnostic, continuation)

This is exploratory independent outcome grading of one frozen Clique app (Astra medium, snapback2@0.0.6). There is **no** precommitted rotated holdout set and **no** completed calibration. **No formal O3/O5, weighted total, or preregistered-probe claim.** Machine record: `grader-report.json` (diagnostic; includes M8 keys the frozen report schema pattern does not list).

The first session wrote reports and left feasible independent checks unrun. Those reports are preserved unchanged as `initial-report.md` and `initial-report.json`. This file is the updated record after the remaining feasible M1–M6/M8 web/API checks.

- Claimed archive SHA-256: `c64b7b1e82a5f4588dfe7f0f07110ad149c0c7c3e0764424be678160f2f75b61`
- Extracted `app/` tree SHA-256 (excluding node_modules/.snapback/evidence): `397504a19c710e08efbaeee241db1e89e38953fefc47e8c06fb424525d19c90e` (325 files)
- Continuation hash verify: 325/325 unchanged vs `grader-work/source-files.json` (`grader-work/continuation/frozen-hash-verify.json`)
- Assertions manifest: `app/instrument/benchmarks/schema/social-messenger/assertions.json` sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`
- Grader: Grok 4.6 xhigh, other-family, `calibrationPassed: false`, `contaminated: false`
- Sanitized trace: `grader-work/sanitized-action-trace.jsonl`
- Launch/resume: `grader-work/launch.json` (first session) and `grader-work/continuation/launch.json`

## Qualification (preserved, not overwritten)

M8 qualification is **unresolved**.

1. **Original green with missing bound suite.** `evidence/m8-choreo-1788685993894.jsonl` reports green and binds suite SHA-256 `b327b2f7a2f6a3e55ca124e238a63b06fb394fe30d3e816474e5a041208d7004`. That file is no longer recoverable. Do **not** treat later `9370c41b…` as the original bound suite.
2. **Later failed recheck.** `evidence/m8-requalification-1788686455148/` failed `m8-a15-dual-offline-convergence` (10s locator timeout) and dependent `m8-a16-dual-offline-receipts`.
3. **Prior independent session.** Independent dual-offline web run **passed** (both queued messages appeared once on Bob). That does not erase (1) or (2).

Native M6 is **not absent**. A supplemental earlier published `snapback2@0.0.6` native failure report is `native-m6-original-report.md` (archive SHA-256 `014a913c309a6aecb64d76bcaed50a68db53ed1bb0fe17c9f26fdcd95e8cd55c`, 71 original files, Release Hermes). That identity is **not** this grading tree (`c64b7b1e…`). Mapping: `grader-work/continuation/native-m6-original-mapping.json`. Native **M8 remains not-run**. Simulator was not re-run. No newer SDK candidate reports were sought.

Scale is **pending** (separate copy / 49103, listener pid 6910 left alone). M7 is a **later fresh session**.

## Phase commands and results

| Phase | Command / action | Result |
| --- | --- | --- |
| Ports | lsof 49100/49101/49102 | Free at first-session start; 49103 reserved for scale peer |
| Install | `npm ci` in `app/` | **Retry:** Node 25.9.0 / npm 11.12.1 failed (`Missing: snapback2-linux-x64@ from lock`). Node 20.19.4 / npm 10.8.2 succeeded. Lockfile not edited. |
| Compile | `npx snapback2 check` | `ok 0d1036d3 70 ops` |
| Backend | `npx snapback2 dev --foreground --port 49100` | First session PID 76838 then restart PID 27909 (m8-a11). Continuation: recorded PIDs **dead**; replacement listener **24052** on existing `.snapback`; digest clock **not** reinstalled; no dataset reset |
| Expo | `CI=1 npx expo start --web --port 49101 --localhost` | First session PID 76837. Continuation replacement listener **24108**; `/status` 200 |
| Provider | `node scripts/push-provider.mjs` | First session PID 76778. Continuation PID **24049** on 127.0.0.1:49102 |
| Seed / invariants / config / password / sample-50 / Playwright / suites M1–M8 | (first session) | Unchanged; see `initial-report.md` |
| Instrument path | destination `/Users/ccheever/clique-improvement/instrument` was **absent** | Copied exact `app/instrument` (210 files, 0 hash mismatches). Disclosed environment accommodation, **not** an app repair or portability pass |
| Independent continuation | `grader-work/continuation/remaining-independent.mjs` and follow-up | See assertion table |
| Original M2/M4 after accommodation | `scripts/acceptance-m2.mjs`, `acceptance-m4.mjs` | Both passed; new JSON captured under `grader-work/continuation/*after-instrument-1788691200113.json`; original ENOENT files **restored** to `app/evidence/` |
| Independent m3-a15 | seed.mjs + seed-m2.mjs + seed-m3.mjs twice | Snapshots equal; original m3-suite.json ENOENT retained |

## Assertion outcomes (summary)

`grader-report.json` keys every frozen ID. Diagnostic counts after continuation: **pass 102 / fail 2 / not-recorded 4 / not-run 11** (M7 entire + native M8 a17–a18; M6 a01–a04 not-recorded from the earlier native report).

**Fails (product, this record):**

| ID | Severity | What was observed |
| --- | --- | --- |
| m1-a03 | major | Duplicate handle: API `profiles.save` is `E_CONSTRAINT`, UI shows authenticated Feed with **no** `sm-auth-error`. Session remains authenticated. **Retained.** |
| m6-a07 | major (native, earlier 0.0.6 identity) | Premature blue read ticks while server still reported `sent`. Source: `native-m6-original-report.md`. Not this tree's archive. |

**Dependent / not a second product defect:**

| Observation | Why it is not a separate bug |
| --- | --- |
| First-session m1-a04 UI fail | Same leftover authenticated session after m1-a03; auth form gone so duplicate-email UI could not be shown. Isolated fresh-context signup with `alice@example.com` **passed** (`E_AUTH_EMAIL_TAKEN` on `sm-auth-error`, still on auth form). |
| First-session m3-a15 suite fail | ENOENT on hardcoded external `starter-m1.log`. Portability defect d-03. After instrument accommodation, seed idempotency **passed**. Original ENOENT JSON retained. |
| Bob Following exactly 20 rows | Insufficient count for a next page, not duplicates/gaps. Dedicated user with 25 originals paged 20→25. |

**Not-run / not-recorded (honest gaps):** M7 entire; native M8 a17–a18; M6 a01–a04 not-recorded because online sync never completed in the earlier native report (SSE no body). Scale pending.

## Continuation independent checks (new)

- **m1-a04 isolated:** fresh browser context, duplicate email `alice@example.com`, unique handle. Visible `sm-auth-error` `E_AUTH_EMAIL_TAKEN`. Auth form remained. Evidence: `grader-work/continuation/remaining-independent-1788690949314.json`.
- **M2 URL:** `sm-text-link` present; no iframe / `sm-feed-media`. First click did not capture a popup (`openedUrl` empty, RN web `PAGEERROR` `_dispatchEvent`). Retry with `window.open` hook opened `https://example.com/page-1788691027652`. Original suite after accommodation also completed m2-a12/a13 (same pageerror still logged). Evidence: `pagination-url-followup-1788691027652.json`, `m2-suite-after-instrument-1788691200113.json`.
- **M2 pagination:** Global UI 20→40. Following needed a >20 projection: dedicated user 25 originals, API pages `[20,5]`, unique IDs, first-page prefix match; UI 20→25. Original suite after accommodation completed m2-a22/a23/a24.
- **Implicit self-follow:** dedicated user, following=0; own original and own repost in Following; counts unchanged; explicit self-follow `SELF_FOLLOW` rejected.
- **Follow/unfollow projection:** dedicated users; follow shows post in Following; unfollow removes it; remains in Global.
- **Connected disappearing purge:** isolated DM, `24h` setting, ttl ~180s (`expiresAt` 1788691132953). Two live web clients plus SDK subscribe. Visible before expiry; UI/API/revocation all gone **1205 ms** after expiry (bound used: 5 minutes after expiry). Disconnected-reconnect from the first session was not repeated.
- **Original M2/M4 suites after accommodation:** passed the remaining suite-required IDs; original ENOENT files restored.
- **m3-a15 after accommodation:** two seed passes, equal snapshots.

## Native M6 (earlier source artifact)

From `native-m6-original-report.md` only. Simulator was not re-run.

| Assertion | Result | Boundary |
| --- | --- | --- |
| m6-a01 cold history | **not-recorded** | Online sync failed (`E_NETWORK: SSE response has no body`); empty screens are not proof of durable history |
| m6-a02 viewed media | **not-recorded** | Image never rendered online |
| m6-a03 cold search | **not-recorded** | Token never synced |
| m6-a04 view-once denial | **not-recorded** | Asset never opened/consumed |
| m6-a05 two pending | **pass** | Gray pending clocks, compose order, backend stopped |
| m6-a06 flush in order | **pass** | Manual **Sync now**; not automatic reconnect |
| m6-a07 receipts to read | **fail** | Premature blue ticks while server `sent` |

The report's structured count is 4 passed, 2 failed, 4 not recorded. It is explicitly **not a qualifying M6 pass**. Native M8 was not in that artifact.

## High-signal independent checks (first session, unchanged)

- Starter four-member group verified. Denied cross-user dave / `g-starter`. Logout revocation. Edit window `EDIT_EXPIRED`. Disappearing with clients closed. View-once second fetch `E_ASSET_VIEWED`. API.md Weekend Plans newest-first. Digest one-per-user / silent skip / empty following / no duplicate after owner restart. Timing best-of-3 retained. Dual-offline independent pass.

## Coverage audit

Verdict **honest** for mappings that ran. Sampled IDs listed in `grader-report.json`. Hardcoded parent-tree fixture path remains a checkout-portability defect of the suite (original ENOENT retained). Provisioning that path so remaining original suites could execute is disclosed environment accommodation.

## Defects (O2 input)

| ID | Severity | Summary | Evidence |
| --- | --- | --- | --- |
| d-01 | major | Duplicate-handle signup leaves an authenticated session and no visible error | `grader-work/independent-browser.json`, `dup-identity-api.json` |
| d-02 | major | New-user `/profile/edit` stuck on “Loading profile…” | `app/evidence/m1-suite-failure.png` |
| d-03 | major | Suites/seeds hardcode `/Users/ccheever/clique-improvement/instrument/...`; original ENOENT retained | `acceptance-m2.mjs`, `seed.mjs`, `acceptance-m4.mjs`, `grader-work/original-suite-evidence/` |
| d-04 | minor | Dual-offline not stable across retained runs (original green / later fail / prior independent pass) | QUALIFICATION.md + requalification dir + first-session browser JSON |
| d-05 | cosmetic | Sender can still fetch view-once bytes after recipient view | `m5-a06-followup.json` |
| d-06 | major | Native M6 earlier-0.0.6: SSE body missing, online history/media/search blocked | `native-m6-original-report.md` (archive `014a913c…`) |
| d-07 | major | Native M6 premature read ticks | `native-m6-original-report.md` |

## O-dimension diagnostics (not calibrated scores)

- **O1 diagnostic only:** web/API checklist largely exercised; M1 handle UX fails; native M6 earlier report is a scoped failure not native-absent; M7/native M8/scale pending. No calibration.
- **O2 diagnostic only:** d-01/d-02 identity; d-03 portability; d-06/d-07 scoped to the earlier native M6 identity. Isolated duplicate-email is not a second product defect.
- **O3 null:** no rotated holdout set.
- **O4 null:** earlier native M6 is not a qualifying M6 pass; web offline is not native O4; native M8 not-run.
- **O5 pending:** scale worker separate.

## Missing evidence / remaining infeasible

- Native M8 a17–a18 (not in the supplied M6 report; not run)
- Scale-replay receipt / invariant-combined at envelope (49103 separate)
- M7 pre-migration snapshot and suites
- Original M8 bound suite bytes `b327b2f7…`
- Native artifacts beside `native-m6-original-report.md` (video/receipts) were not copied into this grading directory; the supplied report is the source used

## Calibration limits

Family has not passed `calibration.md`. Wave probe set was not supplied. Do not use diagnostic O1/O2 numbers as L4 statistics. Do not publish a weighted total.
