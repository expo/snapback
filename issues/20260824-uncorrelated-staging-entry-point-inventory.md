# Uncorrelated staging entry-point inventory

Status: Complete static inventory at `96b3f49ea`; analysis only
Date: 2026-08-24
Systems: snapback-sync, snapback-engine, snapback-kernel, snapback-services,
  snapback-server
Related: issues/20260823-mandatory-authority-correlation-design.md,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md,
  issues/20260823-origin-bound-commit-capsule-design.md, LLP 0058, LLP 0059,
  LLP 0290, LLP 0293, LLP 0298

## Result

The staging hole is not confined to watch management. Production has four
reusable shapes that let authority B create an intent, pending value, plan, or
ticket and let a reservation/guard selected from authority A perform a later
durable cut:

1. recorded and detached mutations;
2. watch management through the open `PendingCommit` seam;
3. asset attempt/read/publication phase tickets; and
4. stream-attempt dirty state, whose authenticated persistence batch currently
   commits with a no-op final callback.

The two `commit_guard_classified` calls in `commit_capsule.rs` are **not**
uncorrelated guard calls. `CommitCapsuleReservation` stores the subject and the
reservation minted from that subject. They are the carrier prior art. The open
hole beside them is that `FinalCommitCut::commit` accepts an independently
created `PendingCommit`; in particular, `LocalSnapback::stage_watch_management`
can create B's pending transaction and `WatchManagementPending::commit` will
accept A's database-bound `CommitCapsuleAuthority`.

This inventory also corrects the population model used by the design issue.
The 99 kernel matches are forwarding signatures with generic bounds, not 99
guard acquisitions. They converge on the eight actual `before_commit()`
invocations listed below. The current production population is approximately
45 `commit_guard`/`commit_guard_classified` calls in `engine.rs`, eight raw
`AdmissionEffectGuard` engine paths, the server nested-action guard at
`server.rs:932`, and those eight kernel cuts. `let _ = effect` in the raw paths
does not drop anything: `effect` is a borrowed reference, so the caller's RAII
guard remains live. Those paths retain admission protection; they lack subject
correlation.

The corrected feasibility buckets remain A=40 in scope, B=90 threadable, C=23
genuinely unscoped, D=0. They are migration-planning counts, not entry-point
counts, and are therefore not used as a checksum for this inventory.

## Scope and reading rules

I treated a function as an entry point when its body owns one of the following
semantic cuts: it constructs/stages durable intent, returns or mutates a pending
value/plan/ticket, performs a direct durable write, or consumes such a value at
a later durable cut. This includes private helpers reachable from a production
public or `pub(crate)` wrapper. A function that only parses HTTP, acquires the
`LocalSnapback` mutex, and delegates unchanged is a reachability edge rather
than a second sink; the production roots are recorded after the tables. Without
that semantic boundary, every router, executor, and generic task wrapper would
be a duplicate row for the same cut.

The search boundary was production Rust under `crates/`. I excluded `#[cfg(test)]`,
`test-support`, compile-fail examples, acceptance fixtures, generated output,
JavaScript/TypeScript clients, and `vendor/`. I included filesystem/object-store
writes and durable trigger/receipt state, following LLP 0298 rather than looking
only for SQLite names. Pure reads, authority preparation/validation, ephemeral
socket state, and value projections from `ResolvedAppAuthority` are near-misses,
not rows.

The tables use these body-derived validation abbreviations:

- **SAME**: the body validates source/principal/policy as applicable and obtains
  its commit guard from the exact authority parameter or embedded invocation it
  uses for the write. A caller cannot substitute a foreign guard.
- **SPLIT**: subject validation and the supplied
  `AuthorizedEffectReservation`/`BeforeCommit` are independent; no body
  comparison joins them.
- **RAW**: the body receives only `&AdmissionEffectGuard`; its lifetime spans
  the write, but it carries no subject value the sink can compare.
- **TICKET**: opaque row/object continuity, digest, binding, lease, or HMAC facts
  are checked, but no subject-authority origin is retained or compared.
- **CAPSULE**: the subject and reservation are privately minted/stored together
  in `CommitCapsuleReservation`.
- **TERMINAL**: token IDs/disposition and a process terminal gate are checked,
  but the plan contains no subject origin and the effect guard remains a
  separate control-flow value.

“B + A” always means a value staged/constructed from authority B and a guard,
reservation, capsule, or terminal gate derived from a distinct authority A.
Where the body makes that composition impossible, the structural reason is
stated. No `KEEP` rests on failure to find a call sequence.

## 0. The open reservation and raw-guard factories

These factories are themselves entry points: their result is the separately
movable half later accepted by the sinks below.

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `crates/snapback-sync/src/auth/invocation.rs:2194` | `pub fn reserve_authorized_effect(&self, effect: &'static str) -> SnapbackResult<AuthorizedEffectReservation>` on `PreparedAuthority`; public; issues a pending reservation | Validates A admission/rehearsal/publication/service authority and stores A. It receives no subject intent. | The returned A-reservation is freely passable beside any B-subject SPLIT sink. | **MOVE** |
| `crates/snapback-sync/src/auth/invocation.rs:2202` | `pub fn reserve_authorized_effect_classified(&self, effect: &'static str) -> Result<AuthorizedEffectReservation, AuthorizedEffectReservationError>`; public; classified reservation leaf | Same A-only validation and storage. | Same A-reservation + B-subject composition. | **MOVE** |
| `crates/snapback-sync/src/auth/invocation.rs:1655` | `pub fn commit_guard(&self, effect: &'static str) -> SnapbackResult<AuthorizedEffectCommitGuard<'_>>` on `AuthorizedEffectReservation`; public; issues final guard | Validates only the A retained in the reservation. | The guard can commit B's independently staged transaction. Survivor: the carrier's correlated consuming final cut. | **DELETE** |
| `crates/snapback-sync/src/auth/invocation.rs:1663` | `pub fn commit_guard_classified(&self, effect: &'static str) -> Result<AuthorizedEffectCommitGuard<'_>, AuthorizedEffectReservationError>`; public; classified guard leaf | Retains A's service/publication/rehearsal state and acquires A's admission guard; no B input exists. | Same foreign pairing. The server call at `server.rs:932` and the engine calls all reach this leaf. | **DELETE** |
| `crates/snapback-sync/src/auth/invocation.rs:2351` | `pub fn mode_effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>>` on `PreparedAuthority`; public; issues raw mode guard | Validates only A admission and returns a guard borrowing A's admission lease. | It can be passed to a RAW sink whose subject primitives came from B. It must become internal to a closed mode/caller carrier. | **MOVE** |
| `crates/snapback-sync/src/auth/invocation.rs:2361` | `pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>>` on `PreparedAuthority`; public compatibility alias | Delegates to A's mode guard. | Same raw A-guard + B-subject composition. | **MOVE** |
| `crates/snapback-sync/src/auth/invocation.rs:2637` | `pub fn mode_effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>>` on `PreparedInvocation`; public; issues raw guard | Delegates through the invocation's embedded A authority. | The returned guard is still independent of any later raw sink subject. | **MOVE** |
| `crates/snapback-sync/src/auth/invocation.rs:2644` | `pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>>` on `PreparedInvocation`; public compatibility alias | Delegates to the preceding method. | Same raw A-guard + B-subject composition. | **MOVE** |
| `crates/snapback-server/src/server.rs:14364` | `async fn reserve_route_authorized_effect(authority: &PreparedAuthority, headers: &HeaderMap, effect: &'static str) -> Result<AuthorizedEffectReservation, ApiError>`; private production route factory | Reserves from A after route pause hooks. | Result is a standalone A-reservation accepted by engine sinks beside B. | **MOVE** |
| `crates/snapback-server/src/server.rs:14375` | `async fn reserve_route_authorized_effect_classified(authority: &PreparedAuthority, _headers: &HeaderMap, effect: &'static str) -> Result<AuthorizedEffectReservation, AuthorizedEffectReservationError>`; private classified route factory | Same A-only reservation. | Same standalone pairing. | **MOVE** |
| `crates/snapback-server/src/server/asset_routes.rs:26` | `async fn reserve_asset_authorized_effect(authority: &PreparedAuthority, _headers: &HeaderMap, effect: &'static str, pause_before_reservation: bool, pause_after_reservation: bool) -> Result<AuthorizedEffectReservation, ApiError>`; private production asset factory | Reserves from A; pause flags do not bind a subject. | Result is accepted by every asset SPLIT sink beside independently selected B authority/ticket. | **MOVE** |

## 1. Watch management and the commit capsule

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `crates/snapback-engine/src/local/engine.rs:24960` | `pub fn stage_watch_management<'connection>(&'connection mut self, authority: &PreparedAuthority, intent: &crate::storage::watches::WatchManagementIntent, now_ms: u64) -> SnapbackResult<crate::storage::watches::WatchManagementPending<'connection>>`; public; stages an open SQLite transaction | Admission, `WatchManagement` source, and management owner are derived from B. The pending value stores transaction/binding/intent/value, not B or an origin. | **Constructible:** stage with B, then pass the pending value to A's `FinalCommitCut`/`CommitCapsuleAuthority`; only database binding is compared. | **MOVE** |
| `crates/snapback-kernel/src/storage/watches.rs:685` | `pub fn stage_watch_management<'connection>(&'connection mut self, intent: &WatchManagementIntent, management_principal_id: &str, now_ms: u64) -> SnapbackResult<WatchManagementPending<'connection>>`; public; kernel staging leaf | It checks watch state and the supplied principal string. Authority has already been erased. | **Constructible through its engine wrapper:** the pending value has no origin, so A's capsule authority can commit B's principal-derived intent on the same DB. | **MOVE** |
| `crates/snapback-kernel/src/storage/watches.rs:322` | `pub fn commit(self, authority: &CommitCapsuleAuthority) -> SnapbackResult<WatchManagementCommit>`; public; commits the pending transaction | TICKET: compares the pending database binding with the capsule database binding and then commits. | **Constructible:** B-pending + A-capsule authority succeeds when both target the same DB; no subject comparison exists. | **MOVE** |
| `crates/snapback-server/src/server/commit_capsule.rs:181` | `fn commit(self, authority: &crate::storage::CommitCapsuleAuthority) -> SnapbackResult<Self::Output>;`; private trait method; opens the pending consumer surface | Requires only `CommitCapsuleAuthority`, not the reservation/subject that staged `Self`. | **Constructible by any same-crate `PendingCommit` implementation/value:** B-pending can be supplied to A's final cut. | **MOVE** |
| `crates/snapback-server/src/server/commit_capsule.rs:206` | `pub(crate) fn stage_watch_management<'connection>(&'connection mut self, reservation: &CommitCapsuleReservation, intent: &crate::storage::watches::WatchManagementIntent, now_ms: u64) -> SnapbackResult<crate::storage::watches::WatchManagementPending<'connection>>`; crate-visible; stages | CAPSULE: it obtains the authority view from the same reservation passed by the bounded-capsule callback. | A foreign guard cannot be selected at this entry point: the only authority input is the opaque reservation. The returned pending can still escape into the open consumer above, which is why the consumer moves. | **KEEP** |
| `crates/snapback-server/src/server/commit_capsule.rs:78` | `pub(crate) fn bind(runtime: &AppState, authority: PreparedAuthority) -> SnapbackResult<Self>`; crate-visible; creates a destination/pending carrier | Confirms the runtime admission owns the authority lease and stores the authority with the runtime's commit authority. | Structurally blocked at construction: there is no reservation parameter to mix with the authority. | **KEEP** |
| `crates/snapback-server/src/server/commit_capsule.rs:100` | `fn reserve(authority: PreparedAuthority, operation: &'static str) -> SnapbackResult<Self>`; private; creates `CommitCapsuleReservation` | CAPSULE: calls `authority.reserve_authorized_effect(operation)` internally and stores both results privately. | Structurally blocked: no constructor accepts separate subject/reservation values and fields are private. | **KEEP** |
| `crates/snapback-server/src/server/commit_capsule.rs:630` | `pub(crate) fn commit<T, Pending>(&mut self, reservation: &CommitCapsuleReservation, pending: Pending) -> CommitAttempt<T> where Pending: PendingCommit<Output = T, Uncertain = U>`; crate-visible; final durable cut | Its guard at line 659 is CAPSULE-correlated with A. It does not prove that `pending` was staged from A. | **Constructible:** supply a B-pending implementing `PendingCommit` beside A-reservation. The guard itself is correlated; the pending/guard pair is not. | **MOVE** |
| `crates/snapback-server/src/server/commit_capsule.rs:705` | `pub(crate) fn exact_existing<T>(&mut self, reservation: &CommitCapsuleReservation, intent: &I, witness: crate::storage::ExactCommitRows<I, T>) -> CommitAttempt<T>`; crate-visible; resolves an already-committed exact predecessor rather than performing a new write | Its guard at line 721 is CAPSULE-correlated. `ExactCommitRows::into_value_for` checks database binding and intent/result facts. | There is no pending transaction or new durable cut to pair with a foreign guard. The guard is derived from the same opaque reservation as the subject; the exact-row witness is a read/reconciliation capability. | **KEEP** |
| `crates/snapback-server/src/server/commit_capsule.rs:760` | `pub(crate) async fn with_bounded_commit_capsule<T, Intent, Gate, Uncertain>(destination: CommitCapsuleDestination, spec: CommitCapsuleSpec, terminal_gate: Gate, intent: Intent, transact: impl FnOnce(&mut CommitCapsuleTransaction<'_>, &Intent, Gate, &CommitCapsuleReservation, &mut FinalCommitCut<Intent, Uncertain>) -> CommitAttempt<T> + Send + 'static, reconcile: impl FnOnce(&mut CommitCapsuleTransaction<'_>, &Intent, &Uncertain) -> SnapbackResult<Option<crate::storage::ExactCommitRows<Intent, T>>> + Send + 'static, uncertain_retention: CommitUncertainRetention<Uncertain>) -> CommitCapsuleOutcome<T> where T: Send + 'static, Intent: crate::storage::CommitCapsuleIntent + Send + 'static, Gate: Send + 'static, Uncertain: Send + 'static`; crate-visible; owns capsule choreography | Privately reserves from the destination authority. The callback receives only that reservation, but its generic `Pending` is chosen later at `FinalCommitCut`. | The wrapper itself cannot select a foreign guard, but its callback can feed an independently obtained pending value to the open final cut. Closing the `PendingCommit` origin is part of moving the final cut; the wrapper then survives. | **MOVE** |
| `crates/snapback-server/src/server.rs:29193` | `async fn commit_watch_management_capsule(runtime: &AppState, authority: PreparedAuthority, _headers: &HeaderMap, operation: &'static str, budget: Duration, intent: crate::storage::watches::WatchManagementIntent) -> Result<crate::storage::watches::WatchRecord, ApiError>`; private production watch-management sink | B is moved into `CommitCapsuleDestination`; the closure receives its sole opaque reservation and stages through `CommitCapsuleTransaction::stage_watch_management(reservation, ...)` before committing that returned pending with the same reservation. | Structurally blocked in the current body: it has no second authority/reservation/pending input. This is the exact safe composition the open lower entry points must enforce. | **KEEP** |
| `crates/snapback-server/src/server.rs:29409` | `async fn watch_renew(State(runtime): State<AppState>, Extension(authority): Extension<PreparedAuthority>, headers: HeaderMap, Path(id): Path<String>, input: Result<Json<WatchRenewRequest>, JsonRejection>) -> Result<Json<crate::storage::watches::WatchRecord>, ApiError>`; private route leaf; constructs renewal intent and commits it | Validates B's provider-session source, constructs the intent, and passes B and that intent into `commit_watch_management_capsule`. | Structurally blocked in this body: no second authority/reservation/pending input; the capsule stages and guards from B. | **KEEP** |
| `crates/snapback-server/src/server.rs:29450` | `async fn watch_transition_record(runtime: AppState, authority: PreparedAuthority, headers: &HeaderMap, id: String, target: crate::watches::WatchStatus) -> Result<crate::storage::watches::WatchRecord, ApiError>`; private route leaf; constructs transition intent and commits it | Mode-only branch calls the SAME direct engine sink with B. Caller-backed branch constructs intent then supplies B to the closed capsule wrapper. | Structurally blocked in current branches: neither accepts a foreign guard/pending value. | **KEEP** |

