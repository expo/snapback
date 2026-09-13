# Implementation plans — remaining P2 rows

Status: open  
Date: 2026-08-24  
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server  
Related: LLP 0283, LLP 0303, `issues/shelved/20260824-liveness-row-bucket-assignment.md`, all previously landed implementation-plan documents

This document was prepared read-only against HEAD `1cb5a23074e3f0faaf22d9ae9b88c6030a3068c6`. No file was written. Every cited line was checked against that tree. The project `llp-orient` skill could not load because its `vendor/llp` target is uninitialized, so I manually read LLP 0303 in full, including “Corollary — the artifact must carry provenance.”

The governing rule is strict: derive the subject from the authority and remove the independent parameter. VERIFY is used only where the operation is cross-principal by design, with both principals named. An opaque carrier is insufficient unless it identifies its producer instance and a second same-type producer cannot mint an equal carrier.

## Coverage proof

A row counts as planned only when a plan names its current signature and a target disposition. Question headings and narrative mentions do not count.

| Plan document | Qualifying P2 rows | Incremental unique P2 rows |
|---|---|---:|
| `implementation-plan-q01.md` | F127, F210, F212, F213, F215 | 5 |
| `implementation-plans-q02-q05.md` | F149, F150, F279, C012, F100, F101, F102, F232, F233, C007, F011, F022, F070 | 13 |
| `implementation-plans-q04-q06-q07-q10.md` | F232, F233, C007, F157, F175, F113, C006, F118, C003 | 6; F232/F233/C007 are duplicates |
| `implementation-plans-q08-q09-q12-q14-q15.md` | F120, C002, F119, C001, F240, C013, F305, F306, F075, F081 | 10 |
| `implementation-plan-promoted-rows.md` | F285, F286, F288, C009 | 0; these are promoted P1 rows, not P2 |

Therefore:

```text
68 P2 rows
- 34 unique P2 rows with qualifying row-level plans
= 34 P2 rows remaining
```

The earlier “47 of 68” statement is not supported at row granularity. The apparent overcount is 13 rows: exactly the size of the Q02–Q05 document. The actual unique planned set is:

```text
F011 F022 F070 F075 F081 F100 F101 F102 F113 F118 F119 F120
F127 F149 F150 F157 F175 F210 F212 F213 F215 F232 F233 F240
F279 F305 F306 C001 C002 C003 C006 C007 C012 C013
```

The exact unplanned difference is:

```text
F001 F005 F061 F062 F067 F069 F073 F082 F084 F094 F097 F112
F117 F122 F126 F129 F143 F145 F146 F182 F187 F202 F203 F205
F220 F236 F237 F244 F272 F283 F297 F299 C005 C014
```

## Gated and product-decision rows

Rows that cannot close without introducing or strengthening a seal, producer identity, receipt, or capability are explicitly stopped below:

```text
F061 F062 F069 F073 F094 F117 F126 F143 C005 F145
F202 F220 F244 F272 F299
```

F122 is sequencing-gated by the Q11/C005 authority seal but does not itself require another artifact.

Product decisions, not correlation rulings:

- Q13: F203 and C014. Billing principal selection remains open.
- Q23: F146. Dev-mode impersonation policy was open at this 2026-08-24 plan; ruled owner-bound on
  2026-08-25 — superseded by the note below.

**2026-08-25 ruling note:** Q23 is now owner-bound; see LLP 0303 §Product decisions — Q13 open,
Q23 ruled. Implementation is assigned to the `q23-owner-bound` lane; this planning ticket stays open.

The original index made no product choice.

## Fixture discipline

Every executable row uses at least four cases A–D. No timestamp, index, label, offset, state string, generated identifier, or other per-case value may uniquely identify the expected subject. Authority and subject axes use crossed pairings, substitutions are exercised in both lexical directions, accepted cases read back every named durable column, and refused cases prove those columns unchanged.

---

## Q40 — generic auth-database plan

### F001

1. **Signature and disposition.** Current at `crates/snapback-auth/src/auth/database_plan.rs:38`:

   ```rust
   pub(crate) fn plan<F, Output>(
       execute: F,
   ) -> impl AuthDatabasePlan<Output = Output>
   where
       F: FnOnce(&mut LocalDatabase) -> Output
   ```

   Target: delete this generic closure factory. Each operation-owning module must return a private concrete plan whose subject-bearing fields come from its existing admission, predecessor, or resolved-operation carrier. There must be no crate-wide replacement accepting an arbitrary closure. **DERIVE.**

2. **Existing tested predicate.** There is no single subject predicate at F001: the generic closure can invoke any database operation. Reuse each caller’s existing operation predicate. Do not invent a generic “subject ID” comparison.

3. **Callers.** Complete direct factory list: `auth/lifecycle.rs:271`; `auth/backup.rs:322`; `auth/hosted_edge.rs:736,762`; and `auth/provider.rs:311,3183,3204,3218,3232,3246,3258,3269,3280,3288,3299,3312,3323,3332,3341,3350,3359,3369,3380,3392,4063,4073,4085,4097,4339,4356,4369,4387,4407,4417,4425,4434,4445,4454,4806`. The definition is excluded from this caller list; repository-wide exact search found no others.

4. **Production writes/readback.** F001 itself has no fixed write or durable projection: `Output` and the closure are unconstrained. Honest gap: one row-level projection cannot be named without fabricating a common sink. Migration must retain the existing full readback of each listed operation family; deletion of the generic factory is verified structurally.

5. **Fields actually read.** F001 reads no subject field. It stores and invokes `execute`; all subject reads occur inside the caller closure. Axis requirements therefore belong to the migrated concrete operation, not to invented fields on F001.

6. **Test-support exposure.** Do not replace F001 with a feature-public generic plan constructor. Tests must use the same operation-specific plan factory as production.

7. **Batching.** Land mechanically in operation-family batches, but delete F001 only after all 39 direct calls are gone. F005/F061/F062/F067/F069 migrations should go first because they own several calls.

**Fixture:** Compile/API proof that arbitrary closures are no longer accepted, plus the existing accepted/refused end-to-end fixture for every migrated operation family.

---

## Q41 — generic address admission

### F005

1. **Signature and disposition.** Current at `crates/snapback-auth/src/auth/provider.rs:3088`:

   ```rust
   pub async fn admit_email(
       self: &Arc<Self>,
       email: &str,
   ) -> ProviderResult<AddressAdmission>
   ```

   Target: delete the generic method. Replace it with flow-specific entry points such as:

   ```rust
   pub async fn admit_request_code(
       self: &Arc<Self>,
       email: &str,
   ) -> ProviderResult<RequestCodeAdmission>
   ```

   Proof-bearing flows must consume their existing proof/predecessor carrier rather than obtaining a generic `AddressAdmission`. **DERIVE.**

2. **Existing tested predicate.** Reuse canonical parsing at `provider.rs:3089` and stripe selection in `AuthAdmission::for_address` at `provider.rs:4032`. Authorization remains in each existing downstream transaction; the address lock is not promoted into proof.

3. **Callers.** Production: `server.rs:19030,19636,19727,19771,19880,19977,24685,24769,24911`. Server tests: `server/tests.rs:1581,9682,22112,23794`. Provider tests: `auth/provider_tests.rs:573,811,869,891,901,935,950,967,974,1018,1025,1040,1049,1059,1194,1201,1228,1905,1912,1951,2192,2243,2285,2347,2378,2422,2527,2931`. Runtime tests: `auth/runtime.rs:1163,1529`. Exact search found no other direct callers.

4. **Production writes/readback.** Admission only parses and locks; it writes no durable columns. Each migrated terminal operation retains its own durable readback. F067 specifies request-code columns, while F061/F062/F069 specify their mutation columns below.

5. **Fields actually read.** F005 reads only the input email through `CanonicalAddress::parse`; `for_address` reads only that canonical address to choose the stripe and store it. It does not read a user, session, proof, provider identity, or invitation.

6. **Test-support exposure.** The many tests calling `admit_email` must move to flow-specific entry points. Do not preserve the generic method under `test-support`.

7. **Batching.** Delete only after F061, F062, F067, and F069 have their final entry surfaces. Pure authentication/recovery flows may migrate separately because their downstream exact predicates already exist.

**Fixture:** Two canonical addresses crossed with two flows; include case and normalization aliases. No timestamp or label may reveal which canonical address the admission retained.

---

## Q37 — guest claim and address control

### F061

1. **Signature and disposition.** Current at `crates/snapback-auth/src/auth/provider.rs:4331`:

   ```rust
   pub fn prepare_guest_claim_password_plan<'a>(
       &'a self,
       guest: &'a SessionBearer,
       now_ms: u64,
       custody: PasswordIssuanceCustody,
   ) -> impl AuthDatabasePlan<
       Output = SnapbackResult<GuestClaimPasswordPreparation>,
   > + 'a
   ```

   Required target after the prerequisite:

   ```rust
   pub fn prepare_password_plan(
       &self,
       now_ms: u64,
       custody: PasswordIssuanceCustody,
   ) -> impl AuthDatabasePlan<
       Output = SnapbackResult<GuestClaimPasswordPreparation>,
   > + '_
   ```

   where `self` is a producer-sealed `VerifiedGuestAddressClaim` carrying both the exact guest predecessor and verified canonical address. **DERIVE.** The independent `guest` and generic address admission disappear.

   **GATED:** no production-sealed guest/address proof currently exists. Creating `VerifiedGuestAddressClaim` is separate capability work and must land first.

2. **Existing tested predicate.** Reuse `LocalDatabase::guest_claim_predecessor` at `storage/auth_identity.rs:2797` and the collision/revocation planning at `provider.rs:2608-2638`. The assertion-based `prepare_verified_email_claim` at `storage/auth_identity.rs:600` is explicitly unwired and is not an acceptable proof producer.

