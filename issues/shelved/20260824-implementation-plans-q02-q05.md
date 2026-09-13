# Implementation plans — Q02, Q03, Q04, Q05 (13 rows)

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-engine, snapback-server
Related: LLP 0303, issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260824-assertion-provenance-is-the-recurring-test-defect.md

Row-level implementation plans for four ruled question groups, produced so coding lanes execute
rather than re-derive. Each row carries current signature, target signature, and a DERIVE vs VERIFY
disposition — LLP 0303 prefers DERIVE, and permits VERIFY only at unavoidable joins such as
untrusted wire input or independently completed asynchronous work.

**Scope cap:** `PreparedAuthority` is currently caller-constructible, so no row implemented from
these plans may claim its mismatch is *unconstructible* — only that it derives from the prepared
authority. See `issues/shelved/20260824-authority-provenance-is-a-prerequisite-not-a-peer.md`.

**Anchor drift caught during planning:** descriptor publication is now `server.rs:18045` (was
recorded as `:17950`) and address-guarded issuance commits at `server.rs:18487`. Re-verify anchors
before editing; main moves continuously.

---


The assignment’s server anchors have drifted: descriptor publication is now [server.rs:18045](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18045), and address-guarded issuance commits at [server.rs:18487](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18487).

LLP 0303 requires derivation and permits verification only at unavoidable joins such as untrusted wire input or independently completed asynchronous work ([LLP 0303:21](/Users/ccheever/projects/snapback/llp/0303-subject-authority-correlation-policy.decision.md:21)).

## Q02 — exact prepared-authority descriptors

Decision: a trusted/durable descriptor must come from the exact `PreparedAuthority` and the authorization stream installed on that value. The handshake already receives a `PreparedAuthority` at [server.rs:18008](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18008); there is no resolved-only production exception. A client-echoed descriptor remains untrusted wire input and must be verified.

### Row changes

| Row | Current | Target | Disposition |
|---|---|---|---|
| F149 | [invocation.rs:3302](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3302): `descriptor_for_authority(&PreparedAuthority, &str) -> SnapbackResult<AuthorityDescriptor>` | `descriptor_for_authority(&PreparedAuthority) -> SnapbackResult<DerivedAuthorityDescriptor>`; read `authority.authorization_stream_incarnation()` internally and refuse missing/uninstalled stream | **DERIVE** — remove the independent stream argument |
| F150 | [invocation.rs:3312](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3312): public `descriptor_for_resolved_authority(&ResolvedAppAuthority, &str)` | Delete the public function. Retain at most a private `descriptor_values_for_resolved(...)` called only by F149 | **DERIVE** — the resolved-only authority/stream pair must not be a production construction seam |
| F279 | [engine.rs:16996](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:16996): staging accepts `client_mutation_id`, `Option<AuthorityDescriptor>`, and `PreparedAuthority` independently | Replace those three arguments with `PreparedRecordedMutationAuthority`, a private-field carrier containing the authority, optional mutation ID, and one `DerivedAuthorityDescriptor`; construct it through `bind_recorded_mutation_authority(...)` before ACK or settlement effects | **DERIVE** at staging. The binder **VERIFIES** the client echo because an external queued client necessarily presents previously received wire bytes |
| C012 | [types.rs:11020](/Users/ccheever/projects/snapback/crates/snapback-types/src/manifest/types.rs:11020): public-field wire DTO `AuthorityDescriptor { descriptor_version, authority_instance_id, session_generation }` | Keep the wire DTO/schema unchanged, but never use naked `AuthorityDescriptor` as trusted proof. Add non-`Deserialize`, private-field `DerivedAuthorityDescriptor(AuthorityDescriptor)` in `snapback-sync`; only F149 constructs it | **VERIFY** — a queued client must be able to deserialize and echo the DTO, so wire manufacture cannot be removed; authority follows only after comparison with the derived wrapper |

`DerivedAuthorityDescriptor` should expose only:

```rust
pub fn as_wire(&self) -> &AuthorityDescriptor;
pub fn into_wire(self) -> AuthorityDescriptor;
pub fn authority_instance_id(&self) -> &str;
```

Do not implement `Deserialize`, `From<AuthorityDescriptor>`, or a public parts constructor.

Generalize [AuthCoordinator::bind_bootstrap_publication](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1866) to `bind_installed_stream`. It must:

