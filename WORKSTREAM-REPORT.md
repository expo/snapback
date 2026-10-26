# Integration 27 — DX12, DX13, REL2, SEC10 / Snapback 4 0.4.43

This integration combines the four lanes and fixes the deterministic publication reds named in the brief. Publication remains separate; this is source landing evidence, not an npm or platform qualification claim.

## Integration and commits

Started clean at `aa9e6af45c` on `sb4-loop`. The initial fetched main/base was `799e42a6bb560c310ac8f3a3411d740b7380b372`.

- `091bf460fd`: requested initial `--no-ff` main merge.
- `90f12a39b2`: DX13 `4348d2c6d9`, including DX12 `60c66b4e35`.
- `adc65e74a2`: REL2 `d170d48367`.
- `9aaeb6d3a1`: SEC10 `ab4fb0f53b`.
- `0efca3dcd3`: early version commit, **snapback4 0.4.43: witnessed security questions, release fidelity and proof custody**. Updates the prior bump's manifests/locks/version fixtures and the 3000.037 friction research record before broad verification.
- `08632e34c7`, `54df66dcb2`, `ae4b913371`: seam repairs, known-red/fixture/cleanup fixes, review artifacts and generated censuses.
- `b3de551c7f`: integration journal and wasm budget date.
- `80411b9d8f`: final verification found an additional shared-source regression: write-free depth-200 alias DAGs expanded during unconditional default capture. The authority walker now first checks raw reachable helper syntax with a visited set; exactly empty write-event sets return without substitution. Any possible write still gets the full walk. A literal-default-bearing pure DAG and helper-only two-hop write are opposing regression controls; the existing depth-200 and five-second engine assertions remain unchanged.

- `c6874cb0b7`: eleven publication client fixture/documentation repairs.
- `8eabb1f777`: first final-main merge, through `e0ad590a1b`.
- `02cf700f71`: late Stage P/experiment main merge, through `9ee365bbd6`; no conflict or SQLite runtime change.
- `f8e52af152`: PostgreSQL upgrade facts in the same 0.4.43 guide-changes entry and the integration journal.

## Seam, upgrade and reviews

SEC10 current, applicable approval witnesses are gates. Current enforced derived refutations are promoted to the blocking tier on deployment and excluded from witnessed-question rendering. Every other unacknowledged concrete witness is a default-visible, nonblocking question; unwitnessed advice remains behind `--review`. Displayed authored FIX counts and gate/question/advisory counts agree with actual refusal. Unconditional default witness search retains SEC10's deterministic work budgets. Human compact summaries are excluded from witness identity. Witness-answer validation and the acknowledgment wording remain intact.

Runtime `Table::column_initialization` and both authored/enforced security analyses use DX13's literal-default insert initialization. An omitted declared literal default is initialization; edits still require column authority. SEC10's rewritten analysis retains this parity. LLP 3000.036.004.000 retains SEC10 §§10–13 and moves DX13's overriding rule to §14. REL2 `rowShape` is always in JSON; concise rollback/release output still discloses actual differences and extraction children, while omitting the redundant preserved-shape line.

One conflict-only review from each requested reviewer is saved verbatim under `llp/reviews/3000.037.000-integration27-seam.*`. Muse returned READY. Fresh Codex returned NOT READY with two defects (a derived FIX also shown as a question, and compact summary affecting witness identity); both were corrected with regression controls. No subsequent independent READY verdict is claimed and no extra review round ran.

One coherent 0.4.43 guide-changes entry incorporates DX12/DX13/REL2 and moves SEC10's pending 0.4.41 material. It explains upgrade effects on existing apps/stores. The deliberate semantic changes are literal-default insert initialization and visible-character text minima. Stored values failing the latter require repair before narrowing/adoption; the guard is not weakened.

## Named publication reds and timing fixes

- `store_port_ratchet`: the production use is exactly the neutral `early_release::Durability` type. The matcher excludes only that adapter type and retains external-driver/constructor rejection controls. **Production allowance remains zero.** Main's two new test-only revision-cache sites receive explicitly justified fixture census entries, not a production exemption. The issue is resolved under `issues/closed/`.
- Admin bootstrap without a public privilege race passes. `E_DATA_TRANSACTION_ABORTED` has its guide-code explanation. Release JSON discovery remains on the deploy card.
- Deploy card reference sections moved intact to release-json; no facts/limits removed. Final card **131/150 operational lines, 263/280 total**; initial focused guide/Surf4 targets pass **132/132**, and the changed installed guide plus full CLI Surf4 repeat passes **128 + 20**.
- Old DX12/DX7 tests now exercise an actually applicable declared presence contract; they retain gate/refusal/ack assertions. DX13's nongate question fixture includes the approval guard required by SEC10. Real wave27/018 covers the enforced-derived blocking tier. Focused DX12/DX13/DX7 **8/8** plus complete final CLI pass.
- `proof.test.mjs` test 25 waits for npm's actual descendant-ready marker, completes the command and waits for descendants to disappear. Its condition poll is bounded, cancellation-aware and owns its timer; failure cannot leave an endless poll. Separate timeout and caller-death controls remain. **31-test file passed 10/10 runs**, serial-client-files=1, under **16 busy loops on the same eight CPUs** (608.631 s total). An injected false condition fails in **1.228 s**, the filtered test-file process exits in **1.482 s**, with no surviving poll. Thus readiness/cleanup no longer depends on the five-second window.
- `identity-rate.test.mjs`: deterministic monotonic setup clock protects the ten-millisecond active abort timer from fixture I/O; actual abort is still timed by the real timer. **16/16 pass**.
- `run_admission`: a real held SQLite writer barrier proves the fixture-free path avoids the writer instead of asserting total runtime below five seconds. **28/28 pass**; ticket closed. SEC10 already replaces security_wave19's wall budget with work bounds; affected target passes.

