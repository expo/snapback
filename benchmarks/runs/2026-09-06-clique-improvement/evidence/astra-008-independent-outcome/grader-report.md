# Independent diagnostic outcome grade — astra-008 Clique / snapback2@0.0.8

This is a **diagnostic** independent outcome grade. It is **not** a calibrated O3/O5 holdout score, not a weighted total, and not a holistic ranking. M7 was not in this session.

- Grader: Grok 4.6 (xhigh), session `2d5466a1-ff8d-4029-b0fb-c497ac1537f8`
- Package: published `snapback2@0.0.8` (lock resolved to registry tarball)
- Node: `v25.9.0` at `/opt/homebrew/Cellar/node/25.9.0_3/bin/node` (npm 11.12.1, bun 1.3.12, Playwright 1.62.1)
- Assertion manifest: `instrument/schema/social-messenger/assertions.json` sha256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`
- Contamination: none (builder narratives/essays/scores were not read)
- Session outcome: **completed** (exit 0 means the grading work finished, not green acceptance)

Machine record: `grader-report.json`. Sanitized trace: `evidence-trace.md`.

## Headline counts

| Result | Count |
|---|---|
| pass | 93 |
| fail | 13 |
| not-run | 13 |
| not-applicable | 0 |
| total frozen IDs | 119 |

Fails: `m3-a12`, `m5-a09`, `m5-a10`, `m5-a11`, `m6-a01`–`m6-a07`, `m8-a17`, `m8-a18`.

Not-run: `m3-a13`, `m5-a03`, `m7-a01`–`m7-a09`, `m8-a10`, `m8-a11`.

## Environment and provenance

Assigned ports 50800–50819 were free at start. Owned listeners:

| Port | PID | Role |
|---|---|---|
| 50800 | 69630 | snapback2 dev (main outcome owner) |
| 50801 | 92902 | `scripts/serve.mjs` static web → 50800 |
| 50806 | 45737 | isolated clock owner (`artifacts/clock-instance`) — M8 trending accommodation |
| 50808 | 63683 | isolated digest owner (`artifacts/digest-instance`) — M8 digest accommodation |

Foreign listeners were not inspected or stopped.

Source integrity: product/client/Quarry hashes **unchanged** after grading. The only added files under `app/` (excluding `node_modules`, `.snapback`, `artifacts`) are runtime `app/evidence/*` receipts. Diff: `grader-work/source-integrity-diff.json`.

Starter seed was a **single** `m1 → m2 → m3` invocation with original actor mapping. Canonical starter invariants: **27/27 pass** before any suite mutation (`grader-work/evidence/invariant-starter.json`).

## Suite attempts (original status preserved)

| Milestone | Suite exit | suite-status | Notes |
|---|---|---|---|
| m1 | 0 | pass | All suite-required IDs mapped and green |
| m2 | 0 | pass | All suite-required IDs mapped and green |
| m3 | 0 | pass | All suite-required IDs mapped and green |
| m4 | 1 | fail / application | First image send: two `sm-convo-bubble` nodes (committed + “Waiting for connection”). Coverage map empty. **Original fail kept.** |
| m5 | 1 | fail / application | View-once + non-admin rename passed; people search for Carol timed out. **Original fail kept.** |
| m6 | 0 | pass | Push proof, custom-client demo, sample-50 replay |
| m8 | 1 | fail / application | Insights a01/a03/a04 passed; trending fetch to 50806 failed. **Attempt 1 preserved** in `grader-work/evidence/m8-suite-attempt1.json` |
| m7 | not run | — | Later session |

`scripts/coverage-manifest.mjs` aborted on `assert suite.pass` for m4 (`grader-work/logs/coverage-manifest.log`). That is expected given preserved suite failures.

## Choreography (loader-adapted)

Unmodified `choreography/startup.test.mjs`: `ERR_MODULE_NOT_FOUND .../outcome/lib/json-schema.mjs` — instrument skip, as `qualification/instrument-gap.md`. Loader-adapted segment runs used `scripts/instrument-loader.mjs` + `evidence/setup-identity.json` + `evidence/choreo-adapter.json`. Three-member group created via `scripts/choreo-fixtures.mjs` (starter `Weekend Plans` includes Erin, who has no choreography client).

| Segment | Green | Browser assertions |
|---|---|---|
| m1 | true | 3/3 (live profile, persist, logout) |
| m2 | true | 9/9 |
| m3 | false / choreography-failed | 6/7 — **removed member received a new live group message** |
| m4 | false / suite-failed | 5/5 browser pass; green blocked by suite |
| m5 | false / suite-failed | 4/4 including warm-offline search and disappearing purge |
| m6 | true | web offline queue flush (native simulator not in this web segment) |
| m8 | false / suite-failed | 5/5 web (insights like, two-device live/read, dual-offline) |

## Coverage audit

Sampled suite-required mappings in `scripts/acceptance-mN.mts` (not the pass labels alone):

- **Honest:** m1-a01/a03, m2-a06, m3-a03/a10, m5-a04, m6-a10/a13, m8-a01. m2-a01 is bundled with image/video after a setup text post — sloppy but the text post exists in the same run.
- **Dishonest:** **m6-a08/a09** claim “Bob’s clients closed” but the test keeps Bob’s client open and reads `push.events` from it. Verdict: `dishonest` for M6.
- M4/M5/M8 never produced a green suite, so `coverage-manifest.mjs` cannot honestly stamp those milestones.

## Independent API / browser (grader-owned scripts in `grader-work/`)

Confirmed: signup/auth, duplicate handle/email, token revocation, DM reuse, non-admin remove/rename, reactions, shortened edit window, deleted media 410, view-once 200 then 410, custom-client demo, API.md “latest message of Weekend Plans”, Insights summary, video sendMedia (duration 5000), disappearing expiry after valid title, digest emissions on 50808, trending on 50806.

Failed or incomplete: people search on starter-only state; closed-client push recheck; typing in a crude independent browser pass (canonical choreo later passed); first disappearing attempt with empty title (tester error, then retry passed).

## Native evidence (frozen only — simulator not re-run)

`qualification/m6-native-proof.json`: `attempted-not-proven`; all cold-offline flags false; screenshot is SpringBoard after failed launch, not an offline app.

`qualification/m8-native-proof.json`: `functionalOfflineRestartProof: false`. `qualification/m8-native-launch.png` is a **login screen**. Per QUALIFICATION.md that does not prove native offline.

## Defects

| ID | Severity | Summary |
|---|---|---|
| d-01 | major | Removed member still sees new live group messages in an open web client; API `messages.thread` is `denied` after remove |
| d-02 | major | Starter seed leaves search indexes empty; online people/message search fail until `index-fixtures` |
| d-03 | major | Native cold-start / durable-queue restart not proven |
| d-04 | minor | M4 suite duplicate pending bubble / strict-mode failure |
| d-05 | minor | Dishonest M6 push “clients closed” mapping |
| d-06 | minor | M8 suite requires undocumented 50806 clock instance |
| d-07 | cosmetic | Two visible “Search” buttons |
| d-08 | minor | Effect grants still name `127.0.0.1:50403` |

## Missing / not-run

- M7 entire checklist (assigned later session)
- m3-a13 retained local history after remove (compound choreo aborted)
- m5-a03 expired message in offline search after sync
- m8-a10 next quiet digest period
- m8-a11 digest restart mid-period
- Rotated holdout probes (none supplied) → O3/O5 null
- Scale replay / O5 (starter-only; scale not injected)

## Accommodations (recorded, not product fixes)

1. Ports remapped 504xx→508xx in verification copies only (SOURCE-IDENTITY.json hashes/diffs).
2. `instrument-loader.mjs` maps missing `../../lib/json-schema.mjs` onto AJV 2020 in the installed choreography tree.
3. `evidence/choreo-adapter.json` + `choreo-fixtures.mjs` three-member “Weekend Plans Proof”.
4. `CLIQUE_WINDOWS_CONFIG=windows.shortened.json` (edit 60s, 24h TTL 180s).
5. Isolated clock owner 50806 for independent trending after the canonical m8 suite fail.
6. Isolated digest owner 50808, `periodMs=120000`, after documenting that digest was not run on the main owner.
7. `index-fixtures.mjs` run **after** recording empty-search failure; original m5-a09/a10/a11 remain fail.
8. Verifier scripts live in `grader-work/` (outside `app/` sources).

## Diagnostic O placements (not claim statistics)

- O1 ~68, O2 ~55, O4 ~45: uncalibrated commentary only.
- O3 null, O5 null: no preregistered holdout / no scale replay.
- No weighted or holistic score.

## Cleanup

Owned PIDs listed above were SIGTERM’d after this report; see `cleanup.json`.
