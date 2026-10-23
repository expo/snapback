# Integration 23 — snapback4 0.4.39

0.4.39 qualification complete; final nonforce landing is recorded in git.
Worktree: `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.

## Changes and commits

- Qualified 0.4.38 landed first, through `2281138019`, after merges
  `7b051e5f3f` and `c3f23ff2c2`; pushed `sb4-loop:main` without force.
  Step-0 evidence records 452 five-crate scopes, 7,348 reported passes and 266
  declared ignores, zero failures; incoming affected Core 653, CLI 520 passes/
  nine ignores after the known stopping-admission flake passed alone, Postgres
  364 plus public S1, clients 78/78 and root checks. These are their recorded
  scopes, not a claim of a full rerun after each later Step-0 merge.
- ROLL `cd20d7ebc9` merged as `2fa38c3b21`. Subsequent main merges include
  `4df0fc0ce1`, `bacbbb29cd`, `121107c574`, `152ba573c8`, `15676078d3`,
  `7cb3b67759`, `4aa3dea152`, `056ba3b478`, `fb93ed7753` and `e1f424691a`.
  Both journal histories survive; lane-local report conflicts retain ours.
- Standalone bump `8550d12b65`, `snapback4 0.4.39: visible rollback views and
  readable deploys`, follows the ten-file 0.4.38 bump exactly. One coherent
  guide-changes entry describes existing-app/store upgrades. LLP 3000.037 §20
  and the retained-storage RFC §20 record visibility behavior.
- The wave-25 regression is corrected: registration follows actual widening,
  hiding and misrepresentation facts. Executable-only repairs are protected
  behind unchanged data and intent. Independent invariants alone never require
  every ordinary v2 change to preserve the complete predecessor source.
  Truthful complete-current or current-guarded bridges retain v2 guards,
  authority, defaults, lifetimes and independent intent. Unsupported truthful
  representations refuse with an actionable authored-workflow step.
- Initial blocker correction `33ab430e29` and its reviewed follow-ups retain
  current guarded workflows and declared wire/table/field identities.
  `1daadaf4aa` handles unchanged-program legacy layout reopening;
  `4532c039c8` avoids an irrelevant asset-free child probe. `fe77ed9d02`
  corrects the guide fixture to exercise a real domain widening, and
  `4d61619f1d` records actual upgrade outcomes in LLP 3000.037 §20.8.
- Pre-0.4.39 stores either roll back visibly or name both `rollback --to N
  --exact` and “redeploy with 0.4.39 to register a view”. Small fixtures cover
  rename, split, required addition, images/references, aliases and current guards.
- Late-main PG/SQLite qualification exposed missing current named-index
  transport. Corrections `c45653db27`, `a036153251`, `e6716e0b0c`,
  `024f978514`, `177b225b88`, `c7c0c7afb8`, `f10a13ee5a`, `ff6e8303e2`
  and `f6922d049f` share injective declared identities and complete compiled
  key/policy comparison between registration, compiler preparation and CLI
  admission. Plain key tokens alone may change spelling. Opaque components,
  operands, provenance, Boolean structure and audiences stay exact. Every named
  dependency remains; only unused identical plain unique duplicates are pruned.
  A changed calendar input now registers before rows exist. Final focused
  regressions pass 65 language, 38 security and 19 CLI cases.
- Actual blind Muse and fresh Codex reviews, briefs, complete outputs and
  provenance are under `llp/reviews/3000.000.000-integ23-wave25-*` and
  `llp/reviews/3000.000.000-integ23-index-transport-*`. Findings were fixed;
  final correction dispositions bind the reviewed content, not an unrelated HEAD.
- Incoming concrete-store access is moved below its port (`402c955e72`,
  `cc1c2b2e6a`), preserving policy. The await census reconciliation
  `c4a6195c4b` preserves semantic fault scenarios after RT3b moves/retry.
  The codec census fix `f07884e368` has a real mutation control. No production
  census allowance, test assertion, deadline or seed was weakened.

## Final qualification

Source `a34a9192bcd241bb98e45c3f222e0f30074e97f9`; native SHA-256 `364370f89c269d7614ed06d0e0f58aa14fe38c36066f12999b5fa6e71e1857b1`;
client pack SHA-256 `1a082e7ba810831999c2401f63ec1d780fbe8fb9999cdd7cfb22b1b9fd77a103`. Actual command ledgers,
logs, source/artifact bindings and harnesses are in
[snapback4/reports/integration23/qualification-0.4.39](snapback4/reports/integration23/qualification-0.4.39/README.md).
The earlier fully green f078 snapshot is separately and explicitly historical.
Interrupted/superseded attempts are never counted as completed passes.

- Full Linux five-crate `cargo test ... --no-fail-fast` after the final shipping
  fix: 454 reported scopes,
  7562 reported passes,
  360 declared ignores, zero failures.
  These include nested reports and are not a deduplicated test count.
- Difftest engine 20,000 and devices seeds 0–999 pass. Lean 20,000 has no new
  signatures versus qualified 0.4.38 `7b051e5f3f`: its known raw exit 1 is
  baseline-proven, all oracle/coverage fields match except three timing fields,
  and all 38 representative Quarry inputs match byte-for-byte. Of the 76
  representative files, 52 are byte-identical; 24 query JSONs differ only by
  S10e-2a's added `pending_opening: null` diagnostic. Strict comparison verifies
  every other field, data, meter and canonical continuation; nonnull or other
  differences would fail. The original stricter byte check stopped on that
  intentional format addition; the evidence-format verification passes.
- Full client pool, one pass: 431 files, 7940 passes,
  56 declared skips, zero failures; `git status --porcelain` is empty
  after the pool. The two model files run serially after the ordinary pool.
- A fresh `publish.mjs --prepare-client` pack passes all consumer qualification,
  including new ROLL/security cases, Linux packaged checks and Ubuntu/Alpine.
  Mode is `--consumer-only`; receipt deliberately says publicationQualified=false.
  Separately requested source suites run in full. No npm publication is claimed.
- Stock private-Postgres qualification passes, including the public configured
  PG/SQLite evolution and restore witness and strengthened comparison controls.
  Its three inherited ticketed exclusions remain explicit in test-postgres.sh:
  prefetch_complete_fixture_queries_mutations_and_hidden_rows,
  unified_add_spare_capacity_meter_overlap_regression and
  evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head.
  Original two-writer stress still runs. Owned clusters are independently stopped.
- Docs budget, ref-check, root inventories and guide all pass after frozen root
  installation/hoist/generated bootstrap. Generated authoring census has 875
  rows; SDK delivery census has 215 sites. Store-port production allowance is zero.
- Production-artifact replay of all 15 originally refused wave-25 lanes plus
  six ROLL controls: before 15 refusals/10 false; after 2 genuine refusals
  (004/024), zero false refusals, zero hidden v1 rows in all six ROLL lanes.
  Legacy rollbacks pass or name both recovery steps. Lane 030 deploys, but
  default rollback truthfully refuses two unprojectable retained rows: its
  artifact lacks the required preimage/down. It names the bridge/down and
  exact/redeploy steps rather than hiding them. This genuine artifact case is
  not claimed as a successful rollback. All replay stores are deleted.
- Published 0.4.37 release histories: all 50 upgrade/default rollback/forward
  cycles preserve rows. This means 48 unchanged copies and two disclosed
  authored copy-only compatibility steps (010/032), not 50 automatic migrations.
- Schema survey: 450 projects (wave15's 100 plus seven 50-project waves
  16/18–23), 900 original/intent-stripped records and 1,800 human/JSON calls:
  zero false refusals. SEC7 gates 15 unique projects (30 variant records);
  all 36 original retained-role-grant findings are individually acknowledged
  on disposable copies, with zero unresolved findings.
- All 50 wave-23 original acceptance scripts pass with unchanged script bytes.
  Three disclosed copy-only expiry support helpers (007/026/029) reproduce a
  0.4.38 baseline assumption; a headless tsconfig drops the unavailable Expo base.
- Black M5 Mac, scratch `/Users/ccheever/projects/snapback-integ23` only:
  affected Cargo targets, actual Lean-backed difftest, 103 platform/affected
  client files plus two serial model files pass (2,357 passes/14 declared skips).
  Source binding records all
  semantic inputs; census regeneration keeps production allowance zero. A single
  appended clean wasm measurement is separately byte-verified as nonsemantic
  metrology, with its full provenance retained. Logs disclose
  actual platform skips. No Mac-unreachable deferral is used.
- Exact: clean Exact2 origin/main `14c091f205f62c32ed9d585ae75148cffc12dfa2`
  (EX10 contract migrate), private Snapback binary/client bindings only, fresh
  synced and online apps under `~/sb4-loop/prewave23/`. Both literal
  `bun exact.mjs snapback` and `bun exact.mjs test web` pass; synced has two
  tests, online one. Exact commands, setup patch and owned-server cleanup are saved.

Final root inventory initially could not load TypeScript/ajv. Repeating the
frozen root install, workspace hoist and named generated-artifact bootstrap
restored them; final inventory, guide (22/0/0) and reference checks pass. No
tracked shipping source changed, and all 312 SDK leaves still match the pack.
The raw precondition failure and repair receipts are preserved.

## Wasm and delivery

Clean measured wasm: 2,407,070 B raw / 735,469 B gzip / 553,849 B Brotli.
Budget 735,969 B = measured gzip + exactly 500 B. The reason records whole merged
core/error layout and version stamping (+581 B gzip versus qualified 0.4.38),
not a per-feature cost attribution or a runtime authority increase. Strict
family/absence audits pass. A diagnostic missing-Brotli attempt is superseded
by the complete measurement, not treated as a zero-byte result.

Every shell command has a timeout. Cargo invocations inherit incremental=0,
dev/test debug=0; Linux uses 12 build jobs/eight test threads (PG four), Mac four.
Source/SDK dist stays stable during the final full Rust and client runs.
No publication worktree, target/publication, original production store or other
existing worktree is modified. The forbidden full scripts/test.sh and npm
publication are not run. No other required scope is silently skipped.
