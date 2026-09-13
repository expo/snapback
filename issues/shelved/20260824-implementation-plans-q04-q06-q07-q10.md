# Implementation plans — Q04, Q06, Q07, Q10 (9 rows)

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-engine, snapback-server
Related: LLP 0303, issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260824-implementation-plans-q02-q05.md,
  issues/shelved/20260824-implementation-plan-q01.md,
  issues/shelved/20260824-assertion-provenance-is-the-recurring-test-defect.md

Row-level plans for four more ruled question groups, so coding lanes execute rather than re-derive.

**Scope cap:** `PreparedAuthority` remains caller-constructible on main and the seal was blocked for
four provenance gaps, so no row implemented from these plans may claim a mismatch is
*unconstructible* — only that it derives from the prepared authority.

**Two coordination constraints carried into these plans:**

- **Q07 overlaps the authority-seal lane.** An executable review found the same
  `ServiceAuthorityFenceRegistry` lets a caller rebind an `Arc::ptr_eq` origin. Q07 must coordinate
  with that lane rather than fix the registry twice in conflicting ways.
- **Q06 is a designed cross-principal flow.** The effect approver is deliberately a different
  principal from the reconstructed caller, so owner-only is the *wrong* rule; the binding is
  approver → this pending effect → that effect's stored original authority.

**`test-support` exposure is now a required column.** A row was blocked this session because
`ProviderRevocationPlan::for_test` plus public install/finish methods reconstructed the entire defect
under a feature flag. Feature-enabled test APIs are part of the attack surface.

---


`git fetch origin main` was attempted first but the read-only sandbox blocked `.git/FETCH_HEAD`:

```text
error: cannot open '.git/FETCH_HEAD': Operation not permitted
```

`xcrun` also reported inability to create temporary cache files. I inspected the already-present local `origin/main`, which exactly matched detached `HEAD` at:

```text
90191ec0b8abe10de254587304dcc988c6eca9a0
```

The worktree was clean. No files or commits were changed.

The plans below implement LLP 0303’s derive-not-supply ruling, including Q06’s deliberate cross-principal binding ([LLP 0303:21](/Users/ccheever/projects/snapback/llp/0303-subject-authority-correlation-policy.decision.md:21), [Q06 ruling:40](/Users/ccheever/projects/snapback/llp/0303-subject-authority-correlation-policy.decision.md:40)). “Could not construct through the changed API” below never means globally impossible: `PreparedAuthority` and several lower-level kernel carriers remain caller-constructible on this commit.

## Q04 — membership writer and authority-creating consent

### Rows and target signatures

| Row | Current site and signature | Target | Disposition |
|---|---|---|---|
| F232 | [storage.rs:16619](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16619) `pub fn MembershipWriter::from_resolved(resolved: &ResolvedMembershipWriter) -> Self` | Delete; no replacement constructor. | DERIVE |
| F233 | [storage.rs:16623](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16623) `pub fn MembershipWriter::from_resolved_with_authority_creating(resolved: &ResolvedMembershipWriter, authority_creating_consent: bool) -> Self` | Delete; especially remove the independent Boolean. | DERIVE |
| C007 | [storage.rs:16599](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16599) `pub enum ResolvedMembershipWriter { User, ServicePrincipal, System, AdminBypass, Anonymous }` | Delete. | DERIVE |

The replacement production seam remains:

```rust
pub fn PreparedInvocation::membership_writer(&self) -> MembershipWriter
```

but its implementation must match directly on the final post-authority-seal prepared authority and derive service consent from:

```rust
self.matched_grant_scope
    .as_ref()
    .is_some_and(ResolvedGrantScope::authority_creating)
```

Also remove `PreparedInvocation.authority_creating_consent` at [invocation.rs:2498](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:2498), its getter, and the detached `bool` in the return values of `evaluate_function_policy_after_admission` and its classified wrapper. Those edits must wait: `invocation.rs` is owned by the authority-seal lane.

