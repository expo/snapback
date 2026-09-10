# P0 — `deliver` representation decision

Base: `c25b0ec98f0944ca6a6931b6e8bd9c2799777fe1`. Date: 2026-09-10.
Scope: LLP 1019 Mechanism, §3 insert/delete custody, §7 prediction experiment.
No commits, stashes, branch changes, shipped-template changes, or tombstones deletion.

## Recommendation

**Native derived writes at `Runner::finish_row_change`; confidence 90% in the representation, not production readiness.** Compile the declaration and generated table shapes ahead of time, but let the row lifecycle own their writes. The native prototype reaches product seeds, upserts, job chunks, schedule targets, and authoritative replay without expanding each program. AOT still needs protected engine authority, complete-audience proof, commit metadata, omission admission, and special twin prediction. Ordinary executable IR does not remove those obligations.

**Required RFC correction before D1–D3:** change the generated log's `byRow` from `(row, recipient)` to **`(row, kind, recipient)`**, and seek `(row, 'delivered')` for historical fan-out. The specified index contains unlimited `changed` events; an audience bound A cannot bound an all-kind scan. A SQL post-filter or `DISTINCT` over that history does not price the underlying work. The extra ordinary index component solves this without a new index kind or audience table. Id-reuse refusal makes the row prefix one incarnation; still validate the incarnation on events.

**Required D2 closure:** `Engine::seed` is a public raw fixture helper that bypasses the lifecycle. Product `Runtime::seed` is covered. For a delivered table, route the raw helper through the certified seed/upsert path too, or remove its production availability. Do not claim “every writer” while leaving that escape hatch.

## Comparison

| Question | AOT expansion spike | Native spike |
|---|---|---|
| Actual insert/delete execution | Ordinary generated `For(Page)` / `Insert` IR, exact-expansion check, private authority block | Indexed audience read plus generated inserts inside the shared row-change hook |
| Alice/Bob send; Bob leaves; Carol joins; delete | Alice/Bob `delivered`; Alice/Bob `removed` | Same |
| Table-wide recipient read rule | Preserved in actual schema; generated block needs privileged execution | Preserved; only engine-owned log writes use internal authority |
| Ordinary current admission | Delete refuses `E_STRUCTURAL_FANOUT`: no cap on the log's row group | Adds cap-derived writes/read reserves to the existing analyzer; mixed nonuniform scans refuse |
| Additional machinery exposed by spike | Canonical expansion verifier; authority block; trusted read-proof schema; N envelope IDs | Native hook; cap reservation; existing transaction, indexing and containment |
| Twin with no changes | Ordinary schema/IR identity works, but log insert refuses `E_RULE`; `Table.deliver` still refuses `E_SCHEMA` | No automatic events; needs the same Table identity change and one narrow derived prediction slot |
| Correct local prediction | Full generated server fan-out is unsuitable without held audience authority | One own `delivered`, zero `changed`/`removed`, no audience receipt in the Runner experiment |
| Successor | Private ordinary tables still need custody ownership, empty install/bootstrap, audience-bound admission and destructive removal semantics | Same schema obligations; no projection rebuild |
| Historical byRow bound | Trusted cap view valid only for this insert/delete fixture; **not sound production metadata** | Guard refuses a history beyond A+1 instead of silently omitting recipients; needs the index correction above |
| Production invariant established? | No: expansion admission is a test harness, not wired into Generation/seed/job admission | Insert/delete product lifecycle coverage witnessed; raw fixture seed, full ownership/identity and update semantics remain D1–D3 work |

### Measured lines

Physical lines after rustfmt, including blank lines/comments; fixture/test support separated. No production-size extrapolation.

