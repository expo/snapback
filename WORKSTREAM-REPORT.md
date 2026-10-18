# DAY5 — wave 15, target 0.4.32

Worktree `/home/ccheever/projects/sb4-w15-day5`, branch `sb4-w15-day5`, base
`ccb9f752d1`. Initial `git status` was clean and `git log sb4-loop..HEAD` empty.
Final reviewed product/design revision: `0a07ef3e2e0f90053f52c15e2eb0d15599a879f0`.
All commits use Charlie Cheever <ccheever@firewoodagent.com>. No push, version
bump or publication. Both final reviews and all requested Snapback 4 checks passed. No DAY5 item is
deferred. Root checks retain only the inherited generated-artifact preconditions
listed below.

## Per-item delivery

| Item | Change and concrete checks | Commits |
|---|---|---|
| **R2, first** | Exact shipped native-helper digests distinguish age from starter sign-in mode. Every recognized older helper says “an older starter version (adapt can refresh it)”; custom edits remain owned. Historical guest/password variants and a census fail on unregistered template changes. | `1c21edacfe`, hardening `8ce6a7a02a`, `f3c70a2d5e`, `0a07ef3e2e` |
| **R7, second** | Missing/empty version directories and flat sources are “not saved yet”; readable malformed/differing evidence retains drift/refusal. Classification uses typed I/O kind. Empty current/saved source cannot reserve a snapshot. Tests cover empty/missing source and real drift. | `aefe994ab8`, `8ce6a7a02a`, `f3c70a2d5e` |
| **C4** | Preview names every applied/deleted path, package serialization/script ordering, dependency/script edits and starter.day2 marker. Web/Expo snapshot tests assert preview covers apply and preview itself writes nothing. | `b92940c089` |
| **C8** | Preview and check compare flat v1/v2 evidence to all captured `.q` modules, including main.q and multi-module snapshots. Advice names differing files; neither evidence form is overwritten. Single matching module is quiet. | `b92940c089`, `b4c5d78c06` |
| **P14** | Exact digest advice names inherited 0.4.30 assert.fail placeholders and todo snapshots. Custom scripts spawning npx and accepting readiness status receive explicitly heuristic advice with their SHA. No custom ownership inferred. Census and positive/negative advice tests cover it. | `b92940c089`, `8ce6a7a02a` |
| **P15** | Zero executed business cases fail even if query probes answer, including residency's early path. `--fixture-only` explicitly requests measurements/fixture validation; `testSource({fixtureOnly:true})` forwards it. Existing measurement callers and guide commands use the flag. | `329a562ba5`, `8ce6a7a02a`, `47c92b599b` |
| **deploy --save-version** | Captures selected modules, selected-source contemporary fixtures and release.json (actual immutable release id, source hash, CLI version). No-op deploy records its actual id. New positive versions/vN only; no overwrite, --check combination, empty source or deployment custody; failed capture cleans its reservation. CLI tests cover no-op, failed deploy, saved-source fixtures and custody. | `329a562ba5`, `8ce6a7a02a`, `f3c70a2d5e` |
| **Schema-adapted starters** | Custom Home has no inherited todo frontend proof/npm command. Adapt removes only recognized todo proof, fixture and README leftovers; custom files stay owned. Web/Expo init-first and schema-first controls pass. The qualifier carries its captured generated proof explicitly into clean Docker/proot userspaces; relocation and actual component typechecks cover that path. | `b92940c089`, `2c15feefd8`, `b4c5d78c06` |
| **upgrade --quiet** | Suppresses successful install/history/check chatter, retains project/Exact actions and both failure streams. JSON keeps one machine-readable stdout result and sends malformed stdout-only check errors to stderr. Tests exercise install and post-check failures. | `329a562ba5`, `8ce6a7a02a`, `f3c70a2d5e`, `47c92b599b` |
| **#9, trailing guard** | A pure trailing new-column guard is a proved tightening only after an identical prefix/refusal/argument contract and unchanged prior dependencies. Reverse rollback leads with the lost guard and refusal code; changed earlier codes remain warnings. CLI and narration unit controls cover it. | `2c15feefd8` |
| **#9, narration** | Group by generated subject, retain all guards, quota clauses, confidentiality and column changes; only structural index paths move behind verbose/JSON. A table literally named indexes retains its column changes. Lost-guard groups sort first. | `2c15feefd8`, `47c92b599b` |
| **#9, unique restoration** | Refusal names restoring dormant and active rows for each actual duplicate key, bounded by groups and ids. Distinct-key groups never claim a false pair; tests also prove transactional state stays unchanged. | `2c15feefd8` |
| **#9, app checklist** | `rollback --check --bridge DIR` writes complete current Quarry source and this app's ROLLBACK-CHECKLIST.md; it never activates/migrates. Checklist carries actual hazards and required refusal/list/count proofs. Existing destinations and canonical deployment descendants/symlink aliases are refused. | `2c15feefd8` |