This yields a limited claim: the production host writer is derived from the provided `PreparedInvocation`. It does not make public `MembershipWriter` variants or lower-level kernel command APIs globally impossible to construct.

### Exact production rule

Current mapping at [invocation.rs:696](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:696) is:

- `Session`, `RevalidatedPrincipal`, `DevImpersonation` → `MembershipWriter::User`.
- Service with `effective_user_id` → `Delegated`.
- Service without it → `Autonomous`.
- `System`, `AdminBypass`, and `Anonymous` retain their corresponding classes.
- `Seed`, `Import`, and `Admin` are separate non-invocation writers and are outside this row.

Current code treats an autonomous service’s actor as its effective principal at [storage.rs:16676](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16676), so a non-standard function can currently reach the ordinary membership matrix as that actor. Standard-pattern admission separately rejects a service without a projected user at [invocation.rs:3076](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3076). LLP 0303 settles correlation, not whether autonomous services should be product-policy-ineligible for membership writes. Preserve current behavior unless that policy receives a separate ruling.

Only service writers require authority-creating consent at the effect site; the tested dynamic gate is [host_glue.rs:5034](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:5034). It also requires full host-filled membership provenance.

### Existing tested predicates to reuse

- Exact function/kind scope selection and authority bit: `evaluate_function_policy_after_admission`, [invocation.rs:3008](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3008).
- Runtime authority-creating membership gate: `ensure_membership_authority_creating`, [host_glue.rs:5034](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:5034).
- Membership target/class derivation remains in `membership_plans.rs`; do not introduce a second transition-matrix implementation.

### Callers to change

Production calls to the unchanged `membership_writer()` signature are:

- Dry-run mutation: [host_glue.rs:774](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:774).
- Committing mutation: [host_glue.rs:900](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:900).
- Query context: [host_glue.rs:1001](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:1001).
- Asset authorizer: [host_glue.rs:1095](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:1095).

Their call expressions need not change, but their fixtures must obtain a real `PreparedInvocation`; none may reconstruct a writer separately.

Direct callers to delete/migrate:

- Kernel test at `storage/tests.rs:15600–15605`.
- `#[cfg(test)]` adapters at [host_glue.rs:7304](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:7304), which currently repeat the mapping and accept detached consent.
- The trait bridge at [invocation.rs:676](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:676).

Observable behavior:

- Proper user, delegated-service, autonomous-service, system sweep, seed/import/admin paths retain their present writer class.
- `AdminBypass` and `Anonymous` still cannot obtain ordinary membership provenance.
- A service grant whose selected exact scope has `authority_creating=false` is refused with `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`.
- No caller can pass `true` separately at this boundary after the change.

### Fields read and correlation axes

The mapping reads only:

- Authority variant.
- User: `user_id`.
- Service: `actor_user_id`, `effective_user_id`, `grant_id`.
- Selected scope: `function_id`, `kind`, `authority_creating`.

It does not use credential ID/generation, token ID/deadline, integration status, scope `basis`, or caller attribution to build the writer. Do not add Q04 bijection assertions for those ignored fields.

Test both lexical directions for actor/effective/grant substitution, both delegated and autonomous service forms, and `authority_creating=true/false`. Function/kind/basis testing belongs primarily to Q10.

### Durable writes and mandatory readback

Use a full-provenance membership fixture. On an accepted mutation, read back every column written:

- Application membership row: every physical declared column plus `_id`, `_version`, `_createdAt`, `_updatedAt`, `_snapbackGrantedByActor`, `_snapbackGrantedByEffective`, and `_snapbackGrantedByGrant`.
- `_snapback_membership_transitions`: `declaration_id`, `op`, `principal`, `resource`, `from_role`, `to_role`, `actor`, `effective`, `grant_id`, `commit_version`, `writer_class`.
- `_snapback_version`: `id`, `version`.
- `_snapback_changes`: `id`, `version`, `table_name`, `row_id`, `op`, `row_json`, `changed_at_ms`.
- If the fixture enables an authority profile:
  - `_snapback_authority_projection_horizons`: `declaration_id`, `profile_generation`, `earliest_commit`, `coverage_class`.
  - `_snapback_authority_projection_events`: `declaration_id`, `profile_generation`, `incarnation`, `scope_id`, `principal`, `event_kind`, `role`, `status`, `history_json`, `commit_version`, `changed_at_ms`.
