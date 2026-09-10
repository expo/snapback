# custody-b — LLP 1019 D2

Date: 2026-09-10. Base: `7853d4cd49318efda336deb8102804d4f34420af`. Branch: `s2/ri-custody-b`.
Implementation is uncommitted for the orchestrator. No branch changes, stash, main merge, or template changes.

## Implemented claims

- §3: the shared row-change lifecycle emits native `delivered`, `changed`, and `removed` rows in the source transaction. Insert scans the pinned membership group with N+1 overflow capacity, deduplicates principals, and records audience. Updates/upserts use the original `byRow(row, 'delivered', ...)` audience and incarnation; unchanged updates emit nothing. Repeated changes have distinct commit ordinals. Group changes retain the original event's group keys. Departed recipients receive changes and removals.
- §3: mutation, job chunk, row schedule, certified product seed, fixture seed, and authoritative replay use that lifecycle. Failed writes, jobs, schedules, and replay conflicts roll back generated rows. Same-transaction membership writes visible before the content write count.
- §3: id reuse refuses `E_DELIVER_INCARNATION` at the authored write source (rule family, offline page, published executable fresh-insert repair). Retained delivered history refuses reuse; a transactional retired-id metadata key also covers rows originally delivered to nobody. Reset clears those keys. Live incarnation comes from the log, including bootstrap's installation-seq convention.
- §3: production `Engine::seed` remains available, routed through a checked seed mutation for delivered tables, generated tables, membership targets, and all capped tables. It enforces caps and generated-table ownership. Its work ceilings match product seeds; heap remains bounded. The fixture API has no clock argument and uses deterministic time 0; `Runtime::seed` retains its supplied clock.
- §3: `schedule expireMessage on messages at .expiresAt: delete .` lowers to a private mutation with the existing trigger binding, admission, timer settlement, and rejection path. Period triggers, other targets, trailing fields, and non-time columns refuse.
- §4: insert reserves N+1 examined/index/write rows per call. Update/delete reserve engine-recorded A; upsert reserves max(N+1, A). Engine entry specializes the supplied certificate without changing schema identity or repairing missing sites. Native scratch, steps, writes, maintained amplification, associated timers, and final probes are covered. Private reads add no rule/receipt/output authority. E_BOUND includes the deliver term. Runtime checks the full cumulative reserve, including empty groups and repeated calls. Nonuniform scans cannot spend it.
- §7: receipt-only engine/evaluator execution never derives audience writes from held memberships. The evaluator already skipped these writes; the change there is a comment plus executable corpus coverage. Own-event prediction remains D4.

## Files

Paths below are relative to `snapback2/` except the last row.

| Files | Change |
| --- | --- |
| `crates/snapback2-core/src/engine/{runner_ops,runner,mod,timers}.rs`; new `engine/custody.rs` | Native lifecycle, per-commit ordinal, reserve containment, seed route, audience specialization, reset and timer settlement |
| New `crates/snapback2-core/src/engine/containment.rs` | Existing containment methods moved out of runner_ops to stay below 1,500 lines |
| `crates/snapback2-core/src/engine/jobs.rs` | Chunk certificate specialization and original lowered write path |
| `crates/snapback2-core/src/delivery.rs` | Incarnation code/repair and bounded native scratch calculation |
| `crates/snapback2-core/src/certificate.rs`; new `certificate/delivery.rs`; `certificate/{summary,diagnostic}.rs`; `certificate_policy/fanout_bindings.rs` | Native and historical-audience pricing, sourced terms, nonuniform protection; existing rule-index collector extracted |
| `crates/snapback2-core/src/{jobs,offline}.rs`; `crates/snapback2/src/{protocol,writer_wire}.rs` | Same refusal family, write site, repair, and guide on direct, replay, job, and schedule envelopes |
| `packages/compiler/src/quarry/{parser,schedule,direct}.ts` | Private deletion target and write source locations without additional IR bytes |
| `crates/snapback2-core/tests/delivery.rs`; new `tests/delivery/{writes,schedules}.rs` | 18 D2 integration tests; update the inherited reset expectation now that seeds deliver |
| `packages/compiler/src/delivery-checks.ts` | Three D2 compiler checks |
| `crates/snapback2-core/src/bin/export_corpus/delivery_cases.rs`; `corpus/manifest.json`; 11 new `corpus/deliver-*.json`; `tests/spike.rs` | Corpus 277 → 288; authoritative assertions plus receipt-only twins; count pin |
| `packages/evaluator/src/runner.ts` | Receipt-only boundary comment |
| `packages/snapback2/guide/{offline,schedule,grammar}.md`; `guide/families.source.json` | User rules, syntax, refusal card and executable repair |
| `metrics/twin.jsonl` | Required complete-runtime measurement |
| Root `llp/1019-derived-delivery-custody.rfc.md`; `REPORT-custody-b.md` | One implementation record line; this report |

