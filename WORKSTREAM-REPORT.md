# LANG2 — wave 13 / 0.4.30

Worktree: `sb4-w13-lang2`, based on `59fb4ead1b` (0.4.29). No version bump and no push to origin. Mac-only transport uses the explicitly authorized scratch clone `~/projects/snapback-ws-lang2`; publication clones were not used.

## Changes

- P10: total unique membership keys become filtered point lanes; extra equalities remain residual predicates. Generated intent reads report the originating source query.
- P17: action caps are required only for reachable delete roots (rules, programs/helpers, expiry and cascades). Dormant uncapped actions get `N_CASCADE_DORMANT`. External IR admission independently checks all delete footprints, including nested expression blocks and jobs. Cap guidance says product limit and prints the engine's joint heap formula.
- P18 (coordinator revision): `E_QUARRY_IMMUTABLE` refuses proven changes and fresh clock/id patterns; `N_IMMUTABLE_PATCH` explains uncertain supplied values and readable runtime equality. Same-author upserts remain accepted. Proven key/current-snapshot/local-insert equality stays quiet; unrelated opaque fields do not erase facts. Hidden immutable fields retain their established suppression. Source runtime fixtures for uncertain writes are restored. Lean now models immutable equality/hidden stripping; 48 generated cases exercise native/model/both-device outcomes.
- Diagnostics: schema-shaped sync horizon guidance, source-level structural fanout guidance, nullable Boolean operand locations, distinct statement-position code, stable job cursor guidance preserving mutable predicates, and `desc after` converted to `last … after`.
- Notes: whole finite caps/finite unique alternatives silence `N_NO_CURSOR`; reference argument guidance checks existence without a fabricated binding; structurally ordered complete child deletions silence restrict notes; hidden roster guidance is applied and checked in the golden; long quoted expansions abbreviate outside verbose output.
- Language: conjunctive `.x != null` narrows row snapshots in loops and shapes; asserted immutable parent fields plus live require facts prove private count access; writes invalidate those proofs, including parent delete/rebirth. `not before` infers its required boundary index.
- Completeness: indexed compound negative membership retains full private rule evaluation and residual equalities. Finite ordinary online-only table/group caps admit exhaustive private walks, including role-plus-parent and bounded children. All static bounded plans reserve physical allowances at operation entry; each occurrence has one prepaid execution, and all exhaustion checks use its isolated pool. New interpretations require `branch-pages-v5`.
- Copied scope dependencies: no unsafe equality inference from naming/application convention. Unsupported cases print the exact nearest supported query and preserve every caller, with truthful incomplete/cursor handling. An enforced dependency language is intentionally outside this change.
- Median/latest decision: no private median aggregate without an explicit disclosure/window/tie/rounding contract; authorized latest-row queries remain available. Decision recorded in LLP 3000.036.002 §10.
- RULES3 owns authorization recipes and refusal-layer prose; its pointer is in the 0.4.30 guide changes entry.

## Commits

- `1dc5d57700`: diagnostic rewrites, notes, help and compact presentation.
- `3f034013ee`: P10/P17/P18, finite and negative membership plans, source proofs, amendment and Lean/generator/simulator/device coverage.
- `9e320dfb01`: prepaid exhaustion isolation from prior private probes.
- `d16c025fa5`: immutable compound capture-time resolution and rewrite golden qualification.
- `2fa3518d59`: captured keys, historical vacancy compatibility and preserved adversarial runtime fixtures.
- `7b2051eec4`: stable parameter identity, legacy source refusals and metadata.
- `c35938ad1b`: bounded logical charging independent of hidden occupancy, and future-opening exclusion.
- `62204cc8eb`: covering authorization pins, conservative oversized-cap fallback, explicit Lean fragment boundaries and full runtime fixture coverage.
- `f553700d89`: lifetime-free raw witness proof/regression and precise probe contract.
- `e7d112950e`: measured wasm cost, explicit reason and exactly 500-byte headroom.
- `80b2f846b5`: structural cycle detection independent of missing transitive bounds, with Lean/difftest/native/device/simulator coverage.
- `b54f51aff2`: per-lane final census, journal and final measured allowance.
- `9b7389110f`: both final independent READY reviews.
- `1e8df98c46`: isolated fanout fixture and clean final wasm record.
- `09325115e5`: truthful cursor-note budget qualification and corrected fallback expectation.

