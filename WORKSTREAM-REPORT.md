# DX4 — wave-18 developer experience fixes

Implemented and committed on `sb4-b18-dx4`. No push and no version bump.
The 0.4.35 guide changes entry is present; candidate manifests remain 0.4.34.

## Per-item delivery

| Item | Change | Commits | Verification |
| --- | --- | --- | --- |
| Staging #3 | Default start/cheatsheet/personas point to staging. Proof callers see the password-only closed-door notice. `seedAccounts` accepts a validated service seat and merges custom arguments over principal/role defaults. First-admin authenticates before signup and repeats the operator-only upsert. | `c820a556e3`, `544561dd23`, `6578745b85` | Packed staging/first-admin replay, packed default-guide checks and custom-seat/argument cases; staging/proof client tests. |
| Upgrade warnings #4 | Per-project authored-script scan names dev-door and startDev candidates and migration actions, including quiet/JSON callers and failed upgrades. Incomplete scans say so. Store-lock advice retains PID/address and names memory isolation. | `712ef58cbc` | Ten real copied-app upgrades and checks; upgrade/client tests; Linux/Mac store ownership and CLI tests. |
| Dev papercuts #8 | Memory hosts publish the existing private mutual proof; token selects a unique project host or explicit valid port. Live seats use host time. Clock/reset replies and CLI/helpers explain session recovery; identity refusals explain pacing and retry limits. Closed-door port probes use auth/config. | `712ef58cbc`, `29f7b91e81`, `544561dd23` | Linux/Mac token, clock and CLI suites; packed memory mint, time jump, login and reset cases. |
| Uploads #7 | `uploads` guide alias; missing file-hint advice; uploader/one-hour retention advice; own-home placement details after ownership checks. Full PDF/placement/reference/download recipe. | `55f01c2eda`, `544561dd23` | Verbatim installed recipe; Linux/Mac file assets; asset client tests; guide/census coverage. |

`29f7b91e81` also refreshes the literal clock wire witness and qualification
fixture for the added packed hook. `544561dd23` keeps the default guide view
covered and extracts the exact 78-line token body into a module to respect the
source-file limit (parent: 1,433 lines); it changes no token behavior.
`6578745b85` places staging in the first section the default guide renderer
actually prints, with a direct renderer regression. All 127 guide tests pass.

## Design and review

Read the complete wave-18 bakeoff and wave-17 day-two analysis, Snapback 4's
fence/rules/journal, and the governing LLPs before implementation. Context:
LLP 3000.000.000.001 §§2–4/8 (staging/private authority), LLP 3000.019 §3.4
(store ownership), LLP 3000.038 §§3/6/12 (assets), and MIG's
LLP 3000.000.000.002 §4 (staging clock).

The two amendments received independent Muse and fresh Codex reviews. Both
returned READY in round 2. Round-1 invalid-port fallback and unreadable-scan
findings were repaired with tests. Verbatim stdout/stderr, briefs, commands and
hashes are retained in [review provenance](llp/reviews/dx4/provenance.json).
Muse's supplied wrapper used its configured fallback after plan quota exhaustion.

Judgment calls:

- Dev loopback already has no minute identity counters. Refusals explain that
  scripted dev should serialize bounded Argon2 work; no redundant knob or weaker
  staging throttle was added. Staging retains real rate limits and Retry-After.
- Seven-day sessions still expire on the authoritative application clock so auth
  expiry remains testable. Clock replies/CLI/helpers explicitly say to log in
  after large jumps and upload afterward; reset says to discard old credentials,
  recreate accounts and reprovision roles.
- File kind stays explicit because an image may be media or an attachment. The
  missing-hint error and complete runnable recipe teach the intended API.
- SEC4 owns security checks/invariants/lints; QRY owns read semantics. MIG owns
  staging clock semantics. Those surfaces were left to their lanes.

## Verification

- **Cargo:** all 430 unit/integration/doctest targets across `snapback4`, core,
  lang, device, sim, difftest and native have passing completed results:
  **6,896 passed tests, 45 default-ignored cases**. The workspace run hit its
  40-minute watchdog; the remaining-crates run hit its 30-minute watchdog.
  Only unfinished targets were resumed. Introduced fixture/guide/census reds
  were repaired and complete affected targets rerun. No timeout is counted as
  a passing run. [Target index](snapback4/reports/20261019-dx4/cargo-coverage.json)
  preserves the latest result per target and its raw log.
- **Affected client sweep:** 171/171 pass. Covers staging, dev, upgrades,
  assets, proof/fixture/contracts, clock/wire, older surface compatibility and
  qualification/audit tests. Earlier generated proof-table and wire-trace
  drift was regenerated from actual source/host output and rerun.
- **Mac Studio:** final token/clock/CLI 107, file assets 8 and store ownership
  10 tests pass. Earlier lifecycle 29 and affected JavaScript 36 pass. Only
  `ccheever@macstudio-charlie-apt101-a:~/sb4-ws-dx4` was used; no MacBook.