| Representation / support | Location | Added lines |
|---|---|---:|
| Native implementation | `engine/delivery_spike.rs` lines 1–138 (bound + hook) | 138 |
| Native integration | `certificate.rs` +12; `certificate_policy/fanout_bindings.rs` +6; `engine/runner_ops.rs` +2; `engine/mod.rs` +2 | 22 |
| **Native subtotal** | | **160** |
| AOT implementation | `engine/delivery_aot_spike.rs` lines 1–162 (IR expansion, admission, authority block) | 162 |
| AOT integration | `engine/runner.rs` +5; `engine/mod.rs` +2 | 7 |
| **AOT subtotal** | | **169** |
| Shared event-row constructor | `engine/delivery_spike.rs` lines 139–171 | 33 |
| Shared schema/row/operation fixture helpers | same file, lines 172–286 | 115 |
| Initial native/baseline tests | same file, lines 287–316 | 30 |
| AOT witness | `engine/delivery_aot_spike.rs` lines 163–225 | 63 |
| Native path/cost/rollback witnesses | `engine/delivery_spike_tests.rs` +326; `engine/mod.rs` +2 | 328 |
| Twin experiment | `packages/evaluator/src/test-delivery-prototype.ts` +71; `src/test.ts` +1 | 72 |
| Existing containment extraction | `engine/runner_bounds.rs` +253; `runner_ops.rs` −248; `mod.rs` +1 | net +6 |

The 9-line implementation difference is not the decision: **the AOT number excludes its still-missing production admission, scoped privilege and metadata design**. Neither subtotal includes D1/D3 schema/parser work, full update/history semantics, or D4/D5 integration. All `engine/` paths above are under `snapback2/crates/snapback2-core/src/`.

### Certificate measurements (target cap 3, two actual recipients)

| Program | examined | index entries | content writes | log write bound | steps |
|---|---:|---:|---:|---:|---:|
| AOT insert | 14 | 14 | 1 | 3 | 134 |
| AOT delete | 14 | 14 | 1 | 3 | 152 |
| Native insert | 4 | 4 | 1 | 3 | 87 |

Native reserves N+1 for a bounded overflow probe; RFC §4 says N. AOT uses ordinary scan lookahead (N+2) plus the trusted cap view's N×N write probes: 5+9=14. That quadratic tax is evidence against pretending an append log is an ordinary capped table. These are fixture-specific figures, not production chat costs (the fixture omits asset/search work and the full membership policy).

Native cap lowered 3→1 while historical marker remains 3: insert log bound 1, delete log bound 3. This tests the pricing distinction, **not successor admission**. Native 600 calls × (1 content + 3 log writes) refuses at the 2,048-write ceiling. The existing containment rejects a certificate from which the delivery write site was removed and rolls back the content row too.

## Write-path coverage

| Path | Native evidence / enforcement | AOT evidence / required enforcement |
|---|---|---|
| Mutation insert/delete | Executed; `insert_mode` / `delete` → `finish_row_change` | Executed generated fixture and omission/tamper check; production Generation must reconstruct/validate every expansion |
| Conditional insert | Successful `insert_if_absent` shares `insert_mode`; collision returns before hook (code trace; not a new P0 witness) | Must lower the successful branch only; not implemented |
| Upsert | Product seed is upsert; new row delivers, existing row does not redeliver (witness) | Insert-versus-update dispatch and single evaluation of key/row must be expanded; not implemented |
| Update/replace | Shared hook reached, but P0 deliberately emits no changed events | Not implemented in P0; generated code must retain original recipients and incarnation |
| Job delete | Real `enqueue_job_at` + `run_chunk_at`; done, two log writes, one content delete | Compiler expansion must survive `jobs::chunk_program`; exact admission must apply to named and ad hoc jobs; not wired |
| Schedule delete | Real row timer fired through `Runtime::fire_due_at`; target commits and sends Bob a removed event after departure | Expand the private target; retain target admission/settlement. `schedule … delete .` syntax lowering remains D2 |
| Product seeds / reset | `Runtime::seed` → `registry::seed_program` → certified upserts → hook; seed witnessed. Reset uses `reset_and_execute` and the same Runner (code trace) | `seed_program` is synthesized in Rust after the TS compiler; it needs expansion plus admission too. A TS compiler-only rewrite misses it |
| Raw fixture seed | `Engine::seed` does raw `INSERT OR REPLACE` + reindex; witness produces zero events | Same bypass; must close explicitly for delivered tables |
| Authoritative offline replay | Real `Engine::execute_replay`; committed send writes Alice/Bob events | Expanded IR must be generation-bound and pass the same canonical admission; replay IDs/metadata cannot come from a client-supplied privileged block |
| Receipt-only execution / TS twin | Native server hook explicitly skips receipt-only authority; isolated TS derived slot predicts own event | Current twin refuses private generated writes; server-authority block cannot be interpreted as a client capability |
| Rollback | Enclosing require refusal removes content and events; underpriced certificate also rolls both back | Same SQLite transaction in the successful AOT witness; dedicated AOT rollback/seed/job witnesses are not claimed |