User-visible changes have a **0.4.32** guide-changes entry; the package version
stays **0.4.31** for integration. Governing amendments: LLP 3000.000.000 §15,
LLP 3000.011.003.000 §15, LLP 3000.011.003.000.000 §§13–14. This changes narration,
proof custody and explicit CLI evidence, not runtime admission/authorization.

## Reviews

Five fresh Muse/Codex rounds are retained verbatim under
`llp/reviews/3000.000.000-day5-r{1,2,3,4,5}.{muse,codex}.md`, with provenance JSON.
Both **round 5 reviewers returned READY on `0a07ef3e2e`** for the final R2 starter
amendment and implementation. The other two semantic amendments and unchanged
implementation retain matching-content round 4 READY reviews from both families.
Source stayed frozen throughout each final review pair. Muse's subscription quota
failed first, then its existing wrapper successfully used the authorized API
fallback; no key was inspected or printed.

Earlier NOT READY findings were fixed with regressions: bridge custody,
truncated quota/confidentiality facts, false cross-key restoration pairing,
quiet failure output, residency zero-case bypass, unconnected packed proof,
structural index filtering, malformed JSON-check stdout, relocated qualifier
checkout dependency, and non-schema/multi-module legacy evidence. The final
original-requirement audit caught remaining cross-mode wording in lanes 028/058;
`0a07ef3e2e` makes age recognition take precedence and tests all historical identity
pairs. Round 1's moving-tree limitation is recorded; its verdict is not used as
final readiness.

## Verification ledger

- Setup passed: Snapback 4 frozen Bun install, CLI build, wasm build, client
  build; root frozen Bun install plus ensure-workspace-hoist.
- Wasm remains **2,372,829 B raw / 723,275 B gzip**, within **723,775 B**.
- Complete five-crate commands were run separately (never scripts/test.sh).
  CLI full run plus corrected affected targets: **54 targets / 1,311 passed**.
  Core full run: **44 targets / 761 passed**. Language full --no-fail-fast run
  plus the corrected full guide target: **160 targets / 2,106 passed**.
  Simulator full run: **45 targets / 749 passed**. Device full retry:
  **102 targets / 1,562 passed**.
  Counts include Rust doctests; expected ignored child/depth witnesses stay
  explicitly ignored. These are combined scoped results, not an exact-HEAD
  complete publication battery. Raw failures and corrective reruns are retained.
- The initial device generated paired-world test hit SQLite DiskFull / ENOSPC;
  its eight differences all carried those infrastructure errors. The full device
  --no-fail-fast retry passed after space became available.
- Affected clients: **162/162 passed** before final hardening; final revised
  proof/typecheck/Linux/Darwin consumer fixtures: **81/81 passed**. New DAY5 CLI
  integrations: **17/17 passed**, plus final init units **8/8**. Complete guide
  target: **125/125 passed**.
- Packed smoke passed with the prepared actual client and a locally packed debug
  CLI: extracted three-command deploy/rollback/bridge fence, snapshots and case
  guards, Web/Expo Home custody, every changed inline guide measurement recipe
  and the generated chat README command. This smoke is distinct from the final
  production-musl Linux consumer qualification, which also passed.
- Mac Studio only, own `~/sb4-ws-day5`: clean linked checkout, final revision
  `0a07ef3e2e`. Setup and the broad affected Rust/core/client run passed at
  `809ca03ab8`; r3 clock/replay/refusal/preview and clients passed; r4 all 16 DAY5
  Rust tests and all 81 revised client tests passed. Final r5 native identity
  matrix and six starter CLI tests also passed. No black M5, GUI, simulator or
  other worktree was used. Logs/results are retained in the Mac evidence archive.
- Final `./ref-check` passed: **551 LLP docs / 11,393 refs / zero errors**.
  Final docs budget passed: README **317/320** and its named self-containment
  test. The deploy card stays **150/150** with required paragraph/headings.