Assumption for the CAPSULE `KEEP` rows: private-field/module visibility is part
of the supported production surface. If `CommitCapsuleReservation` gains an
`into_parts`, a constructor from separate halves, or an accessor usable beyond
the private final-cut implementation, those rows must be reclassified.

## 2. Recorded mutations, detached mutations, and actions

### Staging and pending construction

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `engine.rs:16939` | `pub fn stage_recorded_authorization_mutation(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, StagedRecordedMutation)>`; public; stages mutation intent | Validates B and prepares `PreparedInvocation`; no reservation enters. | **Constructible:** every authorized commit consumer below accepts reservation A separately. | **MOVE** |
| `engine.rs:16965` | `pub(crate) fn stage_recorded_authorization_mutation_with_generation(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority, expected_generation: Option<&ArtifactGeneration>) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, StagedRecordedMutation)>`; crate-visible; stages | Same B validation plus generation. | B-staged + A-reservation is accepted downstream. | **MOVE** |
| `engine.rs:16994` | `pub(crate) fn stage_recorded_authorization_mutation_with_generation_and_settlement(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority, expected_generation: Option<&ArtifactGeneration>, operation_issuance: Option<crate::commit_envelope::OperationIssuanceV1>, settlement: MutationSettlement) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, StagedRecordedMutation)>`; crate-visible; stages | Same B validation plus settlement/issuance checks. | B-staged + A-reservation. | **MOVE** |
| `engine.rs:17034` | `pub fn stage_recorded_authorization_mutation_with_wire_version(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority, expected_generation: Option<&ArtifactGeneration>, operation_issuance: Option<crate::commit_envelope::OperationIssuanceV1>, settlement: MutationSettlement, media_command: Option<crate::manifest::MediaCommandInvocationV1>, wire_version: Option<&str>) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, StagedRecordedMutation)>`; public; stages | Same B validation plus wire/media constraints. | B-staged + A-reservation. | **MOVE** |
| `engine.rs:17072` | `fn stage_recorded_authorization_mutation_with_generation_and_settlement_inner(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority, expected_generation: Option<&ArtifactGeneration>, operation_issuance: Option<crate::commit_envelope::OperationIssuanceV1>, settlement: MutationSettlement, media_invocation: Option<crate::manifest::MediaCommandInvocationV1>, wire_version: Option<&str>, allow_host_issuance: bool, authority_posture: MutationStageAuthorityPosture) -> Result<(crate::storage::AuthorizationCommitPreflight, StagedRecordedMutation), AuthorizedEffectReservationError>`; private reachable helper; stages | Full B admission/function/schema/policy preview; still no reservation/origin in the staged result. | B-staged + A-reservation. | **MOVE** |
| `engine.rs:23291` | `pub fn stage_nested_mutation(&mut self, name: &str, input: &HandlerInput, authority: PreparedAuthority, identity: Option<&ClientMutationIdentity>) -> SnapbackResult<StagedNestedMutation>`; public; returns in-lock or detached pending mutation | Validates B and prepares the child invocation. | Server normally reserves from the returned child, but the public result can be paired with an arbitrary generic `BeforeCommit`. | **MOVE** |
| `engine.rs:23302` | `pub fn stage_nested_mutation_classified(&mut self, name: &str, input: &HandlerInput, authority: PreparedAuthority, identity: Option<&ClientMutationIdentity>) -> Result<StagedNestedMutation, AuthorizedEffectReservationError>`; public; classified staging helper | Same as preceding row. | Same B-pending + A-final callback. | **MOVE** |
| `engine.rs:23397` | `pub fn preview_detached_nested_authorization_mutation(&mut self, name: &str, input: &HandlerInput, binding: &DetachedMutationBinding, executed: &mut ExecutedIbexMutation, identity: Option<&ClientMutationIdentity>) -> SnapbackResult<DetachedNestedMutationPreview>`; public; constructs commit preflight/plan | Validates the invocation embedded in B-binding and previews B's buffered writes. | Preview and B-buffer are later accepted beside A's generic final callback. | **MOVE** |
| `engine.rs:23411` | `pub fn preview_detached_nested_authorization_mutation_classified(&mut self, name: &str, input: &HandlerInput, binding: &DetachedMutationBinding, executed: &mut ExecutedIbexMutation, identity: Option<&ClientMutationIdentity>) -> Result<DetachedNestedMutationPreview, AuthorizedEffectReservationError>`; public; classified preview | Same B binding/function/schema/generation validation. | B-buffer/preview + A-callback. | **MOVE** |
| `runtime/host_glue.rs:886` | `pub fn execute_ibex_mutation_prepared(module: &IbexModule, input: HandlerInput, prepared: &PreparedInvocation, db: DbRead<'_>, pool: Option<&WarmVmPool>, deadline: Option<Instant>) -> SnapbackResult<ExecutedIbexMutation>`; public; produces buffered writes | Validates B's prepared invocation and runtime result; it intentionally does not commit. | `ExecutedIbexMutation` is later committed with a caller-supplied `BeforeCommit`; no origin is carried. | **MOVE** |
| `engine.rs:33014` | `pub fn execute_detached_ibex_mutation(&self, module: &crate::manifest::IbexModule, input: HandlerInput, prepared: &PreparedInvocation, schema: &SchemaManifest, deadline: Instant) -> SnapbackResult<ExecutedIbexMutation>`; public read-lane wrapper; produces buffered writes | Delegates to the preceding B-prepared execution after schema/read-lane selection. | Same B-buffer + A-callback. | **MOVE** |
| `engine.rs:22959` | `pub fn stage_app_action_with_authority(&mut self, name: &str, authority: PreparedAuthority) -> StagedAppAction`; public; constructs action pending value | Validates/prepares B and embeds its `PreparedInvocation` in `StagedAction`. | Nested durable mutations can later be committed through independently selected child reservations/callbacks. | **MOVE** |
| `engine.rs:22967` | `pub fn stage_app_action_with_authority_generation(&mut self, name: &str, authority: PreparedAuthority, expected_generation: Option<&ArtifactGeneration>) -> StagedAppAction`; public; action staging leaf | Same plus generation/migration checks. | Same action B + later independently selected child cut. | **MOVE** |
| `engine.rs:23207` | `fn staged_mode(&mut self, definition: &FunctionDefinition, invocation: PreparedInvocation, deferred_push_grant: Option<crate::push::PushDeferredGrantV1>) -> StagedAction`; private reachable helper; constructs pending action | Embeds B-invocation. | Later child commit authority is not type-bound to this pending action. | **MOVE** |
| `engine.rs:23223` | `fn staged_config_verify_mode(&mut self, definition: &FunctionDefinition, invocation: PreparedInvocation, entry: &str) -> StagedAction`; private reachable helper; constructs config action | Embeds B-invocation and restricted grants. | Mode classification is control flow, not a closed final-cut type. | **MOVE** |
| `engine.rs:23234` | `fn staged_mode_with_grants(&mut self, definition: &FunctionDefinition, invocation: PreparedInvocation, deferred_push_grant: Option<crate::push::PushDeferredGrantV1>, grants: Value, granted_names: &[String]) -> StagedAction`; private reachable leaf; constructs detached/HostPlan action | Embeds B-invocation and grants. | Later nested commit accepts a separately created reservation/callback. | **MOVE** |
| `engine.rs:28340` | `pub fn stage_managed_host_plan_action(&mut self, name: &str, input: HandlerInput, metadata: CronRunMetadata, prepared: PreparedInvocation) -> SnapbackResult<ManagedHostPlanAction>`; public; constructs managed action plan | Validates B-prepared function/generation and embeds the invocation. | Each child later produces a separately held staged mutation and reservation. | **MOVE** |
| `engine.rs:28395` | `pub fn stage_managed_host_plan_action_step(&mut self, action: &ManagedHostPlanAction, step: &ActionStep, bindings: &BTreeMap<String, Value>) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, PreparedAuthority, StagedRecordedMutation)>`; public; stages child | Derives and returns child B authority beside B-staged value, but does not bind them opaquely. | Caller can discard returned B authority and commit staged B with reservation A. | **MOVE** |
| `engine.rs:28409` | `pub fn stage_managed_host_plan_action_step_classified(&mut self, action: &ManagedHostPlanAction, step: &ActionStep, bindings: &BTreeMap<String, Value>) -> Result<(crate::storage::AuthorizationCommitPreflight, PreparedAuthority, StagedRecordedMutation), AuthorizedEffectReservationError>`; public; classified child staging | Same. | Same tuple destructuring permits B-staged + A-reservation. | **MOVE** |

### Action execution seams

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `engine.rs:4517` | `fn try_new(authority: PreparedAuthority) -> SnapbackResult<Self>` on `LegacyLocalActionAuthority`; private; creates the authority carrier used by the synchronous in-Local action host | Rejects finite session/service callers and privately stores B for the remaining closed legacy classes. | Structurally blocked at this constructor: there is no host or reservation parameter, and the resulting host derives every nested authority from the stored value. Assumption: the enumerated non-finite variants are the intended closed legacy classes. | **KEEP** |
| `engine.rs:28483` | `fn invoke_action_prepared_with_staged_config(&mut self, name: &str, input: HandlerInput, metadata: CronRunMetadata, prepared: PreparedInvocation, staged_config: Option<(Value, crate::config::SecretRedactor)>) -> SnapbackResult<Value>`; private production action executor; can perform nested durable mutations and external effects | Validates B and either executes HostPlan children derived from B or constructs `LegacyLocalActionAuthority` from that same B. It does not accept a host/guard parameter. | Structurally blocked in this body: every nested mutation authority descends from `prepared`. The separately callable runtime leaf below remains open. | **KEEP** |
| `engine.rs:28583` | `fn invoke_action_plan(&mut self, plan: &ActionPlan, input: HandlerInput, metadata: CronRunMetadata, prepared: &PreparedInvocation) -> SnapbackResult<Value>`; private HostPlan executor; directly commits child mutations | Each child authority is obtained with `prepared.inherit_authority_for(InvocationSource::NestedMutation)` and the direct mutation path derives its guard internally. | No independently supplied guard/host exists, so a foreign authority cannot be selected through this signature. | **KEEP** |
| `crates/snapback-engine/src/runtime/host_glue.rs:856` | `pub fn invoke_ibex_action_prepared(_runtime: &RuntimeManager, module: &IbexModule, input: HandlerInput, prepared: &PreparedInvocation, run: CronRunMetadata, host: &mut dyn IbexActionHost, grants: Value, deadline: Option<Instant>) -> SnapbackResult<Value>`; public runtime executor; host calls may stage/commit durable effects | B-prepared projection/admission is installed in the VM, but `host` is an independent caller-selected capability. No body check relates the host's retained authority to B. | **Constructible:** invoke B-prepared action with a host constructed from A; nested writes/external effects use A-host authority while code/result policy uses B. | **MOVE** |
| `crates/snapback-server/src/server.rs:4394` | `async fn run_detached_ibex_action_with_admission_counters_and_timeout(state: &SharedSnapback, action: Box<crate::local::DetachedIbexAction>, input: HandlerInput, metadata: CronRunMetadata, admission: Arc<Semaphore>, worker_limit: usize, counters: DetachedActionWorkerCounters, timeout_ms: u64) -> SnapbackResult<Value>`; private production detached executor; constructs the host and runs durable children/stream persistence | Destructures one B-staged action, derives both its invocation and `DetachedActionHost.authority`/`nested_effect` from that same embedded invocation, then passes those two values to the open runtime leaf. | Structurally blocked in the current wrapper: no second authority or host parameter exists. This `KEEP` does not cure the public runtime signature and does not cure downstream stream-origin erasure. | **KEEP** |