- If the write affects authorization, `_snapback_meta`’s `key,value` row for `authorization_epoch_v1`.

For refusals, assert all those tables and the global version remain unchanged. Dry-run/query/asset-authorizer cases must remain non-durable.

### Test-support exposure

The duplicate adapters are only `#[cfg(test)]`, not feature-enabled, but they must still be removed because they bypass the production derivation in unit tests. No public Q04-specific `*_for_test` constructor was found. Public `MembershipWriter` and buffered membership APIs remain a broader surface; this row must not claim global construction closure.

### Batching

F232, F233, and C007 must land atomically. They should be batched with Q10 after the authority-seal lane releases `invocation.rs`, because Q04 consumes the exact scope’s `authority_creating` bit. Do not edit the owned file now.

---

## Q06 — effect approver, exact pending effect, stored original authority

### Rows and target signatures

| Row | Current site and signature | Target | Disposition |
|---|---|---|---|
| F157 | [coordinator.rs:1729](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1729) `prepare_retained_effect_session(&self, authorization_stream_incarnation: &str, session_id: &str, user_id: &str, provider: &str, generation: u64, epoch_now_ms: u64, monotonic_now: Instant) -> Result<PreparedBearerAuthority>` | `prepare_retained_effect_session(&self, retained: &RetainedEffectSessionAuthority, epoch_now_ms: u64, monotonic_now: Instant) -> Result<PreparedBearerAuthority>` | DERIVE |
| F175 | [engine.rs:5262](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5262) `resolve_retained_effect_service_authority(&mut self, management: &PreparedAuthority, actor_user_id: &str, credential_id: &str, credential_generation: u64, grant_id: &str, token_id: &str, effective_user_id: Option<&str>, expected_expires_at_ms: u64, now_ms: u64, monotonic_now: Instant, provider: Arc<AuthProvider>) -> Result<ResolvedServiceAuthority>` | `resolve_retained_effect_service_authority(&mut self, retained: &RetainedEffectServiceAuthority, now_ms: u64, monotonic_now: Instant, provider: Arc<AuthProvider>) -> Result<ResolvedServiceAuthority>` | DERIVE |

`RetainedEffectSessionAuthority` and `RetainedEffectServiceAuthority` must have private fields and be borrow views issued only from an opaque, database-bound pending-effect approval carrier. A raw public `PendingEffectRecord` must not mint either view.

Add the following engine seam:

```rust
pub fn prepare_pending_effect_approval(
    &mut self,
    management: &PreparedAuthority,
    effect_id: &str,
    now_ms: u64,
) -> SnapbackResult<PreparedEffectApproval>
```

It must:

1. Derive the approver’s user/session from the exact `EffectManagement` prepared authority.
2. Load the exact durable pending row by `effect_id`.
3. Apply the existing nullable/equal `approver_principal_id` predicate.
4. Recheck current function identity, kind, generation, exposure/approval policy, arguments, and link-origin binding.
5. Retain the stored original-authority arm in private form.

Change [effects.rs:64](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:64) to:

```rust
async fn prepare_original_authority(
    runtime: &AppState,
    approval: &PreparedEffectApproval,
) -> Result<PreparedEffectOriginalAuthority, ApiError>
```

No independent `management`, `effect`, or `approver` arguments.

Finally, `approve_pending_effect` must stop accepting independent `effect`, `original`, `management`, and `approver_id`. Target:

```rust
pub fn approve_pending_effect(
    &mut self,
    approval: PreparedEffectApproval,
    original: PreparedEffectOriginalAuthority,
    step_up: Option<&StepUpProof>,
    now_ms: u64,
) -> SnapbackResult<ApprovedEffectDispatch>
```

`ApprovedEffectDispatch` should carry the exact decided record and prepared original authority together into mutation/action dispatch. This is necessary because otherwise the route could re-split the pair after reconstruction.

The approver is deliberately not required to equal the original session user, service actor, or effective user.

### Existing tested predicates to reuse

- Effect-management session predicate: `require_effect_session`, [effects.rs:13](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:13). Move/factor its logic into the engine preparation seam; do not duplicate it.
- Neutral derive-from-management pattern: `require_agent_grant_management_session`, now [engine.rs:5916](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5916).
- Exact pending approver rule: [pending_effects.rs:647](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/pending_effects.rs:647).
- Session revalidation: `resolve_bound_connection_session`, [coordinator.rs:1668](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1668).
- Service re-resolution SQL: [auth_agent_credentials.rs:1210](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1210).
- Link minter/function binding and current function policy: [engine.rs:5361](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5361).
- The landed grant-approval structure is the model: derive the session principal in the engine and give the sink no independent subject coordinates.

### Callers and observable behavior

The only production reconstruction caller is `prepare_original_authority` in `server/effects.rs`; it is called by `effect_approve` at [effects.rs:259](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:259). Change that route to:

1. Prepare `PreparedEffectApproval`.
2. Reconstruct only the carrier’s stored authority arm.
3. Obtain step-up proof bound to the carrier’s effect ID.
4. Consume both opaque carriers in `approve_pending_effect`.
5. Dispatch the returned exact record/authority pair.
6. Settle using an execution ticket returned with that pair, not the raw path ID.

Observable behavior:

- Approver A approving effect E whose stored original authority is principal B remains accepted.
- Owner-only enforcement must not be introduced.
- A/E combined with separately selected live principal C could no longer be expressed through F157/F175’s target signatures. That is an API-scoped statement, not a claim that arbitrary `PreparedAuthority` construction is impossible.
- Stale session instance, stream, provider, generation, token, grant, credential, effective user, or deadline retains existing refusal semantics.

### Fields read and axes

F157 must read and bind every stored session field:

- `authorization_stream_incarnation`
- `session_id`
- `user_id`
- `provider`
- `generation`
- `authority_instance_id`

The last field is currently compared in `effects.rs`; move that comparison into F157 so the complete stored session tuple is handled by one derived carrier.

F175 must read and bind every stored service field:

- `actor_user_id`
- `credential_id`
- `credential_generation`
- `grant_id`
- `token_id`
- `effective_user_id`
- `token_expires_at_ms`

Durable resolution additionally reads current scopes, grant expiry, and integration status for the resulting authority. Axis-test each listed coordinate in both lexical directions. Do not test approver equality with actor/effective user; that is expressly the wrong predicate.

The enclosing approval predicate reads effect ID/status/expiry/approver, function ID/name/kind/generation, args, link origin, caller lane/key, and stored authority. Preview/outcome/journal fields do not participate in correlation and should not be added to the bijection matrix.

### Durable writes and mandatory readback

Reconstruction itself is read-only except:

- F175 calls `observe_agent_authorization_clock`, which may write `_snapback_meta(key,value)` for `auth_invalidation_clock_high_water_ms_v1`.
- Unlike bearer resolution, retained service resolution does not update credential/grant `last_used_at_ms`.

An accepted full approval writes:

- `_snapback_pending_effects` decision fields: `status`, `approver_identity`, `decided_at_ms`, `outcome_code`, `journal_json`.
- Settlement fields: `status`, `executed_at_ms`, `outcome_code`, `journal_json`.
- The invoked application row, `_snapback_version(id,version)`, and all seven `_snapback_changes` columns.