1. Obtain the coordinator’s current incarnation.
2. If the authority already has an incarnation, require exact equality.
3. Otherwise install the coordinator-derived incarnation.
4. Return `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` for missing/mismatched installation.
5. Remain the only caller of the raw crate-private setter at [invocation.rs:2085](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:2085).

Apply that binding after all route authority attachments, replacing the Dev-only conditional at [server.rs:13547](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13547). Internal engine preparations must receive the same opaque installed-stream binding when [LocalSnapback::bind_auth_coordinator](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:7134) proves the coordinator and database incarnations equal.

### Predicate to reuse

Keep [require_current_descriptor](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/descriptor.rs:57) as the sole wire comparison. It already gives:

- Missing: `SNAPBACK_AUTH_STALE_RESULT`, reason `absent`.
- Wrong version: same code, reason `unsupported_version`.
- Malformed values: same code, reason `invalid`.
- Wrong authority instance: same code, reason `authority_instance_mismatch`.

Do not add a second comparison in engine or server.

The code explicitly treats `session_generation` as observational, not an equality axis ([descriptor.rs:50](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/descriptor.rs:50), tested at [descriptor.rs:175](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/descriptor.rs:175)). LLP 0303 settles provenance, not that protocol decision. Changing generation equality requires a separate ruling; this plan must preserve generation-only mismatch as accepted.

### Callers to change

All current raw stream-argument calls must switch to F149 and consume the derived wrapper:

- ACK paths: [engine.rs:11280](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11280), [engine.rs:11333](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11333), [engine.rs:11514](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11514), [engine.rs:11530](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11530).
- Descriptor publication, operation ranges and explanations: [engine.rs:11385](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11385), [engine.rs:11395](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11395), [engine.rs:11429](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11429).
- Asset callback staging: [engine.rs:16086](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:16086).
- Test-only recorded mutation entry: [engine.rs:16951](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:16951).
- All staging wrappers and the inner implementation: [engine.rs:16996](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:16996), [engine.rs:17022](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:17022), [engine.rs:17051](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:17051), [engine.rs:17091](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:17091), [engine.rs:17129](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:17129).
- Direct/recovery mutation path: [engine.rs:18220](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:18220), [engine.rs:18265](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:18265).
- Handshake: replace resolved-only construction at [server.rs:18019](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18019)–[18045](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18045) with `descriptor_for_authority(&authority)?.into_wire()`.
- HTTP mutation: construct one `PreparedRecordedMutationAuthority` at [server.rs:30636](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:30636), obtain response bytes from its derived descriptor, and pass the carrier at [server.rs:30664](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:30664).
- Tests using the old functions: [invocation.rs:4647](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:4647), [engine.rs:28343](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:28343), [engine tests:28388](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/tests/engine.rs:28388), [server tests:10467](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:10467).

Observable compatibility:

- Correct HTTP clients see no wire change.
- Queued Sessions requests retain current descriptor requirements.
- Queued Dev requests without a descriptor remain accepted; a supplied descriptor remains checked.
- Unqueued descriptors are currently ignored; preserve that behavior by discarding the untrusted field from the unqueued carrier.
- Embedders that construct a `PreparedAuthority` without installing a stream will newly receive `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`. This is an intentional internal/source compatibility break.

### Tests

Fail-first requirement: add the adversarial test or compile-fail witness first, run it before implementation, and quote the literal failing test/compiler block in the landing evidence. No legitimate failure quote exists yet and must not be invented.

Accepted/refused matrix:

- Accept exact Session, Service, Dev and Anonymous descriptors derived from the same prepared authority/stream.
- Preserve service token-churn acceptance; credential generation, grant, or actor changes must refuse with `authority_instance_mismatch`.
- Refuse missing, unsupported, malformed, different-authority and different-stream descriptors with the existing exact reasons above.
- Accept generation-only differences.
- A production call to the removed resolved-only helper should fail the security-boundary compile fixture.

Durability:

- Accepted queued mutation: independently assert the application row, global/app version, `_snapback_client_mutations` row, authority-instance field, receipt and ACK-retention state.
- Every refused case: read the same rows and assert byte-for-byte/count equality with the pre-call snapshot; no ACK deletion or settlement insertion.
- Duplicate accepted delivery must return the original settlement and must not create a second application write.

Assertion provenance:

- Expected Session/Dev IDs come from fixture constants, not from `descriptor_for_authority`.
- Use the existing fixed service vector at [descriptor.rs:130](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/descriptor.rs:130), or independently hard-code a second vector.
- Reject any assertion whose expected side was read from the same stored row being asserted; specifically forbid the prior `stored == stored` pattern.

Mutation review:

- Delete or invert each authority/stream equality.
- Replace `==` with `!=`.
- Compare supplied to itself or derived to itself.
- Select database stream instead of the prepared stream.
- Swap authority A/B with identifiers ordered both `aaa… < zzz…` and `zzz… > aaa…`.
- Remove verification before ACK and before duplicate settlement lookup.

Batching: land F149, F150, F279 and C012 atomically in one lane; their public/internal type boundary and all callers are inseparable.

Collision: F149/F150 and installed-stream binding touch `auth/invocation.rs`, directly colliding with authority-provenance sealing. Do not land Q02 until that lane lands; rebase and use its sealed provenance rather than inventing a parallel token. No Q02 work needs the OAuth or authenticated-use files.

Scope: because `PreparedAuthority` remains caller-constructible today, this landing may claim only “the descriptor is derived from the provided prepared authority and its installed stream.” It may not claim that a false prepared authority is unconstructible or impossible until the sealing lane lands and the result is re-audited.

## Q03 — projected session mutation provenance

Decision: projection reservations must be derived from sealed provider plans; finalization must consume the exact operation-bound durable result. Expiry must consume the exact sampled batch after its frontier has durably advanced.

### Row changes

| Row | Current | Target | Disposition |
|---|---|---|---|
| F100 | [session_projection.rs:1811](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1811): `begin_issuance(ProjectedSessionInsert)` | `pub(crate) fn begin_issuance(&mut self, plan: &ProviderSessionIssuancePlan)`; derive the insert internally | **DERIVE** |
| F101 | [session_projection.rs:1967](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1967): `begin_session_mutation(&str, u64, PendingMutationKind)` | Delete it. Add `begin_revocation(&ProviderRevocationPlan)` and `begin_rotation(&ProviderTokenRotationPlan)`; keep one private raw leaf if desired | **DERIVE** |
| F102 | [session_projection.rs:2057](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:2057): `begin_expiry(&str, u64, u64, Instant)` | Private `begin_expiry(&SampledDueExpiry, &DueExpirySampleClock)` reached only while consuming a durably admitted batch | **DERIVE** |

Make `PendingMutationKind` private once coordinator callers use the typed methods.

For expiry:

1. Add stream incarnation and a private batch identity to `DueExpiryBatch`.
2. Remove `Clone`.
3. `DueExpiryBatch::into_floor_plan(self) -> DueExpiryFloorPlan` must consume the batch.
4. Change the kernel clock-floor commit to return an opaque `DurableAuthSessionClockFloor`, not a bare `u64`.
5. Target engine signature:

```rust
pub fn advance_auth_session_clock_floor_for_due_batch(
    &mut self,
    provider: &AuthProvider,
    plan: DueExpiryFloorPlan,
) -> SnapbackResult<DurablyAdmittedDueExpiryBatch>;
```

6. Target coordinator signature:

```rust
pub async fn expire_sampled_due(
    self: &Arc<Self>,
    batch: DurablyAdmittedDueExpiryBatch,
) -> SnapbackResult<DueExpiryFinalization>;
```

The floor plan owns the batch, checks the database/coordinator stream, commits the frontier, seeds the provider, and only then yields the admitted wrapper. This removes the clone-and-recombine sequence currently at [runtime.rs:523](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/runtime.rs:523).

Finalization of issuance/revocation/rotation should consume the matched commit receipts introduced by Q05; do not retain raw `SessionResponse` or `SessionRevocation` joins.

### Predicates to reuse

- [session_for_ticket](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:2696) is the exact ticket/session ownership predicate.
- [sampled_due_expiry_still_matches](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1393) already checks ticket, generation, mutation kind, deadline and both clocks.
- Durable ambiguity must continue through the existing exact reconciliation paths: revocation at [provider.rs:3801](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3801), rotation at [provider.rs:3856](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3856), and issuance at [provider.rs:5386](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:5386).
- Use `require_agent_grant_management_session` at [engine.rs:5877](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5877) as the structural pattern: accept the authority-bearing object and derive its subject, as its layered caller does at [engine.rs:5849](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5849).