Per-item tests: `wave13_lang2` covers P10/P17/P18, all three language additions, cursor/restrict notes, copied-scope and finite/negative/role-plus-parent cases. `wave9_rule_diagnostic_rewrites` applies and rechecks every new/changed rewrite. Core sequence disclosure and simulator write-authority retain the runtime hidden-target exception. The explicit LANG2 difftest factory checks native, Lean and both device stores; the device file also checks the new capability fence. Existing page3/page4, guides, maintained counts and historical snapshot suites guard the paved forms.

## Per-item verification

| Item | Main commits | Passing evidence |
|---|---|---|
| P10 unique membership and source locations | `1dc5d57700`, `3f034013ee`, `62204cc8eb` | Point-lane merge/cursor regression; existing page3/page4 and simulator membership suites; Mac planner/golden run |
| P17 declared deletion bounds and heap repair | `3f034013ee`, `80b2f846b5` | Dormant/activation/external-IR/cycle regressions; 32 reference-action cases; 36 generated cases across native, Lean and both device stores; Linux/Mac |
| P18 precise immutable diagnostics | `3f034013ee`, `d16c025fa5`, `2fa3518d59`, `7b2051eec4` | Captured/compound/branch/spread/snapshot tests; rewrite recheck; 35 preserved runtime write-authority tests on Linux/Mac; final 100-schema census |
| Schema-shaped diagnostic rewrites | `1dc5d57700`, `d16c025fa5`, `7b2051eec4` | All 11 rewrite-golden cases, including sync recipients, Boolean operands, statement position, fanout, cursor jobs and descending pages |
| Cursor/reference/restrict/hidden notes and long output | `1dc5d57700`, `3f034013ee`, `62204cc8eb` | Whole-cap/finite-alternative and ordered-delete regressions; applied reference/hidden suggestions; CLI compact/verbose checks |
| Non-null narrowing, private counts, not-before indexes | `3f034013ee`, `2fa3518d59`, `7b2051eec4` | Positive/negative row-snapshot, authority invalidation and inferred-index regressions; simulator and device execution |
| Negative membership, finite parent/child walks and role-plus-parent | `3f034013ee`, `9e320dfb01`, `2fa3518d59`, `c35938ad1b`, `62204cc8eb` | 36 native/Lean/device differential cases; fixed-budget paired worlds and core disclosure; Linux/Mac; v5 refusal before device execution |
| Copied dependencies and median/latest decision | `3f034013ee`, `62204cc8eb` | Exact caller-preserving unsupported rewrite compiles; explicit LLP decision preserves authorized latest-row reads and declines an undefined private median |

## Verification ledger

