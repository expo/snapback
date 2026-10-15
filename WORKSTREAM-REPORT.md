# LANG — wave 12 final report

Worktree `/home/ccheever/projects/sb4-w12-lang`, branch `sb4-w12-lang`, from `c22dfefc9c` (qualified, unpublished 0.4.28). Target integration: 0.4.29. Committed locally; **not pushed**.

## Scope and decisions

Read the Snapback 4 fence, governing LLPs, current authoring guide cards, wave-12 prioritized list, verification ledger and cited evidence. Evidence apps were read only; the census checked disposable copies and compared all source hashes. Initial status and `git log sb4-loop..HEAD` were empty.

Implemented the endgame fixes rather than check-time limits: fixed-size aggregate identities, actual expiry reference actions, explicit rounded division, and bounded complete page forms with sound fallback notes. Duplicate identity declarations are refused. Reviewed documents retain their proposal status; reviewer READY does not claim author acceptance.

Other lanes own their wider surfaces: KIT owns proof-kit/starters/testing-kit text; RULES2 owns authorization recipes/composition/refusal-order guidance; SURF owns generated help/discovery/persona/client recipes; REL3 owns general release-spanning clients/rollback/test-runner/fixture doors and the Exact rebuild line; EX7 owns Exact2. LANG changes their seams only where required for its semantic compatibility and tests.

## Per-item implementation

| Item | Result and principal commits |
|---|---|
| P1 expiry | Atomic cascade, set-null and restrict on sweep, expired replacement and final retirement. Restrict retains the expired physical row while reads exclude it. Whole-closure preflight, bounded metering and fair in-memory sweep continuation. `20e7c22d11`, `49890d57a7`, `2a30c75480`, `f4f0bafe79`, `4aeb3184b0`, `d701b31c9a`; final compatibility follow-up: `ba8613aa76`, `cfd4e2f242`, `65560f6c4e` (private-column queue and nested device allowance). |
| P2 aggregate identity | Domain-separated 64-character SHA-256 identity shared by writes and adoption; predecessor logical key decoding, transactional derived rebuild and transitive active/dormant reference/index/cap rewriting. Schema generation and capability fences prevent incompatible devices from being trusted. Real 0.4.28 stores adopt, including regrouping and same-target reference chains. `20e7c22d11`, `d516faac8a`, `1648fd2c24`, `12fe4f47fd`, `2fcff60b23`, `54edc531f0`, `60c3cdecd5`, `526072491d`; final counter translation: `f3ba53b70f`, `5042e58965`, `726d2e94d6`, `f365e464f6`, `b3c66354ce`, `93d05d65b6`, `8e2ac7cacd` (canonical keys, complete predecessor admission, aggregate ownership, immutable surviving-row precedence and row-keyed replacement). |
| P3/P4 | Builtin values (`now`, `viewer`, `commit`, `new`) are reserved in parameter/local/loop positions with `E_QUARRY_RESERVED`; a second `use identity` is refused and names both method sets, including across files. `4433843552`. |
| #3 diagnostics | Aggregate parentheses and descending `last N` repairs; foreign-key cause before scan advice; failed declarations retain their table symbol; quote-aware bound-image rewrite; apply-every-rewrite/recheck golden; multi-line `require … else`; simplest structural-fanout predicate first. `4433843552`, `467d2b4a72`, `b7aaba2716`, `b8d2f5fcdc` (literal viewer-rewrite golden). |
| #3 language | Ungrouped scalar totals; exact-domain count and role narrowing with capture/reaching-state invalidation; email validation; enum search; checked decimal division with explicit scale/rounding. Hidden maintained misses stay null; global physical rows cannot escape through scans/pages/schema probes. `b081f96054`, `0fe7cc1263`, `108c2aeeab`, `dcd85ffa57`, `01053b94db`, `8ef64d411f`, `be5d4a4b47`. |
| #3 notes/guidance | Suppress fixture drift for every refusal expectation; explain caller-path readable probes; reviewed-disclosure maintained-delta annotation; expected derived-argument sweep refusal wording; multi-level keep/cascade guidance and direct restrict-section pointer. `467d2b4a72`, `b7aaba2716`. |
| #12 completeness | Bounded positive equality products (up to eight branches), two principal/status pins, fixed plus varying grant audiences and sound server vacancy probes. Actual index declaration and rewritten query in equality advice. Independently validate every static audience leaf; unsupported forms retain honest notes. `4dbf2ffc8e`, `c1e494491b`, `96035cf0b7`, `c6f616e7f1`, `d4e7e4fcf9`. |

## Semantic reviews

