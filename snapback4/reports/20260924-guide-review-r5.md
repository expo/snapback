# Lane F round 5 — refusal prose checked against execution

Date: 2026-09-24. Branch: `sb4-intent/f-guide`.
Starting commit: `85ea84d82`.
Implementation commit: `c797add6e`.

Both Medium findings are fixed. The first `E_RULE` paragraph distinguishes
rule denial, collision visibility, admitted hidden writes, conditional updates
and deletes. Every sentence has a comment linking its text pin to a test that
executes the relevant write. The effects card now requires reconciliation of
recorded steps with their stored provider keys. `meta.id` advice is explicitly
limited to legacy handlers without steps that actually used that provider key.

These corrections supersede the round-4 report's overbroad write-outcome and
effect-key claims. Historical reports and journal entries are unchanged.
No engine, compiler, authorization, disclosure, durability or meter behavior
changed. Bob's `unrepost` test remains integration's work, as requested.

## File map

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/rules.md` | Replaced the first `E_RULE` paragraph with operation-specific cases; scoped the existing matrix's heading to update/upsert. |
| `crates/snapback4-lang/src/guide/effects.rs` | Corrected cancellation and attempt-exhaustion recovery; separated legacy effect keys from generated step keys in the general worker advice. |
| `crates/snapback4-lang/src/guide.rs` | Scoped unavailable-read advice to `E_OFFLINE`; distinguished asset placement ownership from download visibility, including unplaced-owner preview. |
| `crates/snapback4-lang/tests/guide/rules.rs` | Added eight execution tests covering 33 writes, their results, visibility and rollback. |
| `crates/snapback4-lang/tests/guide/recovery.rs` | Added durable step-key/cancellation and asset placement/download witnesses. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the complete selected `E_RULE` paragraph, with a write-executing test link beside every sentence. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Updates the audited recovery facts and links the affected pins to runtime witnesses. |
| `crates/snapback4-lang/tests/guide.rs` | Registers the two new test modules. |
| `crates/snapback4/tests/check.rs` | Updates the real CLI excerpt assertions and names their execution witnesses. |
| `JOURNAL.md` | Appends the dated qualification entry. |
| This report | Records the sentence audit, tests, decisions and results. |

The accurate `E_RULE` registry summary and the later hidden-collision explanation
remain unchanged. No new Quarry form was needed; published Quarry blocks and
card leads are unchanged. Existing forms exercised include
`insert records { ... } if absent`, `update records[id = id] { amount }`,
`upsert records[id = id] { amount }`, conditional update and `delete records[id = id]`.

## Sentence-by-sentence write witnesses

All names below are tests in `tests/guide/rules.rs`. Each uses a real compiled
Quarry program and `Engine::mutate`; seeds only establish the starting rows.
The pins do not substitute for executing the operation.

| Sentence in the selected paragraph | Execution witness |
|---|---|
| Insert-rule denial is `E_RULE` for insert and if-absent. | `insert_rule_refusals`: both deny and admitted-success controls. |
| A hidden unique clash is `E_RULE` for both insert forms. | `insert_collision_visibility`: hidden and readable collision worlds. |
| A readable ordinary secondary clash names its index as `E_CONSTRAINT`; if-absent succeeds with null. | `insert_collision_visibility`: checks the schema's selected index name, null and unchanged rows. |
| Update-rule denial is `E_RULE` on a readable target and `NOT_FOUND` on a hidden target. | `update_rule_refusals`: executes both update and upsert-patch. |
| Admitted writes can change hidden rows and return null while they remain hidden. | `admitted_hidden_updates`: both operations change the stored value, the owner sees it, the caller still reads null. |
| Secondary clashes depend on target readability and then collision readability. | `update_collision_visibility`: all four visibility combinations for both operations, with index details only when both rows are readable. |
| Hidden-target rule/condition/clash refusals withhold private details. | `update_rule_refusals`, `update_conditions`, `update_collision_visibility`: check `NOT_FOUND`, no current row and no retained row/index/column/branch values in the message. |
| Missing update targets and incomplete upsert insert patches return `NOT_FOUND`. | `missing_update_and_incomplete_upsert`: the incomplete insert patch satisfies its insert rule before failing row validation. |
| Hidden conditional updates refuse even if the condition matches; readable mismatches return `E_CONFLICT` and current. | `update_conditions`: matching and mismatching conditions in both visibility states, plus an admitted readable control. |
| Delete distinguishes missing ids from refused existing rows, regardless of read visibility. | `delete_rule_refusals`: missing id, readable/hidden denial and readable/hidden success. |
| Hidden reads return null. | `admitted_hidden_updates`: reads after the successful writes under both principals. |
| Use admitted writes; blind-write `NOT_FOUND` does not prove absence. | The rule-refusal, admitted-hidden-write and missing-target tests jointly establish the distinction. |

The collision prose explicitly scopes index-naming claims to secondary unique
constraints without custom refusals. Primary-id collisions and declared custom
codes must not accidentally inherit a claim that every collision names an index.

## Audit of every round-4 addition

Reviewed the advice added by `10927d7d3`, including its registry edit. The table
covers each new instruction or behavioral clause. Named tests run in the full suite unless noted. In this table, `core`, `lang`,
`sim` and `device` abbreviate their `crates/snapback4-*` directories; full crate
names also omit the `crates/` prefix. Bare `bind/` paths are under the language
crate's `src/`; bare `engine/` paths are under the core crate's `src/`.

| Card and added advice | Code or executable evidence; disposition |
|---|---|
| Residency: show unavailable and reconnect on `E_OFFLINE`. | `packages/snapback4/test/residency.test.mjs`, tests “server-run watches rerun on online-only commits and retain answers offline for the client lifetime” and “offline cold watches refuse E_OFFLINE, persisted local reads still work, server answers never persist.” Clarified that the instruction applies to the refusal; a cached answer remains usable but stale. |
| Residency: inspect `why`, apply the site rewrite, or retain the server dependency and handle queued writes/offline reads. | `bind/residency.rs::change_notes` emits the root-cause rewrites; `tests/residency_notes.rs::w9b_residency_sites_name_sources_for_rules_writes_presence_and_native`; the residency client tests exercise server answers and unavailable offline reads. Retained. |
| Assets: supported kind, column byte bound, downscale/resize/shorten. | `snapback4-core/src/assets.rs::sniff`, plus `engine/mod.rs::prepare_asset` and `write.rs::with_asset_facts`; `snapback4-sim/tests/security.rs::dimensions_and_duration_are_admitted_before_any_upload_file_exists`. Retained. |
| Assets: upload again for another home. | `assets.rs::claim_asset` refuses a different home with `E_ASSET_PLACED`. Retained. |
| Assets: omit Range for once; a consumed view cannot be retried by that principal. | `engine/mod.rs::asset_access_request`; `security.rs::once_applies_to_the_placed_uploaders_view_and_ranges_do_not_consume_it`. Retained. |
| Assets: unknown-asset recovery and hidden/missing indistinguishability. | `write.rs::with_asset_facts`, `assets.rs::claim_asset`, `engine/mod.rs::asset_access_request`, and new `recovery::asset_placement_requires_upload_ownership`. Corrected: ownership governs placement; a live readable home governs placed downloads; an unplaced upload permits owner preview. |
| Actions: inspect steps/provider outcomes before new intent; a new sign-in does not revive the old admission. | `engine/actions.rs::replay`, `action_status`, and `authority.rs::family_authority_expiry`; `core/tests/action_context.rs::deadline_cancellation_and_revocation_end_inflight_authority`. Stored family/generation authority remains bound. Retained. |
| Actions: supply the declared environment variable to the host before restart; keep values out of source/generated files/logs. | `snapback4/src/worker_environment.rs::values` reads declared names from the supervisor environment; its `Redactor` handles output and escaped values. `packages/snapback4/src/server.ts` builds private secret contexts. Retained. |
| Bounds: smaller page, narrower predicate or job sweep. | `core/src/meter.rs::Ceilings` and `Ceilings::job`; `engine/job.rs::run_job_chunk` bounds chunks and rolls refused work back. Existing guide read/job examples execute these forms. Retained; this advice does not promise that arbitrary work fits. |
| Effects: rebuild/check the matching worker; inspect steps/outcomes before replacement. | `core/tests/effect_policy.rs::declaration_fence_precedes_all_queue_mutation_and_absence_stays_compatible` and `generation_drift_parks_before_stale_lease_for_settle_and_every_step_verb`; `packages/snapback4/test/generated-effect-context.test.mjs`. Retained; restart does not resume parked work. |
| Effects: cancellation cannot undo in-flight provider work; use the right key before replacement. | `engine/steps.rs::provider_key` and `begin`, `engine/effect_steps.rs`, `engine/effects.rs::cancel_effect`, `packages/snapback4/src/server-steps.ts`, and new `recovery::cancelled_effect_keeps_distinct_stored_step_keys`. Corrected to stored per-step keys. The same incorrect assumption in pre-existing attempt-exhaustion/general-worker prose was corrected too. |
| Maintains: omit recorded fields; write ordinary source columns. | `engine/recorded.rs::refuse_fields` rejects supplied recorded fields; `snapback4-sim/tests/maintains_recorded.rs` and `recorded/round1.rs` execute attribution and refusal cases. Retained. |
| Maintains: restrict parent readers or use a separate aggregate view if disclosure is unwanted. | `bind/columns.rs` checks source readability and parent audience when producing `N_MAINTAINED_COLUMN_DISCLOSURE`; source-write authority does not close the parent read channel. Retained. |
| Native: fix/check the module, inspect committed chunks before replacement; the failed chunk rolled back. | `engine/job.rs` native-chunk savepoint/rollback path; `snapback4-sim/tests/native.rs::a_trap_parks_a_native_job_with_the_reason`, `a_refused_write_parks_a_native_job_and_rolls_the_chunk_back`, and `a_native_continuation_parks_when_module_bytes_change_and_new_work_runs`. Retained. |
| Personas: wait for minute/slot pressure to clear; avoid a tight retry loop. | `snapback4/src/auth.rs::Admission::attempt` retains counters for 60 seconds, charges denied attempts, and `Kdf::drop` releases slots; `limited` marks the refusal retryable. Retained. |
| Prediction: remove the server dependency or drop `predicts` and queue unpredicted. | `lang/tests/residency_notes.rs::predicts_assertion_accepts_eligible_and_refuses_server_at_header`; `bind/residency.rs` classifies and locates the dependency. Retained. |
| Refusals: inspect verb/generation/reason and any panic stack; normal requested stop needs no repair. | `snapback4/src/lifecycle.rs::Line::prefix`, `install`, `finish`, `background` emit identity, reason, panic location and shutdown classification. Stack inspection is conditional on a stack being available; the advice does not promise one. Retained. |
| Rules and `E_RULE` registry: visibility, collision and recovery clauses. | `engine/write.rs`, `engine/write_target.rs`, all 35 `sim/tests/write_authority.rs` tests and the eight new guide write witnesses. Corrected the selected paragraph; retained the accurate registry summary. |
| Rules: restrict aggregate readers or source-write authority if the delta is private. | `bind/residency.rs` checks insert/delete/update implication and target audience for `N_MAINTAIN_DELTA`; existing guide example compiles with a restricted target. Retained. |
| Search: use paged membership groups when opening all rooms cannot fit. | `sim/tests/search_global/forms.rs::w13e_grouped_cut_continues_through_9000_memberships` and `w13e_newest_measures_complete_page_and_opening_envelope`. Retained. |
| Search: call held queries locally over acquired partitions; use grouped search for server answers. | `core/src/engine/mod.rs::server_query_allowed` refuses held queries; membership search execution tests cover grouped server reads and device horizons. Retained. |
| Search: standard browser normalization, no bypass. | `device/src/web.rs` startup canaries refuse absent/mismatching normalization with `E_HOST_UNICODE`. Retained. |
| Sync: stop a restored client; use a fresh device store/outbox; retry/adoption cannot repair regressed identity. | `device/src/device/store_identity.rs::restore_error`, `require_healthy`; `packages/snapback4/src/local.ts` stops sync/flush on the refusal; `test/sync-generation.test.mjs` checks lower-head restore refusal. Retained. |
| Types: guard the divisor with `require n != 0 else EMPTY`. | `core/src/engine/runner.rs` checks require before evaluating later expressions and refuses zero in `Builtin::Divmod`; `lang/tests/frontend_regressions.rs::division_and_remainder_share_divmods_results_precedence_and_zero_refusal`. Retained. |

“Retained” means the new sentence was checked, not merely copied from a different
card. Recovery advice remains conditional on the actual refusal; it does not
promise that a retry, restart or replacement is always safe or sufficient.

## Regressions and qualification

The cancellation witness admits actual effects and steps, establishes distinct
keys for two names and two effect ids, then takes over an expired claim using
the original stored key. Cancellation preserves both step records and prevents
reclaiming the effect. A local provider map models lost acknowledgements: lookup
by `meta.id` finds neither completed external action; the stored keys find both.
No real provider request or provider-durability claim is involved.

The asset witness checks uploader preview, refusal to another principal before
placement, a public placed download, refusal to place that foreign upload in a
second readable row, and success after using the caller's own upload.

Six negative controls failed at the intended assertions: restoring the old
`E_RULE` paragraph, restoring cancellation advice, restoring attempt-exhaustion
advice, removing the legacy-key qualification, deleting asset-placement advice,
and removing the `E_OFFLINE` qualification. Every temporary edit was restored
byte-for-byte before final tests.

- Frozen Bun install passed.
- Final restored-source guide tests: **77 passed, 0 failed**.
- Final restored-source CLI check/why tests: **69 passed, 0 failed**.
- Existing write-authority tests: **35 passed, 0 failed**.
- Existing effect-policy tests: **12 passed, 0 failed**.
- All eight Quarry blocks in the three edited guide sources are byte-identical
  to the starting commit. All 29 card introductions are unchanged. No new
  diagnostic or note exception was added.
- The 195-code census now pins 391 recovery/boundary facts. The full `E_RULE`
  paragraph has 12 sentence pins linked to the eight write-executing tests.
- README remains 292/300 physical lines. The largest changed Rust source is
  1,459 lines. `git diff --check` passed.

One full `scripts/test.sh` run: **`== 0 failure(s) in 406 s`**, exit 0.
No introduced, baseline or environmental suite failures; the complete log has
no failure markers. Client tests: **1,088 passed, 10 skipped, 0 failed**.
All 195 CLI explanations remain within 4,096 bytes; the largest is 4,094 bytes,
and `E_RULE` is 2,111 bytes. WASM remains 1,744,842 B raw / 484,967 B gzip under
the unchanged 486,000 B budget.
Logs are `~/sb4-intent/lane-f-r5-{bun,guide,check,write-authority,effect-policy,suite,mutations}.log`
and `lane-f-r5-mutant-*.log`.

During test development, the new fixture initially used unsupported bare
boolean rules and ambiguous positional keys. A missing row-constructor helper
also caused a compile failure. The asset test initially reassigned the same
asset to its existing readable home; that is an allowed no-op, so the test was
corrected to exercise a second row. The old offline text pin was updated.
These introduced test failures were corrected; no engine bug was found.

## Deviations and open problems

No scope deviation or new open problem. The additional asset/offline wording
and adjacent effect-key advice repairs come from the requested audit. Budgets
and compatibility forms are unchanged. Nothing was pushed or published.

The inherited full-history search example still emits its asserted
`N_NO_HORIZON` note. Reproduce by copying the first Quarry block from
`crates/snapback4-lang/src/guide/search_all.md` into an otherwise empty project's
`snapback/schema.q` and running `snapback4 check`. Its source and the exact
`every_card_compiles_clean` exception remain unchanged.