Full workspace testing ran to completion with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 SNAPBACK4_REQUIRE_LEAN=1 cargo test --workspace --no-fail-fast` (`/tmp/lang2-wave13/cargo-delivery.log`). It recorded **6,367 passed, 2 failed, 45 ignored** (existing measurements, exhaustive campaigns, subprocess workers and frozen-baseline fixtures). The two failures were earlier compiled fixture versions: `residency_notes::branch_merge_capped_group_accounts_for_every_participating_lane` and `write_authority::m3_a_non_predicting_pass_over_a_hidden_prefix_does_not_abort_when_a_query_would_not`. Both are corrected in the final source. The final combined rerun of both complete affected targets passed **79/79, 0 failed**, exit 0 (`/tmp/lang2-wave13/cargo-affected-closeout.log`: 44 residency-note tests and 35 write-authority tests). All other workspace targets passed, including all 94 differential tests.

The workspace invocation began before the last transitive P17 correction. Final affected tests after that graph-only correction passed 86 language/simulator/reference-action cases and all 36 generated native/Lean/device cases on Linux and Mac. Later cursor wording and fixture isolation retain the reviewed runtime semantics. Unchanged expensive targets were not rerun merely to bind every result to a newer HEAD.

- Generated native, memory-device, SQLite-device and Lean regressions: `/tmp/lang2-wave13/regressions-r8-final.log`, six targets, **174 passed, 0 failed, 4 ignored**. This includes historical device/Lean/smoke campaigns and the LANG2 factory. No new native/device/Lean signatures remain in that run. The historical seed stream remains unchanged; the new generator has its own explicit campaign.
- Language semantic regressions: **27 passed**, including admitted and oversized empty/hidden paired worlds, compound/captured/branch immutable keys, private-count delete/rebirth invalidation, repeated vacancy equalities and historical fence validation (`dormant-transitive-final.log`, 27 native + 27 simulator, plus 32 reference-action cases). This includes a thousand tied raw witnesses under a six-unit physical pool. The simulator uses the same source regressions.
- Core sequence disclosure: **29 passed** after correcting fixed uniform-prefix charging and nested logical prepayment (`privacy-final-r10.log`). The full run found an actual hidden-population rule-probe meter leak; this correction and its regression are part of LANG2.
- Mac: the dedicated scratch clone passed **572 tests, 0 failed** across the affected language, core sequence/update-image, device and simulator files (`mac-final-checks.log`). The final planner/meter/golden run passed **162 tests, 0 failed** (`mac-delivery.log`); the raw-witness extension passed all **52 native/simulator cases** (`mac-witness-final.log`). Final transitive P17 admission passed **86 native/simulator/reference-action cases** (`mac-dormant-final.log`), and all **36 generated native/Lean/memory/SQLite cases** passed on Mac (`mac-difftest-final.log`). The final write-authority file passed **35/35** (`mac-write-authority-final.log`), and the final cursor/golden rerun passed **55/55** (`mac-cursor-notes-final.log`).
- Lean: **73 theorems audited**, **116/116 examples**, **7 oracle fixtures** (`lean-delivery-final.log`). The source emitter/model/generator include finite exhaustion and compound negative membership; source-only proof/refusal changes retain runtime semantics and have binder plus simulator/device regressions.
- Client: final rebuilt wasm/client qualification passed **71/71 tests across four files** (`client-delivery.log`); the final P17 wasm rebuild also passed **17/17 capability/version tests** (`client-p17-final.log`); three additional capability files passed (19 passed, 4 intentional skips). Client TypeScript build and typecheck passed. A first attempt named a nonexistent protocol file; the corrected run uses `device-version.test.mjs` and is green.
- `./ref-check`: passed, 548 LLP docs, 11,319 refs, 0 errors (`ref-check-final.log`).
- Snapback 4 `node scripts/docs-budget.mjs`: passed, README **320/320** lines. The named self-containment test passed (`docs-budget-final-env.log`); guide compilation, all-code definition/recovery pins and the guide-word guard also passed in the affected tests.
- Repository root setup ran `bun install --frozen-lockfile` and `node scripts/ensure-workspace-hoist.mjs`. Both required root checks were run three times. `check-guide` reports **19 passed, 0 content failures, 3 preconditions**; `check-inventories` reports the same missing generated Snapback 1 demo artifacts (competitive-checkpoint generated operation schemas and todo-v2 Contract outputs). These files and their generation policy are outside the Snapback 4 fence; no Snapback 1 bootstrap or unrelated generated corpus was changed. Latest logs: `check-guide-delivery.log`, `inventories-delivery.log`.

Frozen lowering census: **11/11 passed** (`lowering-final.log`); still-admitted IR, admission and meters retain their frozen bytewise expectations, while newly static-refused programs retain exact refusal records. Final explicit LANG2 generator campaign: **36 cases, no native/device/Lean signatures**, including the dormant descendant shape (`dormant-difftest-final.log`). The global historical seed stream is unchanged. The old no-cursor expectation for a 5000-row private group was corrected: the reviewed 10002-unit draw correctly declines, preserves the older party plan and still needs a cursor. The fixture now reflects that boundary, and the final affected cursor-note/golden rerun passed **55/55** on Linux and Mac (`cursor-notes-final.log`, `mac-cursor-notes-final.log`). No planner behavior changed in that correction.

## Independent semantic reviews

The final amendment §10 SHA256 is `99482b766c80245c60bcd5f664607bd22e302512e5a2d9f28d3f88b708d3b611`. Both fresh independent reviewers returned **READY** for that exact revision:

- Muse: `llp/reviews/3000.036.002-lang2-r15-muse.md`.
- Codex: `llp/reviews/3000.036.002-lang2-r15-codex.md`.

Both responses are saved verbatim with model/command, date and revision provenance. Earlier rounds are retained. They drove capture-time identity, private physical/logical meter isolation, historical capability fencing, precise model boundaries and the dormant transitive graph correction. Final review covers the semantic contract; verification results are independently recorded here.

## Wasm qualification

Clean final source measurement at `b54f51aff2` (`wasm-final-clean.log`): **2,370,874 B raw / 722,776 B gzip / 545,033 B Brotli**. Budget: **723,276 B = measured gzip + 500 B**. Strict family and absent-feature audits passed. The **6,062 B gzip** increase from 0.4.29 carries branch-pages-v5, finite-cap admission, entry-time reservations, isolated physical pools, hidden-independent logical charging, uniform-prefix verdicts and external-IR delete admission. The reason and measurement are in `snapback4/metrics/wasm-budget.json` and `snapback4/metrics/wasm.jsonl`.

## Decisions and scope boundaries

- Copied parent/child fields do not establish a storage invariant. Their unsupported notes print the exact supported query preserving all callers, rather than silently narrowing to the viewer. No unenforced dependency inference was added.
- Median is intentionally absent: it needs an explicit private-disclosure policy and a window/tie/rounding contract. Authorized latest-row reads remain available; this is the recorded LLP decision.
- A bounded static merge occurrence has one prepaid execution. Repeated dynamic evaluation stays incomplete. Nullable set-null groups remain outside the new exhaustion admission, preserving the existing supported party-lane planner instead.
- No version bump, publication, origin push, other worktree changes, publication-clone access, credential copying or evidence-lane edits occurred. Mac branch transport only targeted the user-authorized scratch clone.

## Wave-13 final schema census

Per-lane machine record: `snapback4/reports/20261016-lang2/schema-census.json`.

The before and after census was rerun on all 100 private copies. Baseline 0.4.29: **100/100 pass**. Revised P18: **100/100 pass, zero refusals**. No previously passing schema gains any refusal. The former 23 blanket refusals across 17 lanes are superseded; uncertain patches now produce **28 N_IMMUTABLE_PATCH notes across those same 17 lanes** (some statements contain multiple immutable fields).

Remaining refusal lanes: **none**. Lane052's final `reactions` schema declares `immutable link, comment, author`; `at` is mutable. Its former refusal was `reactions.link`, now an uncertainty note. Its `at: now` is valid. A separate declared-immutable timestamp regression refuses the fresh clock pattern; no evidence schema was edited.

| Note code | Before, all 100 | After, all 100 |
|---|---:|---:|
| N_CONDITIONAL_COMPLETE | 11 | 8 |
| N_DELETE_NEEDS_READ | 1 | 1 |
| N_DELETE_RESTRICTED | 1 | 1 |
| N_EPHEMERAL_SERVER | 2 | 2 |
| N_FIXTURE_ARGUMENT_DRIFT | 21 | 21 |
| N_IMMUTABLE_PATCH | 0 | 28 |
| N_LOOKUP_HIDDEN | 5 | 5 |
| N_MAINTAIN_AUTHORIZATION | 2 | 2 |
| N_MAINTAIN_DELTA | 7 | 7 |
| N_NEVER_COMPLETE | 19 | 15 |
| N_NO_CURSOR | 144 | 139 |
| N_NO_HORIZON | 12 | 12 |
| N_NO_PRODUCTION_WRITER | 50 | 50 |
| N_PATCH_CLEARS | 2 | 2 |
| N_SPARSE_FILTER | 16 | 17 |
| N_SYNC_ORDER | 5 | 5 |
| N_UNREADABLE_PROBE | 13 | 13 |
| N_VACUOUS_RULE | 1 | 1 |
| N_WIDE_MERGE | 3 | 2 |

Every refusal code has count zero before and after. JSON retains per-lane notes, sites, rewrites and raw-census hashes. Evidence copies' schema sources match the read-only originals.

## Deferrals

Repository-root inventory/guide qualification needs the missing Snapback 1 competitive-checkpoint and todo-v2 generated artifacts. Materializing those inherited prerequisites is outside the Snapback 4 fence and this lane. Copied-scope inference and private median remain the explicit supported-fragment decisions documented above; their nearest supported queries/alternatives are provided. No LANG2 implementation or affected-test failure remains open.

## P18 coordinator revision closeout (2026-10-16)

- `2ceeeb958b`: precise refusal/note/quiet split; per-field exact insert proofs; capture and constant analysis; hidden-target preservation; model, generator, simulator, device and rewrite tests; guide writes/why and 0.4.30 changes.
- `b6589becdc`: keep the updated guide within its 12,810-word cap.
- Literal inference is deliberately limited to a pinned key or an exact successful local insert. Other source writers cannot constrain historical/seeded/adopted rows; those cases get the note. Prior writes conservatively make clocks uncertain across nested branches, loops and helper expansion.
- Fresh reviews and final qualification results are recorded below when complete; the older review digest above qualifies the pre-coordinator revision only.
