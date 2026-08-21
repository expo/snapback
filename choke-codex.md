# Authority-Transition Chokepoint Design

**Type:** Design
**Status:** Proposed — security review and two author rulings required
**Systems:** kernel, identity/auth, grants, jobs, watches, capability links, rehearsal, membership, restore/import, invocation
**Date:** 2026-08-20
**Related:** LLP 0214, 0225, 0283, 0284, 0285, 0291
**Publication:** Blocked until every authority family is migrated and the residual review is accepted

## 1. Decision

Adopt a single kernel-owned authority-transition chokepoint.

The operation must perform three inseparable jobs:

1. Re-derive every security-relevant fact from durable state.
2. Mint transaction-bound evidence that cannot leave the chokepoint.
3. Hold exclusive write custody over every durable or in-memory authority successor.

This is the smallest change that closes the *class*. Making session insertion private, adding another opaque `ResolvedPrincipal`, or narrowing public constructors would not close grants, retained service authority, watches, callback principals, capability links, membership provenance, rehearsal authority, or in-memory invocation authority. Those alternatives relocate assertion and would be the fifth failed design.

The decisive difference is:

> A caller may submit candidates and proof material, but it can neither submit evidence nor select the resulting subject, authority class, predecessor, purpose, scope, provenance, or successor. The same kernel operation derives those facts, consumes the evidence, and owns the protected write.

No legacy authority writer, public `ResolvedAppAuthority` constructor, generic `System` path, or evidence-less fallback may remain when the program is declared complete.

A smaller per-family patch is not sufficient. The only equivalent alternative would be to move every authority writer and resolver into one new kernel subsystem without calling it a chokepoint; that is the same design under another name.

## 2. Source basis and confidence

This design targets the live post-reachability tree at commit `1d1f3b6fd`.

`llp/0291-authority-forgery-surface.research.md` and the named `lane/f1-forge` ref are not present in this checkout or any locally available Git ref. Therefore:

- The reported inventory of 30 ordinary and 16 feature-gated families, approximately eleven creation mechanisms, the proposed names, and the minimal-invariant requirement are taken from the decision prompt.
- The exact LLP 0291 family ledger and original formal notation could not be independently line-cited.
- Before implementation or acceptance, LLP 0291 must be brought onto the implementation base and reconciled family by family with this design. Any family not represented below blocks completion.

This is a source limitation, not permission to reduce the reported inventory.

## 3. Why the current tree has no chokepoint

The reachability work successfully made the root `pub(crate)` and placed it in `ServingDatabase` (`crates/snapback-kernel/src/storage.rs:581-605`, `crates/snapback-kernel/src/storage.rs:1376-1395`). That closes access to the old root but does not close fact assertion.

Independent assertion paths remain:

| Surface | Current behavior |
|---|---|
| In-memory application authority | `ResolvedAppAuthority` is a public, `Clone` enum with caller-constructible `Session`, `RevalidatedPrincipal`, `ServicePrincipal`, `AdminBypass`, and `System` variants (`crates/snapback-sync/src/auth/invocation.rs:294-356`). |
| Invocation preparation | Public preparation accepts a caller-supplied `ResolvedAppAuthority`; its checks concern admission, mode, source compatibility, and projection rather than durable derivation of the supplied variant (`crates/snapback-sync/src/auth/invocation.rs:1915-1958`, `crates/snapback-sync/src/auth/invocation.rs:1972-2058`). |
| Internal service | Cron and job staging directly select `ResolvedAppAuthority::System` (`crates/snapback-engine/src/local/engine.rs:20904-20924`, `crates/snapback-engine/src/local/engine.rs:20927-20947`). Ordinary cron execution does the same (`crates/snapback-engine/src/local/engine.rs:25601-25631`). |
| Membership | `MembershipWriter` publicly exposes `Seed`, `Import`, and `Admin`, and `ResolvedMembershipWriter` is independently constructible (`crates/snapback-kernel/src/storage.rs:14102-14154`). Public typed façades accept those values for planning and commit (`crates/snapback-kernel/src/storage/membership_plans.rs:1812-1940`). |
| Session issuance | `CatalogSessionIssuancePlan` contains public fields representing identity state, projected session, revocations, password state, challenge state, sender issuance, rehearsal state, and time (`crates/snapback-kernel/src/storage/auth_catalog_ops.rs:114-151`); a public kernel façade accepts it for commit (`crates/snapback-kernel/src/storage/auth_catalog_ops.rs:4512-4522`). |
| Capability links | The public mint DTO contains minter principal, session, authority-instance, function, expiry, and use-policy fields (`crates/snapback-kernel/src/storage/capability_links.rs:119-133`). The engine compares those fields to a `PreparedAuthority` before entering the kernel (`crates/snapback-engine/src/local/engine.rs:5099-5130`), but the committing transaction rechecks only that the named principal is live and then inserts the caller fields (`crates/snapback-kernel/src/storage/capability_links.rs:374-449`). |
| Watches | Watch creation accepts a public all-field record containing owner, authority mode, grant links, scope bases, and expiry (`crates/snapback-kernel/src/storage/watches.rs:99-131`). The storage method mints an integration anchor and inserts the supplied record (`crates/snapback-kernel/src/storage/watches.rs:221-296`). Execution later constructs new `ResolvedAppAuthority` values directly from watch data (`crates/snapback-engine/src/local/engine.rs:22790-22841`). |
| Rehearsal | `RehearsalExercisePlan` is public, `Clone`, and contains carrier, binding, request, semantic-success, outcome, and time assertions (`crates/snapback-kernel/src/storage/auth_rehearsal.rs:66-75`). Public methods consume it for authority-bearing effects (`crates/snapback-kernel/src/storage/auth_rehearsal.rs:370-386`). |
| Restore | Restore currently accepts a declaration identifier and caller time, then begins the destructive transaction; it has no owner-only trust-anchor parameter or lookup (`crates/snapback-kernel/src/storage/auth.rs:1945-1967`). |
| Database access | `ServingDatabase::auth_database_mut` still exposes the underlying mutable `LocalDatabase` through a compatibility seam (`crates/snapback-kernel/src/storage.rs:1439-1445`). |
| Write mechanism | `LocalDatabase` already has a connection-local writer façade and SQLite authorizer, but the comment says it is dormant until a coverage manifest is present (`crates/snapback-kernel/src/storage.rs:1301-1313`). |