Do not reproduce the durable reconciliation comparisons in coordinator.

### Callers to change

Production coordinator calls:

- Revocation: [coordinator.rs:684](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:684).
- Rotation: [coordinator.rs:716](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:716).
- Issuance and its planned revocations: [coordinator.rs:764](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:764) and [coordinator.rs:769](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:769).
- Password-change rotation and revocations: [coordinator.rs:842](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:842) and [coordinator.rs:854](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:854).
- Expiry: [coordinator.rs:1796](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1796), [engine.rs:5000](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5000), and [runtime.rs:514](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/runtime.rs:514).

Projection tests using raw mutation methods must migrate at [session_projection.rs:3206](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3206), [3252](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3252), [3464](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3464), [3569](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3569), [3625](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3625), [3666](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3666), [3692](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3692), and [3771](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:3771). Tests should use provider/coordinator plan construction; only narrowly focused projection-unit tests may use a `#[cfg(test)]` private raw leaf.

Observable compatibility:

- Successful issuance, rotation, revocation and expiry outputs do not change.
- A stale sampled entry whose generation/deadline has legitimately changed remains a skipped entry, not an error.
- Callers of the public raw projection methods incur a source break.
- A batch that did not pass the exact durable-floor operation, or belongs to another stream, newly refuses.

### Tests

Fail-first tests:

- A projection accepting a hand-built `ProjectedSessionInsert`.
- A raw mutation selecting another session/generation.
- An expiry batch passed without its durable-floor receipt.
- A plan A premark joined with durable result B after Q05.

Run each before implementation and preserve the literal failing output.

Accepted/refused matrix:

- Exact provider issuance/revocation/rotation plan: accepted.
- Stale generation, wrong predecessor digest, successor collision, absent session, or changed stream: `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`.
- Exact durably admitted due batch: accepted.
- Stale due entry after rotation/revocation/deadline extension: batch accepted, entry skipped.
- Missing receipt, receipt below frontier, another stream/database, or ticket/deadline contradiction: `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`.
- Cross-operation durable result: provider-level join refuses `INTERNAL_AUTH_STATE`; coordinator fails the affected session/global projection closed and returns `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`.

Durability:

- Issuance/rotation/revocation accepted paths must read `_auth_sessions` and `_auth_session_tokens`, including generation, current/superseded digest, terminal cause and timestamps.
- Premark refusal must show both tables unchanged.
- Post-commit cross-join refusal must show the actual committed operation’s exact rows while proving no row for the other plan appeared and no credential was published.
- Expiry accepted and refused paths must read `auth_session_clock_floor_ms` plus the exact session/token rows. If the floor committed before later projection refusal, assert that advance explicitly rather than incorrectly expecting a full rollback.

Assertion provenance:

- Seed SQL with known session IDs, generations, deadlines and digest constants.
- Compute expected digests from fixed test bearer material outside provider planning.
- Expected durable rows must come from fixture constants, not `projected_insert()`, the commit response, or a prior database read.

Mutation review:

- Mutate generation equality, predecessor equality, deadline `<=`/`>=`, stream equality, ticket ownership and revocation `all`/`any`.
- Remove the exact-result reconciliation.
- Cross A/Z session IDs in both lexical orders.
- Swap left/right operands and introduce self-comparisons.

Batching: F100 and F101 belong together because issuance may reserve planned revocations. F102 should be a separate lane/landing because it changes runtime ownership and durable clock-floor APIs. Q05 must land before the final F100/F101 commit-receipt integration.

Collision: the raw projection work does not require any listed concurrently edited file. Its exact durable-result integration depends on Q05, which in turn waits for the authenticated-use work in `provider.rs`. F102 is independent of that lane.

Scope: Q03 does not seal `PreparedAuthority`. Its valid claim is limited to “projection subjects are derived from the supplied provider plan or durably admitted due batch.” It cannot claim that every upstream authority or provider plan is impossible to manufacture.

## Q04 — membership writer and consent derivation

Decision: ordinary membership writer class must come only from the exact `PreparedInvocation`. A service principal’s authority-creating consent is the `authority_creating` bit on the exact function/kind scope selected during that invocation. Human callers do not need this additional service-consent bit. `System`, `AdminBypass`, and `Anonymous` prepared invocations have no ordinary transition class. Privileged `Seed`, `Import`, and `Admin` are separate non-invocation flows.