### Commit consumers

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `engine.rs:17622` | `pub fn commit_staged_recorded_authorization_mutation(&mut self, staged: StagedRecordedMutation) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt)>`; public; commits | Uses the `PreparedInvocation` embedded in staged state for a mode-only guard. It does not require a closed mode origin and will accept caller-origin staged values. | No foreign guard is supplied, but this is an open caller bypass of the required caller reservation. Survivor: a closed mode-only consumer plus the carrier consumer at `:17693`. | **DELETE** |
| `engine.rs:17634` | `pub fn commit_staged_recorded_authorization_mutation_with_dependencies(&mut self, staged: StagedRecordedMutation) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, MutationDependencyCapture)>`; public; commits | Same open mode-only posture. | Same bypass. Survivor: closed mode-only consumer / `:17693`. | **DELETE** |
| `engine.rs:17655` | `pub(crate) fn commit_staged_recorded_authorization_mutation_with_network_egress(&mut self, staged: StagedRecordedMutation) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, crate::network_profile::MutationEgressBasis)>`; crate-visible; commits | Same open mode-only posture. | Same bypass. Survivor: closed mode-only consumer / `:17693`. | **DELETE** |
| `engine.rs:17670` | `pub fn commit_staged_recorded_authorization_mutation_with_network_egress_and_dependencies(&mut self, staged: StagedRecordedMutation) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, crate::network_profile::MutationEgressBasis, MutationDependencyCapture)>`; public; commits | Same open mode-only posture. | Same bypass. Survivor: closed mode-only consumer / `:17693`. | **DELETE** |
| `engine.rs:17693` | `pub fn commit_staged_recorded_authorization_mutation_with_authorized_effect(&mut self, staged: StagedRecordedMutation, authorized_effect: &AuthorizedEffectReservation) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, crate::network_profile::MutationEgressBasis, MutationDependencyCapture)>`; public; commits | SPLIT. `MutationEffectPosture::bind` retains the staged invocation only for the mode-only arm; the authorized arm uses A-reservation and does not compare it to B. | **Constructible directly:** staged B + reservation A. | **MOVE** |
| `engine.rs:17712` | `pub fn commit_staged_recorded_authorization_mutation_with_action_effect(&mut self, staged: StagedRecordedMutation, authorized_effect: &AuthorizedEffectReservation, terminal_latch: &ActionTerminalLatch) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, crate::network_profile::MutationEgressBasis, MutationDependencyCapture)>`; public; nested-action commit | SPLIT; latch changes error handling only. | **Constructible:** staged B + reservation A + any matching action latch. | **MOVE** |
| `engine.rs:17729` | `fn commit_staged_recorded_authorization_mutation_inner(&mut self, staged: StagedRecordedMutation, effect_posture: MutationEffectPosture<'_>) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt, crate::network_profile::MutationEgressBasis, MutationDependencyCapture)>`; private reachable commit leaf | SPLIT for both authorized posture variants; no origin comparison. | Its public wrappers construct B-staged + A-posture. | **MOVE** |
| `engine.rs:18078` | `pub fn invoke_host_plan_mutation_guarded<G, Check, BeforeCommit>(&mut self, name: &str, input: HandlerInput, prepared: PreparedInvocation, identity: Option<ClientMutationIdentity>, check_live: Check, before_commit: BeforeCommit) -> SnapbackResult<MutationOutput> where Check: Fn() -> SnapbackResult<()>, BeforeCommit: FnOnce() -> SnapbackResult<G>`; public; direct commit | Validates B-prepared plan; `BeforeCommit` is unconstrained. | **Constructible:** B-prepared mutation + closure returning A-guard or `()`. | **MOVE** |
| `engine.rs:18428` | `fn invoke_host_plan_mutation_commit_guarded<G, Check, BeforeCommit>(&mut self, name: &str, input: HandlerInput, prepared: &PreparedInvocation, identity: Option<&ClientMutationIdentity>, check_live: Check, before_commit: BeforeCommit) -> SnapbackResult<MutationCommit> where Check: Fn() -> SnapbackResult<()>, BeforeCommit: FnOnce() -> SnapbackResult<G>`; private reachable leaf; direct commit | Same B validation and unconstrained final callback. | B-plan + A-guard/`()`. | **MOVE** |
| `engine.rs:18707` | `pub fn commit_detached_ibex_mutation_guarded<G, Check, BeforeCommit>(&mut self, name: &str, input: HandlerInput, binding: DetachedMutationBinding, mut executed: ExecutedIbexMutation, identity: Option<ClientMutationIdentity>, check_live: Check, before_commit: BeforeCommit) -> SnapbackResult<MutationOutput> where Check: Fn() -> SnapbackResult<()>, BeforeCommit: FnOnce() -> SnapbackResult<G>`; public; commits buffered effects | Validates B binding/function/schema/generation and buffer; callback is unconstrained. | **Constructible:** B-buffer + A-guard/`()`. | **MOVE** |

### Server nested-action authority producers

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `crates/snapback-server/src/server.rs:807` | `fn classify(authority: PreparedAuthority) -> Self`; private; constructs `NestedActionEffect` | Classifies B by source into caller-bound or mode-only and stores B. | The value is later rebound and its reservation remains independent of staged mutation at the engine seam. | **MOVE** |
| `server.rs:864` | `fn bind_child(&self, authority: PreparedAuthority) -> Self`; private; constructs child effect carrier | Preserves outer class but replaces stored authority with supplied B-child. | No comparison to a staged value; a different child can be supplied. | **MOVE** |
| `server.rs:871` | `fn reserve(&self, latch: &ActionTerminalLatch) -> SnapbackResult<NestedActionEffectReservation>`; private; issues reservation/mode carrier | Caller arm reserves from stored authority; mode arm clones it. | Result can be passed beside any `StagedRecordedMutation`; engine does not compare origins. | **MOVE** |
| `server.rs:926` | `fn commit_guard<'a>(&'a self, latch: &ActionTerminalLatch) -> SnapbackResult<NestedActionEffectCommitGuard<'a>>`; private; issues final guard | Caller arm invokes `commit_guard_classified` at line 932 (the previously missed call); mode arm obtains stored authority's mode guard. | The guard is internally consistent with its reservation, but not with the independently staged mutation it is used to commit. | **MOVE** |
| `server.rs:1473` | `fn reserve_nested_effect(&self, child_authority: PreparedAuthority) -> SnapbackResult<NestedActionEffectReservation>`; private production host method; issues child reservation | Rebinds to B-child then reserves. | Its result can guard a separately selected staged child because the engine consumer accepts both independently. | **MOVE** |
| `server.rs:1531` | `fn lock_nested_commit<'a>(&'a self, reservation: &'a NestedActionEffectReservation) -> SnapbackResult<(NestedActionCommitGateGuard<'a>, NestedActionEffectCommitGuard<'a>)>`; private; final gate constructor | Validates action liveness and obtains guard from the supplied reservation only. | B-staged data is not an argument, so nothing compares it to A-reservation. | **MOVE** |
| `server.rs:4844` | `async fn run_managed_host_plan_action(state: &SharedSnapback, name: String, input: HandlerInput, metadata: CronRunMetadata, prepared: crate::auth::invocation::PreparedInvocation) -> SnapbackResult<Value>`; private route/worker sink; stages and commits children | Current control flow takes each returned child authority and immediately reserves from it. That is caller discipline, not a type rule; tuple destructuring leaves both axes open. | **Could be constructed by a local source edit using existing public methods:** replace returned child authority with A before `reserve`; no type or runtime comparison fails. That is “constructible,” not “observed in the current branch.” | **MOVE** |

## 3. Assets: tickets, plans, store writes, and database cuts

All asset rows marked SPLIT validate the `PreparedAuthority` and the asset's
caller/attempt/record facts, then independently invoke the supplied reservation.
All TICKET rows validate exact attempt/publication/digest/lease continuity. Those
checks are valuable and must remain; they do not record the logical authority
origin that authorized the first phase.

### Engine entry points