Some individual implementations already revalidate correctly. For example, grant approval consumes step-up proof and creates the grant in one transaction (`crates/snapback-kernel/src/storage/auth_grants.rs:415-496`), and scoped-token exchange revalidates the authorization code, credential, actor, grant, and expiry before insertion (`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:688-790`). Those are reusable verifier bodies, not evidence that all producers share one custody boundary.

## 4. Security invariant

Let:

- \(F\) be any additive Cargo-feature selection reachable by a workspace dependent.
- \(A\) be the union of durable and in-memory authority states.
- \(\Delta\) be a transition that creates authority or increases an existing authority state.
- \(\tau\) be the SQLite transaction or protected read cut in which \(\Delta\) is admitted.
- \(E\) be one `KernelVerifiedEvidence` value.

The required invariant is:

\[
\forall F,\ \forall \Delta \in A:
\operatorname{committedOrPublished}(\Delta)
\Rightarrow
\exists! E:
\begin{aligned}
 &\operatorname{mintedByKernelVerifier}(E) \\
 {}\land{}& E.database = \Delta.database \\
 {}\land{}& E.transaction = \tau \\
 {}\land{}& E.subject = \Delta.subject \\
 {}\land{}& E.purpose = \Delta.purpose \\
 {}\land{}& E.predecessors = \operatorname{durablePredecessors}(\Delta,\tau) \\
 {}\land{}& E.time = \operatorname{durableTime}(\tau) \\
 {}\land{}& E.successorDigest = \operatorname{digest}(\Delta) \\
 {}\land{}& \operatorname{consumedOnceByChokepoint}(E,\Delta,\tau)
\end{aligned}
\]

And:

\[
\nexists \text{ reachable operation under } F
\text{ that creates or increases } A
\text{ without that consumption.}
\]

For an in-memory admitted authority, “published” means returned from the kernel as an invocation lease. Such a lease does not authorize a later authority-increasing write by itself; the later committing transaction must revalidate its durable predecessors and mint fresh evidence.

This is stronger than “only the kernel can construct a token.” It also requires that no alternate SQL writer or public in-memory authority constructor exists.

## 5. Evidence type

### 5.1 Ownership and privacy

`KernelVerifiedEvidence` lives in a new `snapback-kernel::storage::authority_transition` module.

It is a completely private type: `struct`, not `pub`, `pub(crate)`, or re-exported. Its component types are private to the same module. Actual protected writers move beneath that module as descendants.

There is exactly one struct-literal mint site, lexically inside `verify_transition_on`. There is no constructor method.

The type implements none of:

- `Clone`
- `Copy`
- `Default`
- `Serialize`
- `Deserialize`
- `From`
- `TryFrom`
- `FromStr`
- `AsRef`
- `Borrow`
- ordinary `Debug`

There is no public or private field named `verified`, `authorized`, `is_valid`, or equivalent Boolean. Proof success is represented only by the existence of the private evidence value.

Downstream crates cannot implement `Deserialize` or `From` for it because they cannot name the type and Rust’s orphan rules prohibit implementing an external trait for a foreign type. Feature-gated code cannot widen it because the gate rejects any visibility or trait-shape change under every additive feature closure.

### 5.2 Exact fields

`KernelVerifiedEvidence` has these fields:

| Field | Exact role |
|---|---|
| `database: EvidenceDatabaseIdentity` | Contains the connection’s process-unique `Arc<()>` identity and a digest of the private file-identity key. In-memory databases use a kernel-generated identity. Both are compared with the active transaction before use. |
| `transaction_epoch: NonZeroU64` | Monotonically allocated by the connection at `BEGIN`; rollover fails closed. The active `AuthorityWriteTransaction` must carry the same epoch. |
| `single_use_nonce: NonZeroU128` | Kernel-random, registered as the active unconsumed evidence nonce on the transaction, and removed atomically when application begins. |
| `lane: EvidenceLane` | Private closed enum: `Bearer`, `Password`, `RecoveryCode`, `Delivery`, `StepUp`, `OperatorRestore`, `OperatorImport`, `InternalService`, or `Rehearsal`. |
| `subject: VerifiedSubject` | Private closed representation of the derived principal or service subject. |
| `purpose: AuthorityPurpose` | Private closed operation and target. No stringly typed or generic `System` purpose exists. |
| `predecessors: Box<[VerifiedPredecessor]>` | Non-empty set of durable row, absence, generation, configuration, or trust-anchor witnesses. The only mint site refuses an empty set. |
| `time: VerifiedTime` | Durable clock domain, persisted floor, `verified_at_ms`, and the minimum applicable `not_after_ms`. |
| `write_set: AuthorityWriteSet` | Exact authority objects and security-relevant fields allowed to change. |
| `successor_digest: [u8; 32]` | Domain-separated digest of the normalized successor, including subject, purpose, target keys, provenance, scopes, and time. |
| `_not_send_sync: PhantomData<Rc<()>>` | Prevents evidence from crossing a thread or detached-task boundary. |

`EvidenceDatabaseIdentity` contains:

- `process_identity: Arc<()>`
- `file_identity_digest: [u8; 32]`

The current database binding already uses private `Arc` pointer identity (`crates/snapback-kernel/src/storage.rs:532-579`), while file-backed authority identity is derived from canonical filesystem identity (`crates/snapback-kernel/src/storage.rs:635-658`). Evidence binds both without making either an authority source.

### 5.3 Subject

`VerifiedSubject` is a private closed enum:

- `ProspectiveHuman { principal_id }`
- `HumanSession { principal_id, session_id, authority_instance_id, session_generation }`
- `HumanCredential { principal_id, identity_id, credential_id, credential_generation }`
- `DelegatedService { actor_principal_id, effective_principal_id, credential_id, credential_generation, grant_id, token_id }`
- `AutonomousService { actor_principal_id, credential_id, credential_generation, grant_id, token_id }`
- `WatchOwner { owner_principal_id, watch_id, anchor_grant_id }`
- `Operator { trust_anchor_digest, operator_audit_id }`
- `InternalWork { service_class, work_object, work_id, lease_generation }`
- `Rehearsal { grant_id, window_id, provenance_digest }`

There is no `System`, `Admin`, `Seed`, `Import`, or `Anonymous` unit variant. Operator, import, and internal-service authority are present only when bound to the named durable or owner-only predecessor.

### 5.4 Purpose

`AuthorityPurpose` is a private closed enum with exact targets:

- `ResolveFunctionInvocation { function_id, function_kind, scope_basis }`
- `IssueSession`
- `AttachIdentity`
- `CreateOrRotateCredential`
- `RecordAssurance`
- `ProvisionVerifiedIdentity`
- `ApproveGrant`
- `MintScopedToken`
- `InstallScopeBasis`
- `WriteProtectedMembership { table, resource, transition }`
- `CreateOrRenewWatch`
- `ExecuteWatch`
- `MintCapabilityLink`
- `ExerciseRehearsal`
- `CreateCallbackPrincipal`
- `ClaimInternalWork`
- `RestoreAuthorityCatalog`
- `ImportIdentityCatalog`

Any new purpose requires editing this closed enum, the verifier match, the authority-object registry, the family ledger, tests, and gates in the same change.

### 5.5 Predecessors and time

`VerifiedPredecessor` is one of:

- `PresentRow { object, primary_key, security_generation, security_digest }`
- `AbsentRow { object, primary_key, enclosing_generation }`
- `ConsumedProof { object, primary_key, predecessor_generation, proof_digest }`
- `ActiveConfiguration { deployment_digest, function_digest, scope_basis }`
- `OwnerTrustAnchor { database_digest, anchor_digest, operation_digest }`

Even a new principal has predecessors: absence of the proposed identity/session identifiers, current catalog version, active configuration, and the governing proof row. “There was no predecessor” is not allowed.

`VerifiedTime` contains:

- `clock_domain`
- `durable_floor_ms`
- `verified_at_ms`
- `not_after_ms`

The caller’s wall-clock sample is only an observation used to advance the durable floor. The resulting floor is the authority time. A lower later sample cannot revive authority. The current catalog already persists a non-decreasing session clock floor (`crates/snapback-kernel/src/storage/auth.rs:1828-1853`).

## 6. Chokepoint operation

### 6.1 Signature

The only operation that may mint or consume `KernelVerifiedEvidence` is the following private method on `ServingDatabase`:

```text
fn commit_verified_authority_transition(
    &mut self,
    intent: AuthorityTransitionIntent<'_>,
) -> SnapbackResult<AuthorityTransitionOutcome>
```

Both `AuthorityTransitionIntent` and `AuthorityTransitionOutcome` are private closed enums.

There is:

- no evidence parameter;
- no caller-supplied `ResolvedPrincipal`;
- no caller-supplied authority enum;
- no verifier callback;
- no public closure factory;
- no self-implementable trait;
- no public random-source parameter;
- no generic “trusted” or `System` lane.

Public façades are lane-specific methods on `ServingDatabase`. They accept only untrusted selectors, presented secrets, cryptographic artifacts, or ordinary non-authority request data. Each façade constructs a private intent and immediately calls the chokepoint.

### 6.2 Execution sequence

For every intent:

1. **Perform expensive proof work under kernel custody.** Password Argon2 verification and provider cryptography may occur outside the writer transaction, but the kernel owns the computation. It does not accept a Boolean or opaque “verified” claim from another crate. The outside result is a private snapshot-bound computation result.
2. **Begin the protected transaction.** Authority-increasing writes use `BEGIN IMMEDIATE`. Read-only invocation admission uses a protected read cut.
3. **Allocate the transaction epoch and durable time.**
4. **Match the closed intent.** The kernel loads every subject, proof, predecessor, configuration, grant, scope, lease, and trust-anchor fact required by that lane.
5. **Recheck outside computation.** Snapshot identity, credential generation, proof generation, revocation state, and expiry are rechecked in the committing transaction. This follows the required transaction rule (`llp/0285-kernel-authorization-closure.spec.md:422-440`) and the identity-core rule for expensive verification (`llp/0214-snapback-identity-core.spec.md:2097-2115`).
6. **Derive the successor.** Security-relevant fields are taken from durable rows and kernel-owned configuration. Caller values may select an identifier or requested non-authority payload; they never determine subject, class, scope, provenance, predecessor, or audit actor.
7. **Mint exactly one evidence value.**
8. **Consume it immediately.** `apply_verified_transition_on` compares database identity, transaction epoch, active nonce, purpose, write set, successor digest, and durable time. It atomically removes the nonce.
9. **Open the protected write scope.** Only now may statements affecting protected objects be prepared or executed.
10. **Apply the complete successor and audit record.** Partial authority successors are forbidden.
11. **Commit.** Evidence is dropped regardless of outcome and is never returned.
12. **Publish only a committed outcome.** Secrets and an opaque admitted-authority lease may be returned only after a classified committed verdict. Commit uncertainty is reconciled from idempotency receipts or durable successor rows; evidence is never reconstructed from memory.

No proof-bearing value may survive across steps 8–11.

### 6.3 In-memory admitted authority

The public replacement for `ResolvedAppAuthority` is:

```text
pub struct AdmittedAuthority {
    inner: AdmittedAuthorityInner
}
```

`inner` and all its fields are private. Neither type has a public constructor, enum variants, `Clone`, `Default`, serde traits, or conversions.

