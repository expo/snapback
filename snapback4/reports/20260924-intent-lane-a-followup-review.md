Lane A followup review corrections — 2026-09-24

Branch `sb4-intent/a-planner`, parent `d39220e88`; implementation commit `b51f67bd0`. Addresses the two guide-lane planner gaps, literal-id view ordering and rejected-row heap coverage. The earlier nullable-membership and range corrections remain intact. **The requested table-cursor change is stopped under the brief's design-stop instruction:** its prescribed duplicate terminal id violates core schema validation. Reproduction below. Nothing pushed or published.

Changes, file by file (relative to `snapback4/`):

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/bind/intent.rs` | Plan every implicit named final-insert probe through an exact index over all written columns, retaining role checks even when a shorter unique key exists. Run aggregate access-path selection before ordinary planning; share equality/range recognition with that pass. |
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | New aggregate-only access-path pass. An unpaged `count`, `sum` or program `exists` with no authored order/index can use a range column as its seek order. Prefer a finite two-sided range, then a canonical column name. Keep explicit order, authored indexes, page-limited consumers, matching and existing admission untouched. |
| `crates/snapback4-lang/src/bind/mod.rs` | Register the aggregate-planning module. |
| `crates/snapback4-lang/src/bind/program/views.rs` | Preserve an explicitly ordered field named `id` in its written position in the shared view cursor; append id only if absent. |
| `crates/snapback4-lang/src/guide/language.rs` | Remove the explicit `byRoomPrincipalRole` declaration and its use in the admin membership requirement. The existing compiled after-insert example now needs no authored role index. |
| `crates/snapback4-lang/tests/intent/aggregate_plans.rs` | Three planner tests, including capped/uncapped plans for all three aggregate consumers, ordinary/explicit/page order preservation, and canonical range selection. |
| `crates/snapback4-lang/tests/intent_followup.rs` | Four runtime/admission regressions: exact role-sensitive final probes, finite aggregate seeks, unchanged unbounded-page refusal, and literal-id view cursors in both directions. |
| `crates/snapback4-device/tests/intent_views.rs` | Four new device tests, sharing helpers across Memory and SQLite: literal `.id, .at` ordering after sync/reopen in both directions, and rejected source-row heap accounting for residual and second-word rejection. |
| `JOURNAL.md` | One appended dated entry recording changes, measurements and the design stop. |
| `reports/20260924-intent-lane-a-followup-review.md` | This scope, reproduction and evidence record. |

Forms compiled and executed:

- `after insert <- exists members[roomId = .id, principal = .ownerId, role = 'admin']`, with only `unique roomId, principal` and no `by` line on members. Non-admin membership fails with `E_CONSTRAINT` and rolls back the room; admin membership succeeds. A second fixture writes `role` first and proves that the generated exact key follows written order.
- `count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)` chooses the ordinary index `(conversationId, tombstone, at, id)` and seeks both time endpoints. `sum(messages where .conversationId = c and .at >= s and .at < e and not .tombstone, .score)` and `exists messages where .conversationId = c and .at >= s and .at < e and not .tombstone` do the same. The fixture returns 2, 22 and true respectively, examining at most two rows from a 30-row seed.
- `view v: t { id, at }` (block form) with `return v first 1 by .id, .at after c` visits a, b, c when seeded `(id, at) = (a,3), (b,2), (c,1)`. `last 1` visits c, b, a. Every page is complete; continuation exists until the final row. This runs on the server and both device stores after reopen.
- Previously corrected `t where .at in [null, 1, 2] first 1 by .at after c` and `t where .at in range(1, 3) first 10 by .at after c` remain covered and pass. Two-owner nullable membership, both directions, word search, projection, mutations, disclosure and missing coverage also remain covered.

New regression proofs:

| Test | What it proves |
| --- | --- |
| `final_insert_probe_keeps_role_in_its_exact_synthesized_key` | All three named equalities survive in the exact index and constraint key, including role beyond a total unique key; index order follows both tested written orders; non-admin transaction rollback and admin success. |
| `finite_digest_aggregates_seek_without_authored_order` | `count`, `sum` and `exists` have a seek and the expected canonical index, yield exact endpoint/tombstone-filtered values, and avoid examining rows outside the window. |
| `aggregate_planning_does_not_admit_an_unbounded_returned_page` | An uncapped ordinary returned domain retains `E_QUARRY_BOUND`; aggregate planning does not admit it. |
| `literal_id_keeps_its_position_in_view_cursors` | The exact reviewed spelling `.id, .at` preserves every source row over one-row ascending and descending server pages. |
| `digest_aggregate_seek_plan_is_independent_of_cap_admission` | All three unpaged aggregate consumers choose the same seeks and index with and without a cap; planning does not supply a page bound or grant admission. |
| `aggregate_planning_preserves_observable_and_authored_order` | Ordinary reads, explicit order and page-limited aggregate arguments keep their order and do not acquire inferred seeks. |
| `aggregate_range_choice_is_canonical_and_prefers_finite_windows` | A two-sided window wins over a one-sided alternative regardless of conjunct order. |
| `literal_id_order_memory` / `literal_id_order_sqlite` | Exact literal-id view ordering and continuation survive offline sync/reopen on both stores in both directions. |
| `view_rejected_heap_memory` / `view_rejected_heap_sqlite` | Twenty 1 MB rows rejected by `.rank != 0` or a missing second word still consume source heap before rejection. The one-byte controls return complete empty results, proving the predicates reject every seeded row. |

Heap measurements and negative controls:

| Store / rejecting predicate | Heap for 20 rejected 1 MB source rows | Result |
| --- | ---: | --- |
| Memory / residual | 20,012,761 B | incomplete, null result, no cursor |
| Memory / second word | 20,015,237 B | incomplete, null result, no cursor |
| SQLite / residual | 18,011,619 B | incomplete, null result, no cursor |
| SQLite / second word | 18,014,448 B | incomplete, null result, no cursor |

Temporarily moving `view_scan_active` payload charging after word/filter rejection made the Memory residual test fail: it returned a complete empty page with only 46,681 heap bytes. Running the word case first caught the same mutation at 21,277 bytes. The runtime was restored byte-for-byte before affected tests and the full suite. No engine change is in this diff. Logs: `/tmp/lane-a-rejected-heap-mutant.log`, `/tmp/lane-a-rejected-word-heap-mutant.log`, `/tmp/lane-a-followup-device.log`.

Aggregate lane boundary and integrated verification:

Lane A's base does not contain Lane D's streaming aggregate binder. Its capped runtime tests pass; its uncapped planner unit tests prove index/seek selection without weakening admission. In an isolated detached checkout at integration commit `cf803ffcafcb4ce8e1e585fffe70be444679940f`, applied these binder changes and copied `intent_followup.rs`, adding an uncapped variant of the identical digest runtime test by deleting `cap 50 by conversationId`. `cargo test -p snapback4-lang --test intent_followup` passed **5/5**, including both capped and uncapped `count`, `sum` and `exists`. The supervisor's live integration checkout was not modified. Log: `/tmp/lane-a-followup-integration.log`; scratch checkout: `~/sb4-intent/lane-a-followup-integration`. The uncapped runtime variant belongs with integration; it cannot pass on Lane A alone without importing or replacing Lane D's admission work.

Design stop and open reproduction (finding 4):

```quarry
table t:
  at: time
  public 't'