### Row changes

| Row | Current | Target | Disposition |
|---|---|---|---|
| F232 | [storage.rs:16619](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16619): `MembershipWriter::from_resolved(&ResolvedMembershipWriter)` | Delete | **DERIVE** — production already has `PreparedInvocation` |
| F233 | [storage.rs:16623](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16623): `from_resolved_with_authority_creating(&ResolvedMembershipWriter, bool)` | Delete; no method accepts a detached consent boolean | **DERIVE** |
| C007 | [storage.rs:16599](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:16599): public `ResolvedMembershipWriter` enum | Delete | **DERIVE** — do not translate through a caller-manufacturable parallel authority DTO |

Also:

1. Delete `MembershipWriterResolvedExt` at [invocation.rs:676](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:676).
2. Remove `authority_creating_consent: bool` from `PreparedInvocation`.
3. Change `evaluate_function_policy_after_admission` at [invocation.rs:3008](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3008) to return `(AuthRequirement, Option<ResolvedGrantScope>)`.
4. Keep the exact selected scope in `matched_grant_scope`.
5. Target `PreparedInvocation::membership_writer`:

```rust
pub fn membership_writer(&self) -> MembershipWriter
```

The signature remains, but the implementation directly matches `self.authority.resolved()` and derives service consent from:

```rust
self.matched_grant_scope
    .as_ref()
    .is_some_and(|scope| scope.authority_creating)
```

It must never accept authority or consent arguments.

The current behavior at [invocation.rs:3066](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3066) is correct: consent comes from the exact matched grant scope. Do not change it to `function.authority_creating && scope.authority_creating`; the runtime effect gate deliberately catches authority-creating effects even through an unmarked wrapper.

### Predicates to reuse

- Scope/function/kind selection and service consent: [evaluate_function_policy_after_admission](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:3008), tested at [invocation.rs:4012](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:4012).
- Dynamic authority-creating effect check: [ensure_membership_authority_creating](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:5034).
- Userless/privileged refusal: [require_effective_principal](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/membership_plans.rs:1716).
- Self/other and role derivation: [derive_class_and_target](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/membership_plans.rs:1739).

Do not add an engine-local consent comparison.

### Exact caller classes

- Session, revalidated principal and Dev impersonation → `MembershipWriter::User`, effective principal equal to their exact resolved user.
- Service with `effective_user_id` → `Delegated`, with exact actor, effective principal and grant.
- Service without `effective_user_id` → `Autonomous`; it still lacks an effective principal for ordinary membership transitions unless a dedicated policy admits such a future class.
- System, AdminBypass and Anonymous invocation authorities → their userless variants and `SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL` for ordinary transition planning.
- `MembershipWriter::System` remains valid only for the dedicated expiry sweep checked at [membership_plans.rs:1586](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/membership_plans.rs:1586).
- `Seed`, `Import`, and `Admin` remain dedicated privileged non-invocation writers and must produce `SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX` if sent through the ordinary matrix.

Authority-creating service writes are admitted only when the exact matched scope has `authority_creating: true`; otherwise:

- Declared function precheck: `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`, reason `scope_not_authority_creating`.
- Runtime effect site: the same code, reason `effect_site_unconsented`.
- Missing exact function/kind scope: `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`, reason `missing_scope`.

### Callers to change

Production host entry points continue to call `prepared.membership_writer()`, but rebuild against the new derivation:

- Dry-run mutation: [host_glue.rs:761](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:761).
- Mutation: [host_glue.rs:886](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:886).
- Query: [host_glue.rs:986](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:986).
- Asset authorizer: [host_glue.rs:1083](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:1083).

Tests/direct callers:

- Replace [storage tests:15605](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/tests.rs:15605) with explicit kernel enum fixtures when testing the planner, or an actual prepared invocation when testing derivation.
- Delete test adapters at [host_glue.rs:7305](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:7305) and [7312](/Users/ccheever/projects/snapback/crates/snapback-engine/src/runtime/host_glue.rs:7312).
- Migrate their call sites at lines 7373, 7465, 8148, 8328, 8770, 10284–10314, 10788, 11437, 11461 and 12273 to genuine `PreparedInvocation` fixtures.

Observable compatibility:

- No HTTP or storage-schema change.
- Correct invocation behavior remains unchanged.
- Removing the two public kernel factories and `ResolvedMembershipWriter` is a Rust source compatibility break for embedders/tests. Such callers must enter through invocation preparation or an explicit privileged maintenance API.
- A scope marked `authority_creating: true` continues to authorize a service effect even if the function declaration omitted the static marker; the runtime effect-site gate is authoritative.

### Tests

Fail first with both:

1. A security-boundary compile-fail fixture showing the raw `ResolvedMembershipWriter`/boolean factory is still callable before deletion.
2. A durable host test proving a prepared service invocation cannot substitute another actor, effective user, grant, or consent value.

Accepted/refused matrix:

- Exact user self/other transition allowed by the manifest: accepted.
- Exact delegated service with exact role and consent: accepted.
- Same service without authority-creating consent: `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`.
- Missing function/kind scope: `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`.
- System/AdminBypass/Anonymous ordinary write: `SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL`.
- Privileged writer sent through ordinary matrix: `SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX`.
- Valid writer but undeclared role/op/target transition: `SNAPBACK_MEMBERSHIP_TRANSITION_DENIED`.

Durability:

- Accepted paths must read the membership table row, role/resource/principal axes, host-filled actor/effective/grant provenance, `_snapback_membership_transitions`, and authorization/global version.
- Every refused case must read all of those and prove no row, transition, journal or version advance.
- Test delegated actor A/effective B separately from target C; assert provenance from fixture constants.

Assertion provenance:

- Expected actor/effective/grant/role values come from the test credential, grant and manifest fixtures.
- Do not derive expected values by calling `membership_writer()` or reading back the just-written row.
- Include actor/effective/target IDs on both sides of lexical ordering.

Mutation review:

- Swap actor and effective principal.
- Substitute target for effective principal.
- Change scope function or kind comparisons.
- Mutate `authority_creating` checks, including `&&`/`||`.
- Remove service-only gating.
- Flip self/other equality and test both lexical orders.

Batching: F232, F233 and C007 must land together with the `PreparedInvocation` field cleanup and all test migrations.

Collision: this plan must touch `auth/invocation.rs`, so it must wait for authority-provenance sealing and then use that lane’s final sealed authority representation. It does not need to touch `server/oauth.rs` or `storage/auth_integrations.rs`; do not fold OAuth consent into this lane. Rebase against the OAuth lane before final tests if it changes `ResolvedGrantScope.authority_creating`.

Scope: while `PreparedAuthority` is caller-constructible, the valid claim is only “the membership writer is derived from the provided `PreparedInvocation` and its matched scope.” It is not yet valid to say a forged prepared invocation or writer is impossible.

> **DEFEATED BEFORE IMPLEMENTATION (2026-08-25).** The Q05 operation-identity proposal below —
> provider identity plus an injected random nonce — must **not** be implemented as written. A
> read-only pre-implementation analysis established that a dependent can supply a constant or
> repeating `RandomSource`, so allegedly distinct operations share identity. This is reachable under
> ordinary construction: the provider's public dependency constructor accepts `Arc<dyn RandomSource>`
> (`crates/snapback-auth/src/auth/provider.rs:1527-1574`). Separately, rotation and issuance commit
> plans are clonable or expose a rerunnable `commit_plan(&self)`
> (`provider.rs:622-660`, `provider.rs:1206-1219`), so "the carrier was moved" does not establish that
> one commit event occurred — the move-semantics limit recorded in LLP 0303.
>
> What a replacement must satisfy: identity carried from a **producer-owned source a dependent cannot
> inject or reset**; the consumer compares the **installed producer/database instance** rather than
> accepting whichever provider minted the object; `Clone`, repeated `commit_plan(&self)`, callback
> reruns and test-support construction are all inside the threat model; and if single-use or
> cross-restart replay resistance matters, a Rust move is insufficient — consumed state must live in
> durable or producer-owned state.
>
> The safe identity mechanism is still an open design question. This paragraph is a stop sign, not a
> solution.

## Q05 — opaque auth operation identity

Decision: every issuance/rotation/revocation plan, its commit plan, admission, transaction attempt, committed session/revocations, projection carrier and plaintext release must carry one opaque process-local operation identity. Raw durable response values may not be recombined.

### Common type design

Add a private, non-serializable `AuthSessionOperationId` in `snapback-auth`, minted from the provider’s injected random source and bound to a private provider-instance identity. It must have redacted `Debug`, no textual accessor and no wire/database representation.