The chokepoint may return an `AdmittedAuthority` for `ResolveFunctionInvocation` after committing its protected read cut. It contains:

- database binding;
- purpose and exact function/basis;
- non-secret subject projection;
- predecessor digest;
- verified time and expiry;
- admission generation.

It cannot be converted back into `KernelVerifiedEvidence`.

For any later authority-increasing durable write, it is only a lookup selector. The committing chokepoint re-reads the subject and predecessor rows. Revocation after invocation admission therefore prevents the later authority increase.

`InvocationGate::prepare_admitted_authority` becomes non-public and accepts only `AdmittedAuthority`; it no longer accepts `ResolvedAppAuthority`. The public enum is deleted, including `System`. Handler projection remains a read-only consequence of the admitted value.

### 6.4 Protected write custody

A code-generated `AuthorityObjectRegistry` enumerates:

- `_auth_users`
- `_auth_identities`
- `_auth_credentials`
- `_auth_password_credentials`
- `_auth_passkey_credentials`
- `_auth_recovery_code_sets`
- `_auth_recovery_codes`
- `_auth_sessions`
- `_auth_session_tokens`
- `_auth_verification_codes`
- `_auth_assurances`
- `_auth_provisioning_receipts`
- `_auth_agent_credentials`
- `_auth_grants`
- `_auth_grant_tokens`
- `_auth_scope_bases`
- integration and pairing authority tables
- `_snapback_watches`
- watch-anchor grants
- `_snapback_capability_links`
- rehearsal grants, windows, challenges, reservations, and counters
- callback principals and grants
- protected membership tables declared by the active schema
- internal work rows whose claim creates service authority
- restore/import receipts and authority clocks

The registry is derived from the catalog/table declarations and active schema; it is not a hand-maintained list of SQL strings.

The SQLite authorizer denies every `INSERT`, `UPDATE`, `DELETE`, `CREATE TRIGGER`, `DROP`, `ALTER`, and replacement operation affecting a protected object unless:

- the current connection is inside `AuthorityWriteTransaction`;
- its epoch equals the evidence epoch;
- its active nonce has just been consumed; and
- the table and columns appear in the evidence write set.

This protects against a missed direct writer even inside the kernel. It is deliberately stronger than the requested rule: *all* mutations of protected authority objects, including revocation and retirement, pass through the subsystem. That avoids a false classification where an apparently decreasing update also replaces provenance, generation, scope, or owner.

Protected statements are prepared after the scope opens and may not escape the transaction. Statement caching for protected writes is disabled. The authorizer must be tested against trigger bodies, dynamic table names, schema-qualified names, attached databases, and statements prepared before scope entry.

The raw connection, protected statement, and write-scope types are private to the authority-transition module. `auth_database_mut` is deleted. Existing read-only catalog façades may remain public.

This write custody is why session privacy alone is insufficient: a forged grant, retained service credential, watch anchor, capability link, callback principal, membership provenance, or in-memory authority would otherwise bypass it.

## 7. Surface disposition

| Authority family | Chokepoint treatment |
|---|---|
| Sessions | Session and token creation, rotation, extension, and reactivation use `IssueSession`; subject, identity/credential source, generation, authority instance, token family, and time are derived in the transaction. |
| Identities and principals | Creation, attachment, claim, deactivation, and guest promotion use `AttachIdentity`; uniqueness, owner, identity provider, proof provenance, and session consequences form one successor. |
| Credentials | Password, passkey, recovery, agent credential, and rotation writers use `CreateOrRotateCredential`; random generation is kernel-owned. |
| Assurances | Assurance kind and provenance are selected by the verifier lane, never request data. Identity, credential, session, governing authority, and expiry are bound in evidence. |
| Grants | Request, approver, effective principal, actor, exact scopes, bases, consent digest, step-up requirement, and expiry are re-derived. Existing in-transaction step-up consumption is retained. |
| Tokens | Credential generation, live grant, actor/effective principal, exact scopes, caps, and expiry are reloaded in the token-insertion transaction. |
| Scope bases | Only an admitted generation activation may install or increase bases. Function identity, kind, `authority_creating`, bundle digest, and active generation are one predecessor/successor cut. |
| Watches | Watch owner, authority mode, exact functions, scope bases, installation grant, anchor grant, expiry, and callback authority are derived in one transition. Watch execution obtains a fresh `AdmittedAuthority`; it never constructs an authority enum. |
| Capability links | The committing transaction revalidates exact minter session, session generation, authority instance, function identity, scope basis, pinned arguments, expiry, and use policy. The all-field mint DTO disappears. |
| Rehearsal | Grant minting, window installation, identity/session creation, counters, taint, and clock effects use a private rehearsal intent. Public `semantic_success`, outcome, binding, and time assertions disappear. |
| Membership | Writer class and provenance derive from an admitted subject or operator trust anchor inside the commit. `MembershipWriter::{Seed,Import,Admin}` and public resolved-writer types disappear. |
| Callback principals | Callback principal and grant creation require the exact durable asset/work predecessor and installed callback policy; no generic service-principal constructor remains. |
| Internal service | Every producer claims an exact durable work row or invokes a closed operation that derives its work internally. There is no generic `System` acquisition operation. |
| Restore/import | Restore requires an owner-only database-bound trust anchor. Import can carry admissible identities and assurances but cannot import sessions, live grants, tokens, recovery codes, or rehearsal authority, consistent with LLP 0214 (`llp/0214-snapback-identity-core.spec.md:3147-3164`). |

## 8. Legitimate evidence-minting lanes

### 8.1 Bearer

**Presented input:** Raw bearer token and requested function.

**Kernel verification:**

- Hash the token inside the kernel.
- Load `_auth_session_tokens` and `_auth_sessions`.
- Check current token family, session generation, authority-instance identifier, idle and absolute expiry, revocation, optional sender binding, and principal liveness in `_auth_users`.
- Load applicable identity/credential state and active function/scope basis.
- Use the persisted auth-clock floor.