Fresh, mutually blind Muse Spark 1.3 high and fresh Codex gpt-6.1-sol high sessions reviewed each semantic scope. Verbatim outputs and exact briefs/provenance are under `llp/reviews/`; rejected/interrupted attempts are retained. Muse subscription quota failures used the supplied wrapper's authorized fallback. No key contents were inspected or logged.

| Scope | Final paired verdict | Governing documents / review commits |
|---|---|---|
| P1/P2 | R19: both READY | LLP 3000.039, 3000.007.003, 3000.036.003, 3000.000.000; `073acfc7ff` |
| P3/P4 and diagnostics | R8: both READY | LLP 3000.036.002; `c9a50c89f2` |
| Language | R7: both READY | LLP 3000.013.001; `e4630bd375` |
| PAGE5 | R8: both READY | LLP 3000.036.001; `e82f268289` |

## Verification

The complete six-package Cargo invocation ran all five requested crates plus the difftest crate: 393 top-level targets, 6,201 passes, 21 initial failures and 43 authored ignores. All 21 initial failures are closed by scoped passing follow-ups; the original red log remains preserved. Later full simulator coverage passed 706 tests (7 ignores), core unit coverage passed 349 (3 ignores), followed by the focused predecessor-counter lifecycle regressions and 25/25 complete adoption/retirement tests, and the broad device+difftest rerun passed 1,647 tests across 110 targets (4 ignores). Final device deltas passed 29/29 across four targets and the final full difftest suite passed 93/93. This is scoped qualification across the final semantic changes, not a claim that the original six-package command exited green. `full-six-reconciliation.{json,md}` accounts for each failure; no compilation or doctest infrastructure failure is hidden.

- Genuine baseline 0.4.28 migration: 4/4 PASS, including deleted-row sequence history continuing at ordinal 4; focused counter migrations also cover absent nested aggregate parents, removed targets, rollback, overflow, max collision, opaque IDs, full predecessor admission, ownership and same-name row-keyed replacement followed by restoration. Synthetic legacy regrouping and dormant-reference restoration are also covered. Removing the derived target ends that derived lifetime; restoring a reference cannot silently bind a later unrelated reintroduction.
- Lean: 56 build jobs, 73 standard-axiom audited theorems, 115 examples, seven oracle fixtures. The independent sweep model includes cursor state, selected physical expiry indexes, per-table deadline/ID order and repeated calls. Separate two-world witnesses show why private maintained-column predicates must queue, preserve local state and share one nested device allowance. These are abstract contracts, not claims that the row evaluator executes the full device protocol.
- Generated semantic cross-layer target: eight public + eight role families, 16 stale-negative + 16 fresh controls; 264 server +112 memory-device +112 SQLite-device outcomes, snapshots, stream updates and reopen. Rounded division and PAGE5 generated families are included in the difftest suite. Additional expiry generation covers 18 complete and nine incomplete reference-action families: 36 server comparisons, 72 exact device outcomes, 84 snapshot pages, 18 stream pages and 18 negative queue outcomes with zero local changes.
- Clients: all 27 requested files plus two reservation/profile files and a new real-wasm expiry bridge (30 total) are qualified by a scoped evidence union. Intermediate R13 sealed qualification covered 29/29 files and 460 passing assertions with 12 source-authored conditional published-RX skips; the initial in-chat setup failure was rerun in a fixture-complete sealed copy (4/4). The ordinary search oracle passed 300 process + 300 wasm seeds (8/8 assertions). Final R14 affected rerun qualified 23/23 files with 307 passes and 12 authored skips; seven permission-only setup errors in two files were preserved and corrected in a separately sealed source-mode copy (7/7). The budget helper passed 2/2, package build/typecheck passed, and the six heavier search files carry by a per-file semantic non-reach audit. The final 8e2ac7 package build/typecheck and budget 2/2 passed; the independent real CLI + SQLite + wasm expiry bridge reran on the exact 8e2ac7 bytes and passed 1/1 with eight semantic cases, including cascade/set-null/restrict and private maintained-column queue/settlement/catch-up parity. Every sealed snapshot was checked for post-run hash/mode drift.
- Native, device and Lean differential campaigns: 20,000 generated cases each. Native: 1,220,035 executions and zero signatures; device: 648,098 executions and zero new signatures. Lean: 56,917 executions, 16,697 matched cases, 3,173 explicitly unsupported cases and 130 disagreements in four inherited signatures (`E_RULE~NOT_FOUND` ordinary 3 / prelude 25; `next~no-next` ordinary 67 / continuation 35). All four were already in the unchanged Integration-9 baseline. Native/Lean results carry from the reviewed runtime by a scoped audit: subsequent changes affect device-only prediction, feature-gated PostgreSQL and persisted-store adoption, none reached by their fresh-store campaign. Device was rerun on final R14 prediction bytes; persistent counter migration has separate authentic legacy-store tests. The generic campaign is supplemented by generated expiry families and the real wasm bridge, not claimed to cover every new feature. No new allowed-baseline signatures were added. Unsupported fragments and inherited disagreements are reported, never converted to passes.
- Root Integration-11 setup: frozen dependencies, workspace hoist and generated artifacts done. Final `node scripts/check-inventories.mjs` PASS (`r19-inventories.json`: 365 package tests /35 scripts /31 demos /487 publication leaves); `node scripts/check-guide.mjs` PASS 22/22, no skips/preconditions, 121 inherited warnings.
- `node scripts/docs-budget.mjs` PASS: README 320/320 and self-containment test. Final `./ref-check --verbose`: 547 LLP documents, 11,889 references, zero errors and zero unchecked references.