## Verification

The initial broad run completed CLI/core/device/difftest/lang/native, then exposed exponential compilation in two existing simulator alias-DAG controls. Its incomplete receipt and the earlier supplemental rerun are retained without relabeling. Five obsolete DX fixture failures had already been corrected and superseded by a complete CLI pass. Because `80411b9d8f` changes a shared language input, a real final canonical affected run was started on that clean commit against the original pre-merge main, rather than relying on the earlier content-reuse plan.

The final shared-source selection runs against base `799e42a6bb560c310ac8f3a3411d740b7380b372`: seven whole Rust packages, 446 client files (444 ordinary/timer files plus two model files), the Clique fixture, builds/typechecks and the remaining root/semantic steps. All seven Rust package commands pass (8,175 passing test observations, 117 ignored, including nested helper invocations). The canonical command reaches its requested 10,800-second outer limit while the timer group runs; its incomplete raw receipt remains incomplete. Its separately bounded client runner is supervised to completion. The remaining original plan commands run separately. This is composed target evidence, not a canonical PASS or an unchanged-HEAD claim.

The client pool exposes eleven stale-fixture files. `c6874cb0b7` preserves all semantic assertions and updates explicit detail flags, JSON calls, moved-reference discovery, scrolling doubles/browser expectations, installer progress and witnessed-tier ordering. Every repaired file passes. Two export-maintenance cases additionally fail after this integration rebuilt the native executable while their self-restarting workers were alive (`E_WITNESS_PROCESS` / ENOENT captured); both pass alone on the pinned executable. The full pinned file passes **70/70 executable cases, 34 platform skips**. All **446/446** selected client files now pass, with **8,064 passing cases, 56 skips and no failures**, plus the independent Clique fixture **9/9**. Original failing attempts remain recorded.

`8eabb1f777` merges main through `e0ad590a1b` with no runtime resolution, keeping both append-only journal entries. Incoming changes concern PostgreSQL co-dispatch/deadlines and generic queue notification/ownership transfer. The incoming full core command (`postgres,test-support`) passes **1,316 observations / 535 ignored**; targeted CLI binary, HTTP, run-admission and store-port commands pass **708 observations / 75 ignored** (counts include nested helpers). Focused final-native proof/server/HTTP clients pass **100/100**. Wasm stays byte-identical. The 117-source and 150-store repeat completes on immutable native `3e5b86eb9fdf84842c2fbf40ccb7019a64ec3ad02aef7e180801a1d4203fbffb`: every verdict, FIX, witness ID, line count and complete replay record matches the previous verified run.

The last fetch adds Stage P PostgreSQL-only runtime changes, test-support/snapshot changes and experiment records through `9ee365bbd6`, merged as `02cf700f71` without conflict. Direct integrated checks pass: PostgreSQL module **49**, batch fixture consumers **20**, change-evidence SQLite **2**, census **9**, installed guide **128**, release-change parser **1**. Private PostgreSQL cases stay explicitly ignored locally; the incoming lane reports its own full-core **1313/0**, binary **626/0**, Stage P **13/0** and private-server evidence. Reuse unchanged SQLite/authoring/client/differential semantics rather than repeating broad verification for this PostgreSQL-only delta. A zero-match initial fixture filter is retained in the raw log and is not counted; the corrected batch module executes all 20 nonignored cases. Inventories pass again for the incoming test file.

Fresh 2k ordinary differential after this merge: **2,000 generated/compiled, 120,026 executions, zero disagreements, unexpected binder refusals or generator errors**. Lean 2k: **1,658 pass, 324 unsupported, 18 known disagreements**. All 16 reproducer source/JSON files and complete oracle totals match Integration26 byte-for-byte; runtime worker logs are retained and excluded from the reproducer comparison.

Root generated artifacts, regenerated authoring/diagnostic/guide projections, inventories, guide, ref-check and docs budget pass. Ref-check reports 571 LLPs/12,726 references with zero errors. Root guide reports 22 groups, no skips or dependency preconditions. Inventories: 365 package tests, 35 script tests, 31 demos, 487 publication leaves. Root dependencies needed the documented locked/hoisted setup; installer-only executable-bit changes were restored. Generated files were regenerated, not hand merged.

## Copied-schema survey