**Transaction:** Protected read cut for invocation resolution. Any authenticated-use extension or authority-increasing write repeats the relevant checks in its own committing transaction.

**Evidence:** `HumanSession`, `Bearer`, exact function purpose, session/token/principal predecessors, durable time.

### 8.2 Password

**Presented input:** Canonical identifier candidate and password bytes.

**Kernel verification:**

- Read `_auth_identities`, `_auth_credentials`, `_auth_password_credentials`, and `_auth_password_attempts` through a bounded snapshot.
- Perform Argon2id inside kernel-owned code, outside the writer lock.
- Start the transition transaction and recheck identity mapping, credential identifier, generation, PHC digest, credential liveness, lockout state, principal state, and policy version.
- Derive session and assurance successors; do not accept them in a plan.

**Transaction:** Credential recheck, attempt accounting, session creation, token creation, assurance creation, recovery rotation if applicable, revocation/cap effects, security journal, and provisioning consequences commit together.

**Evidence:** `HumanCredential`, `Password`, snapshot row digests, credential generation, durable time.

The existing identity-core contract already requires this outside-compute/inside-recheck pattern (`llp/0214-snapback-identity-core.spec.md:2097-2115`).

### 8.3 Recovery code

**Presented input:** Identifier candidate and recovery code.

**Kernel verification:**

- Load `_auth_credentials`, `_auth_recovery_code_sets`, `_auth_recovery_codes`, `_auth_identities`, and `_auth_users`.
- Verify the keyed code digest, live set generation, unconsumed ordinal, unreplaced set, credential liveness, identity ownership, and principal state.
- Derive a replacement recovery set and new session.

**Transaction:** Consume the code, replace the set, revoke affected sessions if required, create the successor session and assurances, advance the clock, and journal the event atomically.

**Evidence:** `HumanCredential`, `RecoveryCode`, exact set/ordinal/generation predecessors.

### 8.4 Delivery proof

**Presented input:** Challenge identifier and submitted code or provider proof.

**Kernel verification:**

- Load `_auth_verification_codes`, canonical identity state, delivery-adapter installation and activation, current deployment, key id, attempt count, expiry, consumption state, and delivery-handoff receipt.
- Verify submitted proof against the stored digest.
- Verify that the handoff came through the exact configured `contact-ownership` adapter, not a capture/simulation adapter.
- Derive identity and assurance kind from the verified transition.

**Transaction:** Proof consumption, identity link, assurance, session consequences, provisioning receipt, permission advancement, and journal entry commit together. LLP 0214 already requires one consume/link/assurance transaction and a governing adapter installation (`llp/0214-snapback-identity-core.spec.md:1392-1419`).

**Sealing requirement:** The delivery adapter’s handoff writer is itself a sealed internal-service lane. It holds a move-only, non-cloneable adapter lease installed by private composition after durable adapter activation. The general engine cannot obtain it. No public method accepts `delivered: bool` or a caller-created receipt.

**Open implementation question:** The current crate ownership graph may not permit an unconstructable cross-crate adapter lease without moving the small handoff-verification mechanism into the kernel or introducing a cryptographically authenticated receipt. This boundary must be compiled and resolved before the lane is accepted.

### 8.5 Step-up proof

**Presented input:** Pending operation identifier, challenge identifier, and submitted code.

**Kernel verification:**

- Load `_auth_verification_codes`.
- Load the exact session, generation, authority instance, pending effect or grant request, operation digest, required approver, and requested authority delta.
- Re-derive whether the successor requires step-up.
- Verify code digest, key, attempts, expiry, unconsumed state, approver identity, and operation binding.

**Transaction:** Consume proof and apply the exact pending transition in one transaction.

The current proof primitive already verifies and consumes the challenge row transactionally (`crates/snapback-kernel/src/storage/auth_catalog_ops.rs:2218-2313`), and grant approval already consumes it before inserting an authority-creating grant (`crates/snapback-kernel/src/storage/auth_grants.rs:459-496`). The chokepoint keeps those predicates and removes the independent public inputs around them.

### 8.6 Operator restore/import

**Presented input:** Operation identifier, input artifact, and operator authentication material.

**Kernel verification:**

- Read an owner-only database-bound trust-anchor digest; never accept the expected digest in the request.
- Verify operator authentication and operation digest against that anchor.
- For restore, inspect restored catalog generation and timestamps, derive the terminal session/token/grant cut, and advance the durable clock above restored authority.
- For import, verify source digest, adapter/version, import receipt, identity uniqueness, assurance admissibility, and current target policy.

**Transaction:** Restore/import receipt, catalog changes, authority retirement, clock advancement, and audit record commit together.

Imported live authority is always discarded. There is no “trusted import” switch.

**Blocking condition:** If no owner-only trust anchor exists, the lane fails closed. This design does not permit the current declaration-id-only restore call to be grandfathered.

### 8.7 Sealed internal service

This lane covers cron, jobs, pending effects, asset callbacks, watch execution, startup reconciliation, and any future internal producer.

There are only two legitimate forms:

1. **Durable work claim:** Verify an exact row such as `_snapback_jobs_v1`, `_snapback_pending_effects`, watch record, asset work ledger, or callback grant. Bind work id, service class, lease/claim generation, action/function id, scope basis, expiry, and predecessor state.
2. **Closed kernel operation:** Invoke a purpose-specific operation whose entire work set is derived internally, such as `reconcile_orphaned_stream_attempts`. It does not return reusable application authority.

A retained credential or callback principal additionally requires its exact `_auth_agent_credentials`, `_auth_grants`, `_auth_grant_tokens`, or callback-grant predecessor.

There is no generic `InternalService` constructor exposed outside the verifier and no `System` outcome.

### 8.8 Rehearsal

**Presented input:** Carrier secret, requested bounded exercise, and idempotency key.

**Kernel verification:**