Read back all 23 pending-effect columns, not only the updated subset:

`id`, `function_id`, `function_name`, `function_kind`, `args_json`, `args_digest`, `caller_lane`, `caller_key`, `authority_json`, `generation_json`, `effect_class`, `link_origin_id`, `approver_principal_id`, `created_at_ms`, `expires_at_ms`, `status`, `approver_identity`, `preview_kind`, `preview_json`, `decided_at_ms`, `executed_at_ms`, `outcome_code`, `journal_json`.

That proves the stored original authority was not rebound. Also project every physical column of the deliberately simple application fixture plus the version/change rows. For the service arm, project `_snapback_meta.key,value` even on refusal if the clock observation preceded refusal.

### Tests and test-support

Fail-first executable tests:

- Approver A, effect E stored for live B, reconstruct separately supplied live C through current F157; current approval accepts. Target cannot supply C.
- Same exploit through F175.
- Positive A/E/B case.
- Foreign or unentitled approver.
- Link effect with wrong minter or function.
- Each session and service coordinate changed one at a time, both lexical directions.
- Stale deadline and revoked token/grant/credential.
- Full durable readback above.

No pending-effect-specific public `*_for_test` constructor was found. However `PendingEffectRecord`, `PendingEffectAuthority`, and creation requests are public, so the target carriers must not accept a raw record as proof. Any malformed-carrier fixture must be `#[cfg(test)]`, never `feature = "test-support"`.

### Batching

F157 and F175 must land together with the kernel carrier and `server/effects.rs` consumer; splitting them leaves one reconstructable authority arm. This lane does not require edits to any listed owned file and can proceed independently, but it collides in `engine.rs` with Q07/Q10 and therefore should not run concurrently with those implementation lanes.

---

## Q07 — registering a live service-authority witness

### Rows and target signatures

| Row | Current site and signature | Target | Disposition |
|---|---|---|---|
| F113 | Actual site is [snapback-auth/service_fence.rs:821](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:821), not the stale issue path: `pub fn register(&self, witness: ServiceAuthorityWitness, validated_at_ms: u64, monotonic_now: Instant) -> Result<ServiceAuthorityPublication>` | `pub fn register_resolved(&self, resolved: &DurablyResolvedServiceAuthority, validated_at_ms: u64, monotonic_now: Instant) -> Result<ServiceAuthorityPublication>`; raw `register` becomes private or disappears. | DERIVE |
| C006 | [service_authority_contract.rs:18](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/service_authority_contract.rs:18) public `ServiceAuthorityWitness` with eight public fields | Remove it as a public registration carrier. Registry state uses a private witness derived inside `register_resolved`. | DERIVE |

`DurablyResolvedServiceAuthority` is an opaque kernel carrier returned by the durable scoped-token and retained-service resolution paths. It must carry the authority-seal lane’s final non-rebindable database origin. Its fields and constructor stay private; read-only getters are sufficient for the auth crate.

Do not implement a second database-origin identity here. The current registry is publicly `Default` at [service_fence.rs:663](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:663), and kernel installation overwrites an existing interlock at [storage.rs:3433](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:3433). The reported `Arc::ptr_eq` rebind exploit therefore blocks this row until the authority-seal lane supplies the final one-install/non-rebindable origin. Reuse its carrier and regression test.

The exact nominal origin type cannot be decided from main because that lane has not landed. The required post-lane interface is nonetheless fixed: registry and durable-resolution carrier must expose matching sealed database origin, registration must reject a mismatch, and installation must not replace an existing origin.

### Existing tested predicates to reuse

- Secret-backed durable resolution: `resolve_scoped_token`, [auth_agent_credentials.rs:1105](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1105).
- Retained exact-coordinate resolution: `resolve_retained_service_authority`, [auth_agent_credentials.rs:1210](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1210).
- Existing registration liveness/deadline and same-witness checks: [service_fence.rs:827](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:827).
- The authority-seal lane’s origin/rebind predicate and diagnostic must be reused unchanged.