3. **Callers.** One direct production caller: `server.rs:19641`. Exact search found no direct test caller of this wrapper; lower-level guest-claim tests exercise the predicate.

4. **Production writes/readback.** Accepted completion must project:

   - `_auth_users`: `id,created_at_ms,kind,display_name,operator_contact,registration_provenance,deactivated_at_ms,owner_user_id,guest_state,guest_expires_at_ms,guest_claimed_at_ms`.
   - `_auth_identities`: `id,user_id,kind,provider,issuer,subject,canonical_value,created_at_ms,verified_at_ms,disabled_at_ms`.
   - `_auth_credentials`: `id,user_id,kind,generation,created_at_ms,last_used_at_ms,revoked_at_ms`.
   - `_auth_password_credentials`: `credential_id,algorithm,hash_phc,policy_version,common_password_list_version,changed_at_ms`.
   - `_auth_recovery_code_sets`: `credential_id,set_generation,reason,issued_at_ms,replaced_at_ms`.
   - `_auth_recovery_codes`: `set_credential_id,ordinal,code_digest,key_id,consumed_at_ms`.
   - `_auth_sessions`: `id,user_id,identity_id,credential_id,authn_source,authority_instance_id,token_hash,generation,created_at_ms,last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms`.
   - `_auth_assurances`: `id,user_id,session_id,identity_id,credential_id,kind,provenance,issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms`.

5. **Fields actually read.** Production reads custody, password-identifier mode, canonical address, guest bearer hash, current guest session ID/user/generation/token digest, subject occupancy, and planned session revocations. It does not read arbitrary fields discarded from surrounding session records.

6. **Test-support exposure.** Do not expose a constructor taking address/event strings. The unwired `VerifiedEmailClaim` path at `storage/auth_identity.rs:595-621` demonstrates the assertion defect and must not become the prerequisite.

7. **Batching.** Block this row until a reviewed verified-address producer exists. Then land the producer, target signature, route migration, and durable readback together.

**Fixture:** Guest G0/G1 crossed with verified addresses A0/A1. Accept only producer-issued G0/A0 and G1/A1 carriers; test both cross-pairs and prove every listed table unchanged on refusal.

---

## Q38 — password registration and address control

### F062

1. **Signature and disposition.** Current at `provider.rs:4350`:

   ```rust
   pub fn prepare_password_registration_plan(
       &self,
       custody: PasswordIssuanceCustody,
   ) -> impl AuthDatabasePlan<
       Output = SnapbackResult<PasswordRegistrationPreparation>,
   > + '_
   ```

   Required target:

   ```rust
   pub fn prepare_password_registration_plan(
       &self,
       custody: PasswordIssuanceCustody,
   ) -> impl AuthDatabasePlan<
       Output = SnapbackResult<PasswordRegistrationPreparation>,
   > + '_
   ```

   where `self` changes from generic `AddressAdmission` to a producer-sealed `VerifiedPasswordRegistration`. **DERIVE.**

   **GATED:** no current production artifact proves that the registering principal controls this address. A reviewed proof/capability must precede this row.

2. **Existing tested predicate.** Reuse identifier-mode and canonicalization logic at `provider.rs:1919-1940` and `storage/auth_identity.rs:711`. Those predicates validate shape, not ownership; do not mislabel them as address proof.

3. **Callers.** One direct production caller: `server.rs:19732`. Exact search found no other direct caller.

4. **Production writes/readback.** Read back the same concrete identity-core columns listed for F061, except that no predecessor guest row is required. On refusal all identity, credential, recovery, session, assurance, and auth-clock rows remain unchanged.

5. **Fields actually read.** F062 reads custody, configured password-identifier mode, canonical identifier, and canonical address. It does not read any ownership proof, existing session, or challenge result; that absence is the blocker.

6. **Test-support exposure.** Do not make `PasswordRegistrationPreparation` constructible or add a feature-public verified-registration constructor accepting raw strings.

7. **Batching.** Land only with the approved address-control product flow and its producer seal. Coordinate with F005 so generic admission is not retained as fallback.

**Fixture:** Registration authority R0/R1 crossed with addresses A0/A1; exact producer pairs accepted, both substitutions refused, complete identity-core projection unchanged on refusal.

---

## Q39 — request-code target and abuse controls

### F067

1. **Signature and disposition.** Current at `provider.rs:4420`:

   ```rust
   pub fn request_code_plan(
       &self,
       now_ms: u64,
   ) -> impl AuthDatabasePlan<
       Output = ProviderResult<RequestCodeResponse>,
   > + '_
   ```

   Target:

   ```rust
   pub fn request_code_plan(
       self: &Arc<Self>,
       email: &str,
       now_ms: u64,
   ) -> impl AuthDatabasePlan<
       Output = ProviderResult<RequestCodeResponse>,
   >
   ```

   The high-level operation canonicalizes once and derives the stripe, mailbox entry, throttle keys, digest input, and durable challenge from that same address. **DERIVE.** This is rate-control correlation, not proof that the mailbox owner requested the code.

2. **Existing tested predicate.** Reuse `request_code_inner` at `provider.rs:4613-4708`, including mailbox reservation, budget policy, challenge insertion, and refusal handling.

3. **Callers.** Direct callers: production `server.rs:19051`; runtime test `auth/runtime.rs:1534`. The rehearsal sibling at `provider.rs:4428` is a P4 duplicate and must use the same derived-address core.

4. **Production writes/readback.** `_auth_verification_codes`: `challenge_id,canonical_address,code_digest,key_id,attempts,max_attempts,requested_at_ms,expires_at_ms,consumed_at_ms,superseded_by`. Also assert the capture mailbox publishes the same canonical address/challenge pair; refused cases leave the table unchanged.

5. **Fields actually read.** Address, `now_ms`, profile capture permission, active key ID/material, mailbox capacity, budget policy, optional rehearsal window, and generated challenge/code are read. No user/session identity is read.

6. **Test-support exposure.** Remove direct test construction through generic `AddressAdmission`; use the same high-level request-code entry point.

7. **Batching.** Batch with F005 and F001’s request-code plan migration. The external-send behavior must remain after the exact durable insert succeeds.

**Fixture:** Addresses A0/A1, keys K0/K1, and times N0/N1 arranged diagonally. Verify address substitutions in both directions and exact challenge-row correspondence.

---

## Q36 — host/rehearsal session mint

### F069

1. **Signature and disposition.** Current at `provider.rs:4439`:

   ```rust
   pub fn plan_mint_session_plan(
       &self,
       now_ms: u64,
   ) -> impl AuthDatabasePlan<
       Output = ProviderResult<ProviderSessionIssuancePlan>,
   > + '_
   ```

   Required target:

   ```rust
   pub fn plan_mint_session_plan(
       &self,
       now_ms: u64,
   ) -> impl AuthDatabasePlan<
       Output = ProviderResult<ProviderSessionIssuancePlan>,
   > + '_
   ```

   where `self` is an operation-specific `AuthorizedSessionMint` that already contains the authorized canonical address and host/rehearsal provenance. **DERIVE.**

   **GATED:** `authorize_host_operation` returns `()` at `admin.rs:4198`; it does not produce an operation-specific, address-bound authority. That capability must be designed separately.

2. **Existing tested predicate.** Reuse `authorize_host_operation` at `admin.rs:4198` for the host floor and `AuthProvider::plan_mint_session` at `provider.rs:4714` for issuance planning. Neither may be duplicated.

3. **Callers.** Direct calls are `server.rs:18455` and `server.rs:24699`. Transitive terminal callers of `coordinated_mint_session` are the rehearsal fixture-session flow at `server.rs:24805` and `auth.mintSession` at `server.rs:24921`.

4. **Production writes/readback.** Accepted completion projects `_auth_users`, `_auth_identities`, `_auth_sessions`, `_auth_session_tokens`, and `_auth_assurances` with all concrete identity-core columns listed under F061, plus the authorization-stream metadata row in `_snapback_meta(key,value)` when issuance advances it.

5. **Fields actually read.** F069 reads the address retained by admission and `now_ms`; downstream planning reads live-session cap, current identity/session rows, and optional rehearsal provenance. It does not read which host credential authorized the operation.

6. **Test-support exposure.** No raw `AuthorizedSessionMint::for_test` accepting address/provenance parts. End-to-end tests must pass the real operation-specific host/rehearsal authorization path.

7. **Batching.** Stop until the host-operation capability exists. Then batch F069, its two direct callers, and F005’s host/rehearsal admissions.

**Fixture:** Host authorities H0/H1 crossed with addresses A0/A1 and rehearsal grants R0/R1. Only producer-issued triples are accepted; all auth-catalog rows remain unchanged on cross-pair refusal.

---

## Q16 — authorized lease signing

### F073

1. **Signature and disposition.** Current site is `crates/snapback-kernel/src/auth/lease.rs:260`—the bucket document’s `snapback-auth` path is stale:

   ```rust
   pub fn issue(
       &self,
       issue: AuthorizedLeaseIssue,
       config: AuthorizedLeaseConfig,
       issued_at_server_ms: u64,
       target_profile_id: &str,
       app_id: &str,
   ) -> SnapbackResult<AuthorizedLease>
   ```

   Target: make the raw signer method private and change the public operation to:

   ```rust
   pub fn issue_authorized_lease(
       self,
       config: AuthorizedLeaseConfig,
       issued_at_server_ms: u64,
   ) -> SnapbackResult<AuthorizedLease>
   ```

   on an `AuthorizedLeaseCapture` that retains its exact signer/provider origin. **DERIVE.**

   **GATED:** current `AuthorizedLeaseCapture` at `engine.rs:4518` carries issue/target/app/admission but no signer or engine-graph provenance. It must be bound to the existing `EngineAppStateGraphIdentity` pattern at `engine.rs:3211` before the provider parameter can disappear safely.

2. **Existing tested predicate.** Reuse `validate_issue` and timestamp/deadline checks at `auth/lease.rs:268-297`, plus the existing capture path at `engine.rs:4528`.

3. **Callers.** Raw `issue` callers: production wrapper `provider.rs:3021`; engine test `local/tests/engine.rs:31895`; lease tests `auth/lease.rs:716,743,753,771,784,796,810,823,836,847,858,885,1151`; authorized-lease storage tests `storage/authorized_lease.rs:505,574,747`. Production capture consumer is `server.rs:30379`; provider test wrapper use is `auth/provider_tests.rs:727`.

4. **Production writes/readback.** None: signing produces an in-memory/serialized lease. Assert every lease field at `auth/lease.rs:298-320`: IDs, query identity, principal/session/provider, authorization/data witnesses, activation hash, issue/deadline fields, authority instance, key ID, and MAC.

5. **Fields actually read.** Every `AuthorizedLeaseIssue` field is copied into the lease; config and both time axes bound expiry; target profile and app enter the MAC. No issue field is discarded.

6. **Test-support exposure.** `AuthorizedLeaseAuthenticator::from_test_key` at `auth/lease.rs:253` remains kernel-test-only and must not become a production or feature-public signer.

7. **Batching.** Land only with signer/capture graph provenance and removal of `provider` from `AuthorizedLeaseCapture::issue_authorized_lease`.

**Fixture:** Captures C0/C1 and signer graphs G0/G1. A second graph must never produce an equal origin. Cross-graph issue attempts are structurally unavailable or refused before a lease is returned.

---

## Q42 — invalidation scope retirement

### F082

1. **Signature and disposition.** Current at `auth/invalidation.rs:459`:

   ```rust
   pub fn authenticate_scope_retirement(
       &self,
       authenticated: &AuthenticatedBootIssuer,
       namespace: QueryNamespace,
       retire_through_scope_sequence: u64,
       authorization_expectation: AuthorizationVersion,
       target_profile_id: &str,
       app_id: &str,
   ) -> SnapbackResult<ScopeRetirement>
   ```

   Target: remove this as a callable public surface. The sole operation remains:

   ```rust
   fn prepare_scope_retirement_authenticated(
       &self,
       scope: &ScopeId,
   ) -> SnapbackResult<(
       Option<ScopeRetirementCandidate>,
       Option<ScopeRetirement>,
   )>
   ```

   on `LocalInvalidationState`, deriving the candidate from its own `ObligationRegistry`. **DERIVE.**

2. **Existing tested predicate.** Reuse `ObligationRegistry::preview_scope_retirement` through `engine.rs:3802`, the issuer authentication at `engine.rs:3806`, and `commit_scope_retirement` at `engine.rs:3815`.

3. **Callers.** Raw authenticator callers: wrapper `auth/invalidation.rs:345` and unit test `auth/invalidation.rs:1796`. Wrapper callers are production `engine.rs:3806,22760`. Exact search found no others.

4. **Production writes/readback.** No SQL writes. Read back in-memory `scope_retirement_frontier` and `issued_scope_high_water` for the exact `(issuer_id, namespace)` and prove unrelated namespaces unchanged.

5. **Fields actually read.** Authenticated issuer ID/MAC, namespace, retirement sequence, authorization expectation, target profile, and app ID all participate. `ScopeRetirementCandidate` contains only namespace and sequence at `auth/invalidation.rs:809-812`.

6. **Test-support exposure.** Make candidate fields private and provide no `for_test` retirement signer accepting raw namespace/sequence.

7. **Batching.** Batch raw-method visibility changes with both wrapper callers and candidate sealing.

**Fixture:** Obligations O0/O1 crossed with issuers I0/I1 and namespaces N0/N1. Only the registry-derived candidate for the exact issuer is authenticated and retired.

---

## Q43 — obligation registry installation

### F084

1. **Signature and disposition.** Current at `auth/invalidation.rs:830`:

   ```rust
   pub fn new(
       expectation: ObligationExpectation,
   ) -> SnapbackResult<Self>
   ```

   Target:

   ```rust
   pub(crate) fn new(
       issuer: &LiveInvalidationIssuer,
   ) -> SnapbackResult<Self>
   ```

   deriving authorization, version stream, and issuer ID from the already installed issuer. **DERIVE.**

2. **Existing tested predicate.** Reuse `ObligationExpectation::validate` at `auth/invalidation.rs:831` and the installation checks at `engine.rs:8720-8736`: current kernel authorization, `bind_authorization_expectation`, and `install_version_stream`.

3. **Callers.** Production `engine.rs:8732`; unit test `auth/invalidation.rs:1695`. No others.

4. **Production writes/readback.** None; installation is process-local. Assert the registry expectation’s `authorization`, `version_stream`, and `issuer_id`, plus unchanged unrelated obligation maps.

5. **Fields actually read.** Constructor validation reads all three expectation fields. The rest of the registry starts empty; no caller-supplied obligation state is read.

6. **Test-support exposure.** Unit tests should install a real test issuer rather than construct `ObligationExpectation` beside it.

7. **Batching.** Land with `install_auth_invalidation` so no intermediate caller can reconstruct the old expectation.

**Fixture:** Issuers I0/I1 and authorization streams S0/S1. Registry fields must always follow the issuer instance, not diagonally paired input values.

---

## Q17 — session-projection rebuild provenance

### F094

1. **Signature and disposition.** Current at `auth/session_projection.rs:866`:

   ```rust
   pub fn rebuild(
       source: ProjectionSource,
       projection_startup_id: &str,
       epoch_now_ms: u64,
       monotonic_now: Instant,
   ) -> SnapbackResult<Self>
   ```

   Required target:

   ```rust
   pub fn rebuild(
       snapshot: AdmittedProjectionSnapshot,
       epoch_now_ms: u64,
       monotonic_now: Instant,
   ) -> SnapbackResult<Self>
   ```

   The startup ID is minted internally and raw `ProjectionSource` is not accepted. **DERIVE.**

   **GATED:** `AdmittedProjectionSnapshot` is opaque at `kernel/auth/session_projection.rs:83`, but it carries no database/engine producer-instance identity and exposes `into_source` publicly at line 93. It must gain verified producer provenance before this target can satisfy LLP 0303’s corollary.

2. **Existing tested predicate.** Reuse `SessionProjection::rebuild` validation at `session_projection.rs:872` onward and kernel snapshot production at `auth/auth_stream.rs:136-150`.

3. **Callers.** Direct callers are coordinator test `coordinator.rs:2301` and projection tests `session_projection.rs:2898,3098,3106,3114,3122,3135,3143,3151`. Production enters through `AuthCoordinator::from_admitted_snapshot` at `coordinator.rs:560` and `rebuild_with_fresh_startup_id` at line 565.

4. **Production writes/readback.** None. The test must read the resulting projection’s authorization-stream incarnation and every projected user, identity, session, token, generation, deadline, and terminal state from the supplied snapshot.

5. **Fields actually read.** Every `ProjectionSource` vector and `authorization_stream_value` is read; `restore_declaration_id` is read when present. Startup ID and both clocks are read. No source field is discarded.

6. **Test-support exposure.** Narrow feature-public `AuthCoordinator::new` at `coordinator.rs:572`; remove public raw `into_source` once consumers migrate. Tests may construct malformed raw sources only inside the owning module.

7. **Batching.** Stop until snapshot producer identity is reviewed. Then land kernel snapshot identity, rebuild signature, coordinator migration, and test-support narrowing atomically.

**Fixture:** Two databases D0/D1 with value-equal snapshots. Their provenance must compare unequal. Cross-instance rebuilds fail even when every row value matches.

---

## Q18 — session publication selection

### F097

1. **Signature and disposition.** Current at `session_projection.rs:1144`:

   ```rust
   pub fn session_publication_fence(
       &self,
       session_id: &str,
       expected_generation: u64,
   ) -> SnapbackResult<FencedPublication>
   ```

   Target:

   ```rust
   pub fn session_publication_fence(
       &self,
       authority: &ProjectedSessionAuthority,
   ) -> SnapbackResult<FencedPublication>
   ```

   with private `ProjectedSessionAuthority` fields and exact projection-origin validation. **DERIVE.**

2. **Existing tested predicate.** Reuse the session lookup/generation predicate at `session_projection.rs:1149-1163` and token-resolution liveness at `session_projection.rs:1490-1539`.

3. **Callers.** Coordinator production: `coordinator.rs:1628,1710,1988`. Internal wrappers: `session_projection.rs:1215,2758`. Tests: `session_projection.rs:3171,3198,3244,3314`.

4. **Production writes/readback.** None. Assert the returned publication’s stream incarnation, session fence instance, and expected generation; no durable table changes.

5. **Fields actually read.** Current code reads only `session_id` and `expected_generation`. The target authority additionally needs its private projection origin. User ID, provider, deadlines, and rehearsal provenance are not read by this method and must not become F097 axes.

6. **Test-support exposure.** Remove public fields from `ProjectedSessionAuthority` at `session_projection.rs:150-158`; tests obtain it through real resolution.

7. **Batching.** Coordinate with Q09/C001 and Q01 publication work so there is one session-authority carrier.

**Fixture:** Sessions S0/S1 and generations G0/G1 with shared non-axis values. Cross-session and cross-generation substitutions refuse in both directions.

---

## Q19 — service terminal gate selection

### F112

1. **Signature and disposition.** Current site is `crates/snapback-auth/src/auth/service_fence.rs:753`—the bucket’s `snapback-sync` path is stale:

   ```rust
   pub async fn acquire_terminal_gate(
       &self,
       token_ids: &[String],
       disposition: ServiceAuthorityDisposition,
   ) -> SnapbackResult<ServiceAuthorityTerminalGate>
   ```

   Target: remove this public registry method. Move the existing opaque `ServiceAuthorityTerminalPlan` at `engine.rs:3342` into the owning auth layer and expose only:

   ```rust
   pub async fn acquire_gate(
       &self,
   ) -> SnapbackResult<ServiceAuthorityTerminalGate>
   ```

   The plan already owns registry, exact token set, and disposition. **DERIVE.**

2. **Existing tested predicate.** Reuse `install_terminal_intent` at `service_fence.rs:684-747` and the drain test beginning at `service_fence.rs:1816`.

3. **Callers.** Engine plan: `engine.rs:3357`. Auth tests: `service_fence.rs:1829,1894,1990,2045,2077,2086,2098,2189,2225`. Server tests: `server/tests.rs:30385,30592,31578,41550`.

4. **Production writes/readback.** Gate acquisition is memory-only. Full terminal-route tests read `_auth_grant_tokens(id,grant_id,revoked_at_ms)` and, for `DurableDelete`, `_auth_grants(id,revoked_at_ms)` as demonstrated by `auth_agent_credentials.rs:1360-1384`.

5. **Fields actually read.** Exact token strings and disposition are read; domains are selected only by token ID. No grant, actor, effective user, or credential fields are read here.

6. **Test-support exposure.** Narrow `service_authority_terminal_plan_for_test` at `engine.rs:6067`; tests must obtain a plan from the same planner used by the mutation being terminalized.

7. **Batching.** Move plan ownership and delete the raw method atomically. Coordinate with F117’s separate transaction-receipt prerequisite.

**Fixture:** Token sets T0/T1 and dispositions Carrier/DurableDelete. Cross-plan token substitution must be impossible through the target API.

---

## Q20 — terminal transaction receipt

### F117

1. **Signature and disposition.** Current at `kernel/auth/service_fence.rs:98`:

   ```rust
   pub(crate) fn service_authority_commit_interlock(
       &self,
       prepare: impl Fn(
           &[String],
           ServiceAuthorityDisposition,
       ) -> SnapbackResult<PreparedServiceAuthorityTerminal>
           + Send
           + Sync
           + 'static,
   ) -> ServiceAuthorityCommitInterlock
   ```

   Required target shape:

   ```rust
   pub(crate) fn service_authority_commit_interlock(
       &self,
       terminalizer: TransactionProducedServiceTerminalizer,
   ) -> ServiceAuthorityCommitInterlock
   ```

   where terminal preparation consumes a transaction-produced receipt containing the exact token set and disposition rather than calling a fact-asserting closure. **DERIVE.**

   **GATED:** `TransactionProducedServiceTerminalizer`/receipt does not exist. This row cannot close by wrapping the current callback in another nominal type.

2. **Existing tested predicate.** Reuse database identity comparison at `kernel/auth/service_fence.rs:68-84` and the existing transaction/interlock settlement machinery. The current callback’s assertions are not a predicate to preserve.

3. **Callers.** Direct: auth bridge `auth/service_fence.rs:1205` and kernel test `kernel/auth/service_fence.rs:179`. Storage forwarding is `storage.rs:1994,2005`; installation is `engine.rs:27254`; tests install at `storage/auth.rs:3814` and `storage/auth_agent_credentials.rs:3249`.

4. **Production writes/readback.** Receipt-producing tests must read the producer transaction’s exact `_auth_grant_tokens(id,grant_id,revoked_at_ms)` and, when applicable, `_auth_grants(id,revoked_at_ms)`. Rollback and ambiguous outcomes must match the same rows.

5. **Fields actually read.** Current interlock reads token IDs and disposition only through the callback, then checks only `Arc` database identity on the returned terminal. Callback-captured facts are otherwise opaque and must not be treated as verified axes.

6. **Test-support exposure.** `RecordingServiceAuthorityCommitInterlock` at `kernel/auth/service_fence.rs:130` may record a real receipt path; it must not remain an alternate fact-asserting producer.

7. **Batching.** Separate prerequisite lane: define and review the transaction-produced receipt first, then migrate auth bridge, storage forwarding, installation, and tests together.

**Fixture:** Two database instances and two token/disposition transactions. Value-equal token vectors from the wrong transaction or database must not yield an acceptable terminal receipt.

---

## Q44 — session claims correlation

### F122

1. **Signature and disposition.** Current at `invocation.rs:814`:

   ```rust
   pub fn from_authority(
       authority: &ResolvedAppAuthority,
       session_claims: Option<AuthClaimsProjection>,
   ) -> SnapbackResult<Self>
   ```

   Target: delete the public factory. `PreparedBearerAuthority::prepare` constructs the handler projection after loading claims from its own session ID:

   ```rust
   fn prepare(
       self,
       database: &mut ServingDatabase,
       source: InvocationSource,
       active_mode: AuthMode,
       profile: ServerProfile,
       admission: AdmissionLease,
       wire: &WireAuthorityFields,
       now_ms: u64,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   **DERIVE.**

2. **Existing tested predicate.** Reuse `LocalDatabase::identity_claims` at `storage/auth_identity.rs:3693`, including the exact live session query at lines 3703-3707 and assurance predicate at lines 3798-3810. Existing production derivation is already at `coordinator.rs:538-552`.

3. **Callers.** `invocation.rs:2797,3419,3430,3440,3636,3649,3679,3709`; `runtime/host_glue.rs:1631,7371,7463,8146,8326,8768,10282,10310,10786,11435,11459,12267`; `engine.rs:30985`; `local/tests/engine.rs:26164`.

4. **Production writes/readback.** None; claims projection is read-only. End-to-end handler tests read projected `userId,sessionId,provider,roles,kind,claims.identities,claims.assurances`.

5. **Fields actually read.** F122 reads only authority variant, session `user_id`, `session_id`, `provider`, and whether claims are present; it moves the complete claims value without inspecting its fields. Generation, authority-instance ID, deadlines, and rehearsal provenance are discarded via `..` and are not F122 axes. The database producer, not F122, reads claim contents.

6. **Test-support exposure.** Remove direct cross-crate calls. Tests needing malformed presence combinations may remain only inside `snapback-sync`.

7. **Batching.** Sequence after Q11/C005 makes session authority producer-sealed. Then delete F122 and migrate all listed calls in one compile-complete batch.

**Fixture:** Session carriers S0/S1 crossed with claim sets C0/C1; no case-unique claim content. Only claims loaded from the carrier’s exact session are projected.

---

## Q21 — deferred rehearsal binding

### F126

1. **Signature and disposition.** Current at `invocation.rs:1745`:

   ```rust
   pub fn bind(
       &self,
       authority: PreparedAuthority,
       deferred: Option<DeferredRehearsalAuthority>,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   Required targets:

   ```rust
   pub fn bind(
       &self,
       authority: PreparedAuthority,
   ) -> SnapbackResult<PreparedAuthority>

   pub fn prepare_deferred(
       &self,
       deferred: DeferredRehearsalAuthority,
       admission: AdmissionLease,
       profile: ServerProfile,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   The deferred path derives its clean System authority internally. **DERIVE.**

   **GATED:** `DeferredRehearsalAuthority` at `storage/jobs.rs:210` is opaque but carries only provenance, not database/engine producer identity. Add the existing engine-graph identity pattern before it crosses into the binding.

2. **Existing tested predicate.** Reuse protected job-claim construction at `storage/jobs.rs:198-220` and `RehearsalAuthorityFence::new` plus `validate_at` at `invocation.rs:1857-1860`.

3. **Callers.** Normal production bind: `server.rs:13560-13561`. Deferred bind: `engine.rs:23658`. The binding producer is `coordinator.rs:1878-1884`.

4. **Production writes/readback.** None. Assert prepared authority’s rehearsal provenance and live fence; durable job and rehearsal rows are only read by their existing producers.

5. **Fields actually read.** Deferred `provenance`, existing authority rehearsal provenance, and live registry are read. No job ID, queue, action, arguments, or attempt field is read by F126.

6. **Test-support exposure.** Keep `DeferredRehearsalAuthority` fields private and provide no raw provenance constructor under `test-support`.

7. **Batching.** Land graph provenance in the kernel job artifact first; then split normal/deferred APIs and migrate both callers atomically.

**Fixture:** Job claims J0/J1 from graphs G0/G1 and rehearsal grants R0/R1. Value-equal provenance from another graph must not bind.

---

## Q45 — telemetry caller/approver attribution

### F129

1. **Signature and disposition.** Current at `invocation.rs:1957`:

   ```rust
   pub fn with_caller_attribution(
       self,
       attribution: CallerAttributionV1,
   ) -> Self
   ```

   Target split:

   ```rust
   pub fn with_authority_caller_attribution(
       self,
   ) -> SnapbackResult<Self>

   pub fn with_effect_caller_attribution(
       self,
       effect: &PendingEffectRecord,
       approver: &str,
   ) -> SnapbackResult<Self>
   ```

   **VERIFY**, because it is cross-principal by design: the original effect caller is one principal and the approving user is another principal. External transport attribution is likewise a transport caller identity distinct from the authenticated application principal. Same-principal lanes derive directly from `self`.

2. **Existing tested predicate.** Reuse external-lane classification at `server.rs:16555-16566`, authority-derived integration attribution at `server.rs:28522-28545`, and the exact pending-effect caller/approver record used by `server/effects.rs:191-197`.

3. **Callers.** Production `server.rs:16583,16598`, `server/effects.rs:191`, and watch-owner path `engine.rs:25861`. No other direct callers.

4. **Production writes/readback.** None. `CallerAttributionV1` is explicitly loss-tolerant, non-bill-grade telemetry at `telemetry_contract.rs:154-165`.

5. **Fields actually read.** The setter only stores attribution. Production later reads `lane,caller_key,approver_key` through `telemetry_caller_details` at `invocation.rs:1880-1883`. No authority field is read by the current setter.

6. **Test-support exposure.** Public constructors at `telemetry_contract.rs:173-234` may remain DTO helpers only if no public authority attachment accepts them directly.

7. **Batching.** Batch server classification, effect attribution, watch attribution, and setter removal. Do not couple this row to Q13 billing.

**Fixture:** Original callers C0/C1 and approvers A0/A1 crossed through exact pending-effect rows; valid cross-principal pairs remain accepted, unrelated pairs refuse.

---

## Q11 — authority-graph provenance

### F143

1. **Signature and disposition.** Current at `invocation.rs:2714`:

   ```rust
   pub fn prepare_admitted_authority(
       source: InvocationSource,
       active_mode: AuthMode,
       profile: ServerProfile,
       admission: AdmissionLease,
       wire: &WireAuthorityFields,
       resolved: ResolvedAppAuthority,
       session_claims: Option<AuthClaimsProjection>,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   Target: delete this public generic join. Only authority-class-specific engine/coordinator producers may return `PreparedAuthority`; none accepts an independently constructed `ResolvedAppAuthority`. **DERIVE.**

   **GATED:** this is the authority provenance seal itself. It must reuse `EngineAppStateGraphIdentity` at `engine.rs:3211`, including private `Arc<()>` pointer identity, rather than invent caller randomness.

2. **Existing tested predicate.** Preserve admission validation/mode matching at `invocation.rs:2746-2747` and `source_allows_authority` at `invocation.rs:3129`. These validate compatibility, not provenance.

3. **Callers.** Complete direct list: `invocation.rs:2700,2901,3517,4547`; `coordinator.rs:543`; `engine.rs:8193,11189,20004,20668,21987,22434,23623,23648,25852,28654,33174`; `local/tests/engine.rs:3689,16227,26554,28619,30104`; `local/admission_fence_tests.rs:76`; and `server/tests.rs:5481,8516,9355,9882,9996,10436,22936,29167,30311,30534,33796,33994,35086,39659`.

4. **Production writes/readback.** Authority preparation itself writes nothing. Honest boundary: its direct callers span many unrelated durable sinks, so there is no single truthful table projection. Each class-specific producer must retain its sink’s existing complete projection.

5. **Fields actually read.** Admission validity/mode, source, active mode, profile, wire-field presence, resolved variant and variant fields needed for handler projection/audit, plus session-claims presence. Variant fields hidden by `..` in a particular branch do not gain axes for that branch.

6. **Test-support exposure.** `prepare_authority` at `invocation.rs:2689` must not remain a feature-public reconstruction path. In-module malformed tests may use a private helper but cannot support a global “unconstructible” claim.

7. **Batching.** Land with C005. Migrate class-specific producers in compile-complete rounds, but do not delete the generic join until no listed caller remains.

**Fixture:** Two engine graphs and value-equal resolved authorities. Every genuine carrier must retain graph origin; copied fields or a lease from another graph cannot prepare authority.

### C005

1. **Signature and disposition.** Current public declaration at `invocation.rs:327`:

   ```rust
   pub enum ResolvedAppAuthority {
       Anonymous,
       Session {
           user_id: String,
           session_id: String,
           provider: String,
           generation: u64,
           authority_instance_id: String,
           session_not_after_ms: u64,
           provider_not_after_ms: Option<u64>,
           rehearsal_provenance: Option<AuthRehearsalProvenanceV1>,
       },
       RevalidatedPrincipal {
           user_id: String,
           authority_instance_id: String,
       },
       DevImpersonation {
           user_id: String,
           roles: Vec<String>,
           local_dev_only: bool,
       },
       ServicePrincipal {
           actor_user_id: String,
           credential_id: String,
           credential_generation: u64,
           grant_id: String,
           token_id: String,
           effective_user_id: Option<String>,
           scopes: Vec<ResolvedGrantScope>,
           token_expires_at_ms: u64,
           integration_status: Option<IntegrationStatus>,
       },
       AdminBypass {
           reason: String,
       },
       System,
   }
   ```

   Target: an opaque `ResolvedAppAuthority` with private representation, read-only projections, and constructors available only to graph-bound resolution producers. **DERIVE.**

   **GATED:** same Q11 authority seal as F143; a nominal private enum without producer-instance identity is insufficient.

2. **Existing tested predicate.** Reuse each durable/session/service resolver and `source_allows_authority` at `invocation.rs:3129`; do not add a universal equality check over copied fields.

3. **Callers.** Honest gap: an exhaustive constructor list could not be derived safely from textual `ResolvedAppAuthority::Variant` matches because the same syntax is used for construction and pattern matching across 361 occurrences. F143’s complete direct consumer list is above. This row must not be assigned for implementation until an AST/type-aware constructor inventory is produced.

4. **Production writes/readback.** None at the carrier. Durable projections remain producer-specific: session resolver, service resolver, watch anchor, asset callback, admin, system, and dev lanes must each retain their existing readback.

5. **Fields actually read.** Variant-specific consumers read different subsets. The authoritative list must be generated per constructor/consumer during the required AST inventory; applying all enum fields as axes to every branch would violate the production-read rule.

6. **Test-support exposure.** Remove public literals and any feature-public constructor from copied fields. Test-only constructors stay within the defining crate and cannot bypass graph origin.

7. **Batching.** Same landing as F143. The unresolved constructor inventory is a real planning gap, not permission to infer coverage.

**Fixture:** Per authority class, two graph instances with equal textual fields. Graph identity must remain unequal and non-rebindable.

---

## Q22 — asset-callback service authority

### F145

1. **Signature and disposition.** Current at `invocation.rs:2839`:

   ```rust
   pub fn prepare_admitted_asset_callbacks(
       profile: ServerProfile,
       admission: AdmissionLease,
       principal: AssetCallbacksServicePrincipal,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   Required target:

   ```rust
   pub fn prepare_asset_callbacks_authority(
       &mut self,
       function_id: &str,
       profile: ServerProfile,
       admission: AdmissionLease,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   on `LocalSnapback`, deriving app ID, exact current scope basis, durable callback principal, and prepared authority inside one engine graph. **DERIVE.**

   **GATED:** `AssetCallbacksServicePrincipal` has public fields at `storage/auth_asset_callbacks.rs:24-29` and no database/graph origin. Seal the existing carrier with producer identity; do not add another peer token.

2. **Existing tested predicate.** Reuse `ensure_asset_callbacks_service_principal` at `auth_asset_callbacks.rs:36-154` and `asset_callbacks_service_principal_is_live` at lines 160-215.

3. **Callers.** One direct caller: `engine.rs:8508`. Its surrounding derivation of app ID/scope begins at `engine.rs:8467`.

4. **Production writes/readback.** On first creation:

   - `_auth_users`: `id,created_at_ms,kind,display_name,operator_contact,registration_provenance,deactivated_at_ms,owner_user_id`.
   - `_auth_grants`: `id,actor_user_id,effective_user_id,scopes,created_at_ms,expires_at_ms,revoked_at_ms,created_by,request_id,consent_digest,last_used_at_ms`.
   - Read current `_auth_scope_bases(function_id,kind,generation,present,authority_creating)` and prove it unchanged.

5. **Fields actually read.** Current F145 reads `actor_user_id`, `grant_id`, and every `ExactGrantScope` field. It ignores `principal.app_id` while constructing `ResolvedAppAuthority`, although later revalidation reads it; app ID therefore belongs to the complete production-flow axes, not merely this function body.

6. **Test-support exposure.** Remove public carrier fields and provide no raw asset-callback authority constructor.

7. **Batching.** Land carrier origin, engine target, F145 deletion, and the sole caller together after Q11/C005.

**Fixture:** App graphs A0/A1 and callback functions F0/F1. Value-equal principal/grant text from another graph must refuse.

---

## Q23 — dev impersonation policy

### F146

1. **Signature and disposition.** Current at `invocation.rs:2895`:

   ```rust
   pub fn prepare_admitted_dev_input(
       source: InvocationSource,
       profile: ServerProfile,
       input: &HandlerInput,
       admission: AdmissionLease,
   ) -> SnapbackResult<PreparedAuthority>
   ```

   **PRODUCT DECISION — no disposition is selected here.** If unrestricted local impersonation is approved, this signature is intentional policy. If owner-bound or fixture-bound identity is selected, the target is DERIVE and accepts the approved dev identity capability, not `input.auth.user_id`.

2. **Existing tested predicate.** Reuse `ResolvedAppAuthority::dev_from_auth` at `invocation.rs:508-516`, `source_allows_authority` at `invocation.rs:3129`, and the existing capability check/warning at `server.rs:13147-13159`.

3. **Callers.** Production `engine.rs:8453,12347,16883,16919,17096,19279,23082,23386,33388`. Tests `local/tests/engine.rs:1642,6352,20088,20783,20963,21008,21033,26521,26761,27588,33386`.

4. **Production writes/readback.** None at authority preparation. Downstream projections are route-specific and must not be chosen until product policy is decided.

5. **Fields actually read.** `dev_from_auth` reads only `input.auth.user_id`; roles are set to an empty vector and `local_dev_only` to true. Other auth-input fields do not carry F146 axes.

6. **Test-support exposure.** The feature/test helper `prepare_dev_input` at `invocation.rs:2879` must follow the selected policy rather than silently preserving a second rule.

7. **Batching.** At this 2026-08-24 plan: stop for product ruling (superseded by the 2026-08-25 ruling note below — the ruling is owner-bound; proceed under it). Deployed-profile impossibility remains unchanged and is not the unresolved question.

**Fixture:** To be specified by the selected product policy. Do not write an acceptance matrix that implicitly chooses unrestricted, owner-bound, or fixture-bound behavior.

**2026-08-25 ruling note:** The product-policy wait is over. The author selected **owner-bound**:
when development mode is genuinely active, `DevImpersonation` may act only as the app owner or users
within a project the developer administers. Unrestricted and fixture-bound impersonation are
rejected. `local_dev_only` must become environment-derived, while deployed-environment impossibility
remains unchanged. See LLP 0303 §Product decisions — Q13 open, Q23 ruled. Implementation is assigned
to the separate `q23-owner-bound` lane; this planning ticket remains open.

---

## Q24 — agent/integration registration

### F182

1. **Signature and disposition.** Current at `engine.rs:5809`:

   ```rust
   pub fn register_agent_principal(
       &mut self,
       effect: &AdmissionEffectGuard<'_>,
       mode: AgentsMode,
       invitation: Option<&CreationInvitation>,
       display_name: Option<String>,
       operator_contact: Option<String>,
       class: AgentRegistrationClass,
       integration_facts: IntegrationRegistrationFacts,
       profile: ServerProfile,
       now_ms: u64,
       random: &dyn RandomSource,
   ) -> SnapbackResult<IssuedAgentCredential>
   ```

   Target removes `mode`:

   ```rust
   pub fn register_agent_principal(
       &mut self,
       effect: &AdmissionEffectGuard<'_>,
       invitation: Option<&CreationInvitation>,
       display_name: Option<String>,
       operator_contact: Option<String>,
       class: AgentRegistrationClass,
       integration_facts: IntegrationRegistrationFacts,
       profile: ServerProfile,
       now_ms: u64,
       random: &dyn RandomSource,
   ) -> SnapbackResult<IssuedAgentCredential>
   ```

   Mode derives from `self.db.schema().effective_agents_manifest()`. Invitation owner/provenance derives from the verified invitation row. **DERIVE.**

2. **Existing tested predicate.** Reuse `register_agent_principal_with_class` at `storage/auth_agents.rs:122-205`, including mode/invitation relation, invitation liveness/consumption, and owner derivation.

3. **Callers.** One direct production caller: `server.rs:17442`. Exact search found no other direct engine caller.

4. **Production writes/readback.**

   - `_auth_users`: all columns at `storage/auth.rs:613-630`.
   - `_auth_agent_credentials`: `id,user_id,secret_hash,generation,created_at_ms,rotated_at_ms,last_used_at_ms,revoked_at_ms`.
   - Invited mode: `_auth_agent_invitations`: `id,token_hash,class,created_by,minted_profile,agent_user_id,created_at_ms,expires_at_ms,revoked_at_ms,consumed_at_ms,consumed_by`.
   - Integration class: `_snapback_integration_records`: `id,principal_user_id,display_name,origin,redirect_uris_json,status,created_at_ms,updated_at_ms,provenance,owner_claim_state`.

5. **Fields actually read.** Mode, invitation, display name, operator contact, class, integration facts, profile, time, and randomness are read. The effect guard is retained for commit liveness but contributes no registration subject.

6. **Test-support exposure.** Tests must configure the manifest rather than pass a desired mode directly.

7. **Batching.** Engine signature, server call, and mode-axis tests can land together; no new artifact is required.

**Fixture:** Open/invited modes crossed with absent/present invitations and agent/integration classes. Mode comes only from schema.

---

## Q25 — agent pairing presentation

### F187

1. **Signature and disposition.** Current and target at `engine.rs:5981`:

   ```rust
   pub fn present_pairing_code(
       &mut self,
       effect: &AdmissionEffectGuard<'_>,
       credential: &AgentCredential,
       pairing_request_id: &str,
       pairing_code: &PairingCode,
       requested_scopes: &[GrantScopeRequest],
       now_ms: u64,
   ) -> SnapbackResult<PairingPresentation>
   ```

   **VERIFY**, because it is cross-principal by design: the agent credential holder is one principal and the human pairing-request owner is another principal. The target may retain the signature because the existing transaction compares and refuses the exact relation.

2. **Existing tested predicate.** Reuse `LocalDatabase::present_pairing_code` at `storage/auth_grants.rs:694-830`: credential liveness, agent/integration state, code hash, request owner, pending state, expiry, bound agent, exact scopes, attempt cap, and single-use update.

3. **Callers.** Engine production `server.rs:17404`; engine test `local/tests/engine.rs:29563`. The storage predicate’s direct callers/tests are `server/tests.rs:22053`, `storage/auth_grants.rs:2466,2507,2558,2607,2674,2739,2782,2809,2836,2850,2876,2886,2918,2935,2944,2954,2974`, plus serving wrapper `storage/auth_grants.rs:3174-3182`.

4. **Production writes/readback.**

   - `_auth_pairing_requests`: `id,code_hash,minted_by_user_id,agent_user_id,requested_scopes,state,attempts,created_at_ms,expires_at_ms,consumed_at_ms,grant_id`.
   - `_auth_agent_credentials`: `id,last_used_at_ms`.
   - Auth clock `_snapback_meta(key,value)` when advanced.

5. **Fields actually read.** Every supplied credential/request/code/scope/time input is read. The effect guard is only liveness and is not a pairing-correlation axis.

6. **Test-support exposure.** No new verified-pair constructor is needed. Keep all test cases on the real transaction predicate.

7. **Batching.** This row can close with executable axes and documentation; no signature or new artifact is required unless a later API-sealing pass groups request fields ergonomically.

**Fixture:** Agent principals A0/A1 crossed with human owners H0/H1, request IDs, codes, and scope sets. Preserve valid cross-principal pairs and refuse every unrelated combination.

---

## Q26 — rehearsal mint authority

### F202

1. **Signature and disposition.** Current at `engine.rs:6352`:

   ```rust
   pub fn auth_rehearsal_mint(
       &mut self,
       plan: RehearsalMintPlan,
   ) -> SnapbackResult<MintedRehearsalGrant>
   ```

   Required target:

   ```rust
   pub fn auth_rehearsal_mint(
       &mut self,
       authorization: AuthorizedRehearsalMint,
   ) -> SnapbackResult<MintedRehearsalGrant>
   ```

   `AuthorizedRehearsalMint` contains the authorized request, current bindings, carrier, namespace candidates, and time as one operation-specific capability. **DERIVE.**

   **GATED:** `authorize_host_operation` currently returns `()` at `admin.rs:4198`; no rehearsal-mint capability exists.

2. **Existing tested predicate.** Reuse `LocalDatabase::auth_rehearsal_mint` at `storage/auth_rehearsal.rs:165`, including request validation, profile/settled bindings, idempotency, reservations, and all-or-nothing transaction.

3. **Callers.** One direct engine caller: `server.rs:24373`. Kernel direct callers/tests: `storage/auth_rehearsal.rs:2523,2539,2565,2679,2783,2996,3014,3051,3158,3200,3325`; serving wrapper at `storage/auth_rehearsal.rs:3480`.

4. **Production writes/readback.**

   - `_snapback_auth_rehearsal_grants`: `grant_id,carrier_hash,record_json,revoked_at_ms,terminal_reason,challenge_attempts,identity_creates,session_mints,verification_simulations,window_installs,clock_advances,allocation_units,uses_charged`.
   - `_snapback_auth_rehearsal_mint_idempotency`: `operator_audit_id,idempotency_key,request_digest,grant_id,created_at_ms`.
   - `_snapback_auth_rehearsal_audit`: `audit_id,grant_id,effect,outcome_class,selector_class,idempotency_digest,counters_before_json,counters_after_json,occurred_at_ms`.
   - `_snapback_auth_rehearsal_store_markers`: `singleton,kind,store_id,disposable_at_creation,disposable_marker_id,rehearsal_admitted,first_admission_at_ms,first_admission_grant_digest,first_admission_effect`.
   - `_snapback_auth_rehearsal_window_reservations`: `window_plan_id,grant_id,namespace_digest,state,window_id,created_at_ms,terminal_at_ms`.

5. **Fields actually read.** Every `RehearsalMintPlan` field at `storage/auth_rehearsal.rs:32-37` is read: request, bindings, carrier, namespace candidates, and time.

6. **Test-support exposure.** Raw public `RehearsalMintPlan` fields must no longer reach the engine sink. Kernel-private transaction tests may retain direct plans.

7. **Batching.** Separate capability lane first; then host authorization, target signature, server caller, and readback together.

**Fixture:** Host authorizations H0/H1 crossed with mint requests/bindings M0/M1. No request timestamp or namespace candidate may identify its authority.

---

## Q13 — ask billing subject

### F203

1. **Signature and disposition.** Current at `engine.rs:6433`:

   ```rust
   pub fn reserve_ask_spend(
       &mut self,
       authority: &PreparedAuthority,
       now_ms: u64,
       subject: AskSpendSubject,
       budgets: &ApiAskBudgets,
   ) -> SnapbackResult<(AskSpendReservation, AskSpendFacts)>
   ```

   **PRODUCT DECISION.** After the payer rule is selected, the target is DERIVE:

   ```rust
   pub fn reserve_ask_spend(
       &mut self,
       authority: &PreparedAuthority,
       now_ms: u64,
       budgets: &ApiAskBudgets,
   ) -> SnapbackResult<(AskSpendReservation, AskSpendFacts)>
   ```

   The engine derives the selected payer from the prepared authority. No payer rule is chosen here.

2. **Existing tested predicate.** Reuse `LocalDatabase::reserve_ask_spend_guarded` at `storage/ask_spend.rs:224` and its exact budget calculations beginning at line 245.

3. **Callers.** Direct F203 tests: `local/admission_fence_tests.rs:1139,1153,1167,1185`. Production uses duplicate guarded F204 at `engine.rs:6453`, called at `server.rs:28299`; current subject selection is `server.rs:27667-27693`.

4. **Production writes/readback.** `_snapback_ask_spend`: `day,lane,caller_key,reserved_tokens,spent_tokens,reserved_result_bytes,spent_result_bytes`.

5. **Fields actually read.** Authority is read only for effect admission at F203. Storage reads `principal_key` and optional `integration_key`; budget code reads every declared limit used at `ask_spend.rs:248-290`. No other authority field participates today.

6. **Test-support exposure.** Once policy is selected, engine tests must stop constructing `AskSpendSubject` directly.

7. **Batching.** Stop for the Q13 product ruling. Then land F203, guarded F204, C014, server derivation removal, and settlement tests together.

**Fixture:** Deferred until payer policy is decided. The fixture must distinguish session user, service actor, effective user, integration, and app without implicitly selecting among them.

### C014

1. **Signature and disposition.** Current at `storage/ask_spend.rs:41`:

   ```rust
   pub struct AskSpendSubject {
       pub principal_key: String,
       pub integration_key: Option<String>,
   }
   ```

   **PRODUCT DECISION.** Target after the ruling: make the type private to storage or delete it from the engine API; its values are derived by the selected payer policy. **DERIVE after policy.**

2. **Existing tested predicate.** Same budget predicate as F203: `reserve_ask_spend_guarded` at `storage/ask_spend.rs:224`.

3. **Callers.** Struct literals: production `server.rs:27672,27683`; engine test `local/admission_fence_tests.rs:419`; kernel tests `storage/ask_spend.rs:496,527,539`.

4. **Production writes/readback.** Same seven `_snapback_ask_spend` columns as F203.

5. **Fields actually read.** `principal_key` is always read; `integration_key` is read only when the integration-day budget is enabled, at `ask_spend.rs:193-199,250-260`.

6. **Test-support exposure.** Kernel-private tests may construct the private storage subject; cross-crate tests must use derived authority.

7. **Batching.** Same product-gated landing as F203.

**Fixture:** Same deferred payer matrix as F203.

---

## Q27 — operator terminal of integration principal

### F205

1. **Signature and disposition.** Current and target at `engine.rs:6565`:

   ```rust
   pub fn plan_integration_principal_service_terminal(
       &mut self,
       operator: &EngineOperatorAuthority,
       authority: &PreparedAuthority,
       principal_user_id: &str,
   ) -> SnapbackResult<ServiceAuthorityTerminalPlan>
   ```

   **VERIFY**, because it is cross-principal by design: the process operator principal is one principal and the target integration principal is another.

2. **Existing tested predicate.** Reuse `validate_operator_authority` at `engine.rs:6542-6562` and `LocalDatabase::plan_integration_principal_service_terminal` at `storage/auth_agent_credentials.rs:512-519`, which requires an integration record and derives its token IDs.

3. **Callers.** One direct production caller: `server.rs:20640`.

4. **Production writes/readback.** Planning is read-only. Full terminal flow reads `_snapback_integration_records(id,principal_user_id,status)` and `_auth_grant_tokens(id,grant_id,credential_id,credential_generation,revoked_at_ms)`; the terminal mutation owns its later revocation projection.

5. **Fields actually read.** Operator private identity, authority admission/source/mode/variant, and target `principal_user_id`. Token IDs are derived from storage. No display name, origin, redirect URI, or owner-claim field is read by this planner.

6. **Test-support exposure.** `EngineOperatorAuthority` remains private-field and graph-minted. Do not add a target-principal capability.

7. **Batching.** Add cross-principal substitution tests around the existing signature and predicate; no new artifact is required.

**Fixture:** Operators O0/O1 and integration principals I0/I1. Valid operator may target either integration in its own graph; another graph or non-integration target refuses.

---

## Q28 — exact commit-row identity

### F220

1. **Signature and disposition.** Current at `storage.rs:891`:

   ```rust
   pub(crate) fn new(
       binding: DatabaseBinding,
       operation_identity: I::OperationIdentity,
       value: T,
   ) -> Self
   ```

   Required target:

   ```rust
   pub(crate) fn new(
       binding: DatabaseBinding,
       intent: CommitCapsuleIntentInstance<I>,
       value: T,
   ) -> Self
   ```

   The kernel-created intent instance binds unique producer instance and intended-row fingerprint; raw operation identity is removed. **DERIVE.**

   **GATED:** `CommitCapsuleIntentInstance` does not exist. Current documentation at `storage.rs:861-880` explicitly says IDs are caller-constructible, non-unique, and do not bind intent instance or row fingerprint.

2. **Existing tested predicate.** Reuse database binding and typed operation comparison in `ExactCommitRows::into_value_for` at `storage.rs:903-917`, strengthened to compare the new instance identity/fingerprint.

3. **Callers.** `storage/commit_capsule_prototype.rs:150,299`; `storage/watches.rs:953`. No others.

4. **Production writes/readback.** Constructor is read-only. For prototype tests, read `_test_bounded_commit_capsule_operations(operation_id,payload,response)` and `_test_bounded_commit_capsule_proofs(proof_id,operation_id,expected_payload,consumed)`. For watches, read every `_snapback_watches` column declared at `watches.rs:31-77` plus `_snapback_watch_firings(watch_id,ordinal,job_id,fired_at_ms,outcome,diagnostic_code)` when the intended effect includes a firing.

5. **Fields actually read.** `into_value_for` reads database binding and operation identity; `value` is returned without inspection. Therefore the new fingerprint must be verified by the intent-instance predicate, not inferred from `T`.

6. **Test-support exposure.** The prototype is deliberately test-support-only but must exercise the real intent-instance mechanism rather than a weaker test identity.

7. **Batching.** Separate seal design/LLP work first. Then migrate all three constructor calls and consumption atomically.

**Fixture:** Two semantically different intents with equal caller operation IDs and two database instances. Both value and operation string may match; producer instance/fingerprint must still distinguish them.

---

## Q29 — membership writer/plan join

### F236

1. **Signature and disposition.** Current at `storage.rs:16876`:

   ```rust
   pub fn user_transition(
       writer: MembershipWriter,
       plan: MembershipPlan,
   ) -> Self
   ```

   Target: delete the public constructor. `authorize_membership_commands` at `storage/membership_plans.rs:202` constructs `AuthorizedMembershipPlan` directly with private fields after planning from `command.writer`. **DERIVE.**

2. **Existing tested predicate.** Reuse all operation-specific planners selected at `membership_plans.rs:210-328` and their captured read dependencies; do not add a second writer/transition policy.

3. **Callers.** Production `storage/membership_plans.rs:329`; test `storage/tests.rs:15697`.

4. **Production writes/readback.**

   - Application membership row: every declared fixture column plus `_id,_version,_createdAt,_updatedAt,_snapbackGrantedByActor,_snapbackGrantedByEffective,_snapbackGrantedByGrant`.
   - `_snapback_membership_transitions`: `declaration_id,op,principal,resource,from_role,to_role,actor,effective,grant_id,commit_version,writer_class`.
   - `_snapback_version`: `id,version`.
   - `_snapback_changes`: `id,version,table_name,row_id,op,row_json,changed_at_ms`.
   - When enabled, `_snapback_authority_projection_horizons(declaration_id,profile_generation,earliest_commit,coverage_class)`, `_snapback_authority_projection_events(declaration_id,profile_generation,incarnation,scope_id,principal,event_kind,role,status,history_json,commit_version,changed_at_ms)`, and `_snapback_meta(key,value)` for the authorization epoch.

5. **Fields actually read.** The current constructor reads no fields; it merely stores both values. Commit later reads `plan.read_dependencies`, `plan.writes`, and `writer` at `storage.rs:6544-6563,6638-6644`. Axis tests must use facts consumed by the selected planner/write, not unrelated writer metadata.

6. **Test-support exposure.** Remove the direct test constructor at `storage/tests.rs:15697`; use `authorize_membership_commands`.

7. **Batching.** Constructor visibility and both callers can land together. Coordinate with existing Q04 plans because they share membership fixtures.

**Fixture:** Writers W0/W1 and planned transitions P0/P1. Only planner-produced pairs commit; crossed pairs cannot be constructed.

---

## Q30 — protected room act

### F237

1. **Signature and disposition.** Current and low-level target at `storage/room_authority.rs:596`:

   ```rust
   pub fn begin_protected_room_act(
       &self,
       room: &RoomId,
   ) -> Result<RoomAuthorityPermit, EphemeralError>
   ```

   **VERIFY**, because it is cross-principal by design: the acting connection principal is one principal and the room membership-policy/owner principal may be another. Keep the low-level signature only behind the complete server authorization flow; no owner-equality rule is introduced.

2. **Existing tested predicate.** Reuse the room liveness/pending/resync checks at `room_authority.rs:600-624` and the complete durable permission flow `authorize_bound_ephemeral_room` at `server.rs:33784-33888`.

3. **Callers.** Kernel forwarding `room_authority.rs:1014-1018`; kernel tests `room_authority.rs:2693,2721,2741,2820,2949,2966`; sync wrapper `ephemeral.rs:3218-3224`; production sync call `ephemeral.rs:3758`; high-level production calls `server.rs:3055,33834,33866`; sync tests `ephemeral.rs:9075,9474,9479,9620,9635,9664,9749,9766`.

4. **Production writes/readback.** No SQL write. The durable permission lookup is read-only; assert the complete relevant membership fixture row and authorization expectation remain unchanged, then inspect the in-memory permit’s room and generation.

5. **Fields actually read.** Low-level code reads room identity, protected-collection registration, pending dependency selection, retired state, pending tickets, resync presence, generation, and active-permit count. It does not read the acting principal; that is verified by the higher-level durable lookup.

6. **Test-support exposure.** Standalone `NonAuthorizingRoomAuthority` must remain explicitly non-authorizing. Tests of protected acts use the bound participant and full authorization flow.

7. **Batching.** Add cross-principal acceptance/substitution tests around the existing two-level flow. No new artifact is required.

**Fixture:** Acting principals A0/A1, rooms R0/R1, and room owners O0/O1. Valid memberships across different owners remain accepted; unrelated membership substitutions refuse.

---

## Q31 — room reauthorization completion

### F244

1. **Signature and disposition.** Current at `room_authority.rs:953`:

   ```rust
   pub fn begin_room_reauthorization_admission(
       &self,
       room: &RoomId,
       generation: u64,
   ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError>
   ```

   Required target:

   ```rust
   pub fn begin_room_reauthorization_admission(
       &self,
       pending: PendingRoomReauthorization,
   ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError>
   ```

   where `pending` is opaque, registry-instance-bound, and contains room/generation/obligation. **DERIVE.**

   **GATED:** both current pending types expose raw public fields (`room_authority.rs:243-246`, `ephemeral.rs:3157-3161`) and neither carries registry producer identity.

2. **Existing tested predicate.** Reuse exact room/generation/resync checks at `room_authority.rs:958-973` and exact subscriber/effect-fence comparison at `ephemeral.rs:3843-3869`.

3. **Callers.** Kernel forwarding `room_authority.rs:1071-1077`; sync wrapper `ephemeral.rs:3301-3311`; production completion `ephemeral.rs:3832`; server completion `server.rs:22991`; engine forwarding `engine.rs:3044-3051` and maintenance completion `engine.rs:27037`.

4. **Production writes/readback.** No SQL write. Read back in-memory resync obligation, generation, subscriber connection IDs/effect fences, resulting subscriber set, removed entries, scope epoch, and outbound removals.

5. **Fields actually read.** Room, generation, resync obligation generation, retired/pending state, subscriber connection IDs, and effect fences. `previous_auth` is test-only and not a production axis.

6. **Test-support exposure.** Remove public fields and `Serialize/Deserialize` from the authorizing pending carrier unless a separate non-authorizing DTO is required.

7. **Batching.** Producer identity/sealing first; then pending enumeration, completion signature, wrappers, and tests atomically.

**Fixture:** Two registries with value-equal room/generation obligations and crossed subscriber sets. Only the originating registry’s pending carrier completes.

---

## Q32 — asset plan/effect correlation

### F272

1. **Signature and disposition.** Current at `engine.rs:15759`:

   ```rust
   pub fn asset_width_plan_with_authorized_effect(
       &mut self,
       ticket: AssetWidthPlanTicketV1,
       authorized_effect: AuthorizedEffectReservation,
   ) -> SnapbackResult<AssetWidthPutTicketV1>
   ```

   Required target:

   ```rust
   pub fn asset_width_plan_with_authorized_effect(
       &mut self,
       plan: AuthorizedAssetWidthPlan,
   ) -> SnapbackResult<AssetWidthPutTicketV1>
   ```

   The plan contains the exact ticket and effect reservation bound at route preparation. **DERIVE.**

   **GATED:** no bound plan exists. The two current opaque types contain no shared request/attempt/publication identity; a new provenance-bearing carrier must be reviewed and must reuse `EngineAppStateGraphIdentity`.

2. **Existing tested predicate.** Reuse the guarded staging transaction at `engine.rs:15764-15776`; do not duplicate `stage_width_variant_plan_proved_guarded`.

3. **Callers.** Production `server/asset_routes.rs:622,822`. Engine tests `local/tests/engine.rs:12496,12585,12591,12663,12680,12686,12761,12775,12781,12896,12910,13016,13034,13114,13128,13134,13293,13316`.

4. **Production writes/readback.** `_snapback_asset_publications_v1`: `publication_id,app_id,planned_key,state,record_json,updated_at_ms`.

5. **Fields actually read.** Ticket `app_id,asset_id,variant_key,digest` are read at `engine.rs:15768-15771`; `AuthorizedEffectReservation` is read only through its commit guard. Other preparation fields—width, primary key, content type, store, quota, rendered bytes—are not F272 correlation axes.

6. **Test-support exposure.** Existing engine tests must obtain `AuthorizedAssetWidthPlan` from the real route-stage binder; no `for_test(ticket,effect)` constructor.

7. **Batching.** Separate carrier/provenance design first. Then both production routes, engine sink, and all listed tests together.

**Fixture:** Tickets T0/T1 and effect reservations E0/E1 from two attempts and graph instances. Exact pairs commit; crossed pairs leave the publication table unchanged.

---

## Q33 — live subscribe connection correlation

### F283

1. **Signature and disposition.** Current raw method at `engine.rs:21854`:

   ```rust
   pub(crate) fn prepare_subscribe_live_for_transport(
       &mut self,
       name: String,
       input: LiveSubscribeInput,
       authority: PreparedAuthority,
       invalidation: LiveInvalidationAdmission,
   ) -> SnapbackResult<PreparedLiveSubscribe>
   ```

   Target server-side operation:

   ```rust
   fn prepare_live_subscribe(
       &self,
       snapback: &mut LocalSnapback,
       name: String,
       input: LiveSubscribeInput,
       expected_generation: Option<ArtifactGeneration>,
   ) -> SnapbackResult<PreparedLiveSubscribe>
   ```

   on the existing `PreparedConnectionAct`, deriving authority, connection identity, invalidation connection, and effect fence from itself. **DERIVE.**

2. **Existing tested predicate.** Reuse source/admission/effect-fence/ownership checks at `engine.rs:21878-21905` and the exact connection act assembled by the production route at `server.rs:31767-31789`.

3. **Callers.** Raw direct tests `local/tests/engine.rs:33769,33816,33931,33946`; feature wrapper `engine/test_support.rs:123,131`; server tests through it at `server/tests.rs:9373,33814`. Production calls the generation sibling at `server.rs:31783`.

4. **Production writes/readback.** No SQL writes. Read back staged subscription fields: connection ID, function/name, authority owner, effect fence, superseded subscription selection, reservation keys, and expected artifact generation.

5. **Fields actually read.** Authority source/admission and ownership; invalidation effect fence; `input.connection_id` and `input.supersedes`; name and expected generation. Other handler input and authorization namespace are moved into later execution but are not used by the correlation predicate at this boundary.

6. **Test-support exposure.** Delete or narrow `engine/test_support.rs:123`; cross-crate tests must use a real `PreparedConnectionAct`.

7. **Batching.** Coordinate with Q01’s connection-carrier work. Move production and test composition to the existing connection act before deleting the raw method.

**Fixture:** Connection acts C0/C1, authorities A0/A1, and invalidation fences F0/F1. No independent combination is accepted; supersession remains connection-local.

---

## Q34 — secret-read lease mint

### F297

1. **Signature and disposition.** Current private method at `admin_secret_read.rs:670`:

   ```rust
   fn mint(
       &self,
       root: &SecretReadRoot,
       request: SecretReadLeaseRequest,
   ) -> SnapbackResult<SecretReadLease>
   ```

   Target:

   ```rust
   fn mint(
       &self,
       request: SecretReadLeaseRequest,
   ) -> SnapbackResult<SecretReadLease>
   ```

   called only through `SecretReadOperator`, which already owns the registry and matching root. **DERIVE.**

2. **Existing tested predicate.** Reuse `SecretReadLeaseRequest::validate` at `admin_secret_read.rs:88-114` and existing operator construction at `admin_secret_read.rs:542-573`. The current root digest comparison at lines 675-683 becomes unnecessary after derivation.

3. **Callers.** Direct registry call: `admin_secret_read.rs:722`. Operator callers: bridge `admin_secret_read.rs:294` and tests `admin_secret_read.rs:1154,1174,1195,1241`.

4. **Production writes/readback.** No durable SQL. Read back the in-memory lease record fields inserted at `admin_secret_read.rs:698-706`: `scopes,expires_at,reset_generation,remaining_rows,remaining_bytes`.

5. **Fields actually read.** Request scopes, TTL, row budget, and byte budget are all read. Root secret is read only for the current comparison; registry clock/reset generation/capacity are read. The bearer is generated internally.

6. **Test-support exposure.** Tests continue through `SecretReadOperator`; no registry/root pairing constructor is exposed.

7. **Batching.** Private mechanical change plus operator tests; independent of F299’s startup bridge blocker.

**Fixture:** Operators O0/O1 and requests R0/R1. Each operator always uses its own root; request scopes/budgets remain caller-selected and bounded.

---

## Q35 — secret-read startup bridge provenance

### F299

1. **Signature and disposition.** Current at `admin_secret_read.rs:207`:

   ```rust
   pub(crate) fn new(
       operator: SecretReadOperator,
       proof_root: SecretReadProofRoot,
       startup_nonce: String,
   ) -> Self
   ```

   Required target:

   ```rust
   pub(crate) fn new(
       startup: SecretReadStartupBinding,
   ) -> Self
   ```

   The binding contains operator, proof root, and nonce from one startup producer. **DERIVE.**

   **GATED:** `SecretReadStartupBinding` and a common startup/graph identity do not exist. Three independent values cannot be made safe by merely wrapping them after the fact.

2. **Existing tested predicate.** Reuse proof nonce/root/freshness/replay checks at `admin_secret_read.rs:230-290` and the existing executable test at `admin_secret_read.rs:901-987`.

3. **Callers.** Production constructor calls: `admin.rs:3041` and `lib.rs:196`. Private clocked test constructor calls: `admin_secret_read.rs:907,1003`.

4. **Production writes/readback.** No SQL writes. Read back bridge startup nonce, proof-root verification result, replay set entry/expiry, and the operator registry’s lease record fields from F297.

5. **Fields actually read.** Constructor only stores all three inputs. `verify_and_claim` reads proof startup nonce, nonce, issued time, MAC, proof root, and replay state; mint later reads the operator. None is discarded.

6. **Test-support exposure.** `new_with_clock` may remain private but must accept the same coherent startup binding plus clock, rather than independently supplied operator/root/nonce.

7. **Batching.** Design and review startup binding/provenance first. Then migrate both production constructors and both clocked tests atomically.

**Fixture:** Startup instances S0/S1 with value-equal nonce text where useful, distinct proof roots, and distinct operator registries. Mixed triples must never form a bridge.