- Load rehearsal grant, carrier hash, instance/app/boot binding, activation digest, mode generation, expiry, revocation, window, selector, counter, and disposable-store markers.
- Derive semantic success inside the kernel.
- Preserve rehearsal provenance on every identity, assurance, and session successor.

**Transaction:** Charge, first-use marker, exact effect, counters, taint, and audit commit together.

The current public `RehearsalExercisePlan` permits caller-selected semantic outcome and time (`crates/snapback-kernel/src/storage/auth_rehearsal.rs:66-75`); that type is replaced by an untrusted request plus kernel-derived evidence. Existing atomic counter/effect logic can remain (`crates/snapback-kernel/src/storage/auth_rehearsal.rs:361-376`).

## 9. Interaction with `lane/f1-forge`

The following treatment is based on the in-flight changes described in the decision prompt; the branch itself was unavailable for inspection.

### Subsumed

- The proposed cross-crate `ResolvedPrincipal` carrier is subsumed by private `VerifiedSubject` inside `KernelVerifiedEvidence`.
- Any public resolver that returns `ResolvedPrincipal` is subsumed by lane-specific chokepoint entry points.
- Any admission that accepts a `ResolvedPrincipal` and then trusts its fields is subsumed.
- Public `ResolvedAppAuthority` and public preparation functions are removed, not wrapped.

If the in-flight `ResolvedPrincipal` remains independently obtainable or movable outside the transaction, it must be discarded. As described, it adds a twelfth assertion mechanism rather than replacing the existing eleven.

Code that computes its fields may be retained only after relocation into `verify_transition_on`, with the result represented as private local data that cannot escape or be passed into a writer.

### Kept

These are correctness fixes independent of the chokepoint and become verifier predicates:

- Delete `requires_step_up` and re-derive it from the requested successor.
- Bind proof to the exact approver and operation.
- Persist and use monotonic clock floors.
- Install the complete loaded function/policy state during same-mode activation.

The current tree already has a durable session-clock floor (`crates/snapback-kernel/src/storage/auth.rs:1828-1853`) and a same-mode activation path that commits the function manifest and authorization event with activation (`crates/snapback-kernel/src/storage/auth_mode.rs:1331-1544`). The in-flight fixes should be preserved where they strengthen those invariants.

### Discarded

- Public or `pub(crate)` authority enums with caller-selected variants.
- Any `Clone`, serde, `From`, or default implementation on proof/evidence carriers.
- Any public constructor or closure factory for “resolved” authority.
- Any public self-implementable verifier or random-source trait used by production.
- Any fallback accepting the old plan/DTO when evidence is absent.
- Any generic `System`, `Admin`, `Import`, `Seed`, or “trusted” constructor.
- Any approach that makes only the session writer private.

## 10. Migration

### 10.1 Rule for interim states

The current tree is not closed, so no staged plan can truthfully make the whole program safe before the final family migrates. The safe staging rule is instead:

- Every family is in exactly one state: `LegacyEnumerated` or `ChokepointOnly`.
- The exact legacy family and writer-callsite set is frozen at stage 0.
- No family may support both a new evidence path and an unenumerated fallback.
- A family flips atomically to `ChokepointOnly` in the same landing that removes all its legacy writer entries.
- The legacy set shrinks monotonically.
- Publication remains blocked until the set is empty.

This avoids a half-converted family while honestly preserving the program-level block.

Each landing must leave:

- `cargo check --all-targets --workspace` green;
- every caller-selected feature combination represented by the gate green;
- the checked-in `schemas/` digest unchanged;
- the legacy ledger equal to the actual remaining sites.

Internal SQLite migration changes, if unavoidable, require explicit review but must not change generated public schemas.

### 10.2 Stages

#### Stage 0 — reconcile and freeze

- Bring LLP 0291 and `lane/f1-forge` onto the implementation base.
- Create the exact 46-family ledger, including every feature predicate, public entry point, durable table/column, in-memory successor, current verifier, writer, test seam, and intended purpose.
- Freeze `schemas/`, current behavior fixtures, SQL traces, and compile-fail probes.
- Reject any new authority family or writer not represented in the ledger.

No behavior changes.

#### Stage 1 — install the empty chokepoint

- Add the private intent, evidence, subject, purpose, predecessor, time, write-set, and outcome types.
- Add the private method with no migrated production variants.
- Add the authority-object registry in audit mode.
- Add runtime reporting for protected writes outside a registered legacy or chokepoint scope.
- Do not expose evidence or an additive `ResolvedPrincipal`.

No existing family changes custody yet.

#### Stage 2 — invocation authority

- Introduce `AdmittedAuthority`.
- Migrate bearer, scoped-token, watch, callback, and internal-service resolution.
- Make invocation preparation non-public and evidence-outcome-only.
- Delete public construction of `ResolvedAppAuthority`.
- Eliminate generic `System`.
- Keep public invocation behavior stable through projection adapters.

This stage is complete only when no caller can construct in-memory application authority.

#### Stage 3 — sessions, identities, credentials, assurances

Migrate in dependency order:

1. Bearer resolution and authenticated-use extension.
2. Password authentication and session issuance.
3. Recovery consumption and rotation.
4. Delivery proof and identity attachment.
5. Guest creation and claim.
6. Password/passkey creation, change, rotation, and revocation.
7. Assurance and verified-provisioning writes.
8. Session cap, family rotation, and revocation consequences.

For each operation, move writer SQL beneath the chokepoint, then flip the affected table/column family to `ChokepointOnly`.

Because these tables are shared, table-wide enforcement flips only after every writer for that table is migrated. Until then, the exact legacy writer list remains active; there is no permissive table-wide exemption.

#### Stage 4 — grants, service credentials, tokens, callback authority

- Grant requests and approvals.
- Step-up-bound grants.
- Agent and integration credential issuance/rotation.
- Scoped token mint/exchange/pairing.
- Installation and retained service grants.
- Asset callback principals and grants.
- Grant/token revocation and retirement.