Commands, source/binary/oracle hashes, compressed logs and intermediate failures are retained under `snapback4/reports/wave12-lang/`. Every Cargo invocation used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`; the full `scripts/test.sh` was not run. The final 349-test core run is preserved as a terminal result excerpt with session provenance in `p1-p2-status.json`; no raw full-run log is claimed for that run. No credentials were copied.

## Read-only 100-schema census

Baseline: **100 clean, 324 notes**. Final: **100 clean, 318 notes**. All source hashes match; **zero new refusals** and **no P3/P4 reservation exceptions**. Each code is reported below.

| Note code | Before | After |
|---|---:|---:|
| `N_CONDITIONAL_COMPLETE` | 10 | 7 |
| `N_DELETE_NEEDS_READ` | 3 | 3 |
| `N_DELETE_RESTRICTED` | 4 | 4 |
| `N_EPHEMERAL_SERVER` | 1 | 1 |
| `N_LOOKUP_HIDDEN` | 1 | 1 |
| `N_MAINTAINED_COLUMN_DISCLOSURE` | 1 | 1 |
| `N_MAINTAIN_AUTHORIZATION` | 7 | 7 |
| `N_MAINTAIN_DELTA` | 10 | 10 |
| `N_NEVER_COMPLETE` | 15 | 13 |
| `N_NO_CURSOR` | 160 | 160 |
| `N_NO_HORIZON` | 13 | 13 |
| `N_NO_PRODUCTION_WRITER` | 48 | 48 |
| `N_PATCH_CLEARS` | 3 | 3 |
| `N_REFERENCE_UNCHECKED` | 1 | 1 |
| `N_SHAPE_METER` | 1 | 1 |
| `N_SPARSE_FILTER` | 12 | 11 |
| `N_SYNC_EMPTY` | 1 | 1 |
| `N_SYNC_ORDER` | 17 | 17 |
| `N_UNREADABLE_PROBE` | 13 | 13 |
| `N_VACUOUS_RULE` | 2 | 2 |
| `N_WIDE_MERGE` | 1 | 1 |

`before.json`, `after.json` and `census-comparison.json` preserve every per-schema result and hash. The intermediate schema-074 diagnostic regression and schema-033 note regression were corrected before this final census.

## Wasm and explicit boundaries

Clean Linux measurement at `073acfc7ff` (final semantic code `8e2ac7cacd`) is **2,353,736 B raw / 716,765 B gzip / 541,361 B Brotli**. The checked budget is **717,265 B = gzip + exactly 500 B**. Whole-artifact gzip growth from qualified 0.4.28 is 9,091 B for shared expiry/digest/language/device semantics and compatibility fences; no per-feature attribution or runtime ceiling increase. Strict family and absence audits passed. Budget/census/artifact commit: `4c27eac1b5`. The exact final CLI and wasm bridge passed, and all 1,198 sealed input hashes and modes remained unchanged. `r19-artifact-and-client-qualification.json` preserves build/typecheck, three exact-byte client tests (eight semantic bridge cases and two budget tests), measurement and ref-check logs. Superseded measurements remain in the receipts.

All requested implementation items are complete. Completeness deliberately remains capped where the admitted form is not sound: schema 033 `commentsOf` combines a chapter-owner hop, author party and three varying grants; schema 087 `weeklyLoss` combines varying-floor membership and non-equality alternatives, so only its fixed manager branch can decide the complete page. Device vacancy/authority shapes remain server-only where local coverage cannot prove them.

The Lean row evaluator does not claim execution support for full maintained views or full-Unicode search; standalone examples and native/simulator/device coverage cover those semantic contracts. Duration-budget early stops, store/commit faults and through/ephemeral scheduling remain outside the sweep oracle's declared supported fragment. Sweep cursors are in-memory and reset on reopen; no durable-fairness claim is made. PostgreSQL feature compilation is checked; this report makes no live PostgreSQL-cluster, macOS artifact, publication or push claim.
