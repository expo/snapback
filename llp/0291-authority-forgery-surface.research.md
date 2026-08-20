# LLP 0291: The authority-forgery surface, enumerated

**Type:** Research
**Status:** Active
**Systems:** Security/authorization, Storage, Auth, Rust core, Verification
**Author:** codex `gpt-5.6-sol`, commissioned by Claude (Opus 5) orchestrating LLP 0283 F-1,
for Charlie Cheever
**Date:** 2026-08-20
**Revised:** 2026-08-20 (a — initial enumeration)
**Related:** LLP 0283 (F-1), LLP 0285 (§1, §3, §5, §6), LLP 0284, LLP 0214, LLP 0225

## Why this document exists

Four consecutive independent review rounds of the LLP 0285 forgery half each found a
**different** way to forge an authenticated principal — not variants of one defect:

1. `insert_email_session_for_test` wrote arbitrary durable identity facts.
2. Composing `insert_human_user_for_test` with `insert_session_for_test`, whose
   `INSERT OR IGNORE` preserved the victim's human kind.
3. After those were demoted to `#[cfg(test)]`: `CatalogSessionIssuancePlan` plus
   `attempt_planned_session_issuance` — both **public, needing no feature at all**.

Each round closed the named path; the next round found another. That pattern says the
surface was never enumerated, so this document enumerates it instead of patching it again.

## Headline result

**There is no chokepoint.** Authority creation is split across roughly eleven independent
mechanisms, and once any of them writes an indistinguishable live row, downstream resolvers
cannot tell a legitimate ceremony from an externally-submitted raw plan.

- **30 no-feature principal/authority-forgery families.**
- **16 further feature-gated families** — equivalent to unguarded, since LLP 0285 §3's
  Attacker A can enable any additive Cargo feature.
- Additional authority-bearing capabilities that are not themselves principals: push
  authority, capability links, authorized leases, sender commitments, and arbitrary claims
  projection.

**This materially exceeds what LLP 0285 §6 step 6 anticipated**, which was converting four
admissions. It should be read before any further forgery-half work, and LLP 0285 may need
amending in light of it.

> **Scope caveat, stated plainly.** This was analysed at `1d1f3b6fd`, which is `main`. The
> in-progress `ResolvedPrincipal` work lives on an unlanded branch, so it does not appear
> here — the enumeration reports the surface as it exists on `main` today. That makes the
> inventory a description of the real problem rather than of the partial fix, but it means
> `ResolvedPrincipal` will **add to** this surface, not replace it.

## Note on `#[doc(hidden)]`

The inventory records `ServingDatabase::auth_database_mut` as a full compatibility escape
into every public `LocalDatabase` method, with the observation that **`doc(hidden)` is not a
boundary.** That is worth carrying forward independently of everything else here.

---

# Authorization-surface inventory

Analysis was performed against checkout `1d1f3b6fdb329ba6a45148dd9ccc2262e64fd735`. No files were changed. The existing modification to `llp/0290-authorization-commit-participant.spec.md` was left untouched.

## Executive result

The requested `ResolvedPrincipal` implementation does not exist in this checkout.

- There is no `crates/snapback-kernel/src/storage/resolved_principal.rs`.
- `storage.rs:40–65` declares no `resolved_principal` module.
- No compiled crate contains a `ResolvedPrincipal` symbol.
- It exists only in LLP/review prose, principally `llp/0285-kernel-authorization-closure.spec.md:184–192,399` and `llp/reviews/0285-authorization-closure-design.claude.md:252–305`.

Therefore, interpreted literally:

1. Paths producing `ResolvedPrincipal` today with no feature: **0**.
2. Paths producing `ResolvedPrincipal` with an additive feature: **0**.

That literal answer conceals the security result. The checkout already has `ResolvedSession`, `ResolvedScopedToken`, `ResolvedAppAuthority`, `WatchAnchorAuthority`, rehearsal authority, push authority, and durable session/identity/grant writers. Under the counting rule below, I found:

- **30 no-feature principal/authority-forgery families**.
- **16 additional feature-gated forgery families**.
- Several further authority-bearing capabilities that are not themselves principals: push authority, capability links, authorized leases, sender commitments, and arbitrary claims projection.

Counting rule: mirrored `LocalDatabase`/`ServingDatabase` wrappers count once; a materially different proof-bypass variant of a shared writer counts separately; helper reads are folded into the resulting end-to-end path; pure revocation/DoS and metadata-only writes do not count as principal forgeries.

## Reachability

| Entry point | Visibility / gate | Consequence |
|---|---|---|
| `crates/snapback-kernel/src/lib.rs:20` — `pub mod auth;`; `:54` — `pub mod storage;` | Public, no feature | Downstream crates may import these surfaces directly. |
| `crates/snapback-kernel/src/storage.rs:2305` — `pub fn memory() -> SnapbackResult<Self>`; `:2347` — `pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self>` | Public, no feature | A caller can create a `LocalDatabase` directly. |
| `storage.rs:1386` — `pub fn adopt(mut db: LocalDatabase) -> SnapbackResult<Self>` | Public, no feature | Creates a `ServingDatabase`. |
| `storage.rs:1435` — `pub fn auth_catalog(&mut self) -> AuthCatalogKernel<'_>` | Public, no feature | Gives mutable access to the raw catalog-plan API. |
| `storage.rs:1444` — `#[doc(hidden)] pub fn auth_database_mut(&mut self) -> &mut LocalDatabase` | Public, no feature | Full compatibility escape from `ServingDatabase` into every public `LocalDatabase` method. `doc(hidden)` is not a boundary. |
| `storage.rs:1785` — `impl Deref for ServingDatabase { type Target = LocalDatabase; }` | Public, no feature; no `DerefMut` | A shared `&ServingDatabase` reaches every shared-borrow `LocalDatabase` reader, including session fact leaks and `identity_claims`. |
| `storage.rs:2225` — `pub fn auth_catalog(&mut self) -> AuthCatalogKernel<'_>`; `:2229` — `pub fn auth_catalog_read(&self) -> AuthCatalogKernel<'_>` | Public, no feature | Raw plan execution and fact reads are available directly on `LocalDatabase`. |
| `crates/snapback-engine/src/lib.rs:89` and `test_support.rs:53` — `#[cfg(feature = "test-support")] pub fn auth_database_mut(snapback: &mut LocalSnapback) -> &mut LocalDatabase` | Additive `snapback-engine/test-support` | Exposes the kernel database from an engine owner. The engine feature does not itself enable `snapback-kernel/test-support`, but it exposes all unguarded kernel APIs. |
| `crates/snapback-kernel/Cargo.toml:12–16` | `default=[]`, additive `test-support=[]` | Every `#[cfg(any(test, feature="test-support"))]` seam is downstream-enableable. |

User-schema writers do not provide a raw-SQL bypass: `crates/snapback-types/src/manifest/types.rs:3450` rejects `_auth`, `_auth_*`, and `_snapback*` as user identifiers. The dangerous paths below are typed public APIs, lifecycle APIs, or owner/test seams.

# I. Resolver and authority-production inventory

