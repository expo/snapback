# Independent outcome grading — astra-006 (diagnostic)

This is exploratory independent outcome grading of one frozen Clique app (Astra medium, snapback2@0.0.6). There is **no** precommitted rotated holdout set and **no** completed calibration. **No formal O3/O5, weighted total, or preregistered-probe claim.** Machine record: `grader-report.json` (diagnostic; includes M8 keys the frozen report schema pattern does not list).

- Claimed archive SHA-256: `c64b7b1e82a5f4588dfe7f0f07110ad149c0c7c3e0764424be678160f2f75b61`
- Extracted `app/` tree SHA-256 (excluding node_modules/.snapback/evidence): `397504a19c710e08efbaeee241db1e89e38953fefc47e8c06fb424525d19c90e` (325 files)
- Assertions manifest: `app/instrument/benchmarks/schema/social-messenger/assertions.json` sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`
- Grader: Grok 4.6 xhigh, other-family, `calibrationPassed: false`, `contaminated: false`
- Sanitized trace: `grader-work/sanitized-action-trace.jsonl`
- Launch/resume: `grader-work/launch.json`

## Qualification (preserved, not overwritten)

M8 qualification is **unresolved**.

1. **Original green with missing bound suite.** `evidence/m8-choreo-1788685993894.jsonl` reports green and binds suite SHA-256 `b327b2f7a2f6a3e55ca124e238a63b06fb394fe30d3e816474e5a041208d7004`. That file is no longer recoverable. Do **not** treat later `9370c41b…` as the original bound suite.
2. **Later failed recheck.** `evidence/m8-requalification-1788686455148/` failed `m8-a15-dual-offline-convergence` (10s locator timeout) and dependent `m8-a16-dual-offline-receipts`.
3. **This session.** Independent dual-offline web run **passed** (both queued messages appeared once on Bob). That does not erase (1) or (2).

Native proof is **absent/pending**. Scale is **pending** (separate copy / 49103). M7 is a **later fresh session**.

## Phase commands and results

| Phase | Command / action | Result |
| --- | --- | --- |
| Ports | lsof 49100/49101/49102 | Free at start; 49103 reserved for scale peer |
| Install | `npm ci` in `app/` | **Retry:** Node 25.9.0 / npm 11.12.1 failed (`Missing: snapback2-linux-x64@ from lock file`). Node 20.19.4 / npm 10.8.2 succeeded. Lockfile not edited. |
| Compile | `npx snapback2 check` | `ok 0d1036d3 70 ops` |
| Backend | `npx snapback2 dev --foreground --port 49100` | PID 76838 then restart PID 27909 (m8-a11). Health `version 0.0.6` |
| Expo | `CI=1 npx expo start --web --port 49101 --localhost` | PID 76837. Hung on `openChrome.applescript`; killed that child; `/status` 200 |
| Provider | `node scripts/push-provider.mjs` | PID 76778 on 127.0.0.1:49102 |
| Seed | single `replay-adapter.mjs` starter-m1+m2+m3, **no scale.log** | 87 committed receipts, 0 comment markers (no pause). `app/evidence/replay-starter-settled.jsonl` |
| Starter invariants | `grader-work/check-starter-invariants.mjs` | **pass**, 0 mismatches. `g-starter` has **4** members (alice, bob, carol, erin) — not the 3-member M3 browser adapter |
| Config | replay false after windows row; shortened windows+digest; `digest.backfillPeriods` | First `config.replay false` rejected (no windows row yet). After `configure.mjs`, replay=false committed. Clock persisted across later restart |
| Password | copy of `store.sqlite` | 8× `$argon2id$v=19$m=19456,t=2,p=1` unique salts; no fixture plaintext in DB or owner log |
| Sample-50 | separate adapter, `CLIQUE_RECEIPTS=evidence/replay-settled.jsonl` | 50 committed receipts (M6 conformance, not scale) |
| Playwright | `npx playwright install chromium` | Environment retry-once after suite abort on missing `chromium_headless_shell-1193` |
| `npm run acceptance` | all-suite | Stops at M1. Then remaining milestones run individually |
| M1 suite | `scripts/acceptance-m1.mjs` | **fail** after a01/a02; screenshot stuck `Loading profile...` |
| M2 suite | | **fail** after a01: ENOENT absolute instrument media path |
| M3 suite | | a03/a04/a05/a14 pass; a15 ENOENT `seed.mjs` absolute starter-m1.log |
| M4 suite | | **fail** immediately: ENOENT media path |
| M5/M6/M8 suites | | **pass** all suite-required IDs |
| Independent API/browser | grader-work scripts | See assertion table |

## Assertion outcomes (summary)

`grader-report.json` keys every frozen ID. Counts in this diagnostic record: **pass 90 / fail 3 / not-run 26** (includes M7 + native + some M2 pagination/self-follow items not re-executed after suite path failure).

**Fails (this session):**

| ID | Severity | What was observed |
| --- | --- | --- |
| m1-a03 | major | Duplicate handle: API `profiles.save` is `E_CONSTRAINT`, UI shows authenticated Feed with **no** `sm-auth-error` |
| m1-a04 | major (UI) | Visible duplicate-email error not shown (auth form gone after a03 leftover session). Server `E_AUTH_EMAIL_TAKEN` works |
| m3-a15 | major (suite portability) | Idempotency test calls `scripts/seed.mjs` which opens a path **outside** the frozen app |

**Not-run (honest gaps, not passes):** M7 entire; M6/M8 native simulator IDs; M2 URL/pagination/self-follow suite items not independently re-run after ENOENT.

## High-signal independent checks

- **Starter four-member group** verified via operator `snapback2 data` + SDK. Named spots (alice/bob profiles, sp0001/sp0002, sm0001/sm0007, Weekend Plans) matched.
- **Denied cross-user:** dave cannot read/send `g-starter` (`MEMBER_REQUIRED`, empty history).
- **Logout revocation:** reused bearer `E_AUTH_SESSION`.
- **Edit window:** shortened 60s, late edit `EDIT_EXPIRED`.
- **Disappearing:** isolated alice–frank DM, clients closed, after TTL message absent; search n=0.
- **View-once:** first open works; second `E_ASSET_VIEWED`; raw HTTP 404. Sender can still `assetBlob` (noted cosmetic).
- **Delete asset:** recipient fetch denied after delete-for-everyone.
- **API.md latest message:** `Weekend Plans` via `scripts/clique-client.mjs` history newest-first.
- **Digest:** dedicated personas, clients closed, exactly one payload with expected counts; silent user none; empty following period none; unrelated chat excluded; no duplicate (user, period) after owner restart.
- **Timing (best of 3, all measurements kept):** live bio 208/240/280 ms; live DM 1648/1058/1539 ms; typing appear 291/115/179 ms (bound 2000); typing expire 4360/4382/4393 ms (bound 5000).
- **Dual-offline (independent):** both pending messages flushed once to Bob.

## Coverage audit

Verdict **honest** for mappings that ran (M5 view-once, M6 push/demo/sample-50, M8 insights/trending). Sampled IDs listed in `grader-report.json`. Not dishonest mappings: M2/M3/M4 tests *would* exercise the observables if the hardcoded parent-tree fixture path existed. That is a checkout-portability defect of the suite, not a fake mapping.

## Defects (O2 input)

| ID | Severity | Summary | Evidence |
| --- | --- | --- | --- |
| d-01 | major | Duplicate-handle signup leaves an authenticated session and no visible error | `grader-work/independent-browser.json`, `dup-identity-api.json` |
| d-02 | major | New-user `/profile/edit` stuck on “Loading profile…” | `app/evidence/m1-suite-failure.png` |
| d-03 | major | Suites/seeds hardcode `/Users/ccheever/clique-improvement/instrument/...` | `acceptance-m2.mjs`, `seed.mjs`, `acceptance-m4.mjs` |
| d-04 | minor | Dual-offline not stable across retained runs (original green / later fail / this pass) | QUALIFICATION.md + requalification dir + this browser JSON |
| d-05 | cosmetic | Sender can still fetch view-once bytes after recipient view | `m5-a06-followup.json` |

## O-dimension diagnostics (not calibrated scores)

- **O1 ~72 (diagnostic):** between the 60-anchor (M1–M4 solid, later patchy) and 90-anchor (every in-scope milestone green including platform-proof). Native/M7/scale absent from evidence; M1 identity UX fails.
- **O2 ~58 (diagnostic):** near the 60-anchor (a few medium defects off the happy path).
- **O3 null:** no rotated holdout set. Cross-user/digest-auth checks are non-scored diagnostics.
- **O4 null:** native artifacts pending; web offline must not be scored as native O4.
- **O5 pending:** scale worker separate; starter invariants passed here.

## Missing evidence

- Native iOS simulator recordings (M6 a01–a07, M8 a17–a18)
- Scale-replay receipt / invariant-combined at envelope
- M7 pre-migration snapshot and suites
- Original M8 bound suite bytes `b327b2f7…`
- Independent re-execution of M2 pagination, URL tap, and implicit self-follow after suite ENOENT
- Connected-client disappearing purge-within-tolerance (disconnected reconnect was shown)

## Calibration limits

Family has not passed `calibration.md`. Wave probe set was not supplied. Do not use these O1/O2 numbers as L4 statistics. Do not publish a weighted total.