query page(c: cursor ?):
  return t first 1 by .id, .at after c
```

This still refuses with `E_CURSOR_INDEX` on `$intent:byIdAt:3f5fd047a4f9ac15`: the index does not end in id and is not marked unique. The requested append after `columns.dedup()` generates `(id, at, id)`. Applying that exact change produced `E_SCHEMA_CONSTRAINT: duplicate column id`, because `snapback4-core/src/schema.rs` rejects repeated column components. It also prevents the equivalent view regression from compiling. The attempted line was removed. Logs: `/tmp/lane-a-followup-first.log` (requested append), `/tmp/lane-a-id-cursor-blocked.log` (current table refusal, reproduced in the isolated integration checkout).

Resolving this requires a supervisor design decision about cursor admission for an index containing intrinsic id before other keys, or schema support for repeated terminal id. This lane does not silently move id, mark the generated index unique, or relax schema validation. The existing cursor diagnostic itself currently suggests the invalid repeated-id index; that remains part of this open finding. All other findings in this round are addressed.

Engineering decisions and deviations:

- Exact final-probe index synthesis was the first alternative authorized by the brief; there is no new IR field and no fallback that drops extra conditions.
- Multiple possible aggregate range columns are resolved deterministically: finite windows first, then column name. Explicit order/index and limited-page consumers retain their meaning. No scan-admission, authorization, disclosure, meter or budget changes.
- Finding 4 is deliberately stopped for the concrete schema contradiction above. No new syntax or diagnostic code was needed for the implemented fixes. The earlier nullable/range fix was already committed in `d39220e88` and was rerun, not rewritten.
- The reviewer's untracked `probe_review_tmp.rs` is absent. Earlier program-wide scope limits and their reproductions remain in `reports/20260924-intent-lane-a.md`; this report covers this review delta.

Verification:

- **114 affected tests passed:** 97 language integration tests (`guide` 55, `intent_followup` 4, `intent_nulls` 7, `intent_review` 7, `intent_target` 21, `lane_domains` 3), 3 aggregate planner unit tests and 14 device view tests. Logs: `/tmp/lane-a-followup-affected.log`, `/tmp/lane-a-aggregate-unit.log`, `/tmp/lane-a-followup-device.log`.
- `scripts/test.sh`: **`== 1 failure(s) in 171 s`**, exit 1. Log: `/tmp/lane-a-followup-full-suite.log`. Only the `cargo test` step failed, with exactly one failed test: **baseline** `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. It is also present in `~/sb4-intent/baseline-test.log`. Reproduce from `snapback4/` with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. This pre-existing problem remains unchanged. **Introduced failures: none. Environmental failures: none.** The intentional temporary-mutant failures above are negative-control evidence, not final-suite failures.
- All **995 client tests passed**, 10 skipped. Builds, typechecks, fixtures and guide tests passed. WASM remains **1,736,564 B raw / 480,855 B gzip**, within the unchanged 481,000 B budget.
- `ref-check --verbose`: 504 LLP documents, 9,212 references, zero errors and zero unchecked. Whitespace checks pass and changed source files remain below 1,500 lines.