| ID | Entry point and exact signature | State read | Verification versus trust | Victim principal? | Smallest capability |
|---|---|---|---|---|---|
| R00 | Requested `resolved_principal.rs` resolvers | None; absent | No implementation exists. The two signatures in review prose are not compiled code. | NO today | N/A |
| R01 | `crates/snapback-auth/src/auth/provider.rs:2958` — `pub fn resolve_session(&self, database: &LocalDatabase, bearer: &str, now_ms: u64) -> ProviderResult<ResolvedSession>` | `_auth_sessions`, `_auth_session_tokens`, identity provider | Parses `SessionBearer`, hashes it, checks current/tombstone row, revocation, idle/absolute deadline and supersession grace. | NO by itself; YES after any session writer or hash-leak path below. | `&LocalDatabase`, plaintext bearer |
| R02 | `auth_catalog_ops.rs:4308` — `pub fn lookup_presented_session(&self, token_hash: &TokenHash) -> SnapbackResult<PresentedSessionLookup>`; `:4315` — `pub fn lookup_presented_session_with_sender_binding(&self, token_hash: &TokenHash) -> SnapbackResult<(PresentedSessionLookup,bool)>` | `_auth_sessions`, `_auth_session_tokens`, identities, sender-family binding | Verifies only that the supplied digest equals a current/tombstone digest. It does not prove possession of the plaintext bearer. | **CONDITIONAL:** YES if a victim has a live session; R03 leaks its digest. | Shared `&LocalDatabase` or `&ServingDatabase` |
| R03 | `auth_catalog_ops.rs:4476` — `pub fn session_issuance_facts(&self, address: &CanonicalAddress, candidate_user_id: &str, now_ms: u64, live_limit: u64) -> SnapbackResult<SessionIssuanceFacts>`; `:4487` — `pub fn session_cap_facts(&self, user_id: &str, now_ms: u64, live_limit: u64) -> SnapbackResult<SessionCapFacts>`; `:4497` — `pub fn user_session_revocation_facts(&self, user_id: &str, excluded_session_id: Option<&str>, identity_id: Option<&str>, now_ms: u64) -> SnapbackResult<Vec<SessionRevocationCandidateFact>>` | `_auth_identities`, `_auth_sessions` | No caller authority. Returns identity/user IDs, session IDs, generations, and raw `TokenDigest`s. `session_issuance_facts` reveals the live count; calling again with that count reveals the oldest digest. `user_session_revocation_facts` returns every matching digest directly. | **YES as a composition with R02 or rotation.** | Shared DB reference; no credential |
| R04 | `auth_identity.rs:3409` — `pub fn identity_claims(&self, session_id: &str, now: u64, profile: ServerProfile) -> SnapbackResult<AuthClaimsProjection>` | `_auth_sessions`, `_auth_identities`, `_auth_credentials`, `_auth_assurances` | Checks only a caller-supplied session ID is live. No bearer, token digest, generation, or authority-instance proof. | **CONDITIONAL:** produces victim claims, not a principal object, if the session ID is known. | Shared DB reference and session ID |
| R05 | `auth_agent_credentials.rs:195` — `pub fn resolve_agent_credential(&mut self, credential: &AgentCredential, now_ms: u64) -> SnapbackResult<ResolvedAgentCredential>` | `_auth_agent_credentials`, `_auth_users` | Verifies credential hash, current generation, non-revocation, active agent; coalesces use. | NO by itself; YES after an unsafe credential writer. | `&mut LocalDatabase`, credential secret |
| R06 | `auth_agent_credentials.rs:1105` — `pub fn resolve_scoped_token(&mut self, token: &ScopedToken, now_ms: u64) -> SnapbackResult<ResolvedScopedToken>` | `_auth_grant_tokens`, `_auth_grants`, `_auth_agent_credentials`, `_auth_users`, scope bases, integration state | Verifies token hash, token/grant/credential generation, actor, liveness, expiry, scopes. | NO by itself; YES after unsafe grant/token creation. | Mutable DB plus scoped-token bearer |
| R07 | `auth_agent_credentials.rs:1210` — `pub fn resolve_retained_service_authority(&mut self, authority: RetainedServiceAuthority<'_>, now_ms: u64) -> SnapbackResult<ResolvedScopedToken>`; carrier fields are all public at `:118–125` | Same tables as R06 | Verifies caller-supplied durable IDs, effective user and generation. No bearer is required. | **CONDITIONAL:** YES when exact tuple values are known or leaked from a durable effect/fixture. | Mutable DB plus exact IDs; no secret |
| R08 | `auth_agent_credentials.rs:1198` — `pub fn retained_service_authority_is_live(&mut self, authority: RetainedServiceAuthority<'_>, now_ms: u64) -> SnapbackResult<bool>`; `:1293` readonly twin | Same authority tables | Exact tuple/liveness only; bearer-free. | Same condition as R07, but returns a predicate. | Mutable/shared DB and exact IDs |
| R09 | `auth_rehearsal.rs:124` — `pub fn auth_rehearsal_resolve(&mut self, carrier_hash: &[u8;32], bindings: &RehearsalBindingFacts, now_ms: u64) -> SnapbackResult<AuthRehearsalGrantV1>` | Rehearsal grants, windows, counters | Compares the digest and bindings to durable values, but both can be chosen by the public mint path R/W below. | **YES through public rehearsal mint and identity/session creation.** | Mutable DB; caller-created carrier and bindings |
| R10 | `capability_links.rs:453` — `pub fn resolve_capability_link(&self, token: &str, now_ms: u64) -> SnapbackResult<CapabilityLinkRecord>`; `:467` — `pub fn capability_link_effect_origin(&self, id: &str, now_ms: u64) -> SnapbackResult<CapabilityLinkRecord>` | `_snapback_capability_links`, `_auth_users` | First verifies bearer hash/liveness; second needs only a known link ID. Both verify live human lineage, not that minting was session-authorized. | NO principal; YES unauthorized function capability after W19. | Shared DB plus bearer or ID |
| R11 | `watches.rs:326` — `pub fn active_watches(&self) -> SnapbackResult<Vec<WatchRecord>>`; `:341` — `pub fn watch_for_execution(&self, id: &str) -> SnapbackResult<Option<WatchRecord>>`; `:360` — `pub fn revalidate_watch_anchor(&mut self, record: &WatchRecord, now_ms: u64) -> SnapbackResult<Option<WatchAnchorAuthority>>` | Watch catalog, `_auth_users`, `_auth_grants`, scope bases, integration registration | `active_watches` exposes every record without owner proof. Integration revalidation checks the stored record against current grants/bases, but trusts the record’s originally stored owner/effective-user facts. | **YES**, conditional on an existing or attacker-created watch. | Shared DB for enumeration, mutable DB to revalidate |
| R12 | `crates/snapback-engine/src/local/engine.rs:22790` private `watch_execution_authority`; public terminal `:22587` — `pub fn prepare_watch_job(&mut self, claim: WatchJobContext) -> SnapbackResult<WatchJobExecution>` | Watch record and current user/grant state | For user watches, verifies only that `owner_principal_id` names an active human, then constructs `ResolvedAppAuthority::RevalidatedPrincipal`. It does not recover proof of who created the record. | **YES** through public kernel `create_watch`. | `&mut LocalSnapback` and a valid scheduled watch claim |
| R13 | `auth_asset_callbacks.rs:160` — `pub fn asset_callbacks_service_principal_is_live(&self, principal: &AssetCallbacksServicePrincipal) -> SnapbackResult<bool>` | `_auth_users`, `_auth_grants`, scope bases | Checks exact generated provenance/grant/scope. The associated public ensure path creates those facts without caller authority. | **YES** for the internal callback service identity after W18. | Shared DB and public carrier |
| R14 | `crates/snapback-sync/src/auth/invocation.rs:297` — public `enum ResolvedAppAuthority` with public fields; `:393` — `pub fn from_session(session: ResolvedSession) -> Self`; `:458` — `pub fn from_scoped_token(token: ResolvedScopedToken) -> Self`; `:1940` — `pub fn prepare_admitted_authority(source: InvocationSource, active_mode: AuthMode, profile: ServerProfile, admission: AdmissionLease, wire: &WireAuthorityFields, resolved: ResolvedAppAuthority, session_claims: Option<AuthClaimsProjection>) -> SnapbackResult<PreparedAuthority>` | None | Validates source/mode/wire consistency and caller-provided claims. It does not resolve or revalidate a session. `ResolvedSession`, `ResolvedScopedToken`, and `AuthClaimsProjection` also have public fields/constructors. | **YES, directly, no durable exploit required.** | No credential; a public `AdmissionController` can mint a lease |
| R15 | `snapback-auth/src/auth/admission.rs:227` — `pub fn new(transition_generation: u64, accepting: bool) -> SnapbackResult<Self>`; `:232` — `pub fn from_mode_state(mode: &AuthModeStateRecord) -> SnapbackResult<Self>`; `:366` — `pub fn admit(&self) -> SnapbackResult<AdmissionLease>` | None | A constructed controller proves ownership only relative to itself. `InvocationGate::prepare_admitted_authority` does not prove the lease belongs to the target `LocalSnapback`. | **YES**, enables R14. | Nothing beyond public constructors |
| R16 | Public execution sinks accepting `PreparedAuthority`: `snapback-engine/src/host_ops.rs:1133` — `pub fn execute_host_op_with_profile_and_authority(..., prepared_authority: Option<PreparedAuthority>, ...) -> HostOpsResult`; `local/engine.rs:10883`, `:10963`, `:14849`, `:14942`, `:19170`, `:20393`, `:20718`, `:20726` | Application data and selected auth-adjacent state | Session authorities are not re-resolved by `validate_prepared_service_authority`; only service-principal variants get current durable revalidation. | **YES**, consumes R14’s fabricated principal. | `&mut LocalSnapback` or `&LocalSnapback`, depending on sink |
| R17 | `storage.rs:1405` — `#[doc(hidden)] pub fn admit_system_push(&self) -> PushStorageAuthority`; `:1410` — `pub fn admit_user_push(&self, principal_id: &str) -> PushStorageAuthority`; `:1415` — `pub fn admit_other_push(&self) -> PushStorageAuthority` | No durable identity state | Mints database-bound push authority; `admit_user_push` trusts arbitrary principal string. | NO `ResolvedPrincipal`; **YES push authority for arbitrary identity**. | Shared `&ServingDatabase` |
| R18 | `authorized_lease.rs:149` — `pub fn authorize_revalidation_free_lease(&mut self, verified: &VerifiedAuthorizedLease, config: AuthorizedLeaseConfig, now_ms: u64, no_pending_obligation: bool) -> SnapbackResult<()>` | Authorized-lease reservation, auth/data versions, deployment activation, clock | Durable checks are sound relative to `VerifiedAuthorizedLease`, but that “verified” carrier is caller-mintable via W23. No production service currently consumes this gate. | CONDITIONAL, dormant | Mutable DB plus constructed verified lease |