Explicit scope extensions: `engine/jobs.rs`, core `jobs.rs`/`offline.rs`, server `protocol.rs`/`writer_wire.rs`, existing compiler `quarry/schedule.ts`, guide schedule/grammar pages, and the metric record are outside the brief's narrow named-file list. They are the existing chunk, diagnostic, lowering, documentation, and measurement owners. New Rust modules split implementation/containment rather than adding apparatus. No new script, check, registry, config, or design document.

## Before / after

Before evidence was captured on the base with three added failing tests (`/tmp/custody-b-before.log`):

```text
examined=0 index=0 writes=[WriteSite { table: "messages", kind: Insert, max_rows: 1 }]
insert state=Committed { seq: 1 } delivered=[]
changed=[]
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.01s
```

Final targeted reruns (`/tmp/custody-b-after-{insert,update,price}.log`):

```text
insert state=Committed { seq: 4 } delivered=["alice", "bob"]
changed=["alice", "alice", "bob", "bob"]
reuse=E_REQUIRE:E_DELIVER_INCARNATION: program requirement failed
examined=4 index=4 writes=[WriteSite { table: "messages", kind: Insert, max_rows: 1 }, WriteSite { table: "deliveries", kind: Insert, max_rows: 4 }]
```

Each of those three reruns reports `1 passed; 0 failed; 0 ignored; 0 measured; 33 filtered out`. The reuse error's stable `code()` is `E_DELIVER_INCARNATION`; the displayed prefix is the existing Require representation. Seed commits account for the sequence increasing from 1 to 4.

The temporary chat project `/tmp/custody-b-schedule-before` changed only its temporary expiry schedule, with no repository template edits:

```text
before:
refused E_QUARRY_SYNTAX at snapback/messages.q:78:59
  message: expected word, got "<newline>"
  rewrite: -- fix this Quarry declaration and rerun snapback2 check

after:
ok 311ea737 27 ops
```

A final seed-policy regression first failed with `E_BOUND`, `examined entries 11000 exceeds ceiling 10240` (`/tmp/custody-b-seed-before.log`: `0 passed; 1 failed; 0 ignored; 0 measured; 32 filtered out`). After matching seed work exemptions, the capped membership seed succeeds and the oversized delivered-content seed still refuses its heap bound.

## Tests and exact results

All commands used real Node v24.18.0 first on PATH. Cargo commands ran in `snapback2/`.

1. `cargo build`: exit 0. Final production build: `Finished dev profile [unoptimized + debuginfo] target(s) in 0.13s`.
2. `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --test delivery --test cap --test timers --test jobs --no-fail-fast`:
   `Summary [   0.664s] 91 tests run: 91 passed, 1 skipped`.
   Log: `/tmp/custody-b-lifecycle-final2.log`. The ignored test is existing `jobs::measure_100000_row_fill`, marked “LLP 1016 measurement, explicitly run outside the blocking suite”. This run precedes the one additional queued-successor test below.