Copy the ID into:

- `ProviderSessionIssuancePlan` and commit plan.
- `ProviderTokenRotationPlan` and commit plan.
- `ProviderRevocationPlan`.
- Password-change/guest/exchange parent and child plans.
- Planning and commit admissions.
- Every transaction attempt, including rollback, uncertain and refused outcomes.

Introduce private-field wrappers:

```rust
pub struct BoundIssuanceAttempt { operation_id, attempt }
pub struct BoundRotationAttempt { operation_id, attempt }
pub struct BoundRevocationAttempt { operation_id, attempt }

pub struct MatchedIssuanceCommit { session, committed_revocations }
pub struct MatchedRotationCommit { session }
pub struct MatchedRevocationCommit { revocation }
```

One helper, `require_same_auth_operation`, must perform every ID/provider-instance comparison. A provider-level mismatch returns existing `INTERNAL_AUTH_STATE`. Coordinator catches it, fails the relevant projection/global topology closed, and returns `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`.

### Row changes

| Row | Current | Target | Disposition |
|---|---|---|---|
| F011 | [provider.rs:662](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:662): `into_issue(self, SessionResponse) -> CredentialIssue` | `into_issue(self, MatchedRotationCommit) -> CredentialIssue` | **DERIVE** — session is extracted from an already operation-matched receipt |
| F022 | [provider.rs:1258](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:1258): `into_issue(self, SessionResponse, Vec<SessionRevocation>) -> CredentialIssue` | `into_issue(self, MatchedIssuanceCommit) -> CredentialIssue` | **DERIVE** |
| F070 | [provider.rs:4448](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4448): `AddressAdmission::commit_planned_issuance_plan(&ProviderSessionIssuanceCommitPlan)` | Delete. Add `AuthAdmission::for_planned_issuance(plan) -> ProviderResult<PlannedIssuanceAdmission>`; it derives the address/stripe from the owned plan. Then `PlannedIssuanceAdmission::commit_plan()` accepts no separate plan | **DERIVE** at the sink. Provider-instance equality is still **VERIFIED** because re-admission occurs after an async lock boundary |

`AddressAdmission` should mint/carry the operation ID used by the plan it creates. On retry, obtain a new admission and therefore a new operation ID. Reacquisition must consume the plan, derive its address, lock that stripe and retain the same ID; server must not copy `CanonicalAddress` as it currently does at [server.rs:18475](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18475).

At coordinator joins:

```rust
let matched = attempt.join(&carrier.plan)?;
match matched {
    MatchedRotationAttempt::Committed(commit) => { ... }
    ...
}
```

Only `Matched*Commit` may reach `into_issue`. Do not retain field-by-field session/revocation comparisons in coordinator; the durable reconciliation helper and the single operation join own those predicates.

### Predicates to reuse

The durable tuple predicates already exist and are stronger than parallel coordinator checks:

- Revocation reconciliation: [provider.rs:3801](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3801).
- Rotation reconciliation: [provider.rs:3856](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3856).
- Issuance reconciliation: [provider.rs:5386](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:5386).

There is no current operation-identity helper. Add exactly one `require_same_auth_operation`; do not create separate address, coordinator and `into_issue` implementations.

### Callers to change

Provider/test-support raw `into_issue` callers:

- Password wrapper [provider.rs:879](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:879).
- Guest wrapper [provider.rs:1095](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:1095).
- Test-support guest replay [provider.rs:1836](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:1836).
- Refresh [provider.rs:3906](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3906).
- Exchange [provider.rs:4296](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4296).
- Address mint [provider.rs:4774](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:4774).

Coordinator joins:

- Rotation [coordinator.rs:1131](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1131), currently recombined at [1208](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1208).
- Issuance [coordinator.rs:1215](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1215), currently recombined at [1363](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1363).
- Password change recombination at [coordinator.rs:1487](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1487).
- Revocation finish must also consume its bound attempt so Q03 gets the same guarantee.

Production server flows requiring bound attempts:

- Address mint: [server.rs:18427](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18427).
- Password/session-password issuance: [server.rs:18532](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18532), [18579](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18579).
- Password reset: [server.rs:18626](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18626).
- Exchange: [server.rs:18697](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18697).
- Guest issuance: [server.rs:19258](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:19258).
- Password change: [server.rs:19910](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:19910).
- Refresh: [server.rs:20129](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:20129).
- Logout/revocation families at [server.rs:20262](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:20262) and their coordinator calls.