Reuse existing in-transaction checks, but move evidence minting and write custody around them.

#### Stage 5 — generation and scope authority

- Scope-basis installation and invalidation.
- Same-mode and mode-changing activation.
- Loaded policy installation.
- Authorization-version and retained-live-authority invalidation.

The durable generation remains the crash-recovery authority; no process-local admitted handle substitutes for it, consistent with `llp/0225-core-modularization.decision.md:270-290`.

#### Stage 6 — watches and capability links

- Watch creation, renewal, reactivation, anchor grant, and execution.
- Capability-link mint, consumption, approval, and revocation.
- Webhook/callback authority.

Flip watch, anchor-grant, and capability-link objects to `ChokepointOnly` in one reviewed wave because they form one retained-authority graph.

#### Stage 7 — rehearsal

- Grant mint/revoke.
- Window creation and challenge binding.
- Identity/session/assurance effects.
- Clock and disposable-store effects.
- Import/export receipts.

Delete public authority-bearing plan types before flipping rehearsal tables.

#### Stage 8 — membership, provisioning, import, restore

- Derive membership writer class in the committing transaction.
- Remove public privileged membership variants.
- Bind verified provisioning to the identity transition evidence.
- Install operator trust-anchor verification.
- Migrate restore and import.

Restore does not flip until the trust-anchor ruling is implemented.

#### Stage 9 — internal-service closure

Audit every `System` producer:

- cron;
- job execution;
- pending effects;
- startup repair;
- push;
- watches;
- assets;
- config verification;
- background reconciliation;
- feature-gated test helpers.

Each is converted to a durable work claim or closed kernel operation. Any producer with neither remains a blocking defect.

#### Stage 10 — enforce and delete legacy custody

- Delete the last `LegacyEnumerated` variant and its compatibility adapter.
- Turn the SQLite authority-object authorizer from audit to fail-closed.
- Delete `auth_database_mut`.
- Delete obsolete plan constructors and writer façades.
- Demote required test fixture construction to `#[cfg(test)]` inside the kernel; an additive `test-support` feature may not expose protected mutation.
- Run the complete feature, compile-fail, transaction, fault-injection, and schema-drift qualification.

Only this stage can close the program and unblock publication.

## 11. Gate design

### 11.1 What LLP 0284’s available machinery can prove

Using `syn`, `cargo metadata`, and `rustc --message-format=json` span assertions on pinned Rust 1.97.0, the gate can prove structural properties:

- `KernelVerifiedEvidence` and all component types are non-public.
- All evidence fields are private.
- There is exactly one struct-literal mint site.
- The type lacks every forbidden derive and implementation.
- There is no public constructor, factory, conversion, deserializer, or “verified” Boolean.
- No public API mentions evidence, private intent, private subject, or private purpose.
- No public `ResolvedAppAuthority`, `ResolvedPrincipal`, `MembershipWriter::Admin`, or generic `System` constructor remains.
- Public admitted-authority types have private fields and no construction traits.
- No public kernel API accepts `Fn`, an unsealed trait object, or a production random-source implementation as authority.
- Cargo features cannot enable a constructor, writer, test fixture mutator, or legacy permit.
- Every protected SQL literal and typed writer is beneath the chokepoint module or named in the shrinking legacy ledger.
- Every authority-bearing table declaration appears in the object registry.
- Compile-fail probes from dependent crates fail at the defining private field or item for attempted construction, cloning, deserialization, conversion, privileged membership, `System`, direct protected write, and feature-enabled test access.
- Every public lane maps to a named verifier span and purpose variant.

`cargo metadata` must enumerate additive feature closures, not merely the workspace’s default features. The reported 16 feature-gated families are first-class acceptance cells.

### 11.2 What the gate cannot prove

The full invariant is not mechanically provable by this suite.

In particular, it cannot prove:

- that the 46-family inventory is semantically complete;
- that a verifier queried every row required by the product policy;
- that a queried row or digest means what the design claims;
- that a caller field is never trusted indirectly through body data flow;
- that a dynamic SQL builder targets only the table inferred by syntax;
- that macro expansion, generated code, or a renamed sink has no hidden writer;
- that SQLite authorizer behavior covers every preparation/cache/trigger edge;
- that evidence is minted only after all predicates in the verifier have succeeded;
- that a future change inside the evidence-owning module does not add a second logical mint path while preserving the same syntax shape;
- that time, revocation, and generation checks are correctly ordered in every execution;
- that delivery-adapter handoff or operator trust-anchor semantics are sound;
- that a public accessor does not enable a higher-level semantic forgery even though the underlying value remains opaque.

LLP 0284 itself states that `syn` is not full macro or cross-crate semantic analysis and that signature checks do not establish body-level taint properties (`llp/0284-workspace-security-gate-threat-model.spec.md:541-645`).

### 11.3 Documented residual

The unprovable remainder is an explicit security residual:

> The gate proves evidence unconstructability, surface confinement, feature closure, and writer location. Human/model review plus transaction tests prove that each verifier’s durable predicates are sufficient for its purpose and successor.

The residual is carried by:

1. The exact 46-family ledger.
2. A per-purpose table naming every input, durable verification query, predecessor, successor field, and writer.
3. Independent review of every ledger row against live SQL.
4. Runtime authorizer tests for every protected object.
5. Revocation/generation races and commit fault injection for every lane.
6. A qualification digest binding the ledger, gate output, tests, and reviewed commit.

No scalar count or “zero public constructors” claim substitutes for that review.

## 12. Cost, breakage, and risk

### 12.1 Size

This is an XL security rearchitecture, not one more F-1 patch.

A realistic estimate is:

- 15–25 independently reviewable landings;
- 20–40 engineering days before complete qualification;
- several thousand lines relocated or replaced across kernel, auth, engine, sync, server, and tests;
- migration of approximately 46 families and eleven mechanisms;
- substantial compile-driven call-site discovery after public constructors disappear.