3. `NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core -p snapback2 -E 'test(engine::custody) | test(delivery_incarnation_has_one) | test(every_frozen_corpus_case_replays) | test(a_queued_delete_across)' --no-fail-fast`:
   `Summary [   0.514s] 5 tests run: 5 passed, 928 skipped`.
   Log: `/tmp/custody-b-proof-final.log`. All five selected tests passed; the 928 are outside the name filter.
4. Rust guide definition/budget checks, also including the four earlier core/protocol/corpus checks:
   `Summary [   2.275s] 6 tests run: 6 passed, 925 skipped`.
   Log: `/tmp/custody-b-proof.log`. Guide names: `quarry_keywords_print_grammar_and_definitions_beside_symbol_help`, `offline_guide_page_respects_its_budget_and_its_codes_have_pages`.
5. Compiler targeted registration in `packages/compiler`:
   ```sh
   bun -e 'import {registerDeliveryChecks} from "./src/delivery-checks.ts"; const checks=[]; registerDeliveryChecks((name,run)=>checks.push({name,run})); let failed=0; for(const c of checks){try{await c.run(); console.log("PASS",c.name)}catch(e){failed++; console.error("FAIL",c.name,e)}} console.log(`Delivery compiler checks: ${checks.length-failed} passed, ${failed} failed`); if(failed)process.exitCode=1'
   ```
   Result: `Delivery compiler checks: 9 passed, 0 failed`.
   `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
6. `cargo run -p snapback2-core --bin export_corpus`: `wrote 288 frozen corpus cases`. Rust `every_frozen_corpus_case_replays_its_certification_outcome` passed. Evaluator `bun src/test.ts`:
   `{"cases":261,"passed":261,"serverOnly":27,"failed":0,"corruptionPath":"replay-mismatch"}`.
   Log: `/tmp/custody-b-evaluator-final.log`. A final focused replay after regeneration also passed: `Summary [   0.286s] 4 tests run: 4 passed, 194 skipped`.
7. `node build.mjs` in `packages/snapback2`: exit 0; `guide: 31 cards, 79649/98304 bytes (18% headroom)`. The existing offline headroom warning remains.
8. `node build.mjs --measure-twin`: complete local runtime minified **259,644**, gzip **84,996**, ceiling **85,000**, Node **v24.18.0**, esbuild **0.25.9**, gzip level **9**. D1/D3 base: 84,996; D2 delta: **0 bytes**. Main reference 84,994 is two bytes below this inherited base.
9. `./ref-check --verbose`: `ref-check: ok — 433 LLP docs, 7934 refs in 19086 files, 0 errors, 0 unchecked`.
10. `git diff --check`: exit 0. `node scripts/caps.mjs`: one inherited Snapback 1 violation: `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs is 1504 lines, over the cap of 1500.` Baseline 204, actual 205. That file is untouched. No changed/new source exceeds 1,500 lines.

### Added assertions by test name

Integration tests under `tests/delivery/` (18):

- `delivered_insert_and_seed_cover_the_cap_group`
- `fixture_seed_waives_work_ceilings_but_keeps_the_heap_ceiling`
- `changed_removed_and_reuse_follow_original_custody`
- `delivery_insert_reserves_overflow_and_generated_writes`
- `upsert_existing_and_rollback_are_atomic`
- `zero_audience_still_refuses_retired_id_and_seed_cannot_overfill_cap`
- `delivery_containment_guards_the_reserve_even_with_an_empty_group`
- `audience_bound_specializes_all_native_meters_and_names_the_deliver_term`
- `live_writes_and_bootstrap_keep_incarnation_through_a_cap_lowering`
- `a_nonuniform_scan_cannot_spend_the_native_delivery_reserve`
- `receipt_only_execution_skips_custody_even_when_memberships_are_held`
- `a_queued_delete_across_a_cap_successor_keeps_historical_custody`
- `same_commit_membership_and_group_moves_do_not_rewrite_send_time_custody`
- `reset_clears_retired_ids_and_recomputes_audience_before_certified_seeding`
- `log_maintains_share_native_writes_and_the_historical_reserve`
- `schedule_delete_delivers_the_departed_recipient_tombstone_and_settles`
- `schedule_delete_rollback_restores_body_and_events_but_records_rejection`
- `job_delete_fanout_and_rollback_are_per_chunk`

Core unit tests (2): `engine::custody::tests::authoritative_replay_derives_events_and_a_conflict_rolls_them_back`; `engine::custody::a_retained_delivery_log_refuses_reuse_without_a_retired_metadata_record`.

Wire unit test (1): `protocol::delivery_incarnation_has_one_family_write_site_rewrite_and_page_on_every_wire`.

Compiler additions (3): “the incarnation refusal publishes an executable fresh-insert repair”; “schedule delete lowers to a private mutation with its existing admission and source”; “schedule delete refuses periods, other rows, extra fields, and non-time columns”. The repair check compiles/checks the published complete example, including its schema, on both sides; the wrong side is a runtime incarnation refusal, not a compiler refusal.

New corpus names (11): `deliver-insert-cap3`, `deliver-changed-original`, `deliver-upsert-existing`, `deliver-delete-departed`, `deliver-rollback`, `deliver-id-reuse`, `deliver-seed`, `deliver-replay-skip`, `deliver-schedule-delete-target`, `deliver-job-delete-chunk`, `deliver-audience-bound-refused`.

## Specification facts, deviations, and boundaries

- RFC §4 says insert N; the lane explicitly corrects it to **N+1**, matching P0's overflow probe. Implemented N+1; RFC prose still needs that correction.
- The line citations at 635999335 were stale. The actual schedule lowering is `quarry/schedule.ts`; parser/binding already accepts the synthesized ordinary target, so no `bound.ts` edit was needed.
- The handoff report exists at `/Users/ccheever/projects/snapback-ri-20260910/reports/final-custody-a.md`, not this worktree's `reports/`.
- The checkout's build enforces **8,192 bytes per guide page**, not the lower values in the common brief. Baseline offline/grammar/schedule were already 7,413/4,109/5,607 bytes. Final values are **8,034/4,140/5,909**; no budget changed. Actual build and guide tests pass.
- RFC acceptance 8's 84,000 ceiling is stale; the brief and current tool enforce 85,000. No runtime budget was raised.
- Receipt-only execution already performed no native custody writes. Preserved that behavior and tested it; no D4 prediction was added.
- Historical A is applied to each authoritative execution/chunk/firing from the stored engine record. It does not enter schema identity or the compiler's portable certificate. Rule/closure/output charges for private audience access are zero; maintained final probes and derived work remain charged when present.
- A small retired-id metadata record is necessary for empty-audience deletes: those rows have no event from which to prove prior existence. It does not duplicate live-row incarnation.
- Corpus schedule/job examples execute their lowered target/chunk bodies because the frozen corpus format has no owner scheduler. Actual firing, chunk control, successor A, and rollback are Rust integration assertions.
- D1's reset test expected no seed events and an unchanged old audience bound. Updated it to two seed events and recomputed A=2; this is the new native seed behavior.
- The lane-specific instruction says targeted tests only. `scripts/test.sh`, the full workspace, Hermes proof, and loop measurement were not run; the orchestrator owns remote integration verification. No targeted test failed because of sandbox restrictions. Read-only `ps` was denied; no dev process was started or killed.

Acceptance 6 is covered for native containment, mixed nonuniform scans, incarnation, job/schedule rollback, receipt-only skipping, authoritative conflict rollback, and a queued delete across a cap-lowering successor. Acknowledgement/queue interaction belongs to D5 and is not claimed here. Acceptance 7's D1 addition/bootstrap/removal/retarget/A/log cases remain green in the delivery suite; D2 adds writes against live and bootstrap incarnation after cap lowering. Twin tombstone swap/cold restart and template acceptance remain D4/D6.

Open D2 design questions: none. Pending handoff work: orchestrator review/commit/integration verification, other lanes' acceptance claims, and the unrelated inherited caps violation.

## Fix round r1

Base/worktree HEAD: `5434af50beef012714c3d9dc3634359d033e03be` (`s2/ri-custody-b`). No commit, stash, branch change, full suite, or process kill performed.

### Disposition of the eight requested items

| Item | Disposition | Evidence |
|---|---|---|
| 1. Normalize images | FIXED | `omitted_optional_images_deliver_into_null_group_without_false_changes`; `both_seed_entries_normalize_optional_delivery_images`. Both images materialize the table's optional fields before comparison/event construction. The null group delivers, and omitted/explicit-null upserts add no events. Both Engine and Runtime seeds covered. |
| 2. Private traces/containment | FIXED | `stripping_only_prior_delivery_index_refuses_before_scanning_and_rolls_back`; `private_delivery_probes_trace_identities_prefixes_and_absences_without_receipts`. Full reserve, byRow and audience indexes, and constraint declarations checked before scans. Each actual scan emits a private constraint trace, including empty identities. Private memberships, empty audiences, and three distinct principals at cap three covered. |
| 3. Durable specialization refusal | FIXED | `historical_audience_specialization_replay_rejection_is_durable`; `historical_audience_specialization_settles_pending_then`; `custody_storage_fault_does_not_settle_replay_or_then_as_a_program_refusal`. Portable cap-1 certificate passes; actual retained A=10 overflows heap. Replay records rejected/E_BOUND, consumes its slice, keeps identical terminal after retry/reopen; then becomes sent with rejection. Unreadable A remains E_STORE_VERSION, with no replay terminal/slice or then settlement. |
| 4. Table-specific repair/envelopes | FIXED | `incarnation_repair_fits_the_table_on_direct_seed_and_replay`; `incarnation_job_and_schedule_keep_the_authored_write_and_settle_rollback`; `real_incarnation_refusals_keep_the_table_repair_on_direct_seed_and_replay_wires`; compiler `incarnation repairs fit required fields and writes use only statement source sites`. Real retired `notes` row; repair `insert notes { authorId: viewer, conversationId, text }`; family rule/page offline; actual write sites and rollback. Replay settles, job parks, timer settles and does not re-fire. The published family card retains its complete messages example. |
| 5. Overflow meter | FIXED | `a_loop_dominated_step_overflow_keeps_e_steps_despite_a_delivered_write`; `a_delivery_dominated_step_overflow_names_the_declaration`. Delivery joins the priced product with its declaration site; an unrelated dominant loop preserves E_STEPS and its own statement site. Heap scratch also gets the contributing declaration's site. |
| 6. Statement sites | FIXED | `incarnation_sites_follow_statement_then_and_loop_nesting`, real job/timer/direct tests above, compiler schedule/source tests. Deleted writeSources and write_path; writes ride statementSources and 1-based `program:statement:N` with nested statement/then/else segments. |
| 7a. Corpus outcomes | FIXED | `every_frozen_corpus_case_replays_its_certification_outcome` now also runs the real server id-reuse case and asserts rejected/E_DELIVER_INCARNATION; deliver-seed must contain and execute its upsert. Export regenerated all 288 cases. |
| 7b. Historical upsert | FIXED | `upsert_existing_reserves_historical_ten_above_current_cap_three`: installed cap 3, retained A=10, specialized log max_rows=10, ten original recipients get changed. |
| 7c. Owner expiry | FIXED | `schedule_delete_as_owner_obeys_custody_despite_author_only_delete_rule`; compiler `schedule delete lowers to a private mutation with its existing admission and source`. Delete rule is `.authorId = viewer`; owner target deletes and departed Bob gets removed. |
| 7d. Job reserve | FIXED | `a_nonuniform_job_chunk_cannot_spend_the_delivery_reserve`. A raw job-chunk checker previously admitted a nonuniform scan plus delivered delete; now E_STRUCTURAL_FANOUT. Ordinary job certification retains its existing owner-total-visibility semantics, and the job integration suite passes. |
| 8. Hygiene/records | FIXED, external append restricted | RFC §4 now says N+1 and upsert max(N+1,A); acceptance 8 says 85,000; misleading artificial every-wire test replaced by real scoped tests; runner_ops unused-import suppression removed; collect_rule_indexes moved to general certificate_policy; offline guide updated (8,190 bytes); measurement records this HEAD; RFC implementation record appended. Writable mirror `reports/final-custody-b.md` preserves the prior report and appends this section. The canonical external report cannot be modified in this sandbox. |

### Verbatim final verification summaries

```text
cargo build:
    Finished `dev` profile [unoptimized + debuginfo]

NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --test delivery --test cap --test timers --test jobs --no-fail-fast:
     Summary [   0.729s] 104 tests run: 104 passed, 1 skipped

NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --lib -E 'test(certificate::) | test(engine::custody::)' --no-fail-fast:
     Summary [   0.094s] 35 tests run: 35 passed, 121 skipped

cargo test -p snapback2-core --test spike every_frozen_corpus_case_replays -- --nocapture:
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.34s

cargo test -p snapback2 real_incarnation_refusals -- --nocapture (matching binary unit):
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 200 filtered out; finished in 0.02s

cargo test -p snapback2 --bin snapback2 deliver -- --nocapture:
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 198 filtered out; finished in 0.03s

cargo run -p snapback2-core --bin export_corpus:
wrote 288 frozen corpus cases

packages/compiler: bun src/test.ts:
Compiler checks: 299 passed, 0 failed

packages/evaluator: bun src/test.ts:
{"cases":261,"passed":261,"serverOnly":27,"failed":0,"corruptionPath":"replay-mismatch"}

packages/snapback2: node build.mjs:
guide: 31 cards, 81814/98304 bytes (16% headroom)
```

`node build.mjs --measure-twin`: Node v24.18.0, esbuild 0.25.9, gzip level 9. HEAD `5434af50beef012714c3d9dc3634359d033e03be`; minified 259,467; gzip **84,946**, ceiling **85,000**, target 80,000. Engine-only fix adds no client runtime bytes. No budget changed. Media helper and Hermes are not needed by these tests.

`caps`: changed source/report files are below 1,500 lines; largest affected source is registry.rs at 1,483 (field additions). Corpus JSON and manifest are generated fixtures, handled by caps' existing generated-file exclusion. One inherited violation: `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs is 1504 lines, over the cap of 1500.` No Snapback 1 file changed. `git diff --check`: clean. `ref-check: ok — 439 LLP docs, 7974 refs in 19125 files, 0 errors, 0 unchecked`. Final changed non-generated files: 31 checked, all ≤1,500 lines.

### Before → after outputs

The regression tests were installed before their relevant fix, on this merged tree. Later reproductions include earlier ordered fixes. Logs live in `/tmp/custody-b-r1-*.log`.

```text
B1 before: Value(MissingField("conversationId"))
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 34 filtered out; finished in 0.02s
B1 after: both optional-image tests pass.