Provider tests using raw results must migrate at [provider_tests.rs:222](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/provider_tests.rs:222), [2045](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/provider_tests.rs:2045), [2115](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/provider_tests.rs:2115), [2160](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/provider_tests.rs:2160), and direct commit clusters around lines 581–586 and 2204–2552.

Observable compatibility:

- No wire or durable schema change; the operation identity stays process-local.
- Correct successful and refusal outcomes remain unchanged.
- Public/test-support construction and matching of `PlannedIssuanceCommit`, `PlannedRotationCommit`, raw `SessionResponse`, and raw revocation vectors becomes a Rust source break.
- Cross-operation recombination newly fails closed instead of potentially releasing one plan’s bearer with another plan’s durable result.

### Tests

Fail first with two genuinely produced operations A and B; do not manufacture or expose IDs:

- Carrier A + attempt A: accepted.
- Carrier A + committed, rollback, uncertain, collision or refusal attempt B: `INTERNAL_AUTH_STATE` at the provider join and `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` through coordinator.
- Address plan A can only be committed by an admission derived from owned plan A. The removed address-plus-plan method should be covered by a security-boundary compile-fail fixture.
- Plan A’s plaintext bearer must never be released with B’s session or revocation set.

All underlying outcomes with the same operation ID remain accepted by the join and then retain current semantics: committed, candidate collision, predecessor changed, code invalid/locked, credential invalid/throttled, guest budget/idempotency refusal, sender-key bound and rehearsal outcomes.

Durability:

- Same-operation issuance/rotation: read `_auth_sessions`, `_auth_session_tokens`, generations, current/superseded hashes and revocation rows.
- Cross-join after B committed: assert B’s durable rows exactly, A’s predecessor rows exactly, no A successor, no credential response, and projection rebuild/fail-closed state.
- Address mismatch refusal before commit: no session, token, identity, challenge or revocation changes.
- Ambiguous commit reconciliation must show the exact successor rows before producing a matched receipt.

Assertion provenance:

- Generate A/B with deterministic test randomness, but derive expected session IDs, hashes, generations and revocations from fixed random-source outputs and fixture inputs—not from the commit response.
- Never expose the operation ID merely to write `expected == observed`.
- Cross-join tests themselves prove identity inequality without inspecting its value.

Mutation review:

- Remove or invert the one operation-ID comparison.
- Compare the observed ID with itself.
- Attach the expected ID to an unrelated attempt during wrapping.
- Copy A’s ID into B’s commit plan.
- Change revocation vector `all` to `any`, truncate/permute entries, or accept only session ID without generation.
- Run A/Z subject ordering in both directions.

Batching: F011 and F022 should land together with the common bound-attempt/matched-receipt infrastructure. F070 should be a separate, sequential lane because it changes address lock ownership and async reacquisition. Land Q05 before Q03’s final commit-receipt conversion.

Collision: all three rows require edits to `crates/snapback-auth/src/auth/provider.rs`, directly colliding with the authenticated-use lane. Wait for that lane, rebase, then implement Q05. The process-local design intentionally avoids `server/oauth.rs`, `storage/auth_integrations.rs`, and any durable schema migration.

Scope: Q05 does not make `PreparedAuthority` unconstructible. Its claim is only that plan/admission/attempt/result joining is correlated by one opaque operation identity. It must not be described as global authority closure or impossibility.

## Landing order and common proof gates

Recommended sequence:

1. Authority-provenance sealing lane.
2. Q02 as one atomic lane.
3. Q04 as one atomic lane, rebased onto sealing.
4. Authenticated-use provider lane.
5. Q05 F011+F022.
6. Q05 F070.
7. Q03 F100+F101.
8. Q03 F102 independently.

For every lane, the coding agent must:

- Add and run the watched failure before implementation and quote it verbatim.
- Run the focused crate tests plus affected server integration tests.
- Run `./ref-check --verbose`.
- Run `node scripts/check-inventories.mjs` because moving Rust diagnostic sites can stale the diagnostics registry even without adding a code.
- Run `node scripts/check-guide.mjs` if any guide-referenced signature moves.
- If the checkout is clean and Rust build state is absent, run `scripts/bootstrap-ibex-runtime` before Cargo commands, per repository instructions.