Relevant current sites: `runner_ops.rs:29` insert mode, `:101` upsert, `:167` delete, `:204` shared lifecycle; `engine/mod.rs:340` raw seed; `registry.rs:919` product seed and `:1083` generated seed program; `engine/timers.rs:153` target Runner; `registry_timers.rs:8` firing; `engine/replay.rs:14` authoritative replay. RFC line 165 is stale: it is near replace/delete, not the lifecycle's definition on this base.

## Successors and custody

- **Install empty:** add the generated log as an ordinary durable table, without putting it in `Schema.maintains`; current `successor::plan` naturally sees an added table, and nothing should populate it unless requested. This cannot retroactively invent recipients for existing messages.
- **Bootstrap:** explicit current-member fan-out over existing content, through certified generated work with cap×row-count installation/job pricing. Record that it approximates send-time audiences. Do not call maintain rebuild. P0 does not implement bootstrap.
- **Remove:** preserve ordinary `Drop::Table` plan behavior for the log, including nonempty history after every content body has been deleted. Retarget/prefix changes must force the same destructive custody decision even when table/column shapes happen to remain equal.
- **Audience bound A:** persist independently of current target cap N; lowering A requires actual historical audience evidence. The P0 optional marker is only a fixture encoding, not that admission. Store audience/incarnation metadata where empty audiences and deleted bodies remain distinguishable for id-reuse refusal.
- **Generated-table ownership:** canonical schema shape and insertion authority must be enforced for raw IR and the system principal as well as Quarry; table `insert <- deny` alone does not stop the system principal. No new arbitrary trigger language is needed.

## Twin findings and risks

- `certificate-identity.ts:113` still rejects unknown Table fields. Ordinary engine-owned log columns/rules are representable today; the declaration and ownership metadata must be explicitly canonicalized in Rust field order and hashed. Do not strip unknown metadata to get prediction working.
- `runner.ts` has insert/update/delete calls into `maintain`, and a validated, direct aggregate-write route. A delivery prediction can use that narrow derived-write pattern; it must never scan an incomplete membership set and call it the send-time audience.
- The experiment predicts one Alice event with zero audience receipts; edits and delete produce no predicted delivery events. It monkey-patches a Runner only inside the test file. It is **not** an outbox/cold-restart, rollback-overlay, drain, receipt-ack or byte-qualification implementation.
- AOT's generated NewId consumes the client envelope by audience order/count. Native server event IDs can derive from the source identity/incarnation/recipient/event identity without consuming that envelope. Both still need a stable provisional own-event identity/order reconciled with the server's commit seq; repeated edits in one commit also need a distinct event identity. P0 handles insert/delete only.
- The general declaration does not imply the sender belongs to its target range. D4 must restrict prediction to a proved own membership/covered insertion contract or define that rule explicitly. The chat contract supplies the expected sender-membership guard; blindly generating a sender event for every possible deliver declaration would be false.

## Before / after evidence

Before native hook (new witness against unchanged lifecycle):

```text
native delivered=[]
baseline delivered=[]
assertion `left == right` failed
  left: []
 right: ["alice", "bob"]
test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 149 filtered out; finished in 0.01s
```

Actual copied chat fixture with the proposed declaration, production compiler unchanged:

```text
refused E_QUARRY_SYNTAX at snapback/schema.q:71:11
  message: expected ":", got "to"
  rewrite: -- fix this Quarry declaration and rerun snapback2 check
```

After:

```text
native delivered=["alice", "bob"]
native removed=["alice", "bob"]
AOT delivered=["alice", "bob"] removed=["alice", "bob"]
product seed delivered=2; existing upsert delivered=2; Engine::seed fixture delivered=0
native schedule: Object {"state": String("committed")}
native job: done {"deliveries": 2, "messages": 1}
tampered certificate: E_TRACE_SUBSET: writes to deliveries 2 > 0
native repeated-history guard: E_INPUT: P0: byRow exceeds audience reserve; need delivered-only index
P0 twin identity: ordinary private table accepted; Table.deliver -> E_SCHEMA
P0 twin unchanged runner: messages only; ordinary AOT private log insert -> E_RULE
P0 twin derived slot: 1 own delivered, 0 changed, 0 removed, no audience receipt
P0 twin: 3 experiments passed
```