B2 before: only deliveries.byRow removed → Ok(Execution ... state: Committed { seq: 4 })
B2 before: private delivery trace count left: 0, right: 2
B2 after: single-index removal refuses with no content/events; private identities/prefixes/absences traced, absent from receipts.

B3 before: Err(SchemaDeliver { code: "E_BOUND", message: "schema.tables.messages.deliver: heap bytes 8935920 exceeds ceiling 8388608 (...)" })
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 38 filtered out; finished in 0.13s
B3 after: rejected E_BOUND terminal, consumed slice, identical retry/reopen; pending then sent with rejection.

B4 before (review/source-confirmed): every incarnation error used `insert messages { conversationId, authorId: viewer, body }`; seed dropped structured site/repair.
B4 after: `insert notes { authorId: viewer, conversationId, text }`, rule/offline, actual statement site, through real direct/seed/replay/job/timer refusals.

B5 before: steps 2092 exceeds ceiling 1000; dominant literal-range expressions=1000 and statements=1000; code E_BOUND at schema.tables.messages.deliver.
B5 after: E_STEPS at the dominant loop statement; a delivery-dominated steps overflow remains E_BOUND at the declaration.

B6 before: notes.reuse/body/0, notes.sweep/body/0/body/0.
B6 after: notes.reuse:statement:1, notes.sweep:statement:1:statement:1; conditional nesting includes :then:/:else:.

