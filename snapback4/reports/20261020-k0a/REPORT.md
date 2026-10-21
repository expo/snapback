# K0a — reference committer seam

Base: `ce6c0d87daf0f8ac6ca136e46cb19932fcee6daa`. Lane: `sb4-pg/k0a`.

The crate-private seam lives in `crates/snapback4-core/src/engine/committer.rs`.
`Member::new(Kind, body)` supplies an in-place body to `Committer::run`.
The member-scoped committer opens the original store transaction (`open`),
or invokes activation's original raw SQLite opener (`open_with`). The body
calls `commit` at the original boundary. This preserves explicit rollback
errors, implicit drop on early normal returns, savepoints, receipt/refusal
handling and statement order. `after_commit` executes a submitted hook
synchronously; `Committed<T>` carries that right across adapter/engine
layers. No queue, batching, threads, retries or persisted revisions are added.

## Producer routing

All paths below use `Committer::run(Member::new(...))`. The table distinguishes
producer families from transaction-open sites; the RFC's inventory includes
nested work, and seed deletion adds another actual producer.

| Producer | Member kind and route |
| --- | --- |
| `Engine::mutate` | Program; `engine/mod.rs`; the time-audience prelude stays before the member, and replay/drop/rollback branches stay distinct |
| Expire | Engine; `sweep_expired_for` in `engine/mod.rs` |
| Seed | Administrative; `seed_at` → existing `seed_rows` |
| Trusted seed deletion | Administrative; `seed_delete_at` |
| Load | Administrative; `load_mode` / streaming `load_stored_rows` |
| Restore | Administrative; `load_stored_rows`, including the live-bulk branch |
| `seed_sequences` | Existing seed savepoint inside the seed/reset member; no new transaction or member is introduced |
| Job chunks | Engine; `run_job_chunk_for`; native helper receives the same member committer and commits its original transaction |
| Time-audience publication | Publication; `publish_time_audience`, including clock-only and stale-opening outcomes |
| Timeline delivery | Engine; one member per existing `timeline_chunk` attempt, including refusal parking |
| Row views | Engine; `run_view_chunk_for`, retaining private and published branches |
| Expiry orphans | Engine; `repair_expiry_orphan` |
| Activation rebuild | Administrative; `store/activation.rs::activate_transaction_with` invokes the original immediate raw opener through `open_with`; `engine/activation.rs` remains its builder |
| Development reset | Administrative; `store/dev_reset.rs::dev_reset`, called by `Engine::dev_reset_at` |
| Following launch | The same administrative activation member; `store/timeline_launch.rs::build` remains inside it |
| Host smoke witness | Engine; host `verbs/witness/smoke.rs` → `Store::record_witness_barrier` in `store/tooling.rs`; clock sampling stays between sequence allocation and recording |

The private `pin_time_audience` writer also uses a Direct member. Postgres
`engine/postgres/*::mutate_once` remains on its existing path, unchanged.
No host metadata source was edited.

## Post-commit hooks

Hooks preserve their previous position and order:

- Expiry continuation update, then the follow-on bounded audience advancement.
- Job status reads after success/parking/native completion.
- Timeline scheduler rotation after successful delivery or refusal parking.
- Activation commit timing, adoption report, runtime catalog/identity and
  accepted-open state; then retained/restored narration and dormant inventory.
- Engine adoption/release state, expiry continuation clearing and ephemeral rebind.
- Reset expiry continuation clearing, timeline scheduler reset and ephemeral rebind.

Host wakeups remain at the existing caller boundaries after engine results.
There was no host wakeup immediately after a moved `commit()` call; the smoke
barrier also has none. Assets selected by reset are still unlinked by its
caller. The K0 queue/publication-member follow-on is not claimed here.

## Census and K0b worklist

The new census counts production source lines outside `store.rs`, `store/`,
`engine/postgres/` and `engine/committer.rs`, using the shared Rust lexer.
Before: **62 sites / 15 files** at the base. After: **49 sites / 11 files**.
Twelve external sequence-producer opener lines plus the private clock pin
leave the census. Three more sequenced opener sites were already inside
excluded adapters (activation/Following, reset, smoke). The seed allocation
preview is a nested savepoint, not another opener.

The new allowlist has no raise override. `SNAPBACK4_RATCHET_UPDATE=1` only
lowers/deletes entries. The existing store-port allowlist falls from 11 to 7
production lines (its base already has 7 actual matches; four stale allowances
are removed); tests stay at 95. The lexer is extracted without changing its
matching behavior.

Remaining sites, grouped by kind:

| Kind | File and entry points | Sites |
| --- | --- | ---: |
| Direct: identity/session writes | `identity.rs`: `logout_session`, `bound_custom_session`; `identity/read_sessions.rs`: `narrow_session` | 3 |
| Direct: action lifecycle | `engine/actions.rs`: `request_action`, `claim_selected_actions`, `settle_action`, `cancel_action`, `action_status`, `requeue_expired_actions`, `requeue_expired_actions_for` | 7 |
| Direct: route admission | `engine/routes.rs`: `admit_route` | 1 |
| Direct: effect authority, claims, settlement, lease renewal, presence, maintenance | `engine/effects.rs`: `authorize_effect_poll_strict`, `claim_effects_inner`, `claim_effects_strict`, `presence_reconnected`, `settle_effect_inner`, `settle_effect_strict`, `effect_status_strict`, `advance_worker_leases_at`, `requeue_expired_effects`, `requeue_expired_effects_for`, `cancel_effect` | 11 |
| Direct: action/effect steps | `engine/actions/steps.rs`: begin/complete/park action step; `engine/effect_steps.rs`: begin/complete/park effect step strict | 6 |
| Direct: upload/intents, receipt-only reports, views and sweeps | `engine/asset_uploads.rs`: `finish_asset`, `declare_asset_intent`, `asset_declaration`, `asset_intent`, `pending_asset_intents`, `finish_asset_intent`, `cancel_asset_intent`, `asset_access_request`, `record_asset_view`, `prepare_asset_sweep_for`, `finish_asset_sweep_slice` | 11 |
| Direct: job and schedule admission | `engine/job.rs`: `enqueue_job`, `fire_schedule_range` | 2 |
| Administrative: development replay schedule metadata | host `dev_replay.rs::schedules` (left for the concurrent host metadata lane) | 1 |
| Administrative: opening/upgrade candidate | `engine/mod.rs::open_selected_at` → `opening_transaction`; can open a writer, but can also read a read-only store | 1 |
| Conservative snapshot candidates | `identity.rs`: `resolve_supervised`, `current_service`, `resolve_digest`; `engine/actions.rs`: `action_request_at`, `replay_action`; `engine/routes.rs`: `route_service_generation`. These six authority snapshots roll back and make no writes today. | 6 |

The exclusion is structural, not proof that all adapters have entered the
stream. Adapter-internal composite identity mints/rotations/invalidation,
release writes and maintenance transactions still need K0b review, alongside
the listed callers. Comments/literals, test-only files and inline test modules
are excluded; aliases, macro-generated APIs and SQL assembled as strings can
escape this lexical census.

## Validation

All Cargo runs used the requested worktree target directory, disabled
incremental compilation, line-table debug information for dev/test, and `-j 32`.
No `SNAPBACK4_RATCHET_ALLOW_RAISE` override was used.

- `cargo build -p snapback4`: passed, including the final source.
- `cargo test -p snapback4-core`: passed completely, including integration
  tests and doctests. The unit target passed 459 tests with three ignored.
- `cargo test -p snapback4 --no-fail-fast`: ran all targets, including both
  censuses. Three tests fail for inherited missing JavaScript prerequisites:
  `check::w11r1c_toolchain_why_explains_node_start_failure_too` and
  `check::farm2_typescript_7_is_refused_by_version_not_crashed_on` report the
  absent TypeScript installation; `witness_web::web_witness_help_and_invalid_input`
  cannot import the absent `packages/snapback4/dist/client.js` before validating
  the invalid timeout. Both complete failing targets were rerun in a second
  local worktree at `ce6c0d87da`; all three failures reproduce there. Every
  other host target passed.
- `cargo clippy -p snapback4-core -p snapback4 --tests`: retains the two
  base-reproduced errors, `clippy::while_immutable_condition` in
  `engine/read.rs:780` and `clippy::never_loop` in `engine/row_views.rs`
  (base line 1010, final line 1013). Comparing warning message/source-file
  signatures and multiplicities with the base finds **no new warnings**.
- Final focused checks passed: two reference seam tests (including adapter/
  engine hook order, body/open/commit errors and uncommitted returns), five
  Quarry/native job time-audience tests, and all eight tests in the two
  census targets. Final counts remain 49 production committer sites, seven
  production store-port sites and 95 test store-port sites.
- `./ref-check --verbose` passed with no errors or unchecked references.
  A literal-sequence comparison of the edited pre-existing production files
  finds all existing SQL and error strings unchanged; only three `sqlite`
  configuration literals are added there.

The baseline worktree was removed after comparison; no repository was cloned.
`scripts/test.sh` was not run. Nothing was pushed. The remaining uncertainty
is the documented lexical census boundary (especially adapter-internal
transactions), not a claim that K0's queued stream or batching has landed.