### Callers to change

Production:

- Retained effect authority: [engine.rs:5297](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5297).
- Route scoped-token authority: [engine.rs:5431](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5431).
- Registry creation/install: [engine.rs:26887](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:26887).

Remove `ResolvedScopedToken::service_authority_witness` at [auth_agent_credentials.rs:104](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:104); callers pass the opaque durable carrier directly.

Test callers requiring migration include:

- The feature helper calling raw `register` at `service_fence.rs:793–815`.
- All direct auth-crate test registrations at `service_fence.rs:1325–2260`.
- Engine tests at `local/tests/engine.rs:15687`, `:28039`, `:28079`.
- Cross-crate registry `Default` fixtures in `stream_attempt.rs:1664`, server tests `:30291`, `:30510`, `:31548`, `:41536`, and engine test `:26012`.

Auth-module unit tests may use a private `#[cfg(test)]` witness helper. Cross-crate tests must obtain a real database-resolved carrier.

Observable behavior is unchanged for a valid, current durable token. Public Rust callers lose `Default`, raw `register`, and witness literals. A second registry install/origin rebind is refused using the authority-seal lane’s diagnostic.

### Fields read and axes

Current registration reads every witness field:

- `token_id`
- `grant_id`
- `actor_user_id`
- `effective_user_id`
- `credential_id`
- `credential_generation`
- `expires_at_ms`
- `grant_expires_at_ms`

The full witness equality at [service_fence.rs:899](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:899) consumes all eight. Axis/bijection tests therefore vary every field, both lexical directions, plus the post-lane database origin.

### Durable writes and readback

F113 itself writes only process-local registry state; it writes zero database columns.

Its production producers differ:

- `resolve_scoped_token` may write `_snapback_meta(key,value)`, `_auth_agent_credentials.last_used_at_ms`, and `_auth_grants.last_used_at_ms`.
- Retained-effect resolution writes only the authorization-clock `_snapback_meta(key,value)` row.
- A later accepted function writes the selected application row, `_snapback_version(id,version)`, and all `_snapback_changes` columns.

The end-to-end test must read back the exact producer-specific columns and the full downstream app/version/change rows. On a refused origin or witness mismatch, assert no downstream application/version/change write; if the durable resolution already advanced the clock or coalesced `last_used_at_ms`, assert that explicitly rather than expecting a wholly unchanged database.

### Test-support exposure

Current shippable feature APIs reconstruct the defect:

- `ServiceAuthorityPublication::synthetic_for_test`, [service_fence.rs:276](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:276).
- Registry `synthetic_publication_for_test`, [service_fence.rs:793](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:793).
- `ResolvedServiceAuthority::synthetic_for_test`, [engine.rs:3412](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3412).

Together they allow arbitrary resolved authority plus an unrelated publication under `test-support`. Narrow them to `#[cfg(test)]` or replace them with a durable fixture installer that returns the same opaque carrier as production. Q07 cannot be considered implemented while that feature-enabled composition remains.

A rustdoc `compile_fail` test may prove that the named public witness constructor/fields and `register` call are gone. It proves only that those APIs could not construct the mismatch, not that all `PreparedAuthority` construction is impossible.

### Batching

F113 and C006 must land atomically after the authority-seal origin fix. Do not duplicate or edit around that live lane’s rebind solution. This batch also changes `engine.rs`, so it is forced apart from Q06 and Q10. Do not modify owned `auth_integrations.rs`; consume its status through the durable carrier.

---

## Q10 — exact function/grant scope and `authority_creating`

### Rows and target signatures