- Root inventory and guide commands ran after dependencies/hoisting. Inventory
  fails on inherited missing Snapback 1 generated leaves: competitive-checkpoint
  startReply.args.schema.json and todo-v2 Contract setCompleted.mutation.ts /
  runtime-links.ts. Root guide: **19 passed, 0 content failures, 3 preconditions**
  for those same ignored artifacts. They are outside the Snapback 4 fence.
- Fresh final preparation is source-bound to `0a07ef3e2e`. Client SRI:
  `sha512-8MlhxjouBsTBF4YgDCvuCHFuT08CmdfGvKeaPPqE6PMRTOshllDIMvGOVzMZ2BkUoKQZ2+KR+AYwtCJf8Fln6Q==`.
  Final `qualify-linux --consumer-only` passed on `0a07ef3e2e`: static ELF,
  loaded-host generated frontend proofs (12 attempts), all six starter toolchains
  and their adapted/negative controls, guide/client/rule/production recipes, and
  clean Ubuntu 24.04 plus Alpine userspaces. The survey and qualified platform
  archives are byte-identical. `--consumer-only` deliberately skips the
  prohibited full scripts/test.sh and cannot issue a publication receipt.
  Superseded r3 qualification was stopped after real review findings; its
  unfinished build/proofs are never represented as a pass. A preparation attempt
  caught concurrent tests' temporary checkout files and correctly refused; final
  preparation runs clean. No gate was bypassed.

## Fifty-lane before/after survey

Before and final after: `check`, `init --adapt` preview and actual
`upgrade --to 0.4.31` passed on copies of **all 50 even-numbered wave-15 lanes**:
**150 commands per phase**, all exit 0. Originals stayed read-only. Initial public
registry 404 results are retained separately. Baseline upgrades used a private
loopback registry serving existing 0.4.31 archives read-only and proxying ordinary
dependencies. Final upgrades used the prepared final client and a pack of its
production binary; its archive equality with qualification is checked separately.
Only scratch lockfile registry URLs changed.

The final ledger lists **143 appeared lines and 50 disappeared lines** across
**51 changed command results** (31 adapt, 10 check, 10 upgrade). All other command
results have an explicit “No advice line changed.” entry. Every changed line has
a reason. The observed changes are R2 age/mode wording and C4 complete metadata
previews; R7, C8 and P14 cases absent from these final lane copies are covered by
the focused regressions. Lanes 028 and 058 now report the old helper's age plus
its sign-in update. **Zero** forbidden native “previous schema's sign-in” strings
remain in all 150 final command outputs. Full normalized deltas and raw before /
after outputs are retained under `snapback4/reports/wave15-day5/`.

Evidence entry points: [validation summary](snapback4/reports/wave15-day5/validation.json),
[every advice delta](snapback4/reports/wave15-day5/advice-delta.md),
[Rust target ledger](snapback4/reports/wave15-day5/test-target-ledger.json),
[Linux consumer record](snapback4/reports/wave15-day5/linux-consumer.json),
[artifact binding](snapback4/reports/wave15-day5/artifact-binding.json), and
[Mac results](snapback4/reports/wave15-day5/mac-results.json). Raw compressed logs
and the verbatim review briefs are alongside them. Evidence commits after
`0a07ef3e2e` change reporting only; reviewed product/design content is unchanged.

## Decisions, boundaries and handoff

- A bridge starts with the complete current release, keeping its gates. The
  operator edits and proves the checklist; no automatic business migration or
  fabricated old-source safety claim is made.
- Existing flat/directory snapshots remain evidence. Save-version captures only
  the chosen source's contemporary files; it does not substitute working files.
- KIT4 owns proof-kit API/day-two recipe and clock/runner changes. PROD2 owns
  production adaptation/release-aware UI. SURF5 owns discovery. LANG4 owns the
  remaining compiler-note measurement hints that need --fixture-only; DAY5
  updated the authoring guide and starter README. These are ownership pointers,
  not deferred DAY5 implementations.
- Root Snapback 1 generated prerequisites are recorded, without expanding this
  fenced lane into retired subsystems. Integration owns 0.4.32 versioning and
  final cross-lane publication qualification.
- Shell work was bounded with timeout. Explicit Cargo and final indirect checks
  disabled incremental and dev/test debug. Earlier docs-budget attempts inherited
  Cargo defaults; the final check corrects that and passed with the required
  environment.
  Only obsolete duplicate binaries and completed superseded qualification
  dependency trees from this worktree were removed to recover disk; no other worktree, shared registry storage or machine work was touched.
