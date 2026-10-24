# Integration 24 — Snapback 4 0.4.40

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Final complete product qualification: `53da2f7b3de6344e2be82a90364815679b4e7533`.
This report supersedes the stopped Integration 24 attempts. Receipts retain their actual source bindings.

## Changes and commits

- SEC9 (including SEC8): merge `59af43d907`. DX8 (including DX7): merge `36f1af99e3`. Both lanes' compiler, diagnostic, help/parser and rollback intent is preserved. Main merges include `809cdc3818`, `1c3d2daadb`, `18fb954531` and `4dbc981bce`. Report conflicts keep the integration side; journal conflicts keep both histories.
- Standalone version bump `2b926e84f6`: `snapback4 0.4.40: structural write authority and day-two workflows`. It follows 0.4.39's version-file set. Exactly one 0.4.40 guide-changes entry folds the lanes' 0.4.40/0.4.41 entries and explains existing-app/store upgrade gates, generated deploy campaigns and repair/individual-decision steps, `write <-`, `immutable … when`, `stop`, format 10 and restart guidance.
- Rollback corrections `e29f8375db`, `eda6d961d9`, `e8192c80fd` preserve v2 guards, column audiences and conditional immutability through views and guarded bridges. Rename-down uses the current edited value. Deploy output leads with its verdict and gives each refusal's next step.
- DX retains staging time and saved v1 clients, provides an authenticated development clock, owns shutdown with `stop`, improves dormant/media SQL and backfill/down explanations, provisions real accounts, and supplies the day-two recipe and newest-first starters.
- Wave-26 fixes `c05fa143f6`, `1458a7d5c3`: authored column write intent permits null/unapproved false-default initialization while structural `write <-` still checks meaningful defaults. Only the operator's exact own executed provision image is exempt from authored read intent; preimages, mixed results, subsequent queries and other mutations remain checked. Approval inference excludes null-absence/stage preconditions while retaining positive/complex dependencies. Every gated code renders as review tier, enforced structurally. Clean generated campaigns pass with zero authored cases, including password apps; explicit principal cases work; existing skipped business cases still fail. Analyzer `sec9-2` invalidates stale decisions.
- Follow-ups `af58ce1362`, `454ba8bd25`, `1a6b1438f9` make printed inherited-read repairs authorable, preserving literals, authored selectors and parent expiry/custody while omitting generated selectors/lifetime bookkeeping. Private HTTP test hosts carry individually validated decisions and refuse stale decisions with the exact next step. Synthetic regression schemas reproduce the lane shapes without using original stores.
- Main-regression fix `3253de2a3e` moves physical request transaction selection into the committer; overload fixtures match the accepted 228-connection reservation. Existing deadlines, retry counts and recovery assertions remain intact. Later write-land merge `4dbc981bce` uses upstream ProgramHost/Committer::run_program_until, byte-identical to upstream in the mutation conflict, preserving the opening-ownership rule.
- New mixed grouped/serial security history `e87e0bff3d` checks expected outcomes and durable rows at widths 1/2/4/12: unauthorized payload/owner changes, nullable creation, approval and frozen edits/deletion/thaw attempts. SQLite and actual private PostgreSQL variants pass on Linux and Mac. Census/lock/measurement commit `53da2f7b3d` regenerates actual outputs: opener allowance identities decrease 4→2, mutation stays zero; no allowance increases. Authoring census remains 884 canonical entries (558 mutation occurrences/95 private sites). Three evaluation locks retain 0.4.40 and registry versions. Diagnostics, manifests and inventories are generated, never hand-merged.
- Both independent review families are READY: semantic round 4, authoring/test-host round 8 and a fresh Muse/Codex pair for the committer fix. Received reviews/provenance are verbatim in `llp/reviews/`, including Muse's quota failure and successful wrapper fallback. No key file was read or printed.

## Final complete qualification

The exact unfiltered five-crate command passes after the last fix:
`cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast`.
**463 scopes; 7,722 reported passes; 468 declared ignores; zero failures.** All wave-26, SEC8/SEC9, rollback and exhaustive ordinary histories pass. The existing resolver-readiness flake is ticketed in `issues/20261016-snapback4-unit-cleanup-and-resolver-readiness-flakes.md`; its earlier isolated/complete repetition passed. No new flake occurs in this final complete run, client pool or Mac run. No assertion, workload or product deadline is relaxed.