# II. No-feature durable authority writers

## A. Raw session-issuance graph

The terminal entry point is:

`crates/snapback-kernel/src/storage/auth_catalog_ops.rs:4512`

```rust
pub fn attempt_planned_session_issuance(
    &mut self,
    plan: &CatalogSessionIssuancePlan<'_>,
    exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
) -> (
    AuthTransactionAttempt<CatalogIssuanceCommit>,
    Option<CatalogIssuanceCommit>,
)
```

Visibility: public, no feature. The plan and every important field are public at `auth_catalog_ops.rs:123–157`. `PlannedIdentityState` is public at `snapback-types/src/contract_types.rs:41–51`; password plan/operation fields are public at `auth_identity.rs:320–335,378–525`.

It writes `_auth_users`, `_auth_identities`, `_auth_sessions`, `_auth_session_tokens`, credentials/password/recovery/assurance rows, challenge consumption, sender bindings, rehearsal provenance and selected session revocations, depending on the variant.

When `plan.challenge == None`, no exchange proof is verified.

| ID | Variant | What is verified | What is trusted | Victim principal? | Minimum |
|---|---|---|---|---|---|
| U03 | `identity=Existing`, `password=None` | Existing identity ID/user ID/address consistency; collision and session-cap predecessors | Chosen session ID, authority-instance ID, bearer digest, timestamps, and the decision that no proof is required | **YES**, the round-3 path | Mutable DB plus victim address; R03 supplies IDs |
| U04 | `identity=Create`, `password=None` | Address is unbound and IDs do not collide | Caller’s assertion that an arbitrary unbound address is verified | **CONDITIONAL:** any unbound email the caller does not control | Mutable DB |
| U05 | `PasswordIssuanceOperation::Register` | Identifier mode, lack of collision, hash/recovery shape | Caller-created password hash/recovery set and the assertion that registration is authorized | **CONDITIONAL:** arbitrary unbound identifier | Mutable DB; hashes are constructible through `hash_password_on_blocking_pool` at `auth_identity.rs:731` and recovery through `prepare_recovery_set` at `:958` |
| U06 | `Authenticate { credential, admission_ledger, verified: true, replacement }` | Snapshot/generation/lockout predecessor | Public `verified: bool`; no password proof is available to the transaction | **YES** | Mutable DB plus `password_snapshot` or `password_authentication_predecessor` |
| U07 | `Set { predecessor, displaced, step_up, ... }` | Session/digest predecessor and consumption of the supplied step-up row | The step-up row itself can be inserted with caller-chosen key/code/digest via W04 | **YES** with leaked victim session facts | Mutable DB |
| U08 | `GuestClaim` | Caller’s real guest bearer predecessor; identifier is unused | Ownership of the selected password identifier | **CONDITIONAL:** unbound email/username not controlled by caller | Mutable DB plus a guest bearer |
| U09 | `RecoveryConsume` | Recovery digest/predecessor exactness | Recovery codes can first be replaced for an arbitrary user by `identity_recovery_rotate` | **YES** | Mutable DB, victim ID; no pre-existing credential after public rotation |
| U10 | `RecoveryRotate` | Caller-supplied session/credential/digest predecessor | No plaintext session bearer or password; exact durable IDs are treated as proof | **YES** with R03/R02 and public snapshots | Mutable DB |
| U11 | `Reset` | Email identity and password snapshot belong to the same user | No challenge or proof; replacement hash is caller-generated | **YES**, when the victim has matching email/password identities | Mutable DB plus `password_reset_predecessor` |

Internal enforcement is in `auth_identity.rs:1240–1538` and `:1541–1900`. It repeatedly checks durable equality but does not distinguish “caller learned the row” from “caller proved the credential.”

## B. Other session/password writers

| ID | Entry point | State | Verification / trust | Victim? | Minimum |
|---|---|---|---|---|---|
| U12 | `auth_catalog_ops.rs:4525` — `pub fn attempt_password_change(&mut self, plan: &CatalogPasswordChangePlan<'_>) -> (AuthTransactionAttempt<CatalogPasswordChangeCommit>, Option<CatalogPasswordChangeCommit>)` | Password credentials, attempts, sessions, tombstones, assurances | `PasswordChangeCommitPlan.verified` is public (`auth_identity.rs:320–325`). Transaction at `:2352–2397` trusts it after snapshot equality. Rotation fields are also caller-selected. | **YES** | Mutable DB, public `password_snapshot`, chosen hash |
| U13 | `auth_catalog_ops.rs:4348` — `pub fn attempt_planned_rotation(&mut self, plan: &CatalogRotationPlan<'_>) -> (AuthTransactionAttempt<PlannedRotationTransaction>, Option<PlannedRotationTransaction>)` | `_auth_sessions`, `_auth_session_tokens` | Verifies session/generation/current digest/liveness; no plaintext bearer. R03 leaks the predecessor digest. | **YES**; choose a successor bearer/digest and take over victim session | Mutable DB plus leaked session fact |
| U14 | `auth_catalog_ops.rs:4430` — `pub fn insert_verification_challenge(&mut self, address: &CanonicalAddress, challenge_id: &ChallengeId, digest: &CodeDigest, key_id: &str, now_ms: u64, expires_at_ms: u64, budget_policy: &ResolvedCompatibilityAuthBudgetPolicy) -> SnapbackResult<RequestInsertOutcome>`; rehearsal twin at `:4453` | `_auth_verification_codes` | Budget/shape/address only. Caller chooses key, code and digest. A normal exchange can then consume the caller-created “proof.” | **YES** | Mutable DB; no existing credential |
| W04 | `auth_catalog_ops.rs:4406` — exact `insert_step_up_challenge` signature with `CatalogStepUpBinding`, address, challenge ID, digest, key ID, times and budget policy | Verification-code table and live session binding | Checks supplied binding matches a live session and address. Caller can learn those facts, choose an `AuthKeyMaterial`, code, operation and target, and compute `StepUpDigest` via `snapback-types/src/auth/crypto.rs:370`. Consumption at `auth_catalog_ops.rs:2221` compares only stored/submitted digest/address/key; it does not re-derive operation/target. | **YES as an enabling path** for password set, agent invitation, grant approval and effect approval | Mutable DB plus leaked session facts |
| — | `auth_catalog_ops.rs:4323` family alarm, `:4330` revocation, `:4374` authenticated-use extension, `:4398` rejection | Revocation, expiry/use, challenges | Exact durable predecessors; no bearer in the commit API | Generally NO principal; rotation/use may prolong/take over an already leaked family, others are DoS/destructive | Mutable DB |
| U15 | `snapback-auth/src/auth/provider.rs:4092` — `pub fn plan_mint_session(&self, database: &LocalDatabase, now_ms: u64) -> ProviderResult<ProviderSessionIssuancePlan>`; `:4124` — `pub fn commit_planned_issuance(&self, database: &mut LocalDatabase, plan: &ProviderSessionIssuanceCommitPlan) -> AuthTransactionAttempt<PlannedIssuanceCommit>` | Same issuance state | Only checks caller-selected `AuthProviderProfile::permits_capture()`. `AuthProvider::new` accepts public `Dev/Test/Demo/Prod` profile values at `:1324`; the profile is not bound to the target database/server. | **YES**, arbitrary existing or unbound address in a caller-selected capture profile | Provider/keyring plus mutable DB |

## C. Identity writers

| ID | Entry point | State written | Verification / trust | Victim? | Minimum |
|---|---|---|---|---|---|
| U16 | `auth_identity.rs:583` — `pub fn prepare_verified_email_claim(address: &str, event_id: &str, governing_authority: &str) -> SnapbackResult<VerifiedEmailClaim>` plus `:2838` — `pub fn identity_guest_claim_verified_email(&mut self, guest: &SessionBearer, proof: &VerifiedEmailClaim, now: u64, random: &dyn RandomSource) -> SnapbackResult<IdentitySession>` | `_auth_identities`, guest state, sessions, assurances | Constructor only canonicalizes address and checks nonempty strings. Claim verifies a real guest session and collision, but not delivery/event authority. | **CONDITIONAL:** any currently unbound email | Mutable DB plus own guest bearer |
| — | `auth_identity.rs:2821` — `pub fn identity_guest_create(&mut self, expires_at: u64, now: u64, random: &dyn RandomSource) -> SnapbackResult<IdentitySession>` | New human guest/session/assurance | Generates all IDs and bearer internally. | NO; legitimate anonymous guest creation | Mutable DB |
| — | `auth_identity.rs:617` — public `prepare_verified_provisioning(...) -> SnapbackResult<VerifiedProvisioningAuthority>` plus `:2793` — `execute_verified_provisioning(...)` | Caller-declared user tables and `_auth_provisioning_receipts` | The “verified” constructor checks shape, not a host proof. Protected identifiers are rejected by `is_user_identifier`, so it cannot directly write `_auth_*`. Code labels it `UNWIRED-DO-NOT-CALL`. | NO current principal; unsafe dormant app-identity binding | Mutable DB |
| U09 prerequisite | `auth_identity.rs:3326` — `pub fn identity_recovery_rotate(&mut self, user: &str, now: u64, random: &dyn RandomSource, key_id: &str, key: &[u8;32]) -> SnapbackResult<RecoveryCodes>` | Replaces recovery credentials/codes and revokes every user session | Only checks the user exists through downstream constraints. No session, password, recovery code, operator token or principal. | **YES** when followed by RecoveryConsume | Mutable DB and victim user ID |
| — | `auth_identity.rs:3405` — `pub fn identity_revoke_password(&mut self, user: &str, now: u64) -> SnapbackResult<()>`; `:3065` — `clear_password_lockout` | Revokes password / deletes attempt ledger | No caller authority; last-authenticator rule for revoke | NO creation; victim DoS/admin mutation | Mutable DB and identifier |
| — | `auth_identity.rs:2973` — `pub fn identity_reap_guests_default_tombstone(&mut self, now: u64) -> SnapbackResult<u64>` | Revokes expired guest sessions, marks guests reaped | Time and guest expiry | NO | Mutable DB |

Safe predecessor readers that genuinely require secrets are:

- `auth_identity.rs:2492` `password_set_planning(... acting: &SessionBearer, ...)`
- `:2581` `password_change_planning(... acting: &SessionBearer, ...)`
- `:2678` `guest_claim_predecessor(... guest: &SessionBearer, ...)`
- `:2723` `recovery_code_predecessor(... code: &str, ...)`

They do not repair the public commit-plan bypass because callers may construct the resulting public plan shapes directly.

## D. Agent, grant and integration writers

| ID | Entry point | State written | Verification / trust | Victim? | Minimum |
|---|---|---|---|---|---|
| U17 | `auth_agents.rs:71` — `pub fn create_agent_principal(&mut self, user_id: &str, created_at_ms: u64, registration: &AgentRegistration) -> SnapbackResult<()>` plus `auth_agent_credentials.rs:151` — `pub fn issue_initial_agent_credential(&mut self, user_id: &str, now_ms: u64, random: &dyn RandomSource) -> SnapbackResult<IssuedAgentCredential>` | Agent `_auth_users`, identity and initial credential | First trusts arbitrary caller registration/owner/user ID. Second requires only an active agent with no live credential. | YES as unauthorized new agent; CONDITIONAL for a pre-existing victim agent lacking a live credential | Mutable DB |
| U18 | `auth_agents.rs:93` — `pub fn register_agent_principal(&mut self, mode: AgentsMode, invitation: Option<&CreationInvitation>, display_name: Option<String>, operator_contact: Option<String>, profile: ServerProfile, now_ms: u64, random: &dyn RandomSource) -> SnapbackResult<IssuedAgentCredential>` | New agent, identity, credential | Caller supplies policy `AgentsMode`; passing `Open` requires no invitation. No check that this equals active app configuration. | YES, new authenticated agent by direct caller | Mutable DB |
| U19 | `auth_agents.rs:122` — `pub fn register_agent_principal_with_class(..., class: AgentRegistrationClass, integration_facts: IntegrationRegistrationFacts, profile: ServerProfile, ...) -> SnapbackResult<IssuedAgentCredential>` | Same plus integration registration | Caller selects `Open`, profile, class and integration facts. | YES, new integration/service principal | Mutable DB |
| U20 | `auth_agents.rs:278` — `pub fn mint_agent_invitation(&mut self, user_id: &str, profile: ServerProfile, proof: &StepUpProof, now_ms: u64, random: &dyn RandomSource) -> SnapbackResult<IssuedAgentInvitation>` | Agent invitation | Checks live human plus step-up consumption, but W04 lets caller manufacture a victim-bound proof. | YES: can mint a victim-attributed invitation and register an agent | Mutable DB and leaked victim session facts |
| U21 | `auth_agent_credentials.rs:151` alone | Agent identity/credential | Active agent and absence of a live credential; no owner session/operator proof | **CONDITIONAL:** existing victim agent has no live credential | Mutable DB, victim agent ID |
| U22 | `auth_grants.rs:211` — `pub fn mint_pairing_code(&mut self, user_id: &str, now_ms: u64, random: &dyn RandomSource) -> SnapbackResult<MintedPairingCode>`; `:266` `present_pairing_code`; `:418` — `pub fn approve_grant_request(&mut self, effective_user_id: &str, session_id: &str, request_id: &str, requested_ttl_ms: Option<u64>, step_up_proof: Option<&StepUpProof>, now_ms: u64) -> SnapbackResult<GrantApproval>`; token mint at `auth_agent_credentials.rs:812` or `:940` | Pairing requests, `_auth_grants`, `_auth_grant_tokens` | Pairing mint checks only that arbitrary `user_id` is a live human and returns the secret. Approval checks requested effective user and request, but `session_id` is audit-only. Non-authority-creating scopes need no step-up; authority-creating scopes accept W04’s forged proof. | **YES**, victim effective authority | Mutable DB; an open/self-created agent credential |
| U23 | `auth_integrations.rs:821` — `begin_oauth_authorization(consenting_user_id, client_id, redirect_uri, scopes, state, code_challenge, code_challenge_method, now_ms)`; `:924` — `issue_oauth_authorization_code(consenting_user_id, request_id, now_ms, random)`; exchange at `auth_agent_credentials.rs:694` | OAuth request/code, grants and token | Client/URI/scope/request consistency, but no user session. Combined with U22 approval, caller gets a victim-effective token. | **YES** | Mutable DB plus registered integration |
| — | `auth_integrations.rs:989` deny and `:1051` `set_integration_suspended` | OAuth request state / integration status | IDs and state only; no operator/session proof | NO creation; DoS/admin state | Mutable DB |
| — | Revocation/deactivation methods: `auth_agents.rs:427`; `auth_grants.rs:579,733,825`; `auth_agent_credentials.rs:228,362,477,524,590,626,1350` | Terminalizes users, credentials, grants/tokens | Usually exact bearer for self-service methods, but several public admin methods accept IDs only | NO creation; possible DoS | Mutable DB, sometimes credential |

## E. Other authority-bearing durable writers

| ID | Entry point | State written | Verification / trust | Victim? | Minimum |
|---|---|---|---|---|---|
| — | `auth_scope_bases.rs:54` — `pub fn reconcile_auth_scope_bases(&mut self, manifest: &FunctionManifest) -> SnapbackResult<ScopeBasisReconciliation>`; `:61` schema twin | `_auth_scope_bases` | Validates manifest shape, not that it is the active deployed manifest or that caller has deployment authority | CONDITIONAL enabling primitive for grants/callbacks | Mutable DB and manifest |
| U24 | `auth_asset_callbacks.rs:36` — `pub fn ensure_asset_callbacks_service_principal(&mut self, app_id: &str, scope: ExactGrantScope, now_ms: u64) -> SnapbackResult<AssetCallbacksServicePrincipal>` | New internal agent `_auth_users`, indefinite immutable `_auth_grants` | Nonempty app/function, mutation kind and time; no startup/operator authority and no proof that scope belongs to active deployment | **YES**, internal service authority | Mutable DB; scope basis can be reconciled first |
| U25 | `watches.rs:222` — `pub fn create_watch(&mut self, request: CreateWatchRecord) -> SnapbackResult<WatchRecord>` | `_snapback_watches`; integration variant also writes `_auth_grants` watch anchor | For user watches it performs no check that the arbitrary owner principal/session/authority-instance belongs to caller. Engine later checks only that owner is an active human. | **YES**, victim `RevalidatedPrincipal` when job executes | Mutable DB; API/watch tables enabled, valid function facts |
| U26 | Same `create_watch`, `owner_kind=Integration`, plus `watches.rs:457` `renew_watch_anchor_for_user` | Watch plus captured grant; renew revokes/remints anchor grant | Validates existing active integration and installation grant/scopes, but not bearer/session authority at the raw kernel entry. | **CONDITIONAL:** live integration installation/effective user | Mutable DB and existing installation facts |
| U27 | `auth_rehearsal.rs:165` — `pub fn auth_rehearsal_mint(&mut self, plan: RehearsalMintPlan) -> SnapbackResult<MintedRehearsalGrant>`; `:379` — `pub fn auth_rehearsal_create_identity(...)`; issuance via the raw catalog plan | Rehearsal grants/windows/accounting, `_auth_users`, `_auth_identities`, rehearsal provenance, sessions | Request shape and caller-supplied bindings such as deployment profile and “sessions settled”; no sealed operator or actual deployment binding | **CONDITIONAL:** arbitrary unbound address; then session authority | Mutable DB |
| U28 | `auth_logical_transfer.rs:201` — `pub fn auth_logical_import(&mut self, artifact: &AuthLogicalExportV1) -> SnapbackResult<AuthLogicalImportOutcomeV1>`; artifact fields public at `auth/logical_transfer.rs:47–98` | `_auth_users`, `_auth_identities`, `_auth_scope_bases`; rotates authorization stream | Closed artifact validation and exact empty target. No source authenticity/signature. Sessions, credentials, grants and tokens are excluded. | **CONDITIONAL:** poison an empty instance with arbitrary identity facts, then use issuance | Mutable empty DB and artifact |
| U29 | `snapback-auth/src/auth/backup.rs:429` — `pub fn restore_backup(backup_directory: &Path, target_database: &Path, random: &dyn RandomSource) -> SnapbackResult<RestoreDeclaration>` | Whole physical database and keyring in a new target | Owner-only directory, exact members, hashes, exact catalog, keyring/reference consistency, target absence. Manifest is self-consistency evidence, not an external authenticity signature. | **CONDITIONAL:** yes on a new target if caller controls an otherwise valid backup directory | Owner-controlled filesystem backup and absent target |
| U30 | `crates/snapback-sync/src/auth/invocation.rs:1940` plus public `ResolvedAppAuthority` and public engine sinks | No durable write required; application effects execute as selected principal | Source/mode/claims shape only, no target-DB resolution or target-controller lease ownership | **YES**, arbitrary session/revalidated/service authority | Public constructors and an engine object |
| — | `capability_links.rs:375` — `pub fn mint_capability_link(&mut self, request: MintCapabilityLink) -> SnapbackResult<MintedCapabilityLink>` | `_snapback_capability_links` | Checks only that caller-supplied `minter_principal_id` names a live human. Session and authority-instance strings are not resolved. | NO principal, but **YES unauthorized victim-attributed capability** | Mutable DB and victim user ID |
| — | `authorized_lease.rs:44` — `pub fn reserve_authorized_lease(&mut self, lease: &AuthorizedLease, config: AuthorizedLeaseConfig, now_ms: u64, no_pending_obligation: bool, current_issuer_id: &IssuerId) -> SnapbackResult<()>` | `_snapback_authorized_lease_reservations`, auth clock | Caller supplies both lease and `current_issuer_id`; checks current DB state. `auth/lease.rs:249` exposes `AuthorizedLeaseAuthenticator::new(key_id,key)`, `:260` `issue`, and `:328` `verify_for_service`, so a caller can mint the MAC key and obtain `VerifiedAuthorizedLease`. | No current principal consumer; future service would be forgeable | Mutable DB plus caller key |
| — | `auth/sender_proof.rs:74` — `pub fn SenderIssuanceCommitment::new(verified: VerifiedSenderIssuance, now_seconds: u64, nonce_ttl_seconds: u64) -> Result<Self,...>`; `VerifiedSenderIssuance` fields public at `:34–38` | Sender-family binding and replay state when included in issuance | Canonical thumbprint/time only; “verified” proof fields are caller-created | Not independent; strengthens a forged session with a forged sender binding | Public values plus issuance plan |

# III. Migration, restore, rescue, reset and GC

These mutate protected state but are not independent current-instance principal forgeries unless stated.

| Entry point | State / effect | Verification / trust | Forge result | Production status |
|---|---|---|---|---|
| `storage/auth.rs:1496` `activate_current_auth_catalog`; `:1512` identifier-mode twin | Creates empty exact auth catalog and metadata | Requires uninitialized/recognized exact catalog; identifier mode becomes immutable | NO | Legitimate production |
| `storage/auth.rs:1846` `advance_auth_session_clock_floor`; `:1858` `auth_gc` | Monotone clock; deletes expired sessions/challenges | Time bounds, exact catalog, orphan checks | NO; delete-only | Legitimate production |
| `storage/auth.rs:1948` `apply_auth_restore_declaration(declaration_id,now_ms)` | Revokes sessions/challenges/agent credentials/grants/tokens and rotates streams | Only UUID-like declaration shape at raw kernel entry | NO creation; arbitrary caller can force global logout | Production lifecycle should be reached through authenticated owner declaration |
| `snapback-auth/src/auth/lifecycle.rs:212` `apply_declared_restore`; `:256` plan twin | Calls previous operation | Validates owner-only declaration file | NO | Legitimate safe wrapper |
| `storage/auth_logical_transfer.rs:49` export | Reads users, identities, scope bases | Exact catalog; excludes spendable authority | Leaks stable IDs but no bearer | Legitimate production |
| `instance_fork.rs:797` `clone_database_into_staging`; `:822` `scrub_and_mint_staged_database` | Copies users, identities, password/recovery credentials, assurances and bases; scrubs sessions, session tokens, challenges, agent credentials, grants/tokens, invitations, pairing and rehearsal authority (`instance_fork.rs:567–666`) | Exact staging custody and catalog audit | NO current authority; copied password facts remain account state in a separate derived DB | Legitimate production |
| `auth_rescue.rs:190` `rescue_auth_collision`; `:206` file form; Serving wrapper `:222` | Renames/copies foreign colliding user tables | Only when no ownership marker and collision is foreign; refuses owned protected catalog | NO | Legitimate production |
| `schema_seed.rs:1223–1266` reset/seed variants | Deletes/reset auth catalog through internal reset path | Reset authorization varies by wrapper; no identity/session insertion | NO | Legitimate production |
| `auth_mode.rs:490–1331` and Serving wrappers `:3966–4040` | Mode records, deployment activation, companion catalogs, scope-basis reconciliation, terminal reset/revocation | Manifest/deployment shape and transition state; several raw methods accept caller-selected manifests/classification | No direct session; can prepare scope prerequisites for other paths | Legitimate lifecycle, but raw mutation surface should be owner-sealed |
| `fork_promotion.rs` | App-data branch/promote state | Protected identifiers cannot enter user schema/mutations | NO protected-auth write from ordinary branch replay | Legitimate production |

# IV. Additive `test-support` surface

All entries below are externally compiled by enabling an additive feature, so under LLP 0285’s Attacker A model their gating is not meaningful isolation.

## Forge-capable feature families: 16

| ID | Entry point(s) | Result |
|---|---|---|
| F01 | `auth_catalog_ops.rs:4607` `insert_restore_fixture_for_test(session_id, authority_instance_id, token_hash, challenge_id, address, code_digest, key_id)` | Creates fixed human/identity plus caller-selected session/hash and challenge. Direct session forge. |
| F02 | `:4650` `insert_email_session_for_test(user_id, identity_id, session_id, authority_instance_id, address, token_hash, created_at_ms, last_used_at_ms, expires_at_ms, absolute_expires_at_ms)` | Direct arbitrary user/identity/session forge. |
| F03 | `:4678` `insert_email_session_and_push_token_for_test(user_id, identity_id, session_id, authority_instance_id, expires_at_ms)` | Direct session with known `[0;32]` digest plus push token. |
| F04 | `:4697` `insert_restore_cli_fixture_for_test(user_id, identity_id, session_id, authority_instance_id, key_id)` | Direct session with known `[1;32]` digest. |
| F05 | `:4812` `insert_session_tombstone_for_test(token_hash, session_id, superseded_at_ms)` | Chosen hash can resolve a victim’s live session through supersession grace. |
| F06 | `push_registry.rs:1166` `insert_session_for_test(principal_id, session_id, generation, expires_at_ms, discriminator)` | Round-2 path. Uses `INSERT OR IGNORE` for `_auth_users`, preserves an existing victim’s human kind, adds email identity and known-digest session. |
| F07 | `auth_identity.rs:3150` `insert_other_identity_session_for_test(user_id, subject, now_ms, random)` | Adds email identity and returns a new victim session bearer. |
| F08 | `auth_identity.rs:3079` `install_imported_password_hash_for_test(username, algorithm, hash_phc)` plus `:3274` `identity_password_authenticate(...)` | Installs caller-known password hash for victim, then returns victim session. |
| F09 | `auth_catalog_ops.rs:4575` `insert_verification_code_for_test(challenge_id, address, digest, key_id, requested_at_ms, expires_at_ms)` | Caller-created verification proof usable by ordinary exchange. |
| F10 | `:4898` `install_service_replay_authority_for_test(now_ms, expires_at_ms)` | Inserts fixed agent, credential, grants and token; public retained-authority resolver needs no bearer. |
| F11 | `:4908` `insert_finite_authority_grant_for_test(grant_id, agent_user_id, effective_user_id, start_ms)` | Arbitrary victim effective-user grant; conditional on credential/bases, then scoped token mint. |
| F12 | `:4958`, `:4967`, `:4973`, `:4982`, `:5017`, `:5026` query/live/route prerequisite and grant fixtures | Insert agent/grant/token authority, including caller-selected bulk owner/effective user. |
| F13 | `auth_identity.rs:2901` `identity_password_register`; `:2865` `identity_guest_claim_password` | Creates authenticated principal for arbitrary unused identifier. |
| F14 | `auth_identity.rs:3339` `identity_recovery_consume` combined with unguarded `identity_recovery_rotate` | Direct victim session after caller rotates victim recovery state. |
| F15 | `snapback-sync/src/auth/invocation.rs:1915` — feature-gated `InvocationGate::prepare_authority(..., resolved: ResolvedAppAuthority)` | Easiest arbitrary in-memory authority construction using `AdmissionLease::unmanaged`; redundant with the unguarded admitted constructor. |
| F16 | `snapback-engine/src/test_support.rs:53` `auth_database_mut`; `:94` `prepare_subscribe_live_for_transport`; `:107` `subscribe_live_prepared_with_invalidation` | Exposes raw DB and consumes prepared authority from downstream test-support users. |

## Other authority-relevant kernel test writers

All are `#[cfg(any(test, feature="test-support"))]`.

### `auth_catalog_ops.rs`

- `:4600` `set_verification_key_id_for_test` — modifies challenge key metadata; enabling/helper, not principal alone.
- `:4643` `insert_expired_challenges_for_test` — expired challenge rows; NO.
- `:4798` `delete_terminal_cause_witness_for_test` — corrupts terminal evidence; no direct revival because revoked state remains.
- `:4851` `insert_human_user_for_test` and `:4857` `insert_email_identity_for_test` — arbitrary durable identity facts; compose with F06 or raw issuance.
- `:4875` `insert_activation_live_grant_for_test` — grant fixture.
- `:4881` `tombstone_scope_basis_for_test`; `:4892` query twin — terminalizes bases; NO creation.
- `:4924` `set_grant_expiry_for_test` — can extend a chosen grant.
- `:4943` `insert_sender_replay_for_test`; `:4953` `advance_sender_replay_epoch_for_test` — replay state, not principal.
- `:4988` `set_agent_credential_rotated_at_for_test` — weakens/changes rotation eligibility, still requires a credential.
- `:5036` `insert_step_up_scope_bases_for_test` — enables authority-creating grant fixtures.

Read-only or assertion seams in this module, not independent writers:

`presented_token_sender_bound_for_test:4565`, `catalog_version_for_test:4595`, `session_generation_revoked_for_test:4629`, `verification_challenge_count_for_test:4638`, `restored_counts_for_test:4715`, `session_count_for_test:4720`, `change_journal_count_for_test:4725`, `challenge_issue_facts_for_test:4730`, `challenge_attempts_and_sessions_for_test:4739`, `provision_counts_for_test:4748`, `current_and_tombstone_counts_for_test:4753`, `session_cap_facts_for_test:4758`, `tombstone_count_for_test:4768`, `sole_session_generation_for_test:4773`, `sole_session_generation_revoked_for_test:4778`, `generation_and_tombstones_for_test:4784`, `session_lifetime_facts_for_test:4789`, `session_revoked_for_test:4807`, `identity_subject_count_for_test:4826`, `sender_issuance_facts_for_test:4831`, `sender_refusal_facts_for_test:4836`, `oldest_live_session_for_test:4841`, `live_session_count_for_test:4846`, `sender_issuance_durable_counts_for_test:4934`, `agent_registration_facts_for_test:4999`, `invitation_consumption_for_test:5008`, `assert_step_up_consumption_for_test:5041`, and `verification_address_count_for_test:5052`.

Some leak identifiers/facts, but the no-feature R03 readers are already stronger.

### `auth_identity.rs`

Feature-gated writers/resolvers:

- `:2865` `identity_guest_claim_password`
- `:2901` `identity_password_register`
- `:2932` `identity_password_set`
- `:3079` `install_imported_password_hash_for_test`
- `:3150` `insert_other_identity_session_for_test`
- `:3198` `insert_typed_guest_session_for_test`
- `:3274` `identity_password_authenticate`
- `:3303` `identity_password_change`
- `:3339` `identity_recovery_consume`

Read-only feature seams: `password_hash_facts_for_test:3114`, `identity_id_for_provider_subject_for_test:3132`, `displacement_facts_for_test:3247`.

### `storage/auth.rs`

- `:1587` `insert_password_attempt_for_test` — lockout/attempt state, DoS rather than forge.
- `:1622` `insert_large_backup_fixture_for_test` — app fixture only.
- `:2531`, `:2565`, `:2593` frozen v1/v2/v3 catalog installers — empty schema/metadata, no principal.
- `:1642` `auth_backup_fixture_state_for_test` — read-only.

### `push_registry.rs`

Only `insert_session_for_test:1166` writes `_auth_users/_auth_identities/_auth_sessions`. The remaining feature seams at `:1184–1402` seed/tamper/inspect push ledgers or revoke/retire sessions. They do not independently create resolver-trusted identity, except insofar as they use the session created by F06.

### Other feature seams

- `auth_rescue.rs:1073` installs foreign collision fixtures; rescue still refuses an owned exact auth catalog.
- `auth_agent_credentials.rs:2425` and `auth_grants.rs:1744,1841,1848` inject commit uncertainty/reconciliation failure; no authority write by themselves.
- `auth_integrations.rs:1078–1095` are read-only fixture inspection.
- `snapback-auth/src/auth/provider.rs:589,674,1106` expose test plan constructors. They make high-level plan construction easier, but the underlying kernel plan fields are already public without a feature.
- `provider.rs:3276,3317,3341,3668,4136` feature-gated convenience refresh/logout/alarm/exchange/mint methods. `AddressAdmission::mint_session:4136` is forge-capable in caller-selected capture profile, though its no-feature plan+commit pair U15 already supplies the same path.

# V. Direct answers

## 1. How many paths can forge a principal today with no feature?

Literal `ResolvedPrincipal`: **0**, because the type and resolvers are absent.

Using the current operational authority types and the counting rule stated above: **30 families**:

1. Leaked session digest → `lookup_presented_session`
2. Public `ResolvedAppAuthority` → `prepare_admitted_authority` → engine sink
3. Existing email identity, password absent, raw issuance
4. New unbound email identity, password absent, raw issuance
5. Password `Register`
6. Password `Authenticate { verified: true }`
7. Password `Set` with caller-created step-up
8. Password `GuestClaim`
9. `RecoveryConsume` after arbitrary recovery rotation
10. `RecoveryRotate` with public predecessors
11. Password `Reset`
12. Password change with `verified: true`
13. Session rotation with leaked predecessor digest
14. Caller-created verification challenge → ordinary exchange
15. Caller-selected Demo/Test/Dev capture provider → plan/commit mint
16. Fake `VerifiedEmailClaim` → guest claim
17. `create_agent_principal` → initial credential
18. Caller-selected `AgentsMode::Open` agent registration
19. Caller-selected open integration registration
20. Forged step-up → victim-attributed invitation → agent
21. Initial credential for an existing agent without a live credential
22. Victim pairing code → approval → scoped token
23. Victim OAuth consent/code → scoped token
24. Bearer-free retained service authority from exact public tuple
25. Asset-callback internal service principal
26. User watch record → `RevalidatedPrincipal`
27. Integration watch anchor → effective-user service authority
28. Rehearsal self-mint → unbound identity/session
29. Logical import into empty target → issuance
30. Caller-controlled physical restore into a new target

Conditions are detailed in the tables. Several are legitimate only in a particular product posture, but the raw kernel entry points accept caller-selected posture facts instead of sealed server evidence.

## 2. How many require only an additive Cargo feature?

Literal `ResolvedPrincipal`: **0**.

There are **16 additional feature-gated forgery families**, F01–F16 above. The critical feature is usually `snapback-kernel/test-support`; `snapback-sync/test-support` and `snapback-engine/test-support` add their own authority/access seams.

These do not become safe because they are named `test-support`. A downstream dependency can enable an additive Cargo feature, and Cargo feature unification makes it part of the compiled library.

## 3. Is there a chokepoint?

There is **no current chokepoint**.

Current authority creation is split among:

- `planned_session_issuance_transaction`
- password-change and rotation transactions
- direct identity helpers’ private `insert_session`
- agent registration/credential issuance
- grant/token and OAuth writers
- watch-anchor writers
- asset-callback principal creation
- rehearsal identity/session provenance
- logical import and physical restore
- test/fixture writers

Once one of these writes an indistinguishable live row, downstream resolvers cannot determine whether it came from a legitimate ceremony or an external raw plan.

A single chokepoint can be introduced:

```text
commit_verified_authority_transition(
    tx,
    evidence: KernelVerifiedEvidence,
    mutation: AuthorityMutation
)
```

Required properties:

- `KernelVerifiedEvidence` has private fields.
- No `Clone`, `Default`, `Deserialize`, `From`, `FromStr`, public constructor, or public “verified bool.”
- It is bound to database identity, transaction, subject, purpose, credential/session predecessor and time.
- It is minted only by the same-transaction verifier for bearer, password, recovery code, delivery proof, step-up proof, operator restore/import, or an explicitly sealed internal-service lane.
- Every creation or authority-increasing write to sessions, identities, credentials, grants, tokens, scope bases, watches, rehearsal authority and capability links passes through it.

Making only session insertion private is insufficient: grants, retained service authority, watches, callback principals, capability links and direct in-memory `ResolvedAppAuthority` can independently establish authority.

## 4. Minimal invariant

A gate-checkable property is:

```text
For every additive feature closure F,
for every externally reachable call path p,
for every committed write w to AuthorityFacts:

    exists e: KernelVerifiedEvidence such that
        minted_by_kernel(e)
        and !constructible_outside_kernel(e)
        and database(e) = database(w)
        and transaction(e) = transaction(w)
        and subject(e) = effective_subject(w)
        and purpose(e) = authority_purpose(w)
        and predecessor(e) = durable_predecessor(w)
        and verified_before_commit(e).

For every returned principal or authority r:

    exists e: KernelVerifiedEvidence such that
        subject(e) = effective_subject(r)
        and authority_class(e) = authority_class(r)
        and live_at_commit_or_resolution(e)
        and, unless explicitly bearer-free by policy,
            possession_proof_verified(e).
```

Where `AuthorityFacts` includes at least:

```text
_auth_users
_auth_identities
_auth_sessions
_auth_session_tokens
_auth_credentials
_auth_password_credentials
_auth_passkey_credentials
_auth_recovery_code_sets
_auth_recovery_codes
_auth_assurances
_auth_agent_credentials
_auth_grants
_auth_grant_tokens
_auth_agent_invitations
_auth_pairing_requests
_auth_scope_bases
rehearsal grant/identity/session provenance
watch owner/anchor authority
capability-link lineage
authorized-lease reservations
```

Corollary suitable for an API audit:

```text
No public or additive-feature public function may:
  (a) accept caller-selected subject/authority IDs and commit AuthorityFacts, or
  (b) return an authenticated authority from caller-selected IDs,
unless its input contains such a sealed evidence value.
```

Durable equality, public IDs, token digests, caller booleans, profile enums, and strings named `verified` are predicates, not evidence.

## 5. Production requirements versus removable conveniences

### Legitimate production requirements that need sealing/redesign

- Session bearer resolution.
- Verification-code exchange, session issuance, refresh, logout, family alarm and authenticated-use extension.
- Password registration/authentication/set/change/reset/recovery.
- Guest creation and a genuinely delivery-verified guest claim.
- Agent registration, invitation, credential rotation and revocation.
- Pairing, grants, scoped tokens and OAuth.
- Scope-basis reconciliation from the actual active deployment.
- Watch creation/revalidation/renewal.
- Asset-callback service principal establishment.
- Auth-mode lifecycle, GC, backup, restore, rescue and derived forks.
- Logical import/export under explicit operator authority.
- Rehearsal, if retained, under sealed non-production/operator evidence.
- Authorized leases, if a service is eventually wired.

The raw catalog plan/fact structs should generally be `pub(crate)` or accept sealed proof carriers. Public provider/engine APIs should accept already-resolved authority from a target-owned coordinator rather than caller-selected profile/mode/evidence.

### Test/fixture conveniences that should become unit-test-only or be deleted

- Every `insert_*_for_test` that writes identities, sessions, credentials, grants, tokens, challenges, scope bases or tombstones.
- `install_imported_password_hash_for_test`.
- `insert_other_identity_session_for_test`.
- `PushRegistryKernel::insert_session_for_test`.
- Service/query/live/route authority fixtures.
- Public test plan constructors that expose successor bearer or raw issuance/revocation plans.
- `InvocationGate::prepare_authority` and `AdmissionLease::unmanaged`.
- Engine `test_support::auth_database_mut`.
- Frozen catalog and collision fixtures can remain only as crate-internal unit-test helpers or in a non-shipping fixture crate/process.
- Direct raw row fixtures should be replaced by private test builders or by exercising production ceremonies.

`#[cfg(test)]` inside the owning crate is materially different from `#[cfg(feature="test-support")]`: downstream consumers cannot enable the former.

# Uncertainties and what would settle them

- The intended `ResolvedPrincipal` branch is not present. Reviewing the exact commit/worktree containing `resolved_principal.rs` is necessary to inventory its actual signatures and reads. The LLP/review proposal is not executable evidence.
- User-watch exploitation requires API/watch catalog activation, valid function/basis facts and a schedulable job claim. The durable trust defect is certain; an end-to-end harness would settle the minimum engine calls needed to publish the effect.
- Retained service resolution requires exact credential/grant/token tuple knowledge. Pending-effect records and test fixtures carry such tuples, but whether a particular production adapter exposes all of them depends on that adapter.
- Authorized-lease forgery is dormant because no non-test service currently calls `authorize_revalidation_free_lease`. The public authenticator constructor makes the proposed future boundary unsafe unless corrected before wiring.
- Physical restore is safe only if “caller able to invoke restore with an owner-controlled directory” is itself treated as sealed operator authority. The backup format proves self-consistency, not origin authenticity.
- Direct Rust reachability assumes the attacker may depend on `snapback-kernel`, `snapback-auth`, `snapback-sync`, or `snapback-engine` as ordinary crates. If package publication or build topology forbids that in the deployed artifact, that narrows remote reachability but does not change the public API or additive-feature result.
