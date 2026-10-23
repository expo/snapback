# Integration 23 — complete 0.4.39 qualification snapshot

Final qualification source: `a34a9192bcd241bb98e45c3f222e0f30074e97f9`.
Last shipping correction: `f6922d049f07c8b9c92a1ed7802aa7e109d86202`.
Standalone release bump: `8550d12b65`.

`artifact-bindings.json` binds the actual prepared SDK and qualified production
musl binary to the store, acceptance and Exact checks. `manifest.json` lists every
compressed raw evidence file and its SHA-256. `.gz` files contain verbatim bytes;
Mac's tar archive includes command statuses, raw logs and source manifests.
Harnesses and actual command ledgers are included. Final report is the repository
root WORKSTREAM-REPORT.md. This directory is written only after the guarded final
statuses pass, including the empty source status after the full client pool.

This is distinct from `../qualification-f078`, the accurately labeled earlier
fully green snapshot. Interrupted or superseded runs are never relabeled green.
One final production harness first stopped because a derivative helper filename
was absent; its exact-byte repair and actual remaining-command resume are saved.
The wave-25 production replay itself had already completed successfully.

## Scope and limitations

- Full five-crate Linux test command after the last shipping fix, full client
  pool in one pass, fresh prepared pack and every consumer qualification case,
  private Postgres script, docs/ref/inventories/guide checks all pass.
- Difftest run 20k and run-devices 0–999 pass. run-lean 20k retains the known
  baseline raw exit 1: all oracle/coverage report fields except three timing
  fields match the fresh qualified 0.4.38 base `7b051e5f3f`. All 38 representative
  Quarry files match byte-for-byte. Of 76 representative files, 52 are byte-identical;
  24 query JSONs add only `finding.left.value.pending_opening: null`, the stronger
  host diagnostic introduced by S10e-2a (`d20fbe09b2`, merged `e1f424691a`).
  Every other field/data/meter/canonical continuation is identical. A nonnull
  dependency or any other change would fail. No new signatures. The earlier snapshot
  preserves the actual base counterexamples archive; final comparison names
  every file and both hashes. Raw exit 1 is disclosed, not converted to a raw pass.
  The original strict raw-byte verifier stopped on the intentional new null field;
  its unchanged harness and the strict evidence-format verification/receipt are
  preserved. All actual campaign exits and the full test exit remain unchanged.
- Packed qualification is `--consumer-only` with publicationQualified=false;
  the separately requested source suites execute in full. No npm publication
  and no forbidden full scripts/test.sh are claimed.
- The stock Postgres script has three explicit inherited ticketed exclusions:
  prefetch_complete_fixture_queries_mutations_and_hidden_rows,
  unified_add_spare_capacity_meter_overlap_regression, and
  evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head.
  The original two-writer stress remains active. Independent pg_ctl/no-PID
  receipts show all owned clusters stopped.
- Wave25: 21 production-store copies (the 15 original refusals plus six ROLL
  controls), 2 genuine remaining deploy refusals (004/024), zero false refusals and
  zero hidden v1 rows in all six ROLL controls. Pre-view rollback either works
  or names both --exact and redeploying with 0.4.39 to register a view. Replay
  stores are deleted; original stores and repro copies remain read-only. Lane
  030 deploys but default rollback genuinely refuses two rows lacking a truthful
  retained preimage/down; its actionable refusal is preserved, not claimed as
  successful rollback or relabeled as a false refusal.
- Published 0.4.37 stores: 50 upgrade/default rollback/forward cycles, comprising
  48 unchanged copies and two disclosed authored compatibility cases (010/032).
  This is not a claim of 50 automatic migrations without business declarations.
- Survey: 450 projects, 900 original/intent-stripped records, 1,800 human/JSON
  calls. Zero false refusals. SEC7 gates 15 unique projects; all 36 original
  retained-role-grant notes are individually acknowledged on disposable copies.
- All 50 original wave23 acceptance script bytes pass unchanged. Three copy-only
  expiry helpers (007/026/029) address baseline-proven 0.4.38 implicit-expiry
  assumptions; the complete support patches are included. Headless tsconfig
  removes the unavailable Expo base. No assertion or script changes are hidden.
- Fresh synced/online Exact apps use the clean Exact2 origin/main clone base
  `14c091f205f62c32ed9d585ae75148cffc12dfa2` (EX10 contract migrate), with only
  merged Snapback crate/client bindings and locks changed. exact-commands-r10.md
  records literal commands, cwd, environment, ports, fixture and server cleanup.
- Black M5 qualification uses only /Users/ccheever/projects/snapback-integ23.
  The archive/source binding validates the affected Cargo scopes, Lean-backed
  difftest and 103 platform/affected client files plus two serial model files.
  The platform-generated test census is explicit and production allowance zero.
  The only other source-manifest difference is one verified appended clean wasm
  measurement, with old bytes matched to e1f424691a and the exact appended record
  preserved; executable source is unchanged.
  All 312 shipping SDK leaves match the qualified Linux pack. This final pool
  includes the complete earlier platform pool, not just the latest new files.

Clean wasm: 2,407,070 B raw / 735,469 B gzip / 553,849 B Brotli. Budget
735,969 B = measured gzip + exactly 500 B; whole merged core/error layout and
version stamping explain the allowance. Strict family/absence audits pass.

Actual independent Muse and fresh Codex reviews are stored under llp/reviews/;
the R9 complete compiled-key registration/preparation correction received READY
from both families before this final batch. Source and SDK dist stayed stable
through the full Linux Rust/client runs. Publication worktrees and
target/publication were never used.

The final root inventory precondition was repaired by a frozen install/hoist
and generated bootstrap, followed by passing inventory, guide and reference
checks. All tracked shipping source and all 312 SDK leaves remained unchanged.
Raw diagnostic and repair logs/receipt are included. Later main integration is
recorded separately in the root workstream report.