Linux: the full 431-group client pool passes in one pass (7,879 passes/56 declared skips), followed by both complete models (89 passes): **7,968 passes/56 skips** total. Source status is empty after the pool; native, SDK and Wasm hashes remain fixed. Final native test/pool/survey/Exact binary SHA-256: `26d6fc31ba629466bb7ce99dc57dc3757c650d9ceab44952acce481d5f98880c`.

Mac Studio: only scratch clone `~/projects/snapback-integ24` is used. Full core/default, PostgreSQL-feature library, affected language/device targets, CLI binary plus 13 integration targets, actual private program/outcome/grouped-write/codec/RT0 checks all pass. All 116 platform-sensitive client files and both full models pass: **2,565 passes/14 declared skips**. Node 24.13.1/Bun 1.4.2. Source status and native/SDK/Wasm hashes remain fixed. Owned PostgreSQL 16.15 cluster stops/status 3/no PID and data is removed. No other Mac worktree or existing cluster is modified.

Difftest repeats BOTH archived 0.4.39 and merged candidate: `run` 20,000 and `run-devices` 0–999 pass. Real-Lean `run-lean` reproduces exactly **130 inherited mismatches**: 3 code, 35 continuation-next, 67 next, 25 prelude-code. No new signatures; normalized reports and all 42 representative case/finding/source records match. Raw Lean exit 1 is preserved; no mismatch-free claim is made. Timing fields alone are excluded.

Fresh `publish.mjs --prepare-client` plus the complete installed-consumer `qualify-linux.mjs --consumer-only` passes every lane helper and clean Ubuntu/Alpine consumer. Client SHA-256 `45ef5fded9e88330086f10181dc4f35bf605c214ba0e0664a6dfe2714f556961`; Expo `0b431967a27670d63ccb94e537e4a9e596c3079f03480a72b7c2ce62b6c4da69`. `publicationQualified:false` is intentional: the prohibited full `scripts/test.sh` is not run; required source suites are separately qualified. No npm publication is claimed.

Actual `node scripts/docs-budget.mjs`, root ref-check, inventories and all **22 guide checks with zero skips/preconditions** pass. Fresh-root setup includes frozen install plus `node scripts/ensure-workspace-hoist.mjs`; earlier incomplete-setup attempts are preserved as failures, not passes.

Private Linux PostgreSQL checks pass: complete feature library, 33 literal-serving cases, 11 read-closure cases, five round-trip cases, one invocation oracle, eight outcome cases, all 53 grouped cases and four store oracles. The owned cluster stops/status 3, its original postmaster is absent and data is removed. The unmodified public `scripts/test-postgres-serve.py` also passes against the default native binary (SHA-256 `7319fc11401e241f3a348ab0ac3d17ecdf0149b39c5fa18135d8a381a47fd89d`), including evolution, ownership, restart, redaction, change retention, SDK sync and public recounts. Its separate cluster stops/status 3/no PID; all 548 recorded child PIDs are independently absent and its owned directory is removed. A newly prepared pack is byte-identical to the complete installed-consumer qualification.

