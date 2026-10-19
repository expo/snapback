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