The estimate is uncertain until LLP 0291 is available and the feature-gated families are reconciled.

### 12.2 Expected breakage

The change will break:

- tests and fixtures that construct authority enums or all-public plan types;
- direct `LocalDatabase` auth mutation calls;
- feature-enabled `test-support` mutators;
- detached action staging that clones authority;
- cron/job paths without an exact durable claim;
- watch execution that reconstructs authority from record fields;
- capability-link minting DTOs;
- import/restore tools that supply caller authority facts;
- membership seed/import/admin constructors;
- service callback and retained-grant preparation;
- any activation path that installs schema without the matching function-policy state;
- code relying on caller-injected `RandomSource`;
- commit-uncertainty reconciliation that currently reconstructs results from in-memory plans.

Public wire behavior should remain stable except where an unsafe operation must newly fail closed. Public Rust APIs will change substantially.

### 12.3 Performance

Potential costs include:

- more `BEGIN IMMEDIATE` transactions;
- repeat reads of credential, grant, scope, generation, and clock rows;
- disabling protected-statement caching;
- larger atomic cuts for watches and provisioning;
- extra durable work claims for internal services.

Argon2, provider cryptography, network delivery, asset work, and other expensive work must remain outside the global writer. Only snapshot recheck and commit enter the transaction, as required by the storage ownership rule (`llp/0225-core-modularization.decision.md:254-301`).

### 12.4 Compile and borrow-check uncertainty

This design has not been compiled. The following claims are open until a prototype passes `cargo check --all-targets --workspace`:

- Whether `rusqlite::Transaction<'_>`, the connection authorizer, and a transaction-local epoch/nonce guard can coexist without conflicting mutable borrows.
- Whether protected statements can be proven not to escape while preserving existing helper structure.
- Whether changing the authorizer while a transaction exists is supported safely by the current rusqlite API.
- Whether a non-`Clone` `AdmittedAuthority` can move through every detached action and async boundary.
- Whether the kernel can own password/provider proof computation without creating dependency inversions.
- Whether delivery-adapter sealing is expressible under the current crate graph without a signed receipt.
- Whether dynamic protected membership tables can be supplied to the authorizer without borrowing the active schema incompatibly.
- Whether commit-uncertainty reconciliation can return secrets without retaining or cloning evidence.

The design deliberately uses an explicit transaction epoch and runtime identity comparison rather than claiming that a Rust lifetime alone solves the problem. A lifetime-branded evidence value may be possible, but it is not asserted until compiled; a literal mutable borrow of the transaction is likely to interfere with the subsequent writes it is meant to authorize.

## 13. Pending author rulings

### 13.1 `config.verify`

Current `config.verify` authenticates the admin route, stages the configured probe, and routes it through cron action staging (`crates/snapback-server/src/server.rs:20790-20834`, `crates/snapback-engine/src/local/engine.rs:21600-21668`). Cron staging then selects `ResolvedAppAuthority::System` without a durable work row (`crates/snapback-engine/src/local/engine.rs:20904-20924`).

The chokepoint makes the pending ruling unavoidable. There are only two acceptable outcomes:

1. **Recommended:** Define `ConfigProbe` as a closed execution class, not an application principal. It may read the named configuration and perform the narrowly declared probe, but it cannot project `System`, create authority, write protected membership, mint grants/tokens, or call arbitrary authority-creating functions.
2. If compatibility requires an ordinary privileged application action, create and claim a durable config-verification work row bound to entry revision, function id, active generation, operator audit, lease generation, and expiry.

“Admin route authentication implies `System`” is not acceptable because it gives the adapter, rather than the kernel transaction, authority to assert the class.

Until Charlie selects one, `config.verify` remains a blocking family.

### 13.2 LLP 0285 §8 risk 2 trust anchor

The chokepoint does not create a trust anchor by centralizing code.

Operator restore/import and protected erasure require a database-bound, owner-only digest loaded by the kernel. A digest supplied in the request is not a predecessor and does not satisfy the invariant.

The author must rule where and how that anchor is provisioned:

- owner-only sidecar bound to database identity;
- OS keychain entry bound to database identity; or
- a protected durable catalog record whose initial provisioning has a separate trusted ceremony.

Existing instances without the anchor must fail closed for protected restore/import/erasure until explicitly provisioned. This will break current declaration-only flows, including `apply_auth_restore_declaration`, but silently preserving those flows would leave the highest-risk forgery lane open.

## 14. Acceptance criteria

The forgery half is closed only when all of the following are true:

1. LLP 0291’s exact 46 families are present in the ledger and each is `ChokepointOnly`.
2. The legacy family and writer set is empty.
3. `KernelVerifiedEvidence` has the exact private, move-only, non-serializable shape specified here.
4. The only evidence mint and consume sites are inside `commit_verified_authority_transition`.
5. Every protected durable mutation is refused by SQLite outside the evidence-bound write scope.
6. Public `ResolvedAppAuthority`, public `ResolvedPrincipal`, public privileged membership variants, and generic `System` acquisition are absent.
7. Every in-memory admitted authority originates from the chokepoint and is purpose-, database-, predecessor-, and time-bound.
8. Every later authority-increasing write revalidates durable predecessors in its committing transaction.
9. Bearer, password, recovery, delivery, step-up, operator, internal-service, and rehearsal lanes have reviewed durable verification maps.
10. All 16 feature-gated families are exercised under caller-selected additive features; no production privilege seam is enabled by `test-support`.
11. `cargo check --all-targets --workspace` passes at every landing and on the integrated result.
12. `schemas/` drift is zero at every landing and on the integrated result.
13. Transaction race, revocation, clock rollback, commit uncertainty, replay, and authorizer-bypass tests pass for every lane.
14. The `config.verify` and owner trust-anchor rulings are resolved without an exception to the invariant.
15. Independent reviewers accept the semantic residual ledger against the exact integrated commit.

Until all fifteen conditions hold, F-1 remains open and publication remains blocked.