Ordinary AOT delete refuses `E_STRUCTURAL_FANOUT` and pastes `cap 3 by row`. That rewrite is unsuitable for this durable log: it would forbid its removed/changed rows. Native mixed nonuniform scan refuses the same family and identifies the mandatory messages reserve. No diagnostic was added to the shipped product.

## Explicit deviations / unfinished product work

1. Both Rust spikes are `cfg(test)`. The fixed test schema stands for `messages deliver to memberships[.conversationId] as deliveries`; no parser or public Table field is added. The AOT expander is typed Rust IR code, not a TS compiler integration. This keeps P0 a representation experiment and leaves the shipped template intact.
2. Text-message fixture copies chat's content relationship/retention and author write rule, with cap 3 for visible measurements. Assets, search, complete chat membership rules, receipts, schedules' new syntax, and update events are outside this P0 slice. The AOT fixture has exactly two distinct recipients, literal incarnation/audience/seq values, a fixed message id, and no general deduplication or upsert lowering. Do not promote it as-is.
3. AOT's marker is an experimental privileged block, and admission takes the source separately. There is no production unforgeability proof or generation wiring. The read-proof cap is fixture-local and unsound for arbitrary histories. These limitations are central comparison findings, not silently accepted changes to the RFC.
4. Native's N+1 history guard, optional-column declaration marker, temporary system actor for generated insert, and minimally metered internal reads are scaffolding. D2 must carry real generated-site/index custody, authoritative dependency tracing, proper origin-specific writes, distinct event IDs for repeated changes, full metering and no-id-reuse admission. Rollback/write containment is proven; full production trace/OCC semantics are not.
5. No successor/bootstrap implementation, no production twin identity/prediction, no receipts/SDK protocol. No guide sentence advertises unimplemented syntax: P0 adds no product-visible rule. D3/D6 must teach the new rule atomically with its implementation.
6. D3 cannot delete the tombstones grammar while D6's shipped template still uses it. Move that deletion to the template cutover, or land the necessary D6 changes with D3; no compatibility shim is proposed.
7. RFC §7/acceptance cite 84,000 bytes; current NOT-DOING allocation is 85,000, target 80,000. No budget is raised here. The measured unchanged runtime is 84,580 bytes.

## Verification

Focused command: `cargo test -p snapback2-core --lib delivery_ -- --nocapture`.

```text
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 148 filtered out; finished in 0.09s
```

That is 11 new Rust witnesses plus one existing asset-delivery test selected by the substring. New TS experiment: `bun src/test-delivery-prototype.ts` → `P0 twin: 3 experiments passed`.

Final blocking-suite and measurement results are recorded below after completion.

## Exact D1–D3 edit map under this recommendation

Paths below are relative to `snapback2/`; new code-module names are proposed concrete destinations, not new scripts/configuration/registries. This is the implementation edit map on the inspected base; the integration lane must re-find lines after wave-1 landings.

| Lane | Exact file | Work |
|---|---|---|
| D1 | `crates/snapback2-core/src/schema.rs` | `Table.deliver`, generated ownership, historical A, incarnation/custody schema metadata |
| D1 | `crates/snapback2-core/src/delivery.rs` (new) | Closed descriptor validation and canonical generated log/receipt table definitions; shared identities |
| D1 | `crates/snapback2-core/src/lib.rs` | Register/export the delivery schema module |
| D1 | `crates/snapback2-core/src/registry.rs` | Raw-schema admission and generated-table shape/ownership checks |
| D1 | `crates/snapback2-core/src/engine/mod.rs` | Low-level schema validation; preserve invariant on all engine constructors |
| D1 | `crates/snapback2-core/src/successor.rs` | Empty install, explicit bootstrap dispatch, destructive removal/retarget, audience admission |
| D1 | `crates/snapback2-core/src/successor/delivery.rs` (new) | Bounded custody-specific successor checks and install work, split from the large successor file |
| D1 | `crates/snapback2/src/writer_ledger.rs` | Generated log/receipt metadata in manifest and visible successor records |
| D1/D2 | `crates/snapback2-core/src/certificate.rs` | Generated table/index/write custody; per-source-write fan-out reservations |
| D2 | `crates/snapback2-core/src/certificate/delivery.rs` (new) | Derived read/write/step/heap cost terms and reserve ownership |
| D2 | `crates/snapback2-core/src/certificate_policy.rs` | Direct generated-table write refusal, including system programs |
| D2 | `crates/snapback2-core/src/certificate_policy/fanout.rs` | Generated reservation diagnostics with sourced declaration term |
| D2 | `crates/snapback2-core/src/certificate_policy/fanout_bindings.rs` | Nonuniform-scan protection for every delivered write kind |
| D2 | `crates/snapback2-core/src/engine/runner_ops.rs` | Call derived custody lifecycle after physical content changes |
| D2 | `crates/snapback2-core/src/engine/runner_delivery.rs` (new) | Insert/change/delete events, stable IDs, original-recipient indexed reads, no id reuse |
| D2 | `crates/snapback2-core/src/engine/runner_bounds.rs` | Containment of generated sites and all their work |
| D2 | `crates/snapback2-core/src/engine/mod.rs` | Register hook module and route raw seed of delivered tables through certified writes |
| D2 | `crates/snapback2-core/src/registry.rs` | Reuse/export certified seed-program construction for that raw-seed closure |
| D2 | `crates/snapback2-core/src/timers.rs` | Confirm/price target's derived work plus settlement per firing |
| D2/D3 | `packages/compiler/src/quarry/ast.ts` | Delivery declaration and inline schedule-delete AST |
| D3 | `packages/compiler/src/quarry/parser.ts` | Delivery syntax; inline schedule delete (split new parser code if near cap) |
| D3 | `packages/compiler/src/quarry/catalog.ts` | Generated row-table namespace entries and collision/principal resolution |
| D3 | `packages/compiler/src/quarry/bound-schema.ts` | Typed descriptor and exact generated schema shapes |
| D3 | `packages/compiler/src/quarry/bound-project.ts` | Private generated operation/API ownership |
| D3 | `packages/compiler/src/quarry/schedule.ts` | Lower inline delete to private mutation and existing schedule target/binding |
| D3 | `packages/compiler/src/ir.ts` | Typed raw-schema delivery and ownership metadata |
| D3 | `packages/compiler/src/diagnostics.ts` | Deliver-specific family/site/guide routing |
| D3 | `packages/snapback2/guide/families.source.json` | Executable diagnostic rewrites using existing families |
| D3 | `packages/snapback2/guide/offline.md` | Custody declaration, sender prediction limit, historical removal |
| D3 | `packages/snapback2/guide/quarry.md` | New schema/write surface pointer within budget |
| D3 | `packages/snapback2/guide/grammar.md` | New spelling within budget |
| D3 | `crates/snapback2/src/guide.rs` | Keyword/definition routing for the added constructs |
| D3 cutover with D6 | `packages/compiler/src/tombstone-checks.ts` | Replace old grammar witnesses when the template is converted |
| D1–D3 | `crates/snapback2-core/tests/delivery.rs` (new) | Production ownership/path/successor/rollback/identity witnesses |
| D1–D3 | `crates/snapback2-core/tests/successor.rs` | Custody install/remove/retarget/bootstrap/audience checks |
| D2 | `crates/snapback2-core/tests/timers.rs` | Inline delete settlement and rollback witnesses |
| D2 | `crates/snapback2-core/tests/jobs.rs` | Per-chunk historical fan-out and rollback |
| D3 | `packages/compiler/src/delivery-checks.ts` (new) | Parser/binder/raw-schema refusals and guide rewrite execution |
| D3 | `packages/compiler/src/test.ts` | Register replacement compiler witnesses in the existing check |
| D1–D3 | `crates/snapback2-core/src/bin/export_corpus/delivery_cases.rs` (new) | Shared engine/twin/certificate cases |
| D1–D3 | `crates/snapback2-core/src/bin/export_corpus.rs` | Register cases in existing exporter |
| D1–D3 | `crates/snapback2-core/tests/spike.rs` | Pin changed corpus count |
| D1–D3 | `corpus/manifest.json`, `corpus/deliver-insert-audience.json`, `corpus/deliver-delete-original-recipients.json`, `corpus/deliver-self-prediction.json`, `corpus/deliver-mixed-nonuniform-refused.json`, `corpus/deliver-id-reuse-refused.json` | Concrete proposed case leaves from the existing exporter |

`engine/jobs.rs`, `engine/timers.rs`, `engine/replay.rs`, `registry_jobs.rs`, `registry_timers.rs`, and owner `writer_replay.rs` / `writer_resume.rs` should inherit native source writes, not gain independent fan-out implementations. Revalidate their certificates/tests. `packages/evaluator/src/certificate-identity.ts` and `runner.ts` are D4 dependencies; they must follow D1 promptly before clients can consume a schema carrying deliver.

Adding a Rust Table field also requires mechanical constructor defaults in the following exact existing files (identified by `rg -l '\bTable\s*\{' snapback2/crates`; the first group above owns behavioral changes). Keep these in D1, not as hidden compiler fallout:

- `crates/snapback2-core/src/bin/export_corpus.rs`
- `crates/snapback2-core/src/bin/export_corpus/assets.rs`
- `crates/snapback2-core/src/bin/export_corpus/constraints.rs`
- `crates/snapback2-core/src/bin/export_corpus/enriched_pages.rs`
- `crates/snapback2-core/src/bin/export_corpus/merge_cases.rs`
- `crates/snapback2-core/src/bin/export_corpus/twin_cases.rs`
- `crates/snapback2-core/src/bin/export_corpus/write_cases.rs`
- `crates/snapback2-core/src/connected.rs`
- `crates/snapback2-core/src/programs.rs`
- `crates/snapback2-core/src/registry.rs`
- `crates/snapback2-core/src/rule_types.rs`
- `crates/snapback2-core/src/schema.rs`
- `crates/snapback2-core/src/successor.rs`
- `crates/snapback2-core/tests/assets.rs`
- `crates/snapback2-core/tests/completeness.rs`
- `crates/snapback2-core/tests/corpus_cursors.rs`
- `crates/snapback2-core/tests/live.rs`
- `crates/snapback2-core/tests/money_maintains.rs`
- `crates/snapback2-core/tests/offline_goldens.rs`
- `crates/snapback2-core/tests/operator.rs`
- `crates/snapback2-core/tests/outbox/lifecycle.rs`
- `crates/snapback2-core/tests/rbac_cases/adversarial.rs`
- `crates/snapback2-core/tests/rbac_cases/certificate_branch_writes.rs`
- `crates/snapback2-core/tests/rbac_cases/schema_maintains.rs`
- `crates/snapback2-core/tests/rbac_cases/tier0_authorization.rs`
- `crates/snapback2-core/tests/spike.rs`
- `crates/snapback2-core/tests/successor.rs`
- `crates/snapback2-core/tests/successor_maintains.rs`
- `crates/snapback2-core/tests/timers.rs`
- `crates/snapback2-core/tests/verified_regressions.rs`
- `crates/snapback2/src/check.rs`
- `crates/snapback2/src/rehearsal_tests.rs`
- `crates/snapback2/src/test_authority_tests.rs`
- `crates/snapback2/src/writer_assets.rs`

The tombstones word inventory and `rules/NOT-DOING.md` move belong to the D3/D6 atomic cutover; the exact planned LLP edits are `llp/1011-quarry-ergonomics.rfc.md` and `llp/1012-local-first-v1.spec.md`, and the existing `llp/1019-derived-delivery-custody.rfc.md` implementation record. No new design doc is proposed.

## Files changed by P0 / scope notes

The source files are exactly those in the measured-lines table. `runner_bounds.rs` is a mechanical extraction of `count_range_is_proved` and `assert_bounds`, preserving their @refs; the base `runner_ops.rs` was already 1,508 physical newline-counted lines. No new check, script, configuration, registry, corpus case, or user-visible grammar is introduced.

Outside the named prototype source areas: this report; one implementation-record line in LLP 1019; `snapback2/metrics/twin.jsonl` receives the existing measurement tool's runtime-byte record. Full measurement may also append `snapback2/metrics/loop.jsonl`; its final status is recorded below. The generated package `dist/`, build outputs and `/tmp/p0-*` evidence are ignored or temporary.