- **Full fresh-pack Linux consumers:** `qualify-linux --consumer-only` passes
  at `29f7b91e81` on Ubuntu 24.04 and Alpine, including all 12 frontend proofs,
  six host starter cases, both complete clean-userspace starter matrices,
  staging, migrations, security, release transitions, day-two/day-four/day-five,
  production, rule/client recipes and the DX4 packed cases.
- **Final source packed rerun:** fresh official prepare-client and static Linux
  platform packs at `6578745b85`; staging and DX4 cases pass, including every
  changed fenced guide recipe verbatim, first-admin replay and default-view
  staging discovery. The stronger packed default-view assertion first caught
  the hidden-opening issue; its failing transcript is retained. The intervening delta is guide ordering/budget, tests,
  annotations and byte-identical token-body extraction; unchanged shared
  starter matrices were not repeated. Final client bytes exactly match the
  full consumer qualification and all ten copied upgrades.
- **Root prerequisites/checks:** frozen Bun install, workspace hoist, generated
  artifacts, inventories and guide pass. Inventories: 365 package tests,
  35 script tests, 31 demos/catalog entries and 487 publication leaves. Guide:
  22 passed, zero failed/skipped/preconditions; inherited freshness/GAP warnings
  remain (162 pages, 1,937 snippets).
- **References/docs:** ref-check passes (556 LLPs, 12,102 refs, zero errors or
  unchecked refs). Docs budget passes: README 319/320 and named self-contained
  first-account test passes. Changed code is within the source-file cap.
- **Wasm:** 2,385,842 raw / 727,013 gzip bytes, within the unchanged 727,513 budget.

All Cargo commands inherited `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`; shell commands were
bounded with timeout. `scripts/test.sh` was not run. Consumer-only evidence is
explicitly **not** a publication-qualified receipt. Standard ignored cases and
optional database/Lean/Kani campaigns are outside this default-suite result.

Artifacts and command evidence:
[verification index](snapback4/reports/20261019-dx4/verification.json),
[full Linux consumers](snapback4/reports/20261019-dx4/linux/consumer.json),
[final packed cases](snapback4/reports/20261019-dx4/packed/proof.json).
Client SHA-256: `bd4aa5bbd039f8a03871561865de24cae04189d4ac84c157033fa839efb53c0e`.

## Ten copied-app upgrades: every warning

Five wave-18 lanes started at 0.4.33: 004, 015, 019, 033, 045.
Five wave-17 lanes started at 0.4.31: 005, 010, 019, 033, 045.
All ten upgrades and post-upgrade checks exit 0; **17 warnings** were shown.
[Every warning, grouped per project](snapback4/reports/20261019-dx4/upgrades/UPGRADE-WARNINGS.md)
and adjacent JSON files preserve the exact warnings/stdout/stderr and check facts.

Original evidence apps were read-only and never modified. Copies omitted
credentials/stores/dependencies/generated probe evidence. A temporary local
registry substituted only candidate Snapback tarballs; real npm resolution and
ordinary upgrade paths were exercised. Some original Expo baselines required
`--legacy-peer-deps` for installation. These are source/schema upgrade tests,
not a production-store downgrade claim. The conservative scan also reports
old `dist-v1` bundles as review candidates; it does not claim every candidate
actually executes a closed door.

## Cleanup and deferrals

No DX4 feature is deferred. The guide points to the owning lane for adjacent
security/query/staging-clock work. The next bakeoff has not been run here;
passing finite tests is not a universal security or bakeoff-win claim.

Copied apps, disposable qualification apps and credential stores were removed
after retaining compact evidence. Dedicated replay/correction scratch was
removed in finally blocks. Old DX4 memory-token fixture remnants were identified
by their dead PID and unique +25h two-day ranker seat and removed on Linux/Mac;
the helper now terminates gracefully before its bounded kill fallback. Mac
build outputs and this worktree's large completed Cargo outputs were removed.
Other lanes' temporary files/worktrees were not deleted.


## Wave-19 day-two coordinator addendum — complete

Merged `origin/main` first in `eecdbb054d`, without conflicts. Read wave-19
§6 and fix-list #6/#7. Evidence app originals stayed read-only. No version bump,
push or publication; source version remains 0.4.34 for integration into 0.4.35.

- **Identity rate limits:** `fa12dce850` shares exact server-delay retry across
  SDK guest/signup/login and proof seedAccounts/seedUsers. Only delivered auth
  429 E_RATE_LIMIT refusals retry, at most four attempts within the deadline,
  preserving credentials/scope. Body retryAfterMs wins; older Retry-After
  headers include zero and elapsed-date handling. Cancellation stops waiting.
  Lost/malformed replies, rotation and provisioning never replay.
  `30a8f2a2f1` explicitly classifies signup deadlines independently of timer
  precision; `ed0abcf8ca` adds the deterministic early-timer regression.
- **Local production lifecycle:** deploy/rollback wait for the actual owner
  flock before admission during shutdown, including a still-open listener
  with a missing control endpoint. Activation requests never automatically
  replay. startServe().stop() reaps its retained child and waits for worker/
  watchdog-held locks. The bounded read-only `serve DIR --wait-stopped` barrier
  creates no store, opens no SQLite and signals no PID. Cleanup failure rejects.
