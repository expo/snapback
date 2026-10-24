# Integration 24 — Snapback 4 0.4.40

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Implementation qualification snapshot: `4f8e498d2e61932925dd2fbf61b43048a12ea25c`.
This report supersedes Integration 23 and the stopped/superseded Integration 24 attempts.

## Changes and commits

- SEC9, including SEC8: merge `59af43d907`. DX8, including DX7: merge `36f1af99e3`. Main synchronizations include `809cdc3818` and `1c3d2daadb` (through upstream `480f88e8b4`). Journal conflicts preserve both histories; the tracked lane-local report keeps the integration side.
- Standalone bump `2b926e84f6`, `snapback4 0.4.40: structural write authority and day-two workflows`, uses the same version-file set as 0.4.39. Exactly one 0.4.40 guide-changes entry folds SEC8/SEC9 and DX7/DX8, including upgrade gates, campaigns and repair/individual-decision steps, column `write <-`, `immutable … when`, `stop`, format 10 and restart guidance. It also records incoming bounded request queuing and PostgreSQL read composition/fallback.
- Rollback views and guarded bridges retain current column write audiences, conditional immutability and workflow guards (`e29f8375db`, `eda6d961d9`, `e8192c80fd`). Rename-down carries the current edited value. Deploy reports lead with the verdict and name each refusal's next step. No bulk security bypass is added.
- DX work retains staging time, provides an authenticated development clock, owns process shutdown with `stop`, improves dormant/media inspection and backfill/down explanations, provisions real accounts, preserves saved clients, and provides the day-two proof recipe and newest-first starter lists.
- Wave-26 precision fixes `c05fa143f6` and `1458a7d5c3`: authored column write intent permits null and unapproved false-default initialization; runtime `write <-` still checks non-null defaults. Only the operator's exact own executed provision image is exempt from authored roster-read intent. Earlier/mixed images and ordinary queries/other mutations remain checked. Approval inference excludes plain null-absence/stage preconditions while retaining positive and complex dependencies. Every gated code renders at review tier. Clean generated campaigns pass with no authored cases, including password-only apps; explicit principal cases work. Existing skipped business cases still fail. Analyzer `sec9-2` renews stale decisions.
- Authoring/test-loop follow-ups `af58ce1362`, `454ba8bd25`, `1a6b1438f9`: printed inherited-read repair assertions are authorable, preserve literals/authored selectors and parent expiry/custody, omit generated selectors and lifetime bookkeeping, and work for correctly selected saved source. Private HTTP hosts carry individual decisions through unchanged production source/analyzer validation and reject stale decisions with actionable logs.
- Main-merge regression fix `3253de2a3e` keeps planned request transaction selection inside `Committer`; admission, replay, frame disposition, COMMIT and continuations retain their order. The ratchet also recognizes `request_write_transaction`; its allowlist is unchanged. Three overload fixtures now saturate the accepted 228-connection reservation instead of 130. Retry counts, deadlines, CORS, stderr faults and recovery remain unchanged. Isolated source-copy tests pass all five affected Rust cases and both complete browser/upload files (36 passes).
- Both independent review families are READY: round 4 for semantic precision, round 8 for final authoring/test-host follow-ups, and a fresh Muse/Codex pair for the main-regression fix. All received reviews and provenance are verbatim under `llp/reviews/`; Muse's plan-quota error and successful wrapper Meta-API fallback are retained. No key file was read or printed by the integration agent.
- Full qualification at `1a6b1438f9` passed before the last main advance: 461 five-crate scopes, 7,679 reported passes, 391 declared ignores, zero failures; Linux clients 7,968 passes/56 declared skips; packed consumers and Mac green. Its evidence remains in `snapback4/reports/integration24/`. The subsequent complete main-snapshot run at `1212ff7aa5` exposed the committer/overload regressions; all failures, complete client/model results and the deliberately stopped packed attempt are retained and never counted as final passes.

## Final qualification after the last fix

Full five-crate Rust passes after the last fix: 461 scopes, 7,687 reported passes, 422 declared ignores, zero failures. Linux clients pass the full 431-group pool in one pass (7,879 passes, 56 declared skips), followed by both complete models (89 passes): 7,968 passes total. The source status is empty after the pool; native, SDK and Wasm hashes are unchanged.

Mac Studio is reachable. Only scratch clone `~/projects/snapback-integ24` is used: full core, PostgreSQL-feature library, affected language/device targets, CLI binary and 13 integration targets pass. All 116 Darwin/platform-sensitive client files pass (2,476 passes/14 declared skips), then both full models pass 89/89. Source status is empty and native/SDK/Wasm bindings remain unchanged. Node 24.13.1, Bun 1.4.2.