B7a before: deliver-seed must freeze its actual write, got Return(Scan(...)).
B7a after: seed freezes Upsert; server id reuse asserts rejected/E_DELIVER_INCARNATION.

B7d before: raw job-chunk checker returned Ok(Certificate ... max_examined: 10240 ...).
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 154 filtered out; finished in 0.01s
B7d after: E_STRUCTURAL_FANOUT at chunk.members.
```

### Files and scope

- Lifecycle/error settlement: core `engine/{custody,mod,error,runner,runner_ops,jobs,timers,replay,receipt}.rs`, `delivery.rs`.
- Certification: core `certificate.rs`, `certificate/{delivery,diagnostic}.rs`, `certificate_policy.rs`, `certificate_policy/fanout.rs`.
- Refusal propagation requiring adjacent files beyond the original named engine-only areas: core `registry.rs` (two state constructors), `offline.rs` (replay envelope), `jobs.rs` (job refusal envelope); CLI `protocol.rs` and `writer_wire.rs`. RuntimeError moved out of the nearly-full engine/mod.rs into engine/error.rs; no new refusal code or card.
- Compiler: `quarry/direct.ts` and `delivery-checks.ts`.
- Proofs: `tests/delivery/{writes,schedules,fix_round}.rs`, `tests/spike.rs`, core custody/certificate unit tests; `bin/export_corpus/delivery_cases.rs`; 260 regenerated corpus JSON files including manifest. Most extra fixture churn is the merged cost lane's previously unfrozen cost_terms metadata, not additional behavior changes. Corpus count remains 288.
- Guide/RFC/evidence: `guide/offline.md`, LLP 1019, `metrics/twin.jsonl`, this report and the writable mirror.

### Facts, deviations, restrictions, and open work

- Fetch attempt was refused: `error: cannot open '/Users/ccheever/projects/snapback/.git/worktrees/snapback-s2v/FETCH_HEAD': Operation not permitted`. No merge attempted after that; HEAD stays the supplied merged `5434af50be`. The orchestrator must perform any newer-main integration outside this sandbox.
- The canonical report is `/Users/ccheever/projects/snapback-ri-20260910/reports/final-custody-b.md`, outside writable roots. It was read and preserved in the local mirror; its requested append is prepared here, not claimed applied there. The local lane brief is also absent; the program's `briefs/lane-custody-b.md` was read instead.
- Cursor result-page addresses are certificate/twin lineage keys, not authored diagnostic sites. Changing the runner to statement sites initially removed the merge cursor (`export_corpus/merge_cases.rs: first.next was None`). The runner now carries result-page lineage separately, matching certificate/page.rs, while writes have only the required statement-site spelling. Full export and Rust/TS corpus checks prove the retained cursor contract.
- Named jobs deliberately certify the owner's total read visibility. The nonuniform-reserve refusal applies to a raw chunk with a genuinely nonuniform read; ordinary owner jobs still use their declared structural page reserve. No new owner permission rule was introduced.
- Current packaged guide allocation is 8,192 bytes per page, not the older values in common.md. Existing build rules enforce the guide; no allocation raised. offline.md is 8,190.
- No full `scripts/test.sh`, complete workspace tests, remote tests, publication, or capability claim. The fix-round instruction assigns whole-suite verification to the orchestrator. No targeted failure was a sandbox test artifact. Intermediate test-fixture compile/encoding mistakes were corrected; final summaries above are green.
- Open product/design questions: none. Operational handoff: newer-main fetch/merge, canonical external-report append, orchestrator remote verification/review/commit.