800 schemas across waves 15,16,18–30, eight workers. Original schemas all match SEC10's baseline hashes. Source-reviewed classification: **0 assessed false gates, 0 assessed false production refusals, 0 unclassified**, three current approval gates and nineteen genuinely refused fresh projects. All twenty-one fresh FIX identities match classified baseline sites/operations/predicates. A final `80411b9d8f` binary follow-up covers all 100 wave29/30 projects and every prior refused project (117 total): unchanged verdicts and FIX identities, no blocker also shown as a question, all three approval witness IDs exactly match SEC10's baseline. Wave30 **008 and 028 pass** with zero gates and no renewed derived false FIX.

Default output across all 800, substituting final follow-up outputs: **check median 2 / p90 6 lines** (max 12), **fresh deploy median 5 / p90 9** (max 20). Median targets are met; p90 targets are missed. Exact calibrated-hole coverage is **1/14**, wave30 **033 F1**. Other questions do not count as covering unrelated calibrated holes.

Initial 800 cold-check latency median/p90 **8.255/25.033 s**, fresh production-mode deploy **6.332/26.433 s**. Final-source 100 wave29/30 cold-check latency **4.755/21.371 s**, deploy **8.519/25.264 s**. These use an optimized Cargo test-profile binary, eight workers and concurrent host work; they are not isolated production-build performance qualification. The final incoming-main 100-project timing sample is cold check **4.871/21.658 s** median/p90 and production-mode deploy **8.455/25.553 s**, with eight survey workers alongside eight replay workers and focused verification. All 117 disposition and line-count records remain identical. These measurements bind native `3e5b86...` before the later PostgreSQL-only merge; they are not a production-profile or exact-final-binary latency promise. There were no survey command watchdog exits. Raw commands/stdout/stderr/source bindings remain in the external evidence directory.

## Copied-store replay

REL2 harness on 150 private production-store copies from waves25/27/29, eight workers, five moves each. Original stores were never opened; ownership/token files are excluded. **724/750 moves succeed; 26 expected refusals; zero false refusals; zero hidden v1 rows.** There are 290 successful rollback populations and **290/290** preview/list/live shape consistency checks.

Wave25: 238 success/12 expected adoption refusals. Wave27: 236 success/14 expected refusals, including ten SEC10 genuine forward refusals (008,018,020,025,033, two cycles each). The final native repeated all 150 stores with identical wave summaries and concrete trace evidence for every one of these ten refusals. Wave29: 250/250 success; 040 restores exact original source and shape, while other extraction cases expose concrete missing-column/view shapes. The summarizer accepts only the exact reviewed security operations/codes and retains every row/shape assertion. Text-only preserved-shape compaction does not change transition outcomes or JSON. The subsequent incoming-main native repeats all 150 stores again: all records structurally equal, including all 750 phase exit/code pairs and all concrete security refutations.

## Wasm

Locked Linux (including the final Stage P/documentation rebuild, byte-identical): **2,416,590 B raw / 738,613 B GNU gzip / 555,952 B Brotli**, SHA-256 `d703ec2e9df43a17ad3e0ea7ff4bef21fb64bf08ed3b06cbeef324db1e409e64`. Budget **739,113 B = measurement + exactly 500 B**. Reason recorded in the budget/journal: whole-artifact visible-character minima, literal initialization and version-stamp change, **+1,022 raw/+483 gzip** from Integration26; no runtime ceiling change or independent feature-cost attribution.

## Delivery and deferrals

Final evidence and reproduction tools are under `snapback4/reports/integration27/`; all actual raw receipts and their nonzero/incomplete states are preserved. The canonical timeout and superseded fixture failures are not relabeled successful. The p90 UX target miss is filed as `issues/20261026-snapback4-witnessed-question-output-p90.md`; no witness, blocker, repair, assertion or allowance was removed to meet it.

Reclaimed **17,828,465,800 B across 517 completed test executables**, plus **346,310,128 B** of four obsolete native pins. Active-process checks skip any mapped executable; only paths enumerated in this integration logs under this worktree’s `target/debug/deps` are removed. Current native, wasm/client outputs and library caches remain; the `3e5b86...` measurement pin is retained. Delivery is the authorized nonforce `sb4-loop:main` push. The commit carrying this report records the final artifact evidence; remote HEAD and a clean worktree are verified at delivery.

The separate Mac C ABI ownership fixture flake remains open in `issues/20261017-snapback4-macos-c-abi-store-ownership-fixture-flake.md`; the final Linux case passes. Its root cause is not established and its ticket forbids hiding it with a retry. Actual Mac execution remains publication work.

No publication worktree or `target/publication/` content was touched. Deferred to publication: packed five-crate/client qualification, qualify-linux, Mac, Exact app builds and 20k/devices differential campaigns. The source selector's broad client/Rust coverage is reported above separately from installed-package qualification. Lean's known disagreements remain owned by LLP 3000.035 and are not described as a green oracle result.

The incoming opt-in private PostgreSQL report retains its differential `E_INPUT: 6` and evaluator lockfile scope. They are outside the default selected differential/publication targets; this integration does not claim to rerun that private-server campaign or turn its nonzero script result green.