- **Inspection:** `data --json` returns `{rows, more, limit}`, including empty
  results, default 50-row truncation and limit zero. Repository consumers and
  guide changes 0.4.35 use the envelope. Text stays JSON lines.
  `d7cb40ffb5` supplies the pagination fixtures' explicit insert rule.
- **Guide follow-through:** `d9b420ef75`, `dcbc335b98`, `ebc41801f2` and
  `7239e705c7` register and pin deadline recovery, preserve the existing timeout
  definition, fit the deploy card's original 150-line budget, and verify both
  timeout help entries in the installed CLI. All existing guide code fences
  remain byte-identical. JOURNAL records the commissioned optional Refusal
  metadata field; SEC4/QRY/MIG scope pointers remain in place.

LLP 3000.000.000.001 §9 carries the semantic amendment. Both final independent
reviews are **READY**: [Muse](llp/reviews/dx4-wave19/r3-muse.txt) and
[fresh Codex](llp/reviews/dx4-wave19/r3-codex.txt). All reviewed implementation
and amendment input hashes still match. [Provenance](llp/reviews/dx4-wave19/provenance.json)
retains all three rounds, exact commands and complete verbatim transcripts.

Verification and evidence:

- **Rust:** all **430/430 targets** have passing completed results: **6,901 tests,
  45 default-ignored**, no missing/red target. Fresh affected coverage is all
  54 CLI targets (1,358 passed) and all 170 language targets (2,292 passed).
  The five unchanged core/device/sim/difftest/native crates retain their original
  full-run evidence above. [Coverage index](snapback4/reports/20261019-dx4-wave19/cargo-coverage.json)
  names every latest result and raw log. Language runs retained earlier guide
  failures; the complete **127/127 guide rerun** supersedes them. The resume
  process consequently exited 101 for that earlier guide result; every remaining
  target and doctest completed, and no failure or timeout is counted as passing.
- **Affected clients:** **135/135 pass** after the corrected pack, including 12
  identity tests, staging, proof lifecycle/fixtures/contracts, sessions and HTTP
  bounds. Exact-delay, cancellation, permanent/ambiguous refusal, active signup
  deadline and deterministic early-timer cases all pass.
- **Mac Studio:** **89 native checks pass** (29 lifecycle, 28 admission, 20 CLI
  surfaces, 12 ownership), plus 41 affected client tests and the final 12-test
  identity target. Only the assigned `macstudio-charlie-apt101-a:~/sb4-ws-dx4`
  lane was used. No platform-sensitive implementation changed afterwards.
- **Fresh full Linux consumer qualification:** source `ed0abcf8ca`, static musl
  ELF, all **12 generated frontend cases**, **6 host starter cases**, and both
  complete clean **Ubuntu 24.04/Alpine** matrices pass, along with the full
  staging, security, production, migration and recipe cases. Its SDK tarball is
  byte-for-byte identical to the final pack (SHA256
  `90a010c91882467da1a2e1ac03a13f05e5b27af6f0fca3ee40e832e7176de0d1`).
  [Full evidence](snapback4/reports/20261019-dx4-wave19/linux/consumer.json).
- **Final packed qualification:** source `7239e705c7`, native guide source
  `ebc41801f2`, passes both timeout help entries, verbatim guide recipes and all
  DX4/staging cases. Actual 30/min peer limits exercise SDK retry and 35 real
  password accounts through seedUsers; worker cleanup precedes stop resolution,
  immediate deploy/rollback succeeds, and JSON pagination boundaries pass.
  [Final proof](snapback4/reports/20261019-dx4-wave19/packed-final/proof.json).
  This scoped rerun covers the guide-only follow-through after the broad run;
  it does not claim a new full frontend/userspace snapshot. Neither run is a
  publication-qualified receipt.
- **Copied upgrades:** all **10 pass** again (five 0.4.33 wave-18 apps and five
  0.4.31 wave-17 apps), with the final SDK bytes. All **17 project warnings** are
  [verbatim here](snapback4/reports/20261019-dx4-wave19/upgrades-final/UPGRADE-WARNINGS.md);
  full per-project stdout/stderr alongside preserves compiler/package-manager
  messages too. That platform includes the d9 guide catalog; the later guide
  paragraph ordering/test matcher changes no upgrade/check behavior. Copied apps were removed; original evidence apps were never modified.
- **Root/checks:** frozen root install, workspace hoist, generated artifacts,
  inventories and guide checks pass. Guide: 22 passed, zero failures/skips/
  preconditions; inherited 121 warnings. Ref-check and docs-budget pass
  (README 319/320). An initial 180-second inventory watchdog was rerun with
  sufficient bounded time; it is not counted as a passing run.

[Verification index](snapback4/reports/20261019-dx4-wave19/verification.json)
binds sources, digests, raw results and artifact locations. Completed Cargo targets, Mac lane dependency outputs and disposable
consumer apps were removed; new
packed scratch directories are absent. Tarballs and compact evidence remain.
No addendum feature is deferred.