Difftest reruns both the archived 0.4.39 base and candidate: `run` 20,000 and `run-devices` seeds 0–999 are green; real-Lean `run-lean` reproduces exactly 130 baseline mismatches (3 code, 35 continuation-next, 67 next, 25 prelude-code). No new signatures; normalized reports and all 42 representative case/finding/source records match the base. Lean raw exit 1 is retained, never presented as a mismatch-free run.

The fresh packed Linux consumer qualification passes, including every added lane case and Ubuntu/Alpine. Client tar SHA-256 `45ef5fded9e88330086f10181dc4f35bf605c214ba0e0664a6dfe2714f556961`; Expo `0b431967a27670d63ccb94e537e4a9e596c3079f03480a72b7c2ce62b6c4da69`. Actual docs-budget passes. Root ref-check, inventories and all 22 guide checks pass with zero skips or missing preconditions. Private PostgreSQL feature, literal, closure, RT0 and store checks pass; the owned cluster stops with status 3 and no PID file, then its data is removed.

The final five-crate command is unfiltered:
`cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast`.
Every Cargo invocation carries `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. Every shell command is bounded by `timeout`.

Fresh installed consumers run `qualify-linux.mjs --consumer-only` on a new `publish.mjs --prepare-client` pack, including every lane helper and Ubuntu/Alpine clean userspaces. This intentionally does not run the prohibited full `scripts/test.sh`: its receipt has `publicationQualified:false`, and the requested source suites are separately qualified. No npm publication is claimed.

Root dependencies require frozen installation and `node scripts/ensure-workspace-hoist.mjs`. Earlier absent-dependency and missing-workspace-link attempts are preserved as unsuccessful setup attempts; passing guide checks must report zero skips/preconditions.

The existing resolver-readiness flake remains open in `issues/20261016-snapback4-unit-cleanup-and-resolver-readiness-flakes.md`. Its unchanged case passed alone and in a complete affected repetition. No assertion, seed, workload or product deadline is relaxed. No new flake occurs in this final complete five-crate, client or Mac repetition.

## Day-one survey

Inputs are immutable copied schemas and contemporary fixtures: wave 15's final 100, and 50 each from waves 16 and 18–26 (600 total). Every schema/fixture hash matches before/after. No original store is opened.

| Measurement | Before fixes | Final after fixes |
|---|---:|---:|
| Projects with check gates | 35 | 35 |
| Fresh production-deploy refusals | 43 | 39 |
| Production refusals after `test` | 56 | 49 |
| Failed original-app test commands | 62 | 54 |
| Survey timeouts | 0 | 0 |

All 49 remaining refused projects receive individual copied-source audit: 32 clear with per-finding one-line intent; 17 are real specification issues (15 retained-grant questions and two ordinary read-privacy contradictions). Every conditional repair/individual decision clears check and both production deploys. Zero false gates, zero false production refusals, zero unresolved conditional copies.

The original SEC9 fixed 450-project slice is wave 15 plus waves 16 and 18–23. It remains 32 gated/36 fresh refused in the completed pre-final repetitions. Seven former false post-test refusals disappear: wave 24/25 operator-provision 006/033, and wave 26's 009/025/041; four false fresh operator-provision refusals also disappear. All 50 wave-26 projects pass check, test and both deploy paths in those repetitions. The final repetition confirms all 50 wave-26 check/test/fresh/post-test deploy commands pass.

Each conditional copied repair/decision must clear check and both production deploys. These experiments do not accept intent on the original authors' behalf. Multiple fields/findings may require multiple one-line declarations. Six conditional copied-app tests remained failed in the completed repetitions: four stale todo starter case files and two deliberately reviewed derived weight-freeze questions still producing finite witnesses. They are never labelled passing business tests. Copying valid decisions into the private HTTP host removes 15 separate false preparation failures after individual acknowledgments.

## Day-two replay

Each mode covers all 50 copied wave-25 production stores: merged runtime directly, and published 0.4.38 followed by the merged upgrade. Final results are identical in both modes: 50 baseline selections pass; two real v2 deploy refusals; one real default rollback refusal among 48 attempts; zero forward refusals among 48 attempts. Forty-seven complete backward/forward cycles per mode retain every tracked v1 row. All 47 successful rollback visibility reports also show zero hidden rows and zero newly-empty cells. No unattempted action is counted as a refusal.

Real next steps: 004 needs truthful cross-table down/bridge source for defaulted visits fields moved into assessments; 024 needs compatible guarded source retaining predecessor fields/inputs and current authority; 030 needs truthful bridge/down source for two retained inspections, or explicit `rollback --to 1 --exact --check`. These genuine cases prevent a zero-total-refusal claim. Unattempted actions are excluded from refusal counts. The harness's earlier None-counting mistake is corrected; the original mistaken summary remains preserved.

Copies exclude owner/token/control files. SQLite is opened only on copies, with explicit connection closing. All 150 original SQLite/WAL/SHM byte hashes are independently rechecked unchanged after qualification. The evidence records the raw-byte method and hashes.

## Exact, wasm and delivery

Fresh Exact2 origin/main clone at `da8ab8746173273da7e2b5f5e489de78b4198f5a`, under `~/sb4-loop/prewave24/`, uses only clone-local merged client/Rust dependency bindings and resulting Cargo/bun lockfiles; no Exact product code changes. Fresh synced/online apps run literal `bun exact.mjs snapback` and `bun exact.mjs test web`. Both commands pass for both fresh final-snapshot apps: synced web 2/2, online web 1/1. App paths are `~/sb4-loop/prewave24/{synced,online}-integ24-wave26-final40/app`, ports 28924/28925. Exact command ledgers, clone-local dependency/lock patch (five files only), manifests, source/runtime/client hashes and owned-server cleanup are in the final Exact evidence.

Final clean-source Wasm measurement at `3253de2a3e` is 2,415,003 B raw / 737,990 B gzip / 555,572 B Brotli; glue 16,053 / 3,695 / 3,260 B. The 738,490 B gzip budget is measurement plus exactly 500 B, with the reason retained (`4ee8dd80ec`, repeated measurements through `4f8e498d2e`). Device-family/server-only-absence checks pass. Mac artifacts have separate toolchain-bound hashes; no cross-host byte-identity claim is made.

Complete qualification evidence is under `snapback4/reports/integration24/final/`; final main-delta evidence is under `snapback4/reports/integration24/post-main/`.
No publication worktree, `target/publication/`, or other existing worktree is modified. No original wave store is opened in place. The source tree is held clean and artifacts fixed during each qualifying client/packed run. LLP 3000.037 §20.9 records structural-security and day-two consequences without invented comparative ratings.


## Final upstream synchronization and delivery

Main through `6cbe3869da` merges as `18fb954531`; metadata/measurement commit `6c638549fd` regenerates three independent evaluation lockfiles at 0.4.40 without changing registry versions. Both journal histories, the integration report and 0.4.40 versions survive. Authoring census regenerates unchanged (884 entries), as do the registry and guide manifest. Clean-source Wasm remains 737,990 bytes gzip with the 738,490-byte budget.

Changed-input qualification at `6c638549fd` passes on Linux and Mac: full PostgreSQL core (1,212 reported passes each); CLI binary plus committer/overload/wave-26 targets (629 Linux / 621 Mac); four portable pipeline oracles; 246 private adapter tests; isolated cold-plan, codec, committer/maintained/command, 60 evolution tests, RT0, actual 128-client HTTP and four store oracles. Linux additionally passes the TCP_NODELAY/strace witness over actual TCP. All commands pass; both owned private clusters stop/status 3/no PID/no surviving original process, data is removed and source status is empty. No new flake occurs. These functional checks make no S1 capacity or on-wire-overlap claim; the upstream witness-gap issue stays open.

The actual default public native binary is rebuilt (SHA-256 `33d84264253bcc891304fdf8fcc91824a8776a167e140e6d1ec8b73e4e877d79`). The unmodified public deploy/serve witness passes ownership, restart, redaction, P1-CE/P1-MC and evolution checks; all recorded child PIDs and its separate private cluster are independently absent, then owned data is removed. A fresh prepared client/Expo pack is byte-identical to the fully qualified artifacts (`45ef5fde…` / `0b431967…`), so the installed-consumer receipt applies to those exact bytes.

Compiler, device, simulator, SDK and root-guide sources are unchanged. Full five-crate, client pools, survey, replay, difftest and Exact receipts retain their actual tested snapshot binding; they are not relabelled as reruns at a later HEAD. New ref-check and inventories pass. All 150 original store-file byte hashes are rechecked unchanged at the end. Detailed commands, counts, content bindings, logs and cleanup receipts are in `snapback4/reports/integration24/post-main/`.

Delivery: qualified for final fetch and nonforce `sb4-loop:main` push. Full `scripts/test.sh` remains unrun as instructed; no npm publication is claimed. The real application survey/replay exceptions above remain explicit.