Every shell command is bounded by `timeout`. Every Cargo invocation carries `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. Completed owned consumer dependency trees and PostgreSQL data are removed; packs, binaries and evidence are retained.

## Day-one false-refusal survey

600 copied projects: wave 15's 100 final schemas plus 50 each from waves 16 and 18–26. Before/after schema and fixture hashes are identical. Each project runs check, fresh production deploy, test and production deploy after test.

| Projects/commands | Before fixes | After fixes |
|---|---:|---:|
| Projects with check gates | 35 | 35 |
| Fresh deploy refusals | 43 | 39 |
| Deploy refusals after test | 56 | 49 |
| Failed original app tests | 62 | 54 |
| Timeouts | 0 | 0 |

All 49 remaining refused projects have individual copied-source audits: **32 clear by one-line intent per finding; 17 are real** (15 retained-grant questions, two ordinary authored read/privacy contradictions). Every conditional check, fresh deploy and post-test deploy passes: **zero false gates, zero false deploy refusals, zero unresolved projects**. The TSV and raw outputs record each finding, exact line/individual acknowledgment and next command. Multiple findings can require multiple declarations; these experiments do not accept the original authors' intent or edit originals.

The SEC9 fixed 450-project slice (wave 15, 16 and 18–23) confirms **32 gated/36 fresh refused**, also 44 after-test refused. Four false fresh operator-provision refusals disappear; seven false after-test refusals disappear (wave 24/25 006/033 and wave 26 009/025/041). **All 50 wave-26 projects pass all four commands.** Six conditional copied-app business tests still fail: four stale todo-starter case files and two deliberately reviewed finite weight-freeze witnesses. They are not presented as passing business tests.

## Day-two replay and original-store hygiene

Both modes cover all 50 copied wave-25 production stores: direct merged upgrade, and published 0.4.38 followed by merged upgrade. Per mode: baseline 50/50 succeeds; **two real v2 deploy refusals**, **one real default rollback refusal among 48 attempts**, **zero forward refusals among 48 attempts**. **47 complete rollback/forward cycles per mode have zero hidden tracked v1 rows; all 47 visibility reports show zero hidden rows and zero newly empty cells.** Unattempted actions never count as refusals.

Real next steps: 004 saddle fitting needs truthful cross-table down/bridge source for defaulted visits fields moved to assessments; 024 stair lifts needs compatible guarded source retaining predecessor fields/inputs and current authority; 030 sewer inspections needs truthful bridge/down source for two retained inspections, or `rollback --to 1 --exact --check`. These prevent a zero-total-refusal claim; no false refusal remains identified.

Original stores are never opened in place. Copies exclude owner/token/control files; SQLite connections to copies close explicitly. All **150 original SQLite/WAL/SHM raw-byte SHA-256 hashes remain unchanged**, independently rechecked after qualification. No publication output, publication worktree, other existing worktree or `~/projects/snapback` is touched.

## Exact and Wasm

Fresh clean Exact2 origin/main clone at **`e54cb130952de59feec3d34d9d26db04f046d3aa`**: `~/sb4-loop/prewave24/exact2-integ24-write40`. Only five clone-local dependency/lock files change, binding merged Rust/client artifacts; no Exact product code changes. Fresh synced/online apps are `~/sb4-loop/prewave24/{synced,online}-integ24-wave26-write40/app`, ports 28924/28925. Both run literal **`bun exact.mjs snapback`** and **`bun exact.mjs test web`** successfully: synced 2/2, online 1/1. Exact new uses `--snapback --port 28924`, respectively `--snapback --port 28925 --online`. Command ledgers record cwd/argv/exit and client install. The first old-lock `--locked` failure is retained separately; root/nested metadata regenerate locks and the complete repeat passes. All owned servers/background compiler are absent afterward.

Clean-source Wasm is **2,415,003 bytes raw / 737,990 gzip / 555,572 Brotli**; glue 16,053/3,695/3,260. Budget **738,490 gzip = measurement + exactly 500 bytes**, with the recorded reason. Clean measurement repeats at write-land `4dbc981bce`; subsequent regression/census-only changes preserve production bytes. Strict-family/server-only absence checks pass. Mac artifacts have distinct toolchain-bound hashes; no cross-host byte-identity claim.

## Evidence and delivery

Final repeated evidence: `snapback4/reports/integration24/write40/`. Earlier complete evidence remains in `final/`; earlier affected reader/adapter evidence in `post-main/`; write-land setup/regressions/censuses in `write-land-prep/`. Interrupted/red attempts are retained and never counted as final passes. LLP 3000.037 §20.9 records structural-security and day-two consequences without invented comparative ratings.

All required product qualification is green. Delivery awaits the final main synchronization, focused verification of its changed tooling inputs and a nonforce `sb4-loop:main` push. Full `scripts/test.sh` remains unrun as instructed; no npm publication is claimed. The genuine application exceptions above remain explicit.
