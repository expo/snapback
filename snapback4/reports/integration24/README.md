# Integration 24 — 0.4.40 qualification

Implementation snapshot: `1a6b1438f902df4b8691b545814d0e0015a9a65d`.
Baseline for integration/difftest: published-source 0.4.39 `d4441c83b6`.
Pre-wave-26 comparator: `809cdc3818` (same production code as the coordinator's `3808a073b7` build), separately built with optimization to complete the full history campaigns. The schema and contemporary-fixture corpus is identical before/after, verified by every per-project hash.

SEC9/SEC8 merge `59af43d907`; DX8/DX7 merge `36f1af99e3`; main sync `809cdc3818`; standalone version bump `2b926e84f6`. The root report records the integration and final delivery commits.

## Results

- Full five-crate Rust passes after the last fix: 461 scopes, 7679 reported passes, 391 declared ignores, zero failures; exact unfiltered --no-fail-fast command/environment retained. Actual node scripts/docs-budget.mjs also passes.
- Linux clients: 431 file/fixture groups, then both full model files. 7,968 passed, 56 declared platform/environment skips, zero failures. `clients/` retains full logs, exact command ledger, unchanged native/SDK/Wasm hashes and the empty post-pool source status.
- Mac Studio: final language library plus 21 affected targets, device2, CLI binary plus11 affected targets pass. All114 Darwin/platform files pass (2,440 passes,14 declared skips), plus89 model tests. `mac/` retains source/toolchain bindings, unchanged artifacts and clean source status. Unchanged Core full/PG-feature library passes at4ee are under `mac/prior/`; the initial missing sparse-checkout fixture error and corrected full retry are both retained.
- The existing resolver-readiness flake occurred in an earlier Mac CLI run. The unchanged case passed alone in3.59s and in the complete final affected repeat. The existing open issue remains open; no assertion, seed or deadline is relaxed.
- Fresh prepared client/Expo bytes are identical across final host-only corrections: client `ff8573ede171e8025d0d4e1ad9f96554e4251bd621039694beed6ae7dd3882c4`, Expo `0b431967a27670d63ccb94e537e4a9e596c3079f03480a72b7c2ce62b6c4da69`.
- Complete installed-consumer Linux qualification passes, including all lane helpers, rollback/migrations, security, staging, frontends/starters and Ubuntu/Alpine. `packed/consumer.json` binds the exact source and artifacts. Its `publicationQualified:false` and source-suite `not-run` are intentional: `scripts/test.sh` is prohibited; the requested source suites run separately. No npm publication is claimed.
- Difftest reruns both current candidate and archived0.4.39: engine20k, devices seeds0–999, real Lean oracle20k. All normalized report fields match apart from timing. Lean's raw exit1 reproduces exactly130 known disagreements (3code,35continuation-next,67next,25prelude-code); no new signature. All42 retained global/worker representative case objects, findings and source bytes are identical.
- Root guide22 passed, zero failures/skips/preconditions; inventories and ref-check pass. Final post-report checks are recorded separately.

## Day one: all600 copied schemas

| Measurement | Before | After |
|---|---:|---:|
| Projects with check gates |35|35|
| Fresh production-deploy refusals |43|39|
| Production refusals after test |56|49|
| Failed original-app test commands |62|54|
| Timeouts |0|0|

Wave15 contributes100 final schemas; waves16 and18–26 contribute50 each. All50wave26 projects now have zero gates, zero fresh/post-test refusals and zero test failures. Seven false post-test refusals disappear: wave24/25operator-provision006/033 and wave26009/025/041. Four fresh operator-provision refusals also disappear.

All49 remaining refusal projects are classified:32 clear with per-finding intent,17 are real (15 retained-grant specification questions and2 ordinary-read privacy contradictions). Each conditional copied repair/decision clears final check and both deploy modes. Zero false gates, zero false production refusals, zero unresolved conditional copies. These are finite corpus observations, not universal proof or author acceptance of intent choices. Multiple fields/findings can require multiple one-line changes.

`day-one-projects.tsv` lists every project, check/gate/deploy/test outcome, individual gate IDs/sites, precise conditional edits and commands. Raw outputs retain every refusal's message and next step. The49 conditional experiments are in `day-one-conditional-audit.jsonl.gz`. Four copied apps still carry unmodified todo starter case files; two deliberately reviewed derived weight-freeze questions still produce finite test witnesses. Their six test failures are retained, never relabelled passes. Copying valid decisions into the private HTTP test host removes15 separate false setup failures after acknowledgments.

The original SEC9 fixed450 subset (wave15 plus16,18–23) remains32 gates/36 fresh refusals, with44 after-test refusals. Earlier debug-build survey attempts had one slow full history exceed900s; its isolated longer run passed and the controlled optimized baseline independently completes all600 with no timeout. No product deadline changes.

## Day two: actual wave25 production stores

Both modes cover all50 store copies: merged build directly and published0.4.38 followed by merged upgrade. Each has zero baseline38 refusals,2 real v2 deploy refusals,48 default rollback attempts/1 real refusal,48 forward attempts/zero refusals,47 complete backward/forward cycles. The remaining forward attempt selects the already-current release after the real rollback refusal.

Both modes have zero hidden trackedv1 row IDs. All47 successful default rollback visibility reports also have zero hidden rows and zero newly-empty cells. Unattempted actions after a failed deploy are excluded from refusal counts. The raw initial summary's None-counting error is superseded by the corrected generated summary.

- 004saddle fitting needs truthful cross-table down/bridge source for defaulted visits fields moved into assessments.
- 024stair lifts needs compatible guarded source retaining predecessor fields/inputs and current authority.
- 030sewer camera needs a truthful bridge/down for retained inspections, or the explicit `rollback --to 1 --exact --check` selection.

The zero-total-refusal target is not achieved; these three cases are genuine. Copies exclude owner/token/control files. Originals are never opened by SQLite; raw byte hashes confirm all150SQLite/WAL/SHM files unchanged. Temporary replay stores are removed.

## Exact and wasm

Fresh Exact2 origin/main at clone: `da8ab8746173273da7e2b5f5e489de78b4198f5a`. Fresh synced and online apps each execute literal `bun exact.mjs snapback` and `bun exact.mjs test web` against the final merged native/client; synced2 and online1 tests pass. `exact-results.json` retains every exact argv, cwd, port, input hash and result. `exact-local-bindings.patch.gz` contains only clone-local client/Rust dependency changes and their Cargo/bun lockfiles; no Exact product code changes. Own server cleanup is recorded.

Canonical Linux wasm:2,415,003B raw/737,990B gzip/555,572B Brotli; glue16,053/3,695/3,260. Gzip budget738,490B is measurement+500B, with the reason recorded in metrics. Fresh prepare rebuilds retain identical bytes. The Mac toolchain emits different bytes within this budget; no cross-host byte identity is claimed.

All received independent reviews are verbatim under `llp/reviews/3000.036.004.000-integ24-wave26-*`, with provenance. Round4 covers the semantic precision amendment; round8's two fresh families are READY on final authoring/test-host follow-ups. Scope decisions and earlier non-ready findings are retained.

## Reproduction and scope

The integration scripts and ledgers preserve timeout bounds and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. No publication worktree or `target/publication/` is touched. No original wave store is opened in place. Client and packed qualification hold the source and artifacts fixed; report additions follow their clean-tree receipts.

The complete five-crate Rust run and actual docs-budget check both pass. Delivery remains pending the required final main sync and changed-input verification.

Post-report root checks pass with zero skipped dependency checks after frozen root dependency installation and `node scripts/ensure-workspace-hoist.mjs`. `root-post-report/` retains the two unsuccessful setup attempts and the successful complete repetitions.