| Row | Current site and signature | Target | Disposition |
|---|---|---|---|
| F118 | [invocation.rs:397](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:397) `pub fn ResolvedGrantScope::from_exact(scope: ExactGrantScope) -> Self` | Delete. Conversion occurs only inside post-seal authority preparation consuming opaque kernel-produced carriers. | DERIVE |
| C003 | [auth_grants.rs:117](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_grants.rs:117) `pub struct ExactGrantScope` with public fields and public `Deserialize` | Keep the value type only with private fields, public getters and `Serialize`; remove `Deserialize` and all public/from-parts construction. | DERIVE |

Replace the assertion-style basis API:

```rust
pub fn current_auth_scope_basis(
    &self,
    function_id: &str,
    kind: &FunctionKind,
    authority_creating: bool,
) -> SnapbackResult<Option<u64>>
```

with:

```rust
pub fn current_exact_scope(
    &self,
    function_id: &str,
) -> SnapbackResult<Option<ExactGrantScope>>
```

It must query `kind`, `generation`, `present`, and `authority_creating` from `_auth_scope_bases` and return a complete scope only when present. The function ID remains a selector derived from the already-selected manifest function; kind, basis, and permission-to-grant-permissions come from storage.

External grant request JSON may still carry requested kind/authority semantics in an untrusted request DTO. Existing `exact_scope_on` verifies that request and then mints the private trusted type. Durable JSON parsing must deserialize into a private stored DTO and validate/canonicalize before producing `ExactGrantScope`; leaving `Deserialize` on the trusted public type would preserve construction through `serde_json`.

### Existing tested predicates to reuse

- Durable exact-scope verification and minting: `exact_scope_on`, [auth_grants.rs:1570](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_grants.rs:1570).
- Current-basis validation: `require_scope_bases_current_on`, immediately after it.
- Invocation function/kind selection and authority bit: [invocation.rs:3029](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3029).
- Asset callback basis lookup: current [engine.rs:8452](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8452), changed to consume `current_exact_scope`.
- The landed grant-approval path already calls the durable exact-scope helper and is the reference implementation.

### Callers to change

F118 production callers:

- Scoped token conversion: `invocation.rs:501`.
- Asset callback preparation: `invocation.rs:2859`.
- Watch-anchor rehydration: [engine.rs:25480](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:25480).

These must use call-specific post-seal preparation APIs, not another public generic conversion. `invocation.rs` is owned, so all three wait.

C003 trusted constructors/deserializers:

- Kernel grant expansion/selection: `auth_grants.rs:1497`, `:1560`, `:1593`; retain as private in-module construction.
- Durable scope parsing: `auth_grants.rs:1651`; change to private stored DTO.
- Asset callback production literal: [engine.rs:8463](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8463); replace with `current_exact_scope(function.id)`.
- Watch creation literals: [engine.rs:24955](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:24955) and `:24963`; replace with scopes derived by function ID from the basis table.
- Feature-enabled renewable-watch fixture: [watches.rs:1021](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/watches.rs:1021).
- Test literals in `auth_asset_callbacks.rs:249`, `watches.rs:2492/:2498`, `invocation.rs:3750`, server tests `:30542`, and engine tests `:26037/:26045/:28028/:28068/:29365`.

`ensure_asset_callbacks_service_principal` at [auth_asset_callbacks.rs:36](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_asset_callbacks.rs:36) must stop accepting `ExactGrantScope`. Target:

```rust
pub fn ensure_asset_callbacks_service_principal(
    &mut self,
    app_id: &str,
    callback_function_id: &str,
    now_ms: u64,
) -> SnapbackResult<AssetCallbacksServicePrincipal>
```

It derives the exact stored scope itself and requires `Mutation`. The function ID must come from the engine-selected actual callback manifest entry.

Observable behavior:

- Valid durable grants, asset callbacks, and watch anchors retain their existing scopes.
- Public Rust construction/deserialization of trusted exact scopes becomes a source compatibility break.
- Serialized grant/effect/watch JSON remains unchanged.
- A false stored authority bit cannot be replaced with caller-supplied `true`.
- A true stored bit remains usable for the exact function and kind.

### Fields read and axes

All four `ExactGrantScope` fields are read in production:

- `function_id`
- `kind`
- `basis`
- `authority_creating`

Invocation matching reads function ID/kind and the authority bit. Retained rerun/current-scope checks read basis. Asset callbacks compare all four.

Watch coverage helpers at `watches.rs:1943–1986` currently read function ID, kind, and basis but do not compare `authority_creating`. Do not add a watch-helper mismatch test for the ignored authority bit. Instead, prove separately that the subsequent prepared invocation receives the current durable bit.

Axis tests:

- Each of the four scope fields changed independently, both lexical directions.
- Removed/present basis and generation advancement.
- True/false `authority_creating`.
- Correct scope for function A paired with invocation B.
- Correct ID but wrong kind.
- Stale basis with otherwise equal scope.

### Durable writes and mandatory readback

F118 conversion itself writes no durable columns.

For scoped-token production, read back:

- `_snapback_meta.key,value`
- `_auth_agent_credentials.last_used_at_ms`
- `_auth_grants.last_used_at_ms`
- The downstream application row, `_snapback_version(id,version)`, and all `_snapback_changes` columns.

For asset-callback principal preparation, read back complete affected rows:

- `_auth_users`: `id`, `created_at_ms`, `kind`, `display_name`, `operator_contact`, `registration_provenance`, `deactivated_at_ms`, `owner_user_id`.
- `_auth_grants`: `id`, `actor_user_id`, `effective_user_id`, `scopes`, `created_at_ms`, `expires_at_ms`, `revoked_at_ms`, `created_by`, `request_id`, `consent_digest`, `last_used_at_ms`.
- `_auth_scope_bases`: `function_id`, `kind`, `generation`, `present`, `authority_creating`.
- Downstream callback app row plus version/change rows.

On a scope-shape change, assert the old grant’s `revoked_at_ms`, the complete new grant row, and the new scope JSON.

For watch creation, read back all physical columns of the inserted `_snapback_watches` row and the complete 11-column anchor `_auth_grants` row. Do not project only scope JSON. A refusal must leave watch/grant/application/version/change state unchanged.

### Test-support exposure

Current main exposes ordinary public fields plus `Deserialize`, which is the primary C003 construction surface.

Additionally:

- The Q07 synthetic publication plus `ResolvedServiceAuthority::synthetic_for_test` can inject caller-built resolved scopes into preparation.
- `seed_renewable_watch_for_management_test` is feature-enabled and writes scopes/bases assembled from literals. Rewrite it to take only fixture IDs and derive through the production basis path, or narrow it to `#[cfg(test)]`.
- Do not add a feature-enabled `ExactGrantScope::for_test` or from-parts constructor.

Rustdoc `compile_fail` tests should cover struct literals and deserialization. Again, that proves those named routes could not construct a trusted scope; it is not a global impossibility claim while the authority seal remains incomplete.

### Batching

F118 and C003 must land together. Because F118 is in live-owned `invocation.rs`, they must wait for the authority-seal lane. The recommended post-lane batch is Q10 plus Q04: Q10 establishes the derived exact scope, and Q04 consumes its `authority_creating` bit without a detached Boolean.

## Landing order and collision map

1. **Q06 lane now:** F157 + F175 + opaque pending-effect carrier + `server/effects.rs`. No listed owned file is required.
2. **Wait for authority-seal lane.**
3. **Q07 lane:** F113 + C006, consuming the lane’s non-rebindable database origin and its existing rebind regression.
4. **Q10/Q04 combined lane:** F118 + C003 + F232 + F233 + C007.

Q06, Q07, and Q10 cannot run concurrently because all require `engine.rs`. Q04/Q10 also require the currently owned `invocation.rs`. Q07 must not duplicate the origin fix, and none of these plans requires edits to owned `mode.rs`, `admission.rs`, `provider.rs`, `oauth.rs`, `auth_integrations.rs`, or `auth_integrations.rs`’s kernel implementation.