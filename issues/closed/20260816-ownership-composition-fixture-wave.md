# Ownership-composition enforcement left ~207 lib tests red repo-wide

**Filed:** 2026-08-16 · **Status:** Resolved · **Systems:** Auth, Storage,
Testing

**Related:** the LLP 0264 Phase 1a owner-write landing (`4fe648fd0`, per the
burn-down coordinator's attribution — wave owner gets first refusal on this
burn-down); issues/20260815-finish-media-happy-path.md (whose 11 media tests
were the first adapted slice, landed `d4fbc1604`).

## Verified counts (media-happy worktree, RUST_MIN_STACK=16777216)

- `cecff14e4` (main tip pre-media-push, post-enforcement): media filter
  already 30 passed / 10 FAILED — the enforcement landing broke tests on
  main before any media-program push.
- `9971c640c` (main tip pre-adaptation): full lib **2588 passed / 218
  failed**.
- With the media adaptation (`d4fbc1604`): full lib **2599 passed / 207
  failed** — exactly the 11 media tests healed; the remaining 207 are
  enforcement-wave fixture debt in unrelated suites.

## Failure classes observed

1. `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE` — owner-policy Patch/Delete
   fixtures lacking sealed `owner_write_checks`.
2. `SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE` — fixtures that patch an owner
   field as a scenario vehicle (now forbidden by design).
3. `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED` — fixtures writing tables with
   implicit/undeclared visibility. Representative deterministic repro:
   `cargo test --lib storage::tests::stored_enum_tests::optional_enum_field_addition_admits_on_a_nonempty_table`
   (refuses its pre-existing undeclared `items` fixture when run alone).

## Adaptation pattern that worked (from the landed media slice)

Sealed checks: `owner_write_checks: vec![OwnerWriteCheckV1 { step_index,
absent }]` on the fixture `MutationPlan` (in-file precedent
`src/storage/tests.rs` `checked_patch`). Owner-transfer scenario vehicles:
re-express through grant replacement, content-based OCC staleness, or
sealed parent deletion — adaptation may change fixtures and vehicles, never
an assertion's meaning (see `d4fbc1604` for six worked examples across
storage and served-HTTP tests).

## Wanted

The wave owner (or a commissioned burn-down lane) sweeps the remaining ~207
using the classes and pattern above, suite by suite, rather than letting
the drift backstop file per-signature tickets. Counts above are the
baseline for measuring the sweep.

## Scope note (2026-08-16, post-filing)

The wave is not test-fixture-only: AUTHORED demo handlers that insert
owner-policy rows with an explicit owner field now refuse at runtime with
`SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED` (owner fields are host-stamped).
`demos/media-happy-post` hit this live and was adapted (drop the authored
ownerId from inserts); other demos with the same authored pattern will hit
it on their next boot — relevant to any demo boot sweep.

## Scope note 2 (2026-08-16, per snapback-ca)

issues/20260815-codegen-pretest-media-ref-capability-unsupported's remaining
pretest reds are exact-base visibility diagnostics from the same
ownership/visibility waves (the capability itself is declared at base), so
that ticket's remainder folds into this sweep's scope.

## Resolution (2026-08-16)

Adapted the remaining lib-test fixtures to the enforced owner-write contract.
PublicRead remains only for principal-free synthetic tables whose tested
behavior is unrelated to write enforcement and whose honest policy is
public-by-design. Principal-bearing and owner-scoped tables use Principal
owner fields, host-stamped inserts, and sealed owner checks; authority tables
are populated through their specialized catalog paths. No enforcement code
was weakened.

The exact exit gate completed with zero wave-attributable reds:

`test result: FAILED. 2811 passed; 5 failed; 2 ignored; 0 measured; 0 filtered out; finished in 67.92s`

The five remaining failures are inherited or demonstrably predate `4fe648fd0`:

- `server::tests::managed_host_plan_action_route_inventory_uses_reserved_step_executor`
- `server::tests::rehearsal_host_op_future_sizes_stay_heap_bounded`
- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`
- `server::tests::served_http_refusals_project_typed_candidates_and_argument_contracts`
- `store_state::tests::registry_and_startup_managed_database_paths_cannot_silently_diverge`

The first, second, and fifth assertions predate the enforcement landing; the
third and fourth are named inherited pins in the wave brief. The issuance-bearing
bench test is not in this set: its `resident_kb_before > 0.0` process-accounting
assertion flakes inside managed sandboxes but passes outside them. The exact
baseline, 49-site disposition, set-diff evidence, and verification commands
are recorded in the root `the disposition table below (previously the lane report)` produced by this lane.

## Exhaustive 49-site disposition

Method: enumerate every `None -> PublicRead` addition in commit `2e26010cf`
from its zero-context diff, then inspect the complete containing fixture and
all of its consumers. `PublicRead` is retained only when both conditions hold:

1. the behavior under test is unrelated to owner-write enforcement; and
2. the table is principal-free synthetic data whose honest table policy is
   public-by-design.

`Split` means one original closure/helper site produced more than one honest
table class; its principal-bearing class is now owner-enforced and only the
separately named principal-free control remains public.

| # | Original adaptation site | Fixture table(s) | Disposition and evidence |
|---:|---|---|---|
| 1 | `src/bench_fixture.rs:70` | `todos` | **PublicRead retained.** Production-compiled synthetic benchmark rows contain only title/done payload; the tests measure runtime cost, not write authorization. |
| 2 | `src/bench_fixture.rs:86` | `others` | **PublicRead retained.** Principal-free synthetic disjoint-table benchmark control; no owner or write-enforcement behavior is under test. |
| 3 | `src/instance_fork.rs:5610` | `items` | **PublicRead retained.** Principal-free fork/reopen payload used to test instance isolation, not write authorization. |
| 4 | `src/local/authorization_acceptance.rs:193` | helper for `docs`, `folders`, permission tables, `notes` | **Split.** `docs` and `folders` now use `Owner(rowOwner)` with Principal fields and host-stamped inserts. Permission-backing tables keep their specialized undeclared posture. Only the principal-free disjoint `notes` control remains PublicRead. Cross-owner acceptance reads are explicit, ceiling-declared elevated reads, so read semantics are preserved without bypassing generic-write enforcement. |
| 5 | `src/local/tests.rs:2167` | `todos` | **PublicRead retained.** Principal-free synthetic mixed-bundle snapshot rows; the test concerns bundle/live child registration, not write authorization. |
| 6 | `src/local/tests.rs:3279` | `events`, `audit` closure | **PublicRead retained.** Principal-free synthetic search/live invalidation corpus; the tested axis is disjoint-table rerun behavior. |
| 7 | `src/local/tests.rs:5584` | asset parent closure (`posts`, `drafts`, `owned`) plus `workspaces`, `workspace_files` | **Owner.** Asset-sharing principals and membership/resource relationships make public table policy dishonest. Every ordinary parent table now has `Owner(rowOwner)` with a Principal field; generic inserts are host-stamped. Asset-sharing policy remains independently tested. |
| 8 | `src/local/tests.rs:6313` | `callback_log` | **Owner(rowOwner).** The fixture proves that lifecycle writes run as the asset-callback service principal, so public migration-window writes would evade the authority being tested. The handler omits rowOwner; the host stamps the service principal into the Principal field. |
| 9 | `src/local/tests.rs:9077` | `profiles` | **PublicRead retained.** Principal-free profile OCC payload; tested behavior is content staleness, not principal enforcement. |
| 10 | `src/local/tests.rs:11617` | `items` | **PublicRead retained.** Principal-free sessions-activation carrier; it tests activation identity and catalog state rather than table-write authorization. |
| 11 | `src/local/tests.rs:14710` | relational-query `books` | **Owner(ownerId).** Rows are explicitly owner-scoped; ownerId is Principal and inserts are host-stamped. The relational plan carries the exact owner policy. |
| 12 | `src/local/tests.rs:14735` | relational-query `authors` | **Owner(ownerId).** This variant intentionally exercises owner composition on both root and join; Principal owner fields and exact plan visibility now enforce it. |
| 13 | `src/local/tests.rs:15257` | relational-lanes `books` | **Owner(ownerId).** Principal-bearing root rows adopt owner policy and exact plan composition; generic inserts are host-stamped. |
| 14 | `src/local/tests.rs:15282` | relational-lanes `authors` | **PublicRead retained.** Authors are now a genuinely principal-free shared synthetic lookup table; the spurious owner field was removed and no write-authorization behavior is tested. |
| 15 | `src/local/tests.rs:15437` | relational-live `books` | **Owner(ownerId).** Live root rows are principal-scoped; the plan carries owner visibility and addBook receives ownerId from the host. |
| 16 | `src/local/tests.rs:15462` | relational-live `authors` | **PublicRead retained.** Shared principal-free synthetic author lookup; tests concern relational replacement/proof behavior, not owner writes. |
| 17 | `src/local/tests.rs:15823` | bounded-children table closure | **Split.** Primary `parents` and `children` use Principal owner fields, exact owner plan policies, child half host-stamped; parent half specialized seed, no generic write path, and sealed Patch/Delete checks. Separately named `publicParents`/`publicChildren` are principal-free synthetic controls used only to prove the public cursor partition. |
| 18 | `src/local/tests.rs:19266` | maintained-projection table closure | **Split.** `books` and owner-carrying `bookSummaries` use exact owner policy; addBook is host-stamped and maintained output derives the root owner. `authors` is a principal-free shared lookup and remains PublicRead. |
| 19 | `src/local/tests.rs:19570` | `structuredRows` | **PublicRead retained.** Principal-free structured-value read-your-writes corpus; tested behavior is value preservation. |
| 20 | `src/local/tests.rs:20794` | membership keyset `rooms`, `messages` closure | **PublicRead retained.** The underlying seeded payload is principal-free synthetic data and intentionally public at the table layer; the functions add a separately tested membership predicate. No generic-write authorization behavior is exercised. |
| 21 | `src/local/tests.rs:22718` | reload `items` | **PublicRead retained.** Principal-free schema-reload carrier; tested behavior is generation/schema replacement. |
| 22 | `src/local/tests.rs:22739` | reload `new_items` | **PublicRead retained.** Principal-free successor-only reload carrier; no owner/write-policy behavior. |
| 23 | `src/local/tests.rs:23797` | lane-settlement `items` | **PublicRead retained.** Principal-free settlement/token payload; tested behavior is lane settlement. |
| 24 | `src/local/tests.rs:24875` | `expenses` | **PublicRead retained.** Principal-free argument-contract payload; the test concerns nested validation and atomic refusal. |
| 25 | `src/local/tests.rs:25524` | live-limit `items` | **PublicRead retained.** Principal-free limit/fanout corpus; tested behavior is live scheduling and bounds. |
| 26 | `src/local/tests.rs:27314` | retainable-sessions `items` | **Owner(owner).** The fixture is explicitly per-principal; owner is Principal, plans carry the owner policy, and inserts are host-stamped. |
| 27 | `src/local/tests.rs:27352` | retainable-sessions `books` | **Owner(ownerId).** Principal-bearing relational root adopts exact owner policy and retained queries only; no rows inserted, no generic write path. |
| 28 | `src/local/tests.rs:27389` | retainable-sessions `authors` | **PublicRead retained.** Principal-free shared synthetic author lookup; retention/relational behavior is under test, not owner writes. |
| 29 | `src/local/tests.rs:30324` | RQS `todos` | **PublicRead retained.** Principal-free query-cache corpus; tested behavior is result-set caching/invalidation. |
| 30 | `src/local/tests.rs:33033` | managed-branch `records` | **Owner(ownerId).** The admin/non-admin scenario is principal-sensitive. ownerId is Principal, inserts are host-stamped, and Patch uses the central sealed owner check while retaining its declared refusal. |
| 31 | `src/proof_checkpoint.rs:3461` | `items` | **PublicRead retained.** Principal-free checkpoint/history payload; tested behavior is checkpoint proof and recovery. |
| 32 | `src/replication.rs:2544` | `replication_rows` | **PublicRead retained.** Principal-free synthetic replication stream; sustained-write/restore frontier behavior, not write authorization, is measured. |
| 33 | `src/search/sqlite.rs:3832` | `incidents` | **PublicRead retained.** Principal-free search storage corpus; tested behavior is real-field encoding/search. |
| 34 | `src/server/tests.rs:2064` | auth-projection HTTP `items` | **PublicRead retained.** Principal-free response carrier; the test concerns handler authority projection, not owner writes. |
| 35 | `src/server/tests.rs:3591` | sessions-activation `items` | **PublicRead retained.** Principal-free activation carrier; session catalog/admission is the tested authorization surface. |
| 36 | `src/server/tests.rs:15747` | generation-bound `tableA`, `tableB` closure | **PublicRead retained.** Principal-free conformance payload; the test detects declaration/observation binding across generations, not write ownership. |
| 37 | `src/server/tests.rs:24600` | jobs `events` | **PublicRead retained.** Principal-free job-event test data; tested behavior is jobs routing/lifecycle. |
| 38 | `src/server/tests.rs:24888` | enqueue `events` | **PublicRead retained.** Principal-free enqueue/argument-contract corpus; no owner enforcement behavior. |
| 39 | `src/server/tests.rs:25168` | managed-host-action `items` | **PublicRead retained.** Principal-free retry/envelope carrier; the test concerns child-envelope reuse. |
| 40 | `src/storage/tests.rs:735` | stored-enum `items` | **PublicRead retained.** Principal-free schema-evolution corpus; enum admission is tested. |
| 41 | `src/storage/tests.rs:1350` | stored-structured-value `items` | **PublicRead retained.** Principal-free type/round-trip corpus; no write authorization. |
| 42 | `src/storage/tests.rs:2029` | migration scan `scanned` | **PublicRead retained.** Seed-only principal-free migration keyset corpus; scan/checkpoint semantics are tested. |
| 43 | `src/storage/tests.rs:2473` | guarded-commit `items` | **PublicRead retained.** Principal-free storage-engine corpus; schema validation, atomicity, uniqueness, and crash cuts are tested, not owner authorization. |
| 44 | `src/storage/tests.rs:2535` | `typed_items` | **PublicRead retained.** Seed-only principal-free typed-decoding corpus; corruption decoding is tested. |
| 45 | `src/storage/tests.rs:3085` | relation `parents` | **Owner(owner).** Sequence scope access is explicitly ExistingOwner; owner is Principal and buffered generic inserts are host-stamped. |
| 46 | `src/storage/tests.rs:3136` | relation `children` | **Owner(rowOwner).** Public was inadmissible because owner-guarded sequence and write-with-activity behavior writes this table. rowOwner is Principal; host-plan/buffered inserts are host-stamped, and Patch/Delete paths are authenticated and sealed. |
| 47 | `src/storage/tests.rs:3195` | relation `activity` | **Owner(rowOwner).** Activity rows carry effective-actor provenance and are emitted with a host-derived Principal owner; generic inserts are host-stamped. |
| 48 | `src/storage/tests.rs:6144` | storage relational `books` | **Owner(ownerId).** Principal-bearing root rows use exact owner policy and host-stamped writes. |
| 49 | `src/storage/tests.rs:6172` | storage relational `authors` | **Owner(ownerId).** This storage variant intentionally composes ownership on both relation arms; Principal field and exact plan policy enforce it. |

The 49 rows above are the complete original addition set: 2 + 1 + 1 + 26 +
1 replication JSON site + 1 + 1 + 6 + 10 = 49.

## Production-compiled bench fixture

`src/lib.rs` exposes `pub mod bench_fixture`, so its two sites were treated as
production-compiled rather than test-only. `todos` and `others` are honestly
public-by-design: neither schema has a principal field, neither handler reads
authority, and the corpus is synthetic benchmark data.

The measured behavior is semantically unchanged. The fix round added no bench
field, owner predicate, authorization input, owner check, handler step, row,
fanout edge, or timing boundary. The benchmark still executes the same query,
insert/update, disjoint-table, fanout, and idle measurements over the same row
shapes. Focused verification passed:

```text
test bench::tests::benchmark_function_profiles_match_the_measurement_contract ... ok
test bench::tests::m1_bench_smoke ... ok
```