| Location | Exact signature; visibility and effect | Validation / foreign pairing | Class |
| --- | --- | --- | --- |
| `engine.rs:12321` | `pub fn asset_attempt_create(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetAttemptCreateRequestV1) -> SnapbackResult<crate::assets::AssetAttemptCreateResponseV1>`; direct compatibility write | SAME internally, but redundant. Survivor `asset_attempt_create_with_authorized_effect` (`:12340`), which must move. | **DELETE** |
| `engine.rs:12340` | `pub fn asset_attempt_create_with_authorized_effect(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetAttemptCreateRequestV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetAttemptCreateResponseV1>`; direct write | SPLIT: B validates caller/request; A guards `asset_attempts_transaction_guarded`. B + A succeeds. | **MOVE** |
| `engine.rs:12357` | `fn asset_attempt_create_inner<G, BeforeCommit>(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetAttemptCreateRequestV1, before_commit: BeforeCommit) -> SnapbackResult<(crate::assets::AssetAttemptCreateResponseV1, Option<String>, Arc<dyn crate::assets_store::AssetStore>)> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private write leaf | B validates; arbitrary callback can return A-guard or `()`. | **MOVE** |
| `engine.rs:12552` | `fn asset_attempt_for_caller(&mut self, authority: &PreparedAuthority, attempt_id: &str) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; private reachable read with lifecycle writes | B caller facts; no caller guard (`asset_reads_transaction` uses `|| Ok(())`). It can commit with no subject guard. | **MOVE** |
| `engine.rs:12560` | `fn asset_attempt_for_caller_inner<G, BeforeCommit>(&mut self, authority: &PreparedAuthority, attempt_id: &str, before_commit: BeforeCommit) -> SnapbackResult<crate::assets::AssetAttemptRecordV1> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private read/write leaf | B caller facts + arbitrary A/`()` callback. | **MOVE** |
| `engine.rs:12577` | `fn asset_attempt_for_caller_state_inner<G, BeforeCommit>(&mut self, authority: &PreparedAuthority, attempt_id: &str, before_commit: BeforeCommit) -> SnapbackResult<(crate::assets::AssetAttemptRecordV1, Option<String>)> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private transaction leaf | B caller facts + arbitrary A/`()` callback. | **MOVE** |
| `engine.rs:12637` | `pub fn asset_attempt_inspect(&mut self, authority: &PreparedAuthority, attempt_id: &str) -> SnapbackResult<crate::assets::AssetTaskStateV1>`; compatibility lifecycle write | SAME but redundant. Survivor `asset_attempt_inspect_with_authorized_effect` (`:12653`), which moves. | **DELETE** |
| `engine.rs:12653` | `pub fn asset_attempt_inspect_with_authorized_effect(&mut self, authority: &PreparedAuthority, attempt_id: &str, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetTaskStateV1>`; lifecycle write | SPLIT; B attempt check + A reservation. | **MOVE** |
| `engine.rs:13583` | `pub fn asset_attempt_cancel(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetAttemptCancelRequestV1) -> SnapbackResult<crate::assets::AssetTaskStateV1>`; compatibility write | SAME but redundant. Survivor `:13601`, which moves. | **DELETE** |
| `engine.rs:13601` | `pub fn asset_attempt_cancel_with_authorized_effect(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetAttemptCancelRequestV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetTaskStateV1>`; write | SPLIT; B request + A reservation. | **MOVE** |
| `engine.rs:13627` | `pub fn asset_tus_head(&mut self, authority: &PreparedAuthority, attempt_id: &str) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; lifecycle write | SAME but redundant. Survivor `:13643`, which moves. | **DELETE** |
| `engine.rs:13643` | `pub fn asset_tus_head_with_authorized_effect(&mut self, authority: &PreparedAuthority, attempt_id: &str, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; lifecycle write | SPLIT; B attempt + A reservation. | **MOVE** |
| `engine.rs:13662` | `pub(crate) fn asset_tus_patch(&mut self, authority: &PreparedAuthority, attempt_id: &str, offset: u64, chunk: &[u8], checksum: Option<(&str, &str)>) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; combined store+DB compatibility path | SAME control flow but duplicates phased path. Survivor: `:13692` preflight, `AssetTusPatchTicketV1::append`, and `:13808` commit, all moved onto one carrier. | **DELETE** |
| `engine.rs:13679` | `pub fn asset_tus_patch_preflight(&mut self, authority: &PreparedAuthority, attempt_id: &str, offset: u64, chunk: &[u8], checksum: Option<(&str, &str)>) -> SnapbackResult<AssetTusPatchTicketV1>`; ticket creation | SAME but redundant. Survivor `:13692`, which moves. | **DELETE** |
| `engine.rs:13692` | `pub fn asset_tus_patch_preflight_with_authorized_effect(&mut self, authority: &PreparedAuthority, attempt_id: &str, offset: u64, chunk: &[u8], checksum: Option<(&str, &str)>, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<AssetTusPatchTicketV1>`; lifecycle write + ticket | SPLIT at preflight; returned TICKET contains attempt continuity, not origin. B-ticket later accepts A at commit. | **MOVE** |
| `engine.rs:13712` | `fn asset_tus_patch_preflight_inner<G, BeforeCommit>(&mut self, authority: &PreparedAuthority, attempt_id: &str, offset: u64, chunk: &[u8], checksum: Option<(&str, &str)>, before_commit: BeforeCommit) -> SnapbackResult<AssetTusPatchTicketV1> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private staging leaf | B facts + arbitrary callback; output erases origin. | **MOVE** |
| `engine.rs:13728` | `fn asset_tus_patch_preflight_from_attempt(&mut self, attempt: crate::assets::AssetAttemptRecordV1, offset: u64, chunk: &[u8], checksum: Option<(&str, &str)>) -> SnapbackResult<AssetTusPatchTicketV1>`; private ticket constructor | TICKET continuity only; authority already erased. B-ticket can be committed with A. | **MOVE** |
| `engine.rs:13800` | `pub fn asset_tus_patch_commit(&mut self, authority: &PreparedAuthority, ticket: AssetTusPatchTicketV1) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; compatibility commit | SAME authority guard but ticket's originating authority is absent; B-ticket + A-authority commits. Survivor `:13808`, moved to carrier. | **DELETE** |
| `engine.rs:13808` | `pub fn asset_tus_patch_commit_with_authorized_effect(&mut self, authority: &PreparedAuthority, ticket: AssetTusPatchTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetAttemptRecordV1>`; commit | SPLIT twice: ticket B, subject authority, and reservation A are independent; only attempt continuity is checked. | **MOVE** |
| `engine.rs:13855` | `fn asset_tus_patch_commit_inner<G1, G2, BeforeCallerCommit, BeforePatchCommit>(&mut self, authority: &PreparedAuthority, ticket: AssetTusPatchTicketV1, before_caller_commit: BeforeCallerCommit, before_patch_commit: BeforePatchCommit) -> SnapbackResult<crate::assets::AssetAttemptRecordV1> where BeforeCallerCommit: FnOnce() -> SnapbackResult<G1>, BeforePatchCommit: FnOnce() -> SnapbackResult<G2>`; private two-cut leaf | TICKET + two arbitrary callbacks. Either callback may be A/`()`. | **MOVE** |
| `engine.rs:13897` | `pub fn asset_tus_terminate(&mut self, authority: &PreparedAuthority, attempt_id: &str) -> SnapbackResult<()>`; compatibility write | SAME but redundant. Survivor `:13913`, which moves. | **DELETE** |
| `engine.rs:13913` | `pub fn asset_tus_terminate_with_authorized_effect(&mut self, authority: &PreparedAuthority, attempt_id: &str, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<()>`; write | SPLIT; B attempt + A reservation. | **MOVE** |
| `engine.rs:13950` | `pub(crate) fn asset_attempt_finalize(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetFinalizeRequestV1) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; combined compatibility pipeline | Redundant caller-discipline pipeline. Survivor is the phased preflight/plan/put/complete/cleanup pipeline after carrier migration. | **DELETE** |
| `engine.rs:13965` | `pub fn asset_attempt_finalize_preflight(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetFinalizeRequestV1) -> SnapbackResult<FinalizePreflightV1>`; ticket/preflight creation | SAME but redundant. Survivor `:13977`, which moves. | **DELETE** |
| `engine.rs:13977` | `pub fn asset_attempt_finalize_preflight_with_authorized_effect(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetFinalizeRequestV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<FinalizePreflightV1>`; lifecycle write + ticket | SPLIT; B request + A reservation; output lacks origin. | **MOVE** |
| `engine.rs:14140` | `pub fn asset_attempt_finalize_plan(&mut self, authority: &PreparedAuthority, ticket: FinalizePrepareTicketV1, preparation: FinalizePreparationV1) -> SnapbackResult<FinalizePhaseAOutcomeV1>`; compatibility plan commit | Ticket B + authority A can already mix. Survivor `:14152`, moved to carrier. | **DELETE** |
| `engine.rs:14152` | `pub fn asset_attempt_finalize_plan_with_authorized_effect(&mut self, authority: &PreparedAuthority, ticket: FinalizePrepareTicketV1, preparation: FinalizePreparationV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<FinalizePhaseAOutcomeV1>`; plan commit | SPLIT; ticket B, authority, and reservation A are independent. | **MOVE** |
| `engine.rs:14170` | `pub fn asset_attempt_finalize_complete(&mut self, authority: &PreparedAuthority, ticket: FinalizeCommitTicketV1) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; compatibility commit | Ticket B + authority A; survivor `:14184`, moved to carrier. | **DELETE** |
| `engine.rs:14184` | `pub fn asset_attempt_finalize_complete_with_authorized_effect(&mut self, authority: &PreparedAuthority, ticket: FinalizeCommitTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<FinalizePhaseCDOutcomeV1>`; commit | SPLIT/TICKET; B-ticket + A-reservation. | **MOVE** |
| `engine.rs:14202` | `pub fn asset_attempt_finalize_complete_revalidated_with_authorized_effect(&mut self, authority: &PreparedAuthority, ticket: FinalizeWitnessRetryTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<FinalizePhaseCDOutcomeV1>`; retry commit | Witness revalidation binds database reads, not authority origin; B-ticket + A-reservation. | **MOVE** |
| `engine.rs:14229` | `pub fn asset_attempt_finalize_revalidate_witness(&mut self, authority: &PreparedAuthority, mut ticket: FinalizeWitnessRetryTicketV1) -> SnapbackResult<FinalizeWitnessRetryTicketV1>`; mutates/reissues pending ticket | Validates A's current reads against ticket facts but not ticket origin; a B-ticket can be revalidated by A. | **MOVE** |
| `engine.rs:14295` | `pub fn asset_attempt_finalize_cleanup_commit_with_authorized_effect(&mut self, ticket: FinalizeCleanupCommitTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; cleanup commit | No subject parameter at all; B-ticket + A-reservation is accepted. | **MOVE** |
| `engine.rs:14373` | `pub(crate) fn asset_attempt_finalize_inner(&mut self, authority: &PreparedAuthority, request: crate::assets::AssetFinalizeRequestV1, crash_after: Option<AssetFinalizeCrashPoint>) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; compatibility pipeline | Redundant combined path. Survivor: phased carrier pipeline. | **DELETE** |
| `engine.rs:14397` | `fn asset_attempt_finalize_commit_inner(&mut self, authority: &PreparedAuthority, ticket: FinalizePrepareTicketV1, preparation: FinalizePreparationV1, crash_after: Option<AssetFinalizeCrashPoint>) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; private combined helper | Ticket B can be combined with authority A; internal guards derive from A. | **MOVE** |
| `engine.rs:14419` | `fn asset_attempt_finalize_plan_inner(&mut self, authority: &PreparedAuthority, ticket: FinalizePrepareTicketV1, preparation: FinalizePreparationV1, crash_after: Option<AssetFinalizeCrashPoint>, authorized_effect: Option<AuthorizedEffectReservation>) -> SnapbackResult<FinalizePhaseAOutcomeV1>`; private plan commit | Optional SPLIT: B-ticket + A-authority/reservation, or no reservation. | **MOVE** |
| `engine.rs:14580` | `fn asset_attempt_finalize_put_inner(ticket: FinalizePutTicketV1, crash_after: Option<AssetFinalizeCrashPoint>) -> SnapbackResult<FinalizeCommitTicketV1>`; private object-store write | TICKET checks publication leases but no subject origin; output later accepts A-reservation. | **MOVE** |
| `engine.rs:14593` | `fn asset_attempt_finalize_complete_inner(&mut self, authority: &PreparedAuthority, ticket: FinalizeCommitTicketV1, crash_after: Option<AssetFinalizeCrashPoint>) -> SnapbackResult<crate::assets::AssetFinalizeResponseV1>`; private commit | B-ticket + authority A; no origin comparison. | **MOVE** |
| `engine.rs:14621` | `fn asset_attempt_finalize_complete_state_inner(&mut self, authority: &PreparedAuthority, ticket: FinalizeCommitTicketV1, crash_after: Option<AssetFinalizeCrashPoint>, mut authorized_effect: Option<AuthorizedEffectReservation>, revalidated_witness: Option<Vec<crate::storage::CapturedReadDependency>>, witness_revalidations: u8) -> SnapbackResult<FinalizePhaseCDOutcomeV1>`; private commit leaf | Optional SPLIT/TICKET; B-ticket + A-authority/reservation. | **MOVE** |
| `engine.rs:14999` | `fn asset_fail_attempt_state(&mut self, attempt: &crate::assets::AssetAttemptRecordV1, asset_outcome: crate::assets::AssetAvailability, refusal: &SnapbackError, authorized_effect: Option<&AuthorizedEffectReservation>) -> SnapbackResult<String>`; private failure write | Attempt contains no origin; optional A-reservation or no guard. | **MOVE** |
| `engine.rs:15304` | `pub fn asset_width_plan_with_authorized_effect(&mut self, ticket: AssetWidthPlanTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetWidthPutTicketV1>`; plan commit | No subject parameter; B-ticket + A-reservation. | **MOVE** |
| `engine.rs:15326` | `pub fn asset_width_commit_with_authorized_effect(&mut self, ticket: AssetWidthCommitTicketV1, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<String>`; final DB commit | No subject parameter; B-ticket + A-reservation. | **MOVE** |
| `engine.rs:15356` | `pub fn asset_deliver(&mut self, authority: &PreparedAuthority, asset_id: &str, variant: &str, range_header: Option<&str>, max_width: Option<u64>, width: Option<u64>) -> SnapbackResult<AssetDeliveryOutcome>`; compatibility lifecycle/delivery write | SAME but redundant. Survivor `:15388`, moved to carrier. | **DELETE** |
| `engine.rs:15388` | `pub fn asset_deliver_with_authorized_effect(&mut self, authority: &PreparedAuthority, asset_id: &str, variant: &str, range_header: Option<&str>, max_width: Option<u64>, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<AssetDeliveryOutcome>`; lifecycle/delivery write | SPLIT; B asset policy + A-reservation. | **MOVE** |
| `engine.rs:15419` | `pub fn asset_strict_delivery_prepare_width(&mut self, authority: &PreparedAuthority, asset_id: &str, requested_width: u64) -> SnapbackResult<String>`; compatibility prework | Returns a key that can feed a later width plan; redundant survivor `:15432`, moved to carrier. | **DELETE** |
| `engine.rs:15432` | `pub fn asset_strict_delivery_width_preflight_with_authorized_effect(&mut self, authority: &PreparedAuthority, asset_id: &str, requested_width: u64, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<AssetWidthPreflightV1>`; ticket/preflight | SPLIT; output has semantic asset facts, no origin. | **MOVE** |
| `engine.rs:15448` | `pub fn asset_signed_url_issue(&mut self, authority: &PreparedAuthority, asset_id: &str, request: crate::assets::AssetSignedUrlIssueRequestV1) -> SnapbackResult<crate::assets::AssetSignedUrlIssueResponseV1>`; compatibility write | SAME but redundant. Survivor `:15487`, moved. | **DELETE** |
| `engine.rs:15487` | `pub fn asset_signed_url_issue_with_authorized_effect(&mut self, authority: &PreparedAuthority, asset_id: &str, request: crate::assets::AssetSignedUrlIssueRequestV1, resolved_width_variant: Option<String>, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::assets::AssetSignedUrlIssueResponseV1>`; receipt/URL issue write | SPLIT; B policy + A-reservation. | **MOVE** |
| `engine.rs:15529` | `pub fn asset_signed_url_prepare_width(&mut self, authority: &PreparedAuthority, asset_id: &str, requested_width: u64, ttl_ms: Option<u64>) -> SnapbackResult<String>`; compatibility prework | Redundant survivor `:15548`, moved. | **DELETE** |
| `engine.rs:15548` | `pub fn asset_signed_url_width_preflight_with_authorized_effect(&mut self, authority: &PreparedAuthority, asset_id: &str, requested_width: u64, ttl_ms: Option<u64>, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<AssetWidthPreflightV1>`; ticket/preflight | SPLIT; output lacks origin. | **MOVE** |
| `engine.rs:15638` | `pub fn asset_delete(&mut self, authority: &PreparedAuthority, asset_id: &str) -> SnapbackResult<Value>`; compatibility delete | SAME but redundant. Survivor `:15648`, moved. | **DELETE** |
| `engine.rs:15648` | `pub fn asset_delete_with_authorized_effect(&mut self, authority: &PreparedAuthority, asset_id: &str, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<Value>`; delete | SPLIT; B asset + A-reservation. | **MOVE** |
| `engine.rs:15671` | `pub(crate) fn asset_delete_inner(&mut self, authority: &PreparedAuthority, asset_id: &str, crash_mid_cascade: bool) -> SnapbackResult<Value>`; crate-visible helper | B asset facts, internal/no-op final cut depending wrapper; redundant only as a crash seam in production compilation. Its production callers can supply no correlated proof. | **MOVE** |
| `engine.rs:15680` | `fn asset_delete_inner_guarded<G, BeforeCommit>(&mut self, authority: &PreparedAuthority, asset_id: &str, crash_mid_cascade: bool, before_commit: BeforeCommit) -> SnapbackResult<Value> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private delete leaf | B facts + arbitrary A/`()` callback. | **MOVE** |

### Service ticket operations

| Location | Exact signature; visibility and effect | Validation / foreign pairing | Class |
| --- | --- | --- | --- |
| `crates/snapback-services/src/assets.rs:809` | `pub fn prepare(self) -> SnapbackResult<AssetWidthPlanTicketV1>` on `AssetWidthPrepareTicketV1`; public; reads/renders and creates plan ticket | TICKET preserves asset/key/digest but no authority origin. B-ticket goes to `engine.rs:15304` with reservation A. | **MOVE** |
| `assets.rs:893` | `pub fn into_put(self, proof: crate::asset_proof::AssetWidthPublicationPlannedProof) -> SnapbackResult<AssetWidthPutTicketV1>` on `AssetWidthPlanTicketV1`; public; creates external-write ticket | TICKET compares app/asset/key/digest and planned state. The proof says the plan committed, not which subject authorized it; the subsequent commit ticket still accepts A. | **MOVE** |
| `assets.rs:926` | `pub fn put(self) -> SnapbackResult<AssetWidthCommitTicketV1>` on `AssetWidthPutTicketV1`; public; direct object-store write and pending ticket creation | TICKET enforces put lease/hash/length. Result B-ticket is accepted by `engine.rs:15326` with A-reservation. | **MOVE** |
| `assets.rs:979` | `pub fn into_parts(self) -> SnapbackResult<(String, String, String, u64, crate::asset_proof::AssetWidthPreparedVariant, AssetPublicationPutLeaseV1)>` on `AssetWidthCommitTicketV1`; public; opens commit payload | TICKET checks commit-pending lease, not origin; engine combines parts with A-reservation. | **MOVE** |
| `assets.rs:1008` | `pub fn from_current_attempt(proof: crate::asset_proof::AssetAttemptCurrentProof, new_offset: u64, all_chunks_checksummed: bool, store: std::sync::Arc<dyn crate::assets_store::AssetStore>) -> SnapbackResult<Self>` on `AssetTusPatchTicketV1`; public; pending ticket creation | TICKET consumes current-attempt proof only. No authority origin. | **MOVE** |
| `assets.rs:1049` | `pub fn append(&self, chunk: &[u8]) -> SnapbackResult<()>` on `AssetTusPatchTicketV1`; public; direct staging-store write | TICKET enforces key/offset continuity. Later DB acknowledgement accepts authority/reservation A. | **MOVE** |
| `assets.rs:1354` | `pub fn from_current_attempt(proof: crate::asset_proof::AssetAttemptCurrentProof, request: AssetFinalizeRequestV1, frozen_intent: crate::manifest::AssetUploadIntentDefinition, on_ready: Option<String>, store: std::sync::Arc<dyn crate::assets_store::AssetStore>, image_finalization_enabled: bool, video_finalization_enabled: bool, app_id: String, app_quota: u64, schema: crate::manifest::SchemaManifest) -> SnapbackResult<Self>` on `FinalizePrepareTicketV1`; public; pending ticket creation | TICKET consumes exact attempt proof but has no origin. | **MOVE** |
| `assets.rs:1406` | `pub fn prepare(&self) -> SnapbackResult<FinalizePreparationV1>` on `FinalizePrepareTicketV1`; public; reads/renders and constructs plan input | B-ticket/preparation later commits with A-reservation. | **MOVE** |
| `assets.rs:1462` | `pub fn into_parts(self) -> FinalizePrepareParts` on `FinalizePrepareTicketV1`; public; opens the pending attempt/request/store/schema payload | TICKET carries exact attempt facts but no origin; the parts can enter a later plan commit under A. | **MOVE** |
| `assets.rs:1164` | `pub fn from_planned_publication(proof: crate::asset_proof::AssetPublicationPlannedProof, ticket: FinalizePrepareTicketV1, prepared: AssetFinalizePreparation, required_proofs: Vec<crate::asset_proof::AssetPublicationPlannedProof>, grade: AssetIntegrityGrade) -> SnapbackResult<Self>` on `FinalizePutTicketV1`; public; external-write ticket creation | TICKET compares every publication/attempt/digest/variant, but no authority origin. | **MOVE** |
| `assets.rs:1236` | `pub fn put(self) -> SnapbackResult<FinalizeCommitTicketV1>` on `FinalizePutTicketV1`; public; direct object-store writes and commit-ticket creation | TICKET enforces publication put leases and hashes. Result can be committed under A. | **MOVE** |
| `assets.rs:1479` | `pub fn into_parts(self) -> (FinalizePrepareTicketV1, AssetFinalizePreparation, AssetPublicationRecordV1, AssetIntegrityGrade, Vec<AssetPublicationPutLeaseV1>)` on `FinalizePutTicketV1`; public; opens pending payload | No origin; parts feed an independently guarded DB cut. | **MOVE** |
| `assets.rs:1512` | `pub fn into_parts(self) -> SnapbackResult<(FinalizePutTicketV1, Vec<snapback_kernel::storage::AssetPreparedVariant>)>` on `FinalizeCommitTicketV1`; public; opens commit payload | TICKET checks leases, not origin. | **MOVE** |
| `assets.rs:1542` | `pub fn cleanup(self) -> SnapbackResult<FinalizeCleanupCommitTicketV1>` on `FinalizeCleanupTicketV1`; public; direct staging/blob deletion and pending ticket creation | TICKET checks sibling-put lease state; cleanup result later accepts A-reservation at `engine.rs:14295`. | **MOVE** |
| `assets.rs:1568` | `pub fn into_parts(self) -> (AssetFinalizeResponseV1, String, String)` on `FinalizeCleanupCommitTicketV1`; public; opens cleanup-commit payload | No origin; engine commits it under independently supplied A. | **MOVE** |

Assumption for this section: the durable publication plan is a valid authority
handoff for the object-store operation only after the plan commit itself is
authority-correlated. Current proof types establish semantic continuity but do
not retroactively correlate that plan commit; therefore they are `MOVE`, not
`KEEP`.

## 4. Stream-attempt staging and persistence

| Location | Exact signature; visibility and effect | Validation in the body | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `crates/snapback-sync/src/stream_attempt.rs:85` | `pub fn stream_attempt_origin(&self) -> PreparedStreamAttemptOrigin` on `PreparedAuthority`; public; creates origin carrier | Privately classifies B as caller-authorized or mode-only and stores B. | The carrier controls who may mutate registry state, but the resulting dirty rows/batch do not retain this origin. | **MOVE** |
| `stream_attempt.rs:102` | `pub fn stream_runner_host(&self, abandoned: Arc<AtomicBool>) -> StreamRunnerHost` on `PreparedAuthority`; public; creates host settlement carrier | Stores B privately. | Host-mutated dirty rows later enter a mixed registry batch with no origin. | **MOVE** |
| `stream_attempt.rs:408` | `fn new(authority: PreparedAuthority, abandoned: Arc<AtomicBool>) -> Self`; private; `StreamRunnerHost` constructor | Stores B; no separate authority input. | The host itself is closed, but persistence erases its origin. It must feed a consuming/mapped carrier rather than an originless batch. | **MOVE** |
| `stream_attempt.rs:549` | `fn stage_start_from<P: StreamAttemptTransitionOrigin>(&self, origin: &P, namespace: usize, client_key: &str, runner: &StreamRunnerIdentity, persisted: Option<&PersistedStreamAttempt>) -> SnapbackResult<StreamAttemptStart>`; private reachable; mutates dirty registry | Checks origin class, idempotency, persisted identity, and runner lease. | Dirty state loses origin and commits with no guard. | **MOVE** |
| `stream_attempt.rs:569` | `fn stage_start_with_metadata_from<P: StreamAttemptTransitionOrigin>(&self, origin: &P, namespace: usize, client_key: &str, runner: &StreamRunnerIdentity, persisted: Option<&PersistedStreamAttempt>, metadata: StreamAttemptMetadata) -> SnapbackResult<StreamAttemptStart>`; private staging leaf | Same plus metadata validation. | Dirty state loses origin; no final subject guard. | **MOVE** |
| `stream_attempt.rs:826` | `fn stage_cursor_premark_from<P: StreamAttemptTransitionOrigin>(&self, origin: &P, attempt_token: &str, cursor_id: &str, runner: &StreamRunnerIdentity) -> SnapbackResult<()>`; private staging leaf | Checks origin class, attempt terminal state, exact runner lease, retry rule. | Dirty premark later commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1136` | `fn stage_initiator_cancel_from<P: StreamAttemptTransitionOrigin>(&self, origin: &P, attempt_token: &str, initiator: &StreamInitiator) -> SnapbackResult<StreamAttemptTerminal>`; private staging leaf | Checks origin class and initiator ownership. | Dirty terminal row later commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1170` | `fn settle_authored<P: StreamAttemptTransitionOrigin>(&self, origin: &P, attempt_token: &str, cause: StreamAttemptCause, runner: &StreamRunnerIdentity) -> SnapbackResult<StreamAttemptTerminal>`; private staging leaf | Checks origin class, runner lease, and terminal state. | Dirty terminal row later commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1374` | `pub fn stage_start(&self, registry: &StreamAttemptRegistry, namespace: usize, client_key: &str, runner: &StreamRunnerIdentity, persisted: Option<&PersistedStreamAttempt>) -> SnapbackResult<StreamAttemptStart>` on `PreparedStreamAttemptOrigin`; public; stages dirty state | Dispatches only through the carrier's private B class. | Origin is erased in registry dirty state; persistence has no guard. | **MOVE** |
| `stream_attempt.rs:1399` | `pub fn stage_start_with_metadata(&self, registry: &StreamAttemptRegistry, namespace: usize, client_key: &str, runner: &StreamRunnerIdentity, persisted: Option<&PersistedStreamAttempt>, metadata: StreamAttemptMetadata) -> SnapbackResult<StreamAttemptStart>`; public; stages | Same. | Same origin erasure. | **MOVE** |
| `stream_attempt.rs:1429` | `pub fn stage_cursor_premark(&self, registry: &StreamAttemptRegistry, attempt_token: &str, cursor_id: &str, runner: &StreamRunnerIdentity) -> SnapbackResult<()>`; public; stages | Same plus lease/retry checks. | Same origin erasure. | **MOVE** |
| `stream_attempt.rs:1446` | `pub fn stage_authored_terminal(&self, registry: &StreamAttemptRegistry, attempt_token: &str, cause: StreamAttemptCause, runner: &StreamRunnerIdentity) -> SnapbackResult<StreamAttemptTerminal>`; public; stages | Same plus authored terminal checks. | Same origin erasure. | **MOVE** |
| `stream_attempt.rs:1463` | `pub fn stage_initiator_cancel(&self, registry: &StreamAttemptRegistry, attempt_token: &str, initiator: &StreamInitiator) -> SnapbackResult<StreamAttemptTerminal>`; public; stages | Same plus initiator ownership. | Same origin erasure. | **MOVE** |
| `stream_attempt.rs:885` | `pub fn record_transport_outcome_host(&self, host: &StreamRunnerHost, cursor_id: &str, state: StreamInitiationState)`; public; mutates dirty state | Checks B-host identity/runner state. | Origin is not present in persistence batch. | **MOVE** |
| `stream_attempt.rs:925` | `pub fn record_cursor_close_host(&self, host: &StreamRunnerHost, cursor_id: &str)`; public; mutates dirty state | B-host and cursor state. | Commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:981` | `pub fn record_progress_commit_host(&self, host: &StreamRunnerHost)`; public; mutates durable-progress pending state | B-host/runner state. | Commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1050` | `pub fn record_emit_counters_host(&self, host: &StreamRunnerHost, attempt_token: &str, byte_len: usize) -> SnapbackResult<StreamChunkEmission>`; public; mutates dirty counters | B-host, token, lease, and counter bounds. | Commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1214` | `pub fn settle_provider_outcome_host(&self, host: &StreamRunnerHost, attempt_token: &str, cause: StreamAttemptCause) -> SnapbackResult<StreamAttemptTerminal>`; public; stages terminal state | B-host, token, lease, terminal checks. | Commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:1274` | `pub fn adopt_terminal_host(&self, namespace: usize, durable: DurableStreamAttempt<StreamRunnerHost>) -> SnapbackResult<StreamAttemptStart>`; public; imports durable state under host carrier | TICKET verifies durable token/client/terminal facts and B-host lease. | Any new dirty state later commits without carrying B. | **MOVE** |
| `stream_attempt.rs:1304` | `pub fn terminalize_invocation_host(&self, host: &StreamRunnerHost, cause: StreamAttemptCause) -> Vec<StreamAttemptTerminal>`; public; stages terminal fan-out | B-host owns invocation; rows become dirty. | Commits with no subject guard. | **MOVE** |
| `stream_attempt.rs:528` | `pub fn persistence_batch(&self, namespace: usize) -> SnapbackResult<(Vec<PersistedStreamAttempt>, snapback_types::stream_attempt::StreamAttemptPersistenceBatch)>`; public; creates authenticated pending batch | TICKET: HMAC prevents row injection/replacement after snapshot. It does not include or partition by authority origin. | Not merely B + A: the batch commits with **no** subject guard and may combine dirty rows from multiple origins. | **MOVE** |
| `crates/snapback-engine/src/local/engine.rs:7750` | `pub fn persist_stream_attempts(&mut self, batch: &crate::stream_attempt::StreamAttemptPersistenceBatch) -> SnapbackResult<()>`; public; direct SQLite upsert | Verifies batch HMAC/shape through kernel. No authority parameter or final guard. | B-batch commits with no guard. | **MOVE** |
| `crates/snapback-kernel/src/storage/settlement.rs:114` | `pub(super) fn upsert_stream_attempts(&mut self, rows: &[(String, String, String)], now_ms: u64) -> SnapbackResult<()>`; restricted kernel write wrapper | Forwards to private leaf with `|| Ok(())`. | Explicit no-guard commit. | **MOVE** |
| `settlement.rs:125` | `fn upsert_stream_attempts_guarded<G, BeforeCommit>(&mut self, rows: &[(String, String, String)], now_ms: u64, before_commit: BeforeCommit) -> SnapbackResult<()> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; private commit leaf | Validates row identities/JSON earlier in the storage adapter; callback is unconstrained and production supplies `()`. | B rows + A-guard or `()`; current production is `()`. | **MOVE** |

The settlement carrier is `UNCLEAR` nowhere: the concrete no-op call proves the
absence of correlation. What remains a design choice is whether the replacement
partitions a mixed batch by origin or treats a previously committed durable plan
as a closed handoff.

## 5. Authority-derived plans and raw-guard writes

### Service-terminal plans

| Location | Exact signature; visibility and effect | Validation / foreign pairing | Class |
| --- | --- | --- | --- |
| `engine.rs:5940` | `pub fn plan_grant_revocation_service_terminal(&self, authority: &PreparedAuthority, user_id: &str, grant_id: &str, now_ms: u64) -> SnapbackResult<ServiceAuthorityTerminalPlan>`; public; terminal plan | Validates B admission and selects token IDs/disposition. Plan stores registry/IDs/disposition, not B. Server may acquire this gate and separately pass a raw guard from A to the revocation write. | **MOVE** |
| `engine.rs:5969` | `pub fn plan_bulk_grant_revocation_service_terminal(&self, authority: &PreparedAuthority, user_id: &str, actor_id: &str, now_ms: u64) -> SnapbackResult<ServiceAuthorityTerminalPlan>`; public; terminal plan | Same TERMINAL shape; B-plan + A-effect is structurally possible. | **MOVE** |
| `engine.rs:6151` | `pub fn plan_expired_service_authority(&self, authority: &PreparedAuthority, now_ms: u64, monotonic_now: Instant) -> SnapbackResult<Option<ExpiredServiceAuthorityPlan>>`; public; terminal plan | Derives exact deadline/token disposition from B, but plan has no B-origin. | **MOVE** |
| `engine.rs:6426` | `pub fn plan_integration_principal_service_terminal(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, principal_user_id: &str) -> SnapbackResult<ServiceAuthorityTerminalPlan>`; public; terminal plan | Validates process-bound operator and B; plan still lacks B-origin. | **MOVE** |
| `engine.rs:3307` | `pub async fn acquire_gate(&self) -> SnapbackResult<crate::auth::service_fence::ServiceAuthorityTerminalGate>` on `ServiceAuthorityTerminalPlan`; public; issues terminal gate | Gate is bound to token IDs/disposition in this plan, not to subject authority. | A gate can surround a raw write whose subject facts came from B; no origin comparison exists. | **MOVE** |
| `engine.rs:3411` | `pub async fn acquire_gate(&self) -> SnapbackResult<crate::auth::service_fence::ServiceAuthorityTerminalGate>` on `ExpiredServiceAuthorityPlan`; public; issues terminal gate | Same TERMINAL binding. | Same B-plan/A-effect independence. | **MOVE** |
| `engine.rs:6184` | `pub fn commit_expired_service_authority(&mut self, plan: &ExpiredServiceAuthorityPlan) -> SnapbackResult<()>`; public; direct terminal write | Consumes deadline facts only; the required gate is ambient control flow. | A gate from a different same-token plan can surround B plan; this function cannot compare them. | **MOVE** |
| `engine.rs:7626` | `pub(crate) fn persist_and_validate_prepared_service_authority(&mut self, authority: &PreparedAuthority) -> SnapbackResult<()>`; crate-visible; validation wrapper that may persist an expired deadline | Delegates to the classified wrapper below, which calls `persist_service_deadline_if_due(B)` before read-only validation. | It can commit B's deadline with no closed terminal carrier. | **MOVE** |
| `engine.rs:7634` | `pub(crate) fn persist_and_validate_prepared_service_authority_classified(&mut self, authority: &PreparedAuthority) -> Result<(), AuthorizedEffectReservationError>`; crate-visible; production validation leaf that may write | Calls the direct deadline persistence seam with B, then validates B's exact service fence. | The validation result type does not carry a final-cut proof; an expired deadline may already have committed without one. | **MOVE** |
| `engine.rs:7643` | `pub fn persist_service_deadline_if_due(&mut self, authority: &PreparedAuthority) -> SnapbackResult<()>`; public; direct expiry write for unmanaged embedders | Derives deadline from B. Managed Local use refuses and delegates to owned terminal choreography; unmanaged use directly terminalizes without a typed gate. | No foreign guard is supplied, but no closed terminal carrier is required either. It must consume the terminal carrier; this is not `KEEP`. | **MOVE** |
| `crates/snapback-server/src/server.rs:18179` | `async fn persist_expired_service_authority_owned(runtime: &AppState, authority: PreparedAuthority) -> SnapbackResult<()>`; private production terminal choreography | Plans from B, acquires the gate from that exact plan, and commits the same plan; no second authority/plan/gate parameter exists. | Structurally blocked in this wrapper. The lower public plan/gate/commit pieces remain open and therefore move. | **KEEP** |

### Server auth-plan consumers

| Location | Exact signature; visibility and effect | Validation / foreign pairing | Class |
| --- | --- | --- | --- |
| `crates/snapback-server/src/server.rs:18484` | `async fn commit_session_password_issuance_plan(runtime: &AppState, provider: &Arc<AuthProvider>, plan: ProviderSessionIssuancePlan, authority: &PreparedAuthority, effect: &'static str) -> Result<IssuanceFinish, SnapbackError>`; private production premark + auth commit | The coordinator turns the independently supplied plan into a premarked carrier. The final effect guard comes from A-authority; no check relates A to the subject that produced B-plan. Concrete pairing: B issuance plan + A authority. | **MOVE** |
| `server.rs:19815` | `async fn commit_password_change_plan(runtime: &AppState, provider: &Arc<AuthProvider>, plan: crate::auth::provider::ProviderPasswordChangePlan, authority: &PreparedAuthority) -> Result<PasswordChangeFinish, SnapbackError>`; private production premark + auth commit | Same SPLIT shape: B password-change plan is premarked, then committed under A's effect guard. Provider admission/commit certainty checks do not compare subject origins. | **MOVE** |

### Eight raw engine entry points

| Location | Exact signature; visibility/effect | Authority validation and survivor | Foreign pairing | Class |
| --- | --- | --- | --- | --- |
| `engine.rs:5703` | `pub fn register_agent_principal(&mut self, effect: &AdmissionEffectGuard<'_>, mode: crate::manifest::AgentsMode, invitation: Option<&crate::auth::crypto::CreationInvitation>, display_name: Option<String>, operator_contact: Option<String>, class: crate::storage::auth_integrations::AgentRegistrationClass, integration_facts: crate::storage::auth_integrations::IntegrationRegistrationFacts, profile: ServerProfile, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<crate::storage::auth_agent_credentials::IssuedAgentCredential>`; direct write | RAW. Ceremony policy is expressed only by arguments/server prechecks. Survivor: new closed `AgentRegistrationCommit` consuming sink. | Guard remains live, but its authority cannot be compared to the invitation/ceremony subject. | **DELETE** |
| `engine.rs:5730` | `pub fn mint_agent_invitation(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, profile: ServerProfile, proof: &crate::auth::crypto::StepUpProof, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<crate::storage::auth_agents::IssuedAgentInvitation>`; direct write | RAW. Survivor `mint_agent_invitation_with_authorized_effect` (`:5744`) after it moves to the carrier. | Effect A + user/proof B cannot be compared. | **DELETE** |
| `engine.rs:5780` | `pub fn mint_pairing_code(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<crate::storage::auth_grants::MintedPairingCode>`; direct write | RAW. Survivor `mint_pairing_code_with_authorized_effect` (`:5791`) after carrier migration. | Effect A + user B. | **DELETE** |
| `engine.rs:5846` | `pub fn present_pairing_code(&mut self, effect: &AdmissionEffectGuard<'_>, credential: &crate::auth::crypto::AgentCredential, pairing_request_id: &str, pairing_code: &crate::auth::crypto::PairingCode, requested_scopes: &[crate::storage::auth_grants::GrantScopeRequest], now_ms: u64) -> SnapbackResult<crate::storage::auth_grants::PairingPresentation>`; direct write | RAW. Survivor: new closed `PairingPresentationCommit` consuming sink. | Effect A + credential/pairing subject B. | **DELETE** |
| `engine.rs:5876` | `pub fn approve_grant_request(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, session_id: &str, request_id: &str, requested_ttl_ms: Option<u64>, proof: Option<&crate::auth::crypto::StepUpProof>, now_ms: u64) -> SnapbackResult<crate::storage::auth_grants::GrantApproval>`; direct write | RAW. Survivor: bound-authority grant-approval sink. | Effect A + session/request B. | **DELETE** |
| `engine.rs:5897` | `pub fn deny_grant_request(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, request_id: &str, now_ms: u64) -> SnapbackResult<()>`; direct write | RAW. Survivor: bound-authority grant-denial sink. | Effect A + request B. | **DELETE** |
| `engine.rs:5958` | `pub fn revoke_grant_for_user(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, grant_id: &str, now_ms: u64) -> SnapbackResult<crate::storage::auth_grants::GrantRevocation>`; direct write | RAW plus separate terminal plan/gate. Survivor: one bound authority + terminal-plan consuming sink. | Effect A + grant/terminal plan B. | **DELETE** |
| `engine.rs:5987` | `pub fn revoke_grants_by_actor_for_user(&mut self, effect: &AdmissionEffectGuard<'_>, user_id: &str, actor_id: &str, now_ms: u64) -> SnapbackResult<crate::storage::auth_grants::BulkGrantRevocation>`; direct write | RAW plus separate terminal plan/gate. Survivor: one bound authority + terminal-plan consuming sink. | Effect A + actor/terminal plan B. | **DELETE** |

The `let _ = effect` statements in these bodies merely mark the borrowed
reference used. They do not shorten the caller's guard lifetime.

### Separately supplied reservations

These are direct durable sinks rather than staging producers, but they are in
scope because they accept both axes independently. Every row is SPLIT and every
concrete pairing is “subject/intent B + `AuthorizedEffectReservation` A.”

| Location | Exact signature; visibility and effect | Validation | Class |
| --- | --- | --- | --- |
| `engine.rs:5545` | `pub fn mint_capability_link_with_authorized_effect(&mut self, authority: &PreparedAuthority, request: crate::storage::capability_links::MintCapabilityLink, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::storage::capability_links::MintedCapabilityLink>`; direct write | B admission/source/request; A reservation only validates itself. | **MOVE** |
| `engine.rs:5660` | `pub fn revoke_capability_link_with_authorized_effect(&mut self, authority: &PreparedAuthority, id: &str, now_ms: u64, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<()>`; direct write | B ownership/source; A reservation. | **MOVE** |
| `engine.rs:5744` | `pub fn mint_agent_invitation_with_authorized_effect(&mut self, authority: &PreparedAuthority, user_id: &str, profile: ServerProfile, proof: &crate::auth::crypto::StepUpProof, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::storage::auth_agents::IssuedAgentInvitation>`; direct write | B session/step-up; A reservation. | **MOVE** |
| `engine.rs:5791` | `pub fn mint_pairing_code_with_authorized_effect(&mut self, authority: &PreparedAuthority, user_id: &str, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<crate::storage::auth_grants::MintedPairingCode>`; direct write | B admission, source, session user; A reservation. | **MOVE** |
| `engine.rs:6314` | `pub fn reserve_ask_spend_with_authorized_effect(&mut self, authority: &PreparedAuthority, now_ms: u64, subject: crate::storage::ask_spend::AskSpendSubject, budgets: &crate::manifest::ApiAskBudgets, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<(crate::storage::ask_spend::AskSpendReservation, crate::storage::ask_spend::AskSpendFacts)>`; direct budget write | B admission; subject is a separately projected value; A reservation. | **MOVE** |
| `server.rs:27552` | `fn ask_spend_subject(authority: &ResolvedAppAuthority) -> SnapbackResult<crate::storage::ask_spend::AskSpendSubject>`; private intent constructor | Projects B's visible principal/integration keys; output contains no origin and `reserve_ask_spend_with_authorized_effect` does not compare it to A. | **MOVE** |
| `engine.rs:6550` | `pub fn claim_push_batch_with_authorized_effect(&mut self, authority: &PreparedAuthority, batch_id: &str, now_ms: u64, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<Option<crate::push::PushBatchClaimV1>>`; direct claim write | B push authority; A reservation. | **MOVE** |
| `engine.rs:6583` | `pub fn mark_push_batch_transmitting_with_authorized_effect(&mut self, authority: &PreparedAuthority, claim: &crate::push::PushBatchClaimV1, now_ms: u64, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<()>`; direct write | B authority/claim; A reservation. | **MOVE** |
| `engine.rs:7376` | `pub fn reserve_push_send_with_authorized_effect(&mut self, authority: &PreparedAuthority, trigger_mode: crate::push::PushTriggerModeV1, deferred_grant: Option<&crate::push::PushDeferredGrantV1>, request: &crate::push::PushSendRequestV1, now_ms: u64, authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<(crate::push::ReservedPushAttemptV1, crate::push::PushSeamDeclarationV1)>`; direct reservation write | B source/schema/deferred grant/request; A reservation. | **MOVE** |
| `engine.rs:11276` | `pub(crate) fn acknowledge_client_mutations_with_authorized_effect(&mut self, authority: &PreparedAuthority, ids: &[String], authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<u64>`; direct settlement deletion | B authority fingerprint/instance; A reservation. | **MOVE** |
| `engine.rs:11473` | `pub fn acknowledge_client_mutations_with_authority_descriptor_and_authorized_effect(&mut self, authority: &PreparedAuthority, authority_descriptor: Option<&AuthorityDescriptor>, ids: &[String], authorized_effect: AuthorizedEffectReservation) -> SnapbackResult<u64>`; direct settlement deletion | B descriptor/fingerprint/instance; A reservation. | **MOVE** |

The direct push helper behind the redundant compatibility wrapper is also an
entry point: `engine.rs:7422`,
`fn reserve_push_send_with_schema(&mut self, authority: &PreparedAuthority, declaration: &crate::push::PushSeamDeclarationV1, schema: &crate::manifest::SchemaManifest, trigger_mode: crate::push::PushTriggerModeV1, deferred_grant: Option<&crate::push::PushDeferredGrantV1>, request: &crate::push::PushSendRequestV1, now_ms: u64) -> SnapbackResult<crate::push::ReservedPushAttemptV1>`,
is private and reachable from `reserve_push_send`. It validates/guards from the
same B authority, but is redundant; **DELETE**, with the carrier-consuming
replacement for `reserve_push_send_with_authorized_effect` as survivor.

The asset and mutation SPLIT rows above account for the remaining engine guard
calls. Private asset helpers with `Option<AuthorizedEffectReservation>` are
listed because production wrappers reach them; they must not become an
`None` escape hatch.

### Redundant SAME wrappers

These wrappers obtain a guard from their own authority, so foreign pairing is
structurally impossible in the current body. They are nevertheless redundant
siblings of the named split-phase entry point and should be deleted while that
survivor moves to the carrier:

| Location | Exact signature | Survivor | Class |
| --- | --- | --- | --- |
| `engine.rs:5499` | `pub fn mint_capability_link(&mut self, authority: &PreparedAuthority, request: crate::storage::capability_links::MintCapabilityLink) -> SnapbackResult<crate::storage::capability_links::MintedCapabilityLink>` | `mint_capability_link_with_authorized_effect` | **DELETE** |
| `engine.rs:5622` | `pub fn revoke_capability_link(&mut self, authority: &PreparedAuthority, id: &str, now_ms: u64) -> SnapbackResult<()>` | `revoke_capability_link_with_authorized_effect` | **DELETE** |
| `engine.rs:6294` | `pub fn reserve_ask_spend(&mut self, authority: &PreparedAuthority, now_ms: u64, subject: crate::storage::ask_spend::AskSpendSubject, budgets: &crate::manifest::ApiAskBudgets) -> SnapbackResult<(crate::storage::ask_spend::AskSpendReservation, crate::storage::ask_spend::AskSpendFacts)>` | `reserve_ask_spend_with_authorized_effect` | **DELETE** |
| `engine.rs:6534` | `pub fn claim_push_batch(&mut self, authority: &PreparedAuthority, batch_id: &str, now_ms: u64) -> SnapbackResult<Option<crate::push::PushBatchClaimV1>>` | `claim_push_batch_with_authorized_effect` | **DELETE** |
| `engine.rs:6565` | `pub fn mark_push_batch_transmitting(&mut self, authority: &PreparedAuthority, claim: &crate::push::PushBatchClaimV1, now_ms: u64) -> SnapbackResult<()>` | `mark_push_batch_transmitting_with_authorized_effect` | **DELETE** |
| `engine.rs:7342` | `pub fn reserve_push_send(&mut self, authority: &PreparedAuthority, trigger_mode: crate::push::PushTriggerModeV1, deferred_grant: Option<&crate::push::PushDeferredGrantV1>, request: &crate::push::PushSendRequestV1, now_ms: u64) -> SnapbackResult<(crate::push::ReservedPushAttemptV1, crate::push::PushSeamDeclarationV1)>` | `reserve_push_send_with_authorized_effect` | **DELETE** |
| `engine.rs:11223` | `pub(crate) fn acknowledge_client_mutations_with_authority(&mut self, authority: &PreparedAuthority, ids: &[String]) -> SnapbackResult<u64>` | `acknowledge_client_mutations_with_authorized_effect` | **DELETE** |
| `engine.rs:11457` | `pub fn acknowledge_client_mutations_with_authority_descriptor(&mut self, authority: &PreparedAuthority, authority_descriptor: Option<&AuthorityDescriptor>, ids: &[String]) -> SnapbackResult<u64>` | `acknowledge_client_mutations_with_authority_descriptor_and_authorized_effect` | **DELETE** |

### Direct SAME writes that are not staging seams

The following functions are included because the requested boundary includes
direct writes. In each body the subject checks and final guard are derived from
the same authority parameter, and the function neither returns a pending value
nor accepts a guard/reservation. Therefore a foreign guard cannot be supplied
through its supported signature. That is a structural `KEEP`, not “no exploit
found.” This says only that mandatory *correlation* does not require changing
them; other lock-order or authority-class work may still do so.

| Location | Exact signature; effect and body validation | Class |
| --- | --- | --- |
| `engine.rs:5069` | `pub fn begin_oauth_authorization(&mut self, authority: &PreparedAuthority, consenting_user_id: &str, client_id: &str, redirect_uri: &str, bundle_names: &[String], code_challenge: &str, oauth_state: Option<&str>, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<crate::storage::auth_integrations::BegunOAuthAuthorization>`; validates OAuth/session subject and obtains the guard from that same `authority`. | **KEEP** |
| `engine.rs:5094` | `pub fn deny_oauth_authorization(&mut self, authority: &PreparedAuthority, consenting_user_id: &str, request_id: &str, now_ms: u64) -> SnapbackResult<crate::storage::auth_integrations::DeniedOAuthAuthorization>`; same-authority OAuth denial write. | **KEEP** |
| `engine.rs:5107` | `pub fn approve_oauth_grant_request(&mut self, authority: &PreparedAuthority, effective_user_id: &str, session_id: &str, request_id: &str, step_up_proof: Option<&crate::auth::crypto::StepUpProof>, now_ms: u64) -> SnapbackResult<crate::storage::auth_grants::GrantApproval>`; same-authority session/step-up and guard. | **KEEP** |
| `engine.rs:5127` | `pub fn issue_oauth_authorization_code(&mut self, authority: &PreparedAuthority, consenting_user_id: &str, request_id: &str, now_ms: u64, random: &dyn crate::auth::crypto::RandomSource) -> SnapbackResult<crate::storage::auth_integrations::IssuedOAuthAuthorization>`; same-authority OAuth write. | **KEEP** |
| `engine.rs:5173` | `pub fn pending_effects_for_approver(&mut self, authority: &PreparedAuthority, principal_id: &str, now_ms: u64) -> SnapbackResult<Vec<crate::storage::pending_effects::PendingEffectRecord>>`; listing transaction may expire rows; same-authority guard. | **KEEP** |
| `engine.rs:5183` | `pub fn pending_effect(&mut self, authority: &PreparedAuthority, id: &str, now_ms: u64) -> SnapbackResult<crate::storage::pending_effects::PendingEffectRecord>`; lookup may expire a row; same-authority guard. | **KEEP** |
| `engine.rs:5237` | `pub fn refuse_pending_effect(&mut self, authority: &PreparedAuthority, id: &str, outcome_code: &str, now_ms: u64) -> SnapbackResult<()>`; same-authority effect-management check and guard. | **KEEP** |
| `engine.rs:5250` | `pub fn approve_pending_effect(&mut self, effect: &crate::storage::pending_effects::PendingEffectRecord, original: &PreparedAuthority, management: &PreparedAuthority, approver_id: &str, step_up: Option<&crate::auth::crypto::StepUpProof>, now_ms: u64) -> SnapbackResult<crate::storage::pending_effects::PendingEffectRecord>`; validates original as the retained execution subject and management as approver; the durable approval guard is derived internally from `management`. Assumption: the approval row's commit subject is management, while `original` is policy input for the later execution. | **KEEP** |
| `engine.rs:5328` | `pub fn settle_pending_effect(&mut self, authority: &PreparedAuthority, id: &str, executed: bool, outcome_code: Option<&str>, now_ms: u64) -> SnapbackResult<crate::storage::pending_effects::PendingEffectRecord>`; same execution authority and guard. | **KEEP** |
| `engine.rs:5341` | `pub fn deny_pending_effect(&mut self, authority: &PreparedAuthority, id: &str, approver_id: &str, now_ms: u64) -> SnapbackResult<crate::storage::pending_effects::PendingEffectRecord>`; same management authority and guard. | **KEEP** |
| `engine.rs:5581` | `pub fn consume_capability_link_use(&mut self, authority: &PreparedAuthority, link: &ResolvedCapabilityLink, now_ms: u64) -> SnapbackResult<ConsumedCapabilityLinkUse>`; the consumption write uses B's internal guard, but the returned opaque use contains only link ID/ordinal and is later accepted by `settle_capability_link_use` beside A. Concrete pairing: consume under B, settle under A. | **MOVE** |
| `engine.rs:5603` | `pub fn settle_capability_link_use(&mut self, authority: &PreparedAuthority, use_: ConsumedCapabilityLinkUse, outcome: &str, now_ms: u64) -> SnapbackResult<()>`; direct terminal accounting derives its guard from A but does not compare A with the B-origin use. If the use is intended as a durable handoff, that must become the closed terminal carrier rather than remain beside an unrelated authority. | **MOVE** |
| `engine.rs:5865` | `pub fn pending_grant_requests(&mut self, authority: &PreparedAuthority, user_id: &str, now_ms: u64) -> SnapbackResult<Vec<crate::storage::auth_grants::PendingGrantRequest>>`; listing may expire rows; same authority/user check and guard. | **KEEP** |
| `engine.rs:5908` | `pub fn grants_for_user(&mut self, authority: &PreparedAuthority, user_id: &str, now_ms: u64) -> SnapbackResult<Vec<crate::storage::auth_grants::UserGrant>>`; listing may expire rows; same guard. | **KEEP** |
| `engine.rs:6332` | `pub fn settle_ask_spend(&mut self, authority: &PreparedAuthority, reservation: &crate::storage::ask_spend::AskSpendReservation, actual_tokens: u64, actual_result_bytes: u64) -> SnapbackResult<crate::storage::ask_spend::AskSpendFacts>`; direct terminal accounting guard comes from A, while the spend reservation may have been created under B; the body does not compare them. The reservation may become a closed handoff carrier, but the present two-argument shape is B + A. | **MOVE** |
| `engine.rs:6391` | `pub fn create_pending_effect(&mut self, authority: &PreparedAuthority, link: Option<&ResolvedCapabilityLink>, mut request: crate::storage::pending_effects::CreatePendingEffect) -> SnapbackResult<crate::storage::pending_effects::PendingEffectRecord>`; validates authority/link and guards write from same authority. | **KEEP** |
| `engine.rs:6443` | `pub fn retire_integration_principal(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, principal_user_id: &str, now_ms: u64) -> SnapbackResult<crate::storage::auth_agent_credentials::AgentFamilyRevocation>`; process operator identity and authority/source validated; guard from same authority. | **KEEP** |
| `engine.rs:6456` | `pub fn set_integration_suspended(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, principal_user_id: &str, suspended: bool, now_ms: u64) -> SnapbackResult<crate::storage::auth_integrations::IntegrationRecord>`; same process/operator authority and guard. | **KEEP** |
| `engine.rs:6479` | `pub fn clear_password_lockout(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, email: &str) -> SnapbackResult<bool>`; same operator authority and guard. | **KEEP** |
| `engine.rs:6511` | `pub fn set_declared_client_status(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, normalized_id: &str, status: crate::storage::declared_clients::DeclaredClientStatus) -> SnapbackResult<crate::storage::declared_clients::DeclaredClientRecord>`; same operator authority and guard. | **KEEP** |
| `engine.rs:6523` | `pub fn delete_declared_client(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, normalized_id: &str) -> SnapbackResult<()>`; same operator authority and guard. | **KEEP** |
| `engine.rs:6598` | `pub fn settle_push_batch(&mut self, authority: &PreparedAuthority, claim: &crate::push::PushBatchClaimV1, settlement: &crate::push::PushBatchSettlementV1, now_ms: u64) -> SnapbackResult<()>`; A supplies the internal guard while B's independently issued claim supplies the durable subject; no comparison exists. A future closed durable-handoff claim can replace both axes. | **MOVE** |
| `engine.rs:6696` | `pub fn register_push_token(&mut self, authority: &PreparedAuthority, request: &crate::push::RegisterPushTokenRequest, now_ms: u64) -> SnapbackResult<crate::push::PushTokenRegistrationResponse>`; exact push-registry session check and same guard. | **KEEP** |
| `engine.rs:6723` | `pub fn unregister_push_token(&mut self, authority: &PreparedAuthority, request: &crate::push::UnregisterPushTokenRequest, now_ms: u64) -> SnapbackResult<crate::push::PushTokenUnregisterResponse>`; same. | **KEEP** |
| `engine.rs:7141` | `pub fn erase_protected_record_admitted(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, wire: crate::proof_checkpoint::ProtectedRecordErasureWireRequestV1, credential_class: &str, credential_digest_sha256: &str, now_ms: u64, monotonic_now: Instant) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1>`; exact source/mode/operator/fenced-publication checks and guard from same authority inside one closure. | **KEEP** |
| `engine.rs:7219` | `pub fn activate_agent_safe_operation_coverage_admitted(&mut self, operator: &EngineOperatorAuthority, authority: &PreparedAuthority, now_ms: u64, monotonic_now: Instant) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1>`; exact source/mode/operator/fenced-publication and same guard. | **KEEP** |
| `engine.rs:7292` | `pub fn deny_derived_fork_host_op_admitted(&self, authority: &PreparedAuthority, op: &str, now_ms: u64) -> SnapbackResult<()>`; denial-marker autocommit occurs under guard obtained from the same authority. | **KEEP** |
| `engine.rs:11338` | `pub fn issue_client_operation_identity_range(&mut self, authority: &PreparedAuthority, client_audience_id: &str, authority_descriptor: Option<&AuthorityDescriptor>, previous: Option<&crate::commit_envelope::ClientIdentityRangeV1>) -> SnapbackResult<crate::commit_envelope::ClientIdentityRangeV1>`; descriptor/audience and same-authority guard. | **KEEP** |
| `engine.rs:16533` | `pub(crate) fn invoke_mutation_with_authority(&mut self, name: &str, input: HandlerInput, authority: PreparedAuthority) -> SnapbackResult<MutationOutput>`; direct compatibility mutation path derives prepared invocation and guard internally from that same authority. | **KEEP** |
| `engine.rs:16546` | `pub(crate) fn invoke_mutation_with_authority_and_dependencies(&mut self, name: &str, input: HandlerInput, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, MutationDependencyCapture)`; same internal authority path. | **KEEP** |
| `engine.rs:16674` | `pub(crate) fn invoke_mutation_recording_with_authority(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, transport: &str, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, Receipt)`; same embedded authority/guard. | **KEEP** |
| `engine.rs:16696` | `pub(crate) fn invoke_mutation_recording_with_authority_and_dependencies(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, transport: &str, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, Receipt, MutationDependencyCapture)`; same. | **KEEP** |
| `engine.rs:16725` | `pub(crate) fn invoke_mutation_recording_with_authority_descriptor(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, transport: &str, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, Receipt)`; same. | **KEEP** |
| `engine.rs:16747` | `fn invoke_mutation_recording_with_authority_descriptor_and_dependencies(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, transport: &str, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, Receipt, MutationDependencyCapture)`; private reachable direct path; same embedded authority. | **KEEP** |
| `engine.rs:16839` | `fn invoke_mutation_recording_with_authority_descriptor_in_scope_and_dependencies(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, transport: &str, authority: PreparedAuthority) -> (SnapbackResult<MutationOutput>, Receipt, MutationDependencyCapture)`; private reachable direct path; same. | **KEEP** |
| `engine.rs:16894` | `pub(crate) fn invoke_mutation_recording_with_authority_descriptor_and_acknowledgements(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, acknowledged_client_mutation_ids: &[String], transport: &str, authority: PreparedAuthority) -> SnapbackResult<(SnapbackResult<MutationOutput>, Receipt)>`; direct path; same embedded authority. | **KEEP** |
| `engine.rs:18124` | `fn invoke_mutation_commit_with_id_and_authority(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, receipt_mutation_id: Option<&str>, authority: PreparedAuthority) -> SnapbackResult<MutationCommit>`; private direct leaf; guard is derived from prepared B inside the call. | **KEEP** |
| `engine.rs:18149` | `fn invoke_mutation_commit_with_id_authority_and_branch(&mut self, name: &str, input: HandlerInput, client_mutation_id: Option<String>, authority_descriptor: Option<AuthorityDescriptor>, receipt_mutation_id: Option<&str>, authority: PreparedAuthority, branch_operation: Option<&crate::fork_promotion::BranchMutationCommitV1>, permission_epoch_preflight: fn(&LocalSnapback, &BTreeSet<String>) -> SnapbackResult<()>) -> SnapbackResult<MutationCommit>`; private leaf; same prepared authority supplies the mode guard. | **KEEP** |
| `engine.rs:21770` | `pub(crate) fn manual_retry_authorization_invalidation(&mut self, input: AuthorizationInvalidationManualRetryInput, connection: AuthorizationInvalidationConnection, authority: PreparedAuthority) -> SnapbackResult<AuthorizationInvalidationManualRetryOutput>`; reservation row and later retry settlement; validates source, exact subscription owner/connection, and uses that same authority for every direct guard. | **KEEP** |
| `engine.rs:24618` | `pub fn create_watch(&mut self, authority: &PreparedAuthority, request: crate::watches::CreateWatchSpec, now_ms: u64) -> SnapbackResult<crate::watches::CreatedWatch>`; direct guarded watch creation. | **KEEP** |
| `engine.rs:24933` | `pub fn transition_watch(&mut self, authority: &PreparedAuthority, id: &str, target: crate::watches::WatchStatus, now_ms: u64) -> SnapbackResult<crate::storage::watches::WatchRecord>`; exact watch owner/source and same guard. | **KEEP** |
| `engine.rs:25016` | `pub fn renew_watch(&mut self, authority: &PreparedAuthority, id: &str, ttl_ms: u64, now_ms: u64) -> SnapbackResult<crate::storage::watches::WatchRecord>`; exact watch owner/source and same guard. | **KEEP** |

## 6. The eight actual kernel final cuts

These are the only production `before_commit()` invocation points. Forwarders
that merely carry `BeforeCommit: FnOnce() -> SnapbackResult<G>` are not new
acquisitions, but they remain migration surface because they preserve the open
type. Each leaf is **MOVE**: replace generic `G` with a concrete correlated or
closed-class final-cut protocol.

| Leaf and cut | Exact owning signature / effect | Current structural problem | Class |
| --- | --- | --- | --- |
| `crates/snapback-kernel/src/storage.rs:4864`, cut `:6292` | `pub(in crate::storage) fn execute_mutation_plan_with_lifecycle_and_settlement_time<G, Check, BeforeCommit>(&mut self, writer_lane: write_authority::LocalWriterLaneV1, plan: &MutationPlan, input: &HandlerInput, apply: bool, identity: Option<&ClientMutationIdentity>, media_command: Option<&crate::manifest::ResolvedMediaCommandV1>, settlement_time: Option<&SettlementTimePolicy>, branch_operation: Option<&crate::fork_promotion::BranchMutationCommitV1>, check_live: &Check, before_commit: BeforeCommit) -> SnapbackResult<MutationPlanExecution> where Check: Fn() -> SnapbackResult<()>, BeforeCommit: FnOnce() -> SnapbackResult<G>`; HostPlan mutation commit | B-plan is unrelated to whatever `G` the callback returns; `check_live()` also runs after guard acquisition. | **MOVE** |
| `storage.rs:6472`, cut `:7247` | `pub(in crate::storage) fn apply_buffered_writes_with_lifecycle_gated<G, Check, BeforeCommit>(&mut self, writer_lane: write_authority::LocalWriterLaneV1, input: &HandlerInput, effects: BufferedEffects<'_>, options: BufferedCommitOptions<'_>, membership_authority: MembershipCommitAuthority<'_>, check_live: &Check, before_commit: BeforeCommit) -> SnapbackResult<MutationCommit> where Check: Fn() -> SnapbackResult<()>, BeforeCommit: FnOnce() -> SnapbackResult<G>`; buffered mutation commit | B-buffer + arbitrary A/`()`. | **MOVE** |
| `storage/asset_attempts.rs:471`, cut `:485` | `fn asset_attempts_transaction_guarded_observed<T, G, BeforeCommit, AfterCommit>(&mut self, f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>, before_commit: BeforeCommit, after_commit: AfterCommit) -> SnapbackResult<T> where BeforeCommit: FnOnce() -> SnapbackResult<G>, AfterCommit: FnOnce() -> bool`; asset attempt/publication transactions | Transaction intent and returned `G` have no shared origin. | **MOVE** |
| `storage/settlement.rs:125`, cut `:148` | `fn upsert_stream_attempts_guarded<G, BeforeCommit>(&mut self, rows: &[(String, String, String)], now_ms: u64, before_commit: BeforeCommit) -> SnapbackResult<()> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; stream-attempt upsert | Production calls with `|| Ok(())`. | **MOVE** |
| `storage/settlement.rs:353`, cut `:510` | `fn acknowledge_client_mutations_inner_guarded<G, BeforeCommit>(&mut self, auth_fingerprint: &str, authority_instance_id: Option<&str>, ids: &[String], before_commit: BeforeCommit) -> SnapbackResult<u64> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; settlement deletion | B fingerprint/instance/IDs + arbitrary A/`()`. | **MOVE** |
| `storage/asset_reads.rs:213`, cut `:225` | `fn asset_reads_transaction_guarded<T, G, BeforeCommit>(&mut self, f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>, before_commit: BeforeCommit) -> SnapbackResult<T> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; lifecycle/read-policy commit | B transaction closure + arbitrary A/`()`. | **MOVE** |
| `storage/auth.rs:1725`, cut `:1740` | `pub(super) fn with_auth_transaction_guarded_observed<T, G, BeforeCommit, BeforeSqliteCommit>(&mut self, operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>, before_commit: BeforeCommit, before_sqlite_commit: BeforeSqliteCommit) -> SnapbackResult<T> where BeforeCommit: FnOnce() -> SnapbackResult<G>, BeforeSqliteCommit: FnOnce(&Transaction<'_>, &T, &G) -> SnapbackResult<()>`; direct auth transaction | B operation and arbitrary A/`()`. Keeping `G` alive proves lifetime, not origin. | **MOVE** |
| `storage/auth.rs:1767`, cut `:1791` | `pub(super) fn attempt_auth_transaction_guarded<T, G, BeforeCommit>(&mut self, operation: impl FnOnce(&Transaction<'_>) -> SnapbackResult<T>, before_commit: BeforeCommit) -> AuthTransactionAttempt<T> where BeforeCommit: FnOnce() -> SnapbackResult<G>`; commit-certainty auth transaction | Same independent axes; refusal/uncertain handling does not correlate them. | **MOVE** |

## 7. Production reachability roots

The semantic rows above are reached by these production surfaces. This list is
included to make the private rows auditable without treating request parsing and
mutex helpers as duplicate sinks:

- auth/OAuth/effects: `server/oauth.rs:337`, `server/oauth.rs:488`,
  `server/effects.rs:211`, `:240`, `:398`, and `server.rs:17139-17565`;
- push/ask/capability links: `server.rs:20269`, `:20286`, `:27680`,
  `:28026`, `:28066`, `:28732`, and the push worker paths around
  `server.rs:2609-2670`;
- mutations/actions: `server.rs:4844`, the action host at `server.rs:1760-2040`,
  `admin.rs:5893`, and the registered mutation/run routes in `server.rs`;
- watches/capsule: watch-management routes call
  `with_bounded_commit_capsule`, whose production pending implementation is
  `WatchManagementPending` at `server.rs:29163-29180`;
- assets: every write-bearing route in
  `server/asset_routes.rs:141-989`, including create, TUS patch/delete,
  finalize, delivery/width, signed URL, and record delete; and
- streams: `server.rs:28026`, `:28066`, `:31288`, plus detached-action host
  flushes that call registry `persistence_batch` and
  `LocalSnapback::persist_stream_attempts`.

Pure forwarding roots do not change the classification of their semantic sink.
If a future wrapper transforms the subject, selects a reservation, constructs a
ticket, or owns a durable cut, it becomes a new row rather than remaining only a
reachability edge.

## 8. Near-misses and explicit exclusions

- `runtime/host_glue.rs:761` is mutation dry-run: its transaction is rolled
  back and its buffer is not a pending commit value. It is not a durable sink.
- `engine.rs:24925` (`list_watches`) is read-only. The write-bearing watch
  listing/evaluation helpers were followed to their actual direct or staged
  sinks.
- query preparation/execution functions accepting `PreparedAuthority` or
  `PreparedInvocation` (`engine.rs:11907-11996`, `:32877-32911`,
  `:37646`, `:38444`) produce read results/dependency proofs, not later durable
  commit values.
- `prepare_*authority`, `InvocationGate::prepare_function`, accessors such as
  `PreparedInvocation::authority`, and `RetainedLiveAuthority::matches` create
  or inspect authority; they do not stage a durable effect.
- `StagedLocalLiveEffect<PreparedLiveSubscribe/Resume/Unsubscribe/...>` keeps
  the `PreparedAuthority` inside its private plan and finalization accepts only
  that staged carrier. Its connection-act changes are in-memory transport/live
  state, not state promised to survive restart. The manual-retry database write
  is separately listed as a direct SAME sink.
- ephemeral subscribe/publish/delete resolvers at `server.rs:33557-33824` and
  `register_authenticated_poll_client`/`register_managed_websocket_client` at
  `engine.rs:32670-32710` mutate process-live registries, not durable storage.
- `engine.rs:6939` (`activate_operator_network_profile`) mutates the
  process-live network-profile state only; it does not create state promised to
  survive restart.
- `ResolvedAppAuthority` projection/accessor functions are excluded except
  `ask_spend_subject`, whose returned value is directly consumed by a durable
  budget reservation.
- `CommitCapsuleReservation`'s two guard acquisitions are explicitly retained
  as CAPSULE prior art. `PendingCommit` remains listed because it opens the
  independently staged value, not because those guard calls are defective.

## 9. Completeness limits

This is complete for the stated semantic boundary and repository snapshot, not
a proof about arbitrary future spellings. The search combined authority-type
signatures, derived carrier/ticket types, all guard acquisitions, all generic
`BeforeCommit` bounds, and write/stage/plan/commit verbs. I then followed every
production caller of each returned pending type until a SQLite or object-store
cut, and followed every private helper back to at least one production root.

What this method could miss:

1. a durable sink implemented without any searched authority/carrier type and
   without a searched stage/write/commit verb;
2. authority origin erased into an unrecognized primitive before the first
   function boundary (the known principal-string and HMAC erasures were found
   by following known carriers); or
3. non-Rust production code outside `crates/` that performs independent durable
   storage.

Those are search limitations, not `KEEP` conclusions. A checked-in AST-based
registry should ultimately replace the spelling-based sweep and fail when a
new durable kernel cut or authority-derived pending type is unclassified.

## How to re-derive this inventory

Run from the repository root at the recorded commit. The broad `rg` commands
deliberately overmatch tests so production wrappers cannot hide behind a test
module; filter every match by body and production callers. The multiline pass
below excludes conventional dedicated test files, but inline `#[cfg(test)]`
blocks still require manual filtering:

```sh
git rev-parse HEAD

rg -n --glob '*.rs' \
  'PreparedAuthority|PreparedInvocation|ResolvedAppAuthority|AdmissionEffectGuard|AuthorizedEffectReservation' \
  crates

rg -n --glob '*.rs' \
  'CommitCapsuleReservation|CommitCapsuleAuthority|StagedRecordedMutation|StagedNestedMutation|ManagedHostPlanAction|WatchManagementPending|PreparedStreamAttemptOrigin|StreamRunnerHost|Asset[A-Za-z0-9_]*Ticket|Finalize[A-Za-z0-9_]*Ticket|StreamAttemptPersistenceBatch|ServiceAuthorityTerminalPlan|ExpiredServiceAuthorityPlan' \
  crates

rg -n --glob '*.rs' '\.(commit_guard|commit_guard_classified)\(' crates
rg -n --glob '*.rs' 'effect:\s*&AdmissionEffectGuard' crates/snapback-engine/src
rg -n --glob '*.rs' 'BeforeCommit:\s*FnOnce\(\)\s*->\s*SnapbackResult<G>' crates
rg -n --glob '*.rs' \
  'let (_commit_guard|commit_guard) = (match )?before_commit\(\)' \
  crates/snapback-kernel/src

rg -n --glob '*.rs' \
  '(stage|prepare|plan|pending|ticket|intent|commit|persist|write|upsert|insert|update|delete|append|put|cleanup)' \
  crates/snapback-engine/src crates/snapback-kernel/src \
  crates/snapback-services/src crates/snapback-server/src crates/snapback-sync/src

rg -n --glob '*.rs' \
  'stage_watch_management|WatchManagementPending|PendingCommit|FinalCommitCut' \
  crates/snapback-engine crates/snapback-kernel crates/snapback-server

rg -n --glob '*.rs' \
  'StagedRecordedMutation|StagedNestedMutation|ExecutedIbexMutation|DetachedMutationBinding|ManagedHostPlanAction' \
  crates/snapback-engine crates/snapback-server

rg -n --glob '*.rs' \
  'persistence_batch|persist_stream_attempts|upsert_stream_attempts|stage_.*_from|_host\(' \
  crates/snapback-sync/src/stream_attempt.rs \
  crates/snapback-engine/src/local/engine.rs \
  crates/snapback-kernel/src/storage/settlement.rs

rg -n --glob '*.rs' \
  'Asset.*Ticket|Finalize.*Ticket|asset_.*authorized_effect|asset_.*guarded' \
  crates/snapback-services/src/assets.rs \
  crates/snapback-engine/src/local/engine.rs \
  crates/snapback-kernel/src/storage/asset_attempts.rs \
  crates/snapback-kernel/src/storage/asset_reads.rs
```

For multiline exact signatures, this read-only `awk` pass prints the function
start line and normalized signature. Diff its output between revisions, then
inspect bodies and callers; do not classify from names alone:

```sh
rg --files crates -g '*.rs' -g '!**/tests/**' -g '!**/*_tests.rs' \
  -g '!**/test_support.rs' |
xargs awk '
function finish() {
  if (sig ~ /(PreparedAuthority|PreparedInvocation|ResolvedAppAuthority|AdmissionEffectGuard|AuthorizedEffectReservation|CommitCapsuleReservation|CommitCapsuleAuthority|PreparedStreamAttemptOrigin|StreamRunnerHost|StagedRecordedMutation|StagedNestedMutation|ManagedHostPlanAction|WatchManagementPending|Asset[A-Za-z0-9_]*Ticket|Finalize[A-Za-z0-9_]*Ticket|StreamAttemptPersistenceBatch|ServiceAuthorityTerminalPlan|ExpiredServiceAuthorityPlan)/) {
    gsub(/[[:space:]]+/, " ", sig)
    print FILENAME ":" start ":" sig
  }
  collecting=0; sig=""
}
/^[[:space:]]*(pub(\([^)]*\))?[[:space:]]+)?(async[[:space:]]+)?(unsafe[[:space:]]+)?fn[[:space:]]+/ {
  collecting=1; start=FNR; sig=$0
  if ($0 ~ /[{;]/) finish()
  next
}
collecting {
  sig=sig " " $0
  if ($0 ~ /[{;]/) finish()
}'
```

Finally, confirm the eight-cut checksum independently:

```sh
rg -n --glob '*.rs' \
  'let (_commit_guard|commit_guard) = (match )?before_commit\(\)' \
  crates/snapback-kernel/src
```

It must report the two mutation leaves, asset-attempt transaction, stream
settlement transaction, client-mutation acknowledgement, asset-read
transaction, and the two auth transaction leaves. A count change requires a
new inventory row even when no authority-type signature changed.
