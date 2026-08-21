# LLP 0293: Authority-transition chokepoint mechanism

**Type:** Spec
**Status:** Review — implements LLP 0292’s accepted direction; not implementation-authoritative until the compile questions in §10 are resolved
**Systems:** Security/authorization, kernel storage, identity/auth, grants, watches, capability links, internal work, restore/import, verification
**Author:** Codex synthesis, for Charlie Cheever
**Date:** 2026-08-20
**Revised:** 2026-08-20 (b — §10.3 resolved by a compiled move-once HTTP handoff prototype)
**Related:** LLP 0283 (F-1), LLP 0284, LLP 0285, LLP 0291, LLP 0292
**Inputs:** `llp/0292-authority-straight-path.plan.md`, `choke-codex.md`, `choke-grok.md`
**Scope:** Mechanism for LLP 0292 phases 2–3

## 1. Evidence status and decision

This specification uses three confidence labels:

- **VERIFIED** — directly established by the checked-in documents or cited source.
- **INFERRED** — a synthesis decision that has not been compiled.
- **OPEN** — neither source establishes the answer; implementation must not proceed by assumption.

**VERIFIED:** Ruling 5 directs Snapback to delete and rebuild the authority-creation surface instead of migrating approximately 46 families, while preserving the real concurrency semantics and acknowledging durable local data (`llp/0285-kernel-authorization-closure.spec.md:119-143`; `llp/0292-authority-straight-path.plan.md:69-85`).

**VERIFIED:** LLP 0291 found 30 ordinary and 16 feature-gated forgery families, with independent authority creation through sessions, grants, retained services, watches, callbacks, capability links, membership provenance, and in-memory `ResolvedAppAuthority` (`llp/0291-authority-forgery-surface.research.md:376-409`). Therefore a private session insertion method is not a chokepoint.

**Decision — INFERRED:** Adopt one kernel-owned authority-transition subsystem with two inseparable result forms:

1. A durable authority transition committed inside its verifying transaction.
2. An exact, opaque `PreparedOperation<Kind>` created from the same evidence for an in-memory admission.

There is one owner and one verification mechanism, not a public “commit gate” that accepts an evidence token manufactured elsewhere. The public surface accepts only operation selectors, raw possession material, cryptographic artifacts, or ordinary non-authority payload. The authority module derives the subject, authority class, purpose, predecessors, writer, provenance, successor, and time.

A public or merely cross-module `commit_verified_authority_transition(tx, evidence, mutation)` is the wrong chokepoint shape. It relocates the assertion to whoever can obtain the evidence parameter. Evidence must never cross the module boundary.

## 2. Governing invariant

The LLP 0291 invariant remains the product invariant:

> For every additive feature closure, every externally reachable authority-increasing durable write or returned authority has exactly one kernel-minted witness bound to the same database, transaction or protected resolution cut, subject, authority class, purpose, durable predecessors, and durable time. Possession is verified unless the exact operation is explicitly bearer-free by policy.

This restates `llp/0291-authority-forgery-surface.research.md:411-438`.

The following corollaries are binding:

- Caller-selected IDs, digests, booleans, provenance, writer classes, profile values, and strings named “verified” are predicates or selectors, never evidence (`llp/0291-authority-forgery-surface.research.md:465-474`).
- A later durable write cannot trust an earlier in-memory admission. It must re-read the relevant durable rows and mint fresh evidence in its own committing transaction.
- A child or nested operation may inherit a powerless subject projection and fences, but it must enter the authority module for its own exact purpose and cannot widen the parent.
- Anonymous access is absence of credentials, not an authority class.
- `System`, `AdminBypass`, caller-selected `MembershipWriter`, generic `PreparedAuthority`, and public `ResolvedAppAuthority` do not exist in the final cross-crate vocabulary (`llp/0292-authority-straight-path.plan.md:212-241`).

## 3. `KernelVerifiedEvidence`

### 3.1 Privacy and construction

**Decision — INFERRED:** `KernelVerifiedEvidence` is a private struct in `snapback-kernel::storage::authority_transition`. It is not `pub`, `pub(crate)`, re-exported, or mentioned by any API outside that module. Its component types are private to the same module.

Its rules are:

- Exactly one syn-visible struct-literal mint site, inside the private verifier.
- No constructor method, including a private named constructor.
- No `Clone`, `Copy`, `Default`, `Serialize`, `Deserialize`, `From`, `TryFrom`, `FromStr`, `AsRef`, `AsMut`, or `Borrow`.
- No public or private `verified`, `authorized`, `valid`, or equivalent Boolean.
- No ordinary `Debug` containing evidence fields.
- No raw bearer, password, recovery code, verification code, administrator secret, or provider proof is retained in evidence.
- Evidence is neither `Send` nor `Sync`.
- Evidence is consumed by value exactly once and never returned, serialized, logged, cached, or reconstructed after commit uncertainty.

This takes the stronger privacy and single-mint mechanism from Codex (`choke-codex.md:106-150`) over Grok’s crate-private evidence parameter (`choke-grok.md:85-93`).

### 3.2 Exact fields

`KernelVerifiedEvidence` contains exactly these fields:

| Field | Contents and binding |
|---|---|
| `database` | Private `EvidenceDatabaseIdentity`: the open store’s process identity, canonical file-identity digest, and new authority-store format version. The active transaction must present the same identity. |
| `transaction_epoch` | Non-zero connection-local epoch allocated at transaction start. Rollover fails closed. A protected read transaction receives an epoch as well. |
| `single_use_nonce` | Kernel-random non-zero nonce registered as unconsumed on the active transaction. Consumption removes it atomically and creates the transaction-local write/admission permit. |
| `proof_kind` | Closed enum with exactly `Bearer`, `Password`, `RecoveryCode`, `DeliveryProof`, `StepUpProof`, `OperatorRestore`, `OperatorImport`, and `SealedInternalService`. |
| `subject` | Private, fully derived `VerifiedSubject`; exact variants are listed below. |
| `authority_class` | Private derived class: `Human`, `DelegatedService`, `AutonomousService`, `Operator`, `InternalWork`, or `NonProductionRehearsal`. There is no `System`, `Admin`, `Anonymous`, `Seed`, or `Import` class. |
| `purpose` | Closed `AuthorityPurpose` containing the exact operation and all target keys. |
| `predecessors` | Non-empty ordered set of durable row, durable absence, consumed-proof, active-configuration, work-claim, or owner-anchor witnesses. Empty predecessor sets are rejected. |
| `time` | `clock_domain`, persisted `durable_floor_ms`, `verified_at_ms`, and minimum applicable `not_after_ms`. Caller time may advance the floor but is not itself authoritative. |
| `write_set` | Exact protected tables, primary keys, columns, and transition kind the successor may change, or the exact in-memory prepared-operation kind when no durable write occurs. |
| `successor_digest` | Domain-separated digest over database identity, authority-store version, subject, class, purpose, target keys, derived scopes, writer, provenance, predecessor digest, write set, and time. |
| `_not_send_sync` | Private marker preventing movement to another thread or detached task before consumption. |

This selects Codex’s database, transaction, nonce, predecessor, time, write-set, successor-digest, and non-`Send`/`Sync` fields (`choke-codex.md:134-150`) and adds Grok’s store-version and explicit proof-kind binding (`choke-grok.md:61-65`). The additions are compatible and make stale-store and proof-class substitution explicit.

`VerifiedSubject` is a closed private enum:

- `ProspectiveHuman { principal_id }`
- `HumanSession { principal_id, session_id, authority_instance_id, session_generation }`
- `HumanCredential { principal_id, identity_id, credential_id, credential_generation }`
- `DelegatedService { actor_principal_id, effective_principal_id, credential_id, credential_generation, grant_id, token_id }`
- `AutonomousService { actor_principal_id, credential_id, credential_generation, grant_id, token_id }`
- `WatchOwner { owner_principal_id, watch_id, anchor_grant_id }`
- `Operator { anchor_id, anchor_generation, operator_audit_id }`
- `InternalWork { service_class, work_object, work_id, lease_generation }`

This follows the Codex subject inventory while deliberately omitting generic administrator and system variants (`choke-codex.md:159-173`).

### 3.3 Exact purposes

`AuthorityPurpose` is a private closed enum whose variants carry the exact target tuple:

- Resolve an exact function invocation.
- Issue or rotate a session.
- Attach, claim, deactivate, or promote an identity.
- Create, rotate, revoke, or replace a credential.
- Record an assurance.
- Provision a verified identity.
- Approve an exact grant.
- Mint or exchange an exact scoped token.
- Install or invalidate an exact scope basis.
- Write protected membership for one table/resource/transition.
- Create, renew, or execute one watch.
- Mint or consume one capability link.
- Exercise one bounded rehearsal operation.
- Create one callback principal or callback grant.
- Claim one internal-work object.
- Decide one pending effect.
- Perform one protected erasure.
- Restore one authority catalog from a named artifact digest.
- Import one identity catalog from a named artifact digest.

Every purpose has exactly one same-named private composite mutation variant. IDs and security facts live on evidence; mutation payloads contain only kernel-derived successor data and non-authority application payload. One evidence value is moved once into one composite mutation, even when the ceremony atomically changes several tables. This adopts Grok’s corrected one-to-one purpose/mutation rule (`choke-grok.md:41-45`) inside Codex’s private, intent-only outer ceremony.

Adding a purpose requires one change containing:

- The purpose and mutation variants.
- Allowed subject classes.
- Verifier predicates and durable-row map.
- Protected write set.
- Successor normalization.
- Feature/call-path census entries.
- Compile-fail witnesses, transaction tests, and review.

### 3.4 Why nothing else can mint it

The mechanism is custody, not naming:

1. All verifier implementations, the evidence literal, private mutation types, protected writers, and the transaction permit live under `storage::authority_transition`.
2. Writer submodules are descendants of `authority_transition` and expose only `pub(super)` operations to their parent. Grok’s review correctly rejected `pub(in crate::storage::authority_transition)` from a sibling module as illegal Rust (`choke-grok.md:35-45`).
3. Other kernel modules receive neither the evidence type nor a constructor, conversion, callback, verifier trait, random-source trait, or “already verified” carrier.
4. External crates cannot name evidence. Safe downstream code therefore cannot construct it or implement conversion/deserialization traits for it.
5. The only evidence literal is reached after the private verifier has loaded and checked the durable predecessors.
6. Its nonce and transaction epoch must match active transaction state. Fabricating the same field bytes is insufficient without the registered nonce.
7. Consumption produces a private transaction-local permit; evidence itself cannot be reused.
8. The runtime SQLite authorizer refuses protected SQL without the active permit.
9. In-memory successors carry a kernel admission identifier and are rechecked when consumed. Type opacity alone is not relied upon against unsafe fabrication.

The threat model and mechanical gate cover safe-Rust constructibility, not arbitrary native memory corruption or malicious `unsafe` code. Runtime nonce, database, generation, and predecessor checks limit reliance on opacity for the public prepared-operation carrier.

## 4. The chokepoint operation

### 4.1 Boundary

The sole durable entry is the private operation:

`commit_verified_authority_transition(&mut ServingDatabase, AuthorityTransitionIntent<'_>) -> SnapbackResult<AuthorityTransitionOutcome>`.

Both intent and outcome are closed. The operation is private to `authority_transition`; no caller passes a transaction, evidence, subject, writer, provenance, authority class, mutation, callback, or verification Boolean.

Lane-specific `ServingDatabase` façades may be visible cross-crate, but they accept only:

- A closed operation selector.
- Raw possession material at its real transport boundary.
- A cryptographic/provider artifact.
- An artifact or work identifier used only to look up durable state.
- Ordinary application payload that cannot select authority.

There is no generic trusted lane and no public evidence parameter. This adopts Codex’s outer signature and immediate intent-to-chokepoint flow (`choke-codex.md:221-247`).

### 4.2 Execution mechanism

For every intent, the authority module performs this sequence:

1. Perform expensive password, passkey, provider-signature, or artifact work under kernel custody outside the global writer. The result is a private snapshot-bound computation containing row digests and generations, not a Boolean.
2. Begin `BEGIN IMMEDIATE` for a durable transition, or a protected read transaction for an in-memory admission.
3. Allocate the transaction epoch, nonce, and durable time floor.
4. Match the closed intent and load every required subject, credential, proof, generation, scope, configuration, work, and anchor row.
5. Recheck all snapshot-bound computation in this transaction: identity, credential and proof generations, stored verifier digest, revocation, expiry, policy version, and operation binding.
6. Derive the subject, authority class, writer, provenance, exact scopes, successor, purpose, write set, and successor digest.
7. Enforce the subject-class/purpose matrix. In particular, a guest or prospective-human proof cannot authorize grants, watches, capability links, pending-effect approval, callback authority, membership administration, or operator work. This selects Grok’s explicit class gate (`choke-grok.md:69-73`).
8. Mint exactly one `KernelVerifiedEvidence` literal and register its nonce as unconsumed.
9. Consume evidence immediately. Compare database identity, authority-store version, transaction epoch, nonce, subject class, purpose/mutation discriminant, predecessors, time, write set, and successor digest.
10. Replace the nonce with a private `AuthorityWritePermit` or `AuthorityAdmissionPermit` scoped to this transaction.
11. Prepare and execute the complete protected write, or construct the exact `PreparedOperation<Kind>`. Protected statements cannot escape.
12. Commit. Evidence and permits are dropped on every outcome.
13. Return only a classified committed outcome, powerless audit receipt, raw secret generated by this committed ceremony, or exact prepared operation.
14. Handle uncertain commits by durable idempotency receipts or successor-row reconciliation. Evidence is never retained or reconstructed from an in-memory plan.
15. Reattach the existing session, service, room, connection, outbox, rollback, and ambiguity fences before publication. A chokepoint does not replace final exposure checks (`llp/0292-authority-straight-path.plan.md:163-174`).

### 4.3 In-memory authority

The public replacement for `ResolvedAppAuthority` and generic `PreparedAuthority` is `PreparedOperation<Kind>`:

- Publicly nameable only because engine/sync consumers need its type.
- All fields and constructors private.
- No `Clone`, `Default`, serde, conversions, or widening operation.
- Bound to database, exact operation and target, subject projection, authority class, predecessor digest, durable time, expiry, active policy generation, and all required publication fences.
- Consumable only by the exact operation handler for `Kind`.
- Never accepted as evidence for an authority-increasing durable write.

Creating `PreparedOperation<Kind>` is itself an authority transition and therefore happens only after evidence consumption. A later durable write may use it as a lookup selector, but must reload its durable predecessors and mint fresh evidence.

On the HTTP path, the operation crosses from policy middleware to its exact
handler inside a private request-local take-once slot. The slot is the only
cloneable extension value; every clone points to the same synchronized
`Option<PreparedOperation<Kind>>`. A custom extractor atomically takes the
operation and returns it by value. `PreparedOperation<Kind>` itself remains
non-`Clone`, and a second extraction fails closed. Section 10.3 records the
compiled shape and rejected alternatives.

Codex correctly identifies the need for an opaque admitted result (`choke-codex.md:268-293`); Grok correctly identifies that closing SQL without closing the in-memory constructor leaves the class open (`choke-grok.md:65-71`). LLP 0292 is stronger than either carrier proposal: the generic legacy authority enums disappear outright (`llp/0292-authority-straight-path.plan.md:212-241`).

## 5. Forcing every authority write through the operation

### 5.1 Protected-object registry

A generated `AuthorityObjectRegistry` contains, at minimum:

- `_auth_users`
- `_auth_identities`
- `_auth_sessions`
- `_auth_session_tokens`
- `_auth_credentials`
- `_auth_password_credentials`
- `_auth_passkey_credentials`
- `_auth_recovery_code_sets`
- `_auth_recovery_codes`
- `_auth_verification_codes`
- `_auth_password_attempts`
- `_auth_assurances`
- `_auth_provisioning_receipts`
- `_auth_agent_credentials`
- `_auth_grants`
- `_auth_grant_tokens`
- `_auth_agent_invitations`
- `_auth_pairing_requests`
- `_auth_scope_bases`
- Integration and pairing authority rows.
- Watch owner and anchor authority rows.
- Capability-link lineage.
- Callback principals and grants.
- Rehearsal grants, windows, challenges, counters, and authority provenance.
- Protected membership columns declared by the active schema.
- Authorized-lease reservations.
- Internal work rows whose claim creates authority.
- Pending-effect authority and decision columns.
- Restore/import receipts, authority clocks, and the administrator-anchor row.

The LLP 0291 minimum is authoritative and explicitly includes sessions, credentials, grants, watches, rehearsal, capability links, and authorized leases (`llp/0291-authority-forgery-surface.research.md:440-463`). The registry is derived from catalog declarations and active schema, not a hand-maintained SQL-string allowlist, following Codex (`choke-codex.md:295-325`).

All mutations of protected objects—not merely those classified in advance as increasing—use the subsystem. A nominal revocation can also replace provenance, generation, owner, or scope; protecting all mutations avoids a classification bypass (`choke-codex.md:327-335`).

### 5.2 Three enforcement layers

| Layer | Requirement | What it contributes |
|---|---|---|
| Lexical custody | Protected writer SQL and typed writers live only under nested `authority_transition/**` modules. Raw connection access and `auth_database_mut` disappear. Production `test-support` cannot expose protected mutation. | Rust privacy prevents safe callers from invoking protected writers directly. |
| Runtime custody | The SQLite authorizer denies protected insert, update, delete, replacement, trigger, schema, and attached-database operations without the active transaction permit and matching write set. Protected statements are prepared only after the permit opens. | A missed direct writer inside the kernel fails closed at runtime. |
| Authority-surface custody | Public writers, all-field plans, privileged membership variants, closure factories, generation publishers, callback-principal constructors, generic `System`, and in-memory authority constructors are deleted. HTTP may carry only a private take-once slot whose clones share one cell; the operation itself remains move-only. | Prevents authority from being created without protected SQL or from being created entirely in memory, while allowing one exact request consumer to receive an admitted operation. |

Grok is correct that a syn SQL scanner alone is a ratchet, not force (`choke-grok.md:61-67`). Codex supplies the stronger runtime mechanism through a protected registry and SQLite authorizer (`choke-codex.md:295-340`). The synthesis uses Grok’s claim discipline and Codex’s fail-closed runtime enforcement.

The authorizer must be tested against:

- Statements prepared before permit entry.
- Statement caches.
- Trigger bodies.
- `INSERT OR REPLACE` and `INSERT OR IGNORE`.
- Dynamic and schema-qualified names.
- Attached databases.
- Dynamic protected membership tables.
- Rollback, commit uncertainty, and nested helper calls.

Whether current `rusqlite` borrowing and authorizer APIs permit this exact implementation remains OPEN; see §10.

### 5.3 Required surface deletion

Phase 2 deletes, rather than wraps:

- `ResolvedAppAuthority`
- Generic `PreparedAuthority`
- `System`
- `AdminBypass`
- Public or feature-public raw auth database access.
- Public session, grant, token, watch, capability-link, callback, rehearsal, import, and membership fact-plan constructors.
- Caller-selected `requires_step_up`.
- Public `MembershipWriter::{Admin, Seed, Import}` and equivalent provenance selectors.
- Public generation/policy publishers.
- Public `admit_*_push` claim roots.
- Public verification-result Booleans.
- Public closure or callback factories that select terminal outcomes.
- Feature-enabled production fixture writers.

This follows LLP 0292’s flag-day deletion (`llp/0292-authority-straight-path.plan.md:296-320`) and Grok’s weaker-root findings (`choke-grok.md:25-32`, `choke-grok.md:73-79`).

## 6. Legitimate minting lanes

### 6.1 Bearer

**Presented material:** Raw session bearer or scoped-service bearer plus an exact requested operation.

**Protected read or transaction:**

- Pure invocation admission uses a protected read transaction.
- Authenticated-use extension or any authority-increasing successor uses its own `BEGIN IMMEDIATE` transaction and fresh evidence.

**Durable rows verified:**

- Human bearer: `_auth_session_tokens`, `_auth_sessions`, `_auth_users`, applicable `_auth_identities` and credential state, current session generation, authority-instance identity, persisted clock floor, active function and `_auth_scope_bases`.
- Scoped-service bearer: `_auth_grant_tokens`, `_auth_grants`, `_auth_agent_credentials`, actor and effective `_auth_users`, exact scope bases, integration state, credential/grant/token generations.

The kernel hashes the raw bearer, verifies token family, generation, revocation, sender binding where applicable, idle and absolute expiry, principal liveness, exact function kind, and scope basis. A digest or durable ID tuple is not a bearer.

This follows Codex’s bearer lane (`choke-codex.md:361-377`) and closes LLP 0291’s bearer-free retained-service path.

### 6.2 Password

**Presented material:** Canonical identity candidate and password bytes.

**Outside-writer computation:** Read a bounded snapshot and perform Argon2id in kernel-owned code. The private result binds the identity, credential, PHC digest, generations, and policy version; it is not `verified: bool`.

**Committing transaction:** `BEGIN IMMEDIATE`.

**Durable rows verified:**

- `_auth_identities`
- `_auth_users`
- `_auth_credentials`
- `_auth_password_credentials`
- `_auth_password_attempts`
- Current credential policy/catalog version.
- Persisted clock floor and relevant session-cap state.

Inside the transaction the kernel rechecks the mapping, credential ID and generation, PHC digest, liveness, lockout state, principal state, and policy. Attempt accounting, session/token creation, assurance, recovery consequences, revocations, journal, and provisioning effects commit atomically.

This preserves the required outside-compute/inside-recheck mechanism (`choke-codex.md:379-394`).

### 6.3 Recovery code

**Presented material:** Identity candidate and plaintext recovery code.

**Committing transaction:** `BEGIN IMMEDIATE`; no reusable preverified carrier crosses into it.

**Durable rows verified:**

- `_auth_credentials`
- `_auth_recovery_code_sets`
- `_auth_recovery_codes`
- `_auth_identities`
- `_auth_users`
- Affected `_auth_sessions` and persisted clock state.

The kernel verifies the keyed digest, active set generation, exact unconsumed ordinal, replacement state, credential liveness, identity ownership, principal state, and recovery policy. It consumes the code, replaces the set, applies required session revocations, issues the new session/assurance, advances time, and journals atomically (`choke-codex.md:396-408`).

### 6.4 Delivery proof

**Presented material:** Challenge ID plus submitted code or provider proof. A caller-supplied address, event ID, adapter name, or `delivered` Boolean is not proof.

**Committing transaction:** The identity transition uses `BEGIN IMMEDIATE`.

**Durable rows verified:**

- `_auth_verification_codes`
- Canonical `_auth_identities` and `_auth_users`
- Active delivery-adapter installation and deployment generation.
- Key ID, attempts, expiry, and consumption state.
- A durable, single-use delivery-handoff receipt bound to challenge, canonical address, adapter installation, provider event, and deployment generation.

The verifier confirms the stored proof digest and that the receipt came through the exact active `contact-ownership` adapter, not capture or simulation. It consumes the challenge and handoff receipt and atomically commits identity linkage, assurance, session consequences, provisioning receipt, permission advancement, and journal (`choke-codex.md:410-423`).

**OPEN:** The present sources do not establish whether an unconstructable adapter handoff lease can cross the current crate graph. Codex explicitly leaves private lease versus cryptographically authenticated durable receipt unresolved (`choke-codex.md:423-425`). Phase 2 must compile one of those mechanisms. A public receipt constructor or delivery Boolean is forbidden.

### 6.5 Step-up proof

**Presented material:** Pending-operation ID, challenge ID, and submitted verification code.

**Committing transaction:** The same `BEGIN IMMEDIATE` transaction consumes the proof and applies the exact target transition.

**Durable rows verified:**

- `_auth_verification_codes`
- Exact `_auth_sessions` row, generation, and authority-instance ID.
- The exact grant request, protected mutation request, or `_snapback_pending_effects` row.
- Operation digest, required approver, and requested authority delta.
- Applicable grant, policy, and clock rows.

The kernel re-derives whether step-up is required; the caller never supplies `requires_step_up`. It verifies the code digest, key, attempts, expiry, unconsumed state, approver identity, session binding, and operation digest. `StepUpProof` is a proof kind, not a reusable purpose or authority class (`choke-codex.md:427-440`; `choke-grok.md:41-45`).

### 6.6 Operator restore/import

**Presented material:** Exact operation ID, artifact, and raw administrator secret. No caller-supplied anchor digest or `OwnerAnchor` value is accepted.

**Anchor mechanism — INFERRED:**

A new-format store is not serveable until explicit administrator-anchor provisioning succeeds under the instance lock. Provisioning creates:

- One database anchor row containing database-identity digest, anchor ID, generation, verifier parameters/digest, and creation time.
- One owner-only durable sidecar containing the matching database identity, anchor ID/generation, and private verifier root material.
- An initial audit receipt.

The caller presents the raw secret. The kernel derives the open database identity, loads both durable members itself, verifies their exact pair, hashes/verifies the raw secret, and binds the exact operation/artifact digest. It never accepts an expected digest at open or derives an anchor from legacy state.

Evidence contains:

- `proof_kind = OperatorRestore` or `OperatorImport`
- `subject = Operator { anchor_id, anchor_generation, operator_audit_id }`
- Exact restore/import purpose and artifact digest.
- `OwnerTrustAnchor` predecessor containing database identity, anchor-row digest, generation, sidecar binding digest, and operation digest.
- Current catalog generation, target-policy generation, and durable time.

**Import transaction:** `BEGIN IMMEDIATE` on the target store. Verify anchor, artifact digest and format, import receipt/absence, identity uniqueness, admissible assurances, target policy, and current catalog generation. Imported live sessions, grants, tokens, recovery codes, rehearsal authority, and continuation state are rejected. Catalog changes, authority retirement, clock advancement, receipt, and audit commit together (`choke-codex.md:442-457`).

**Restore transaction:** Restore builds or opens a staged new-format target under kernel-owned directory custody. The anchor and admissible catalog are installed in a transaction bound to the staged database identity. Live imported authority is discarded, the clock is advanced, and a receipt is committed before the instance-lock-controlled swap. The restored store is never served under the predecessor anchor by implication.

This expresses ruling 7 directly: the anchor is a verified durable predecessor in evidence, not an administrator Boolean or caller digest. Missing or mismatched anchor state fails closed.

**OPEN:** The exact KDF/MAC encoding, sidecar schema, and physical-swap recovery protocol are not settled by either source. Centralizing the chokepoint does not create a trust anchor (`choke-codex.md:811-823`). Those details require a focused anchor/storage specification and compile/fault-injection proof.

### 6.7 Sealed internal service

There is no generic `System` acquisition. Two forms are legitimate:

1. **Durable work claim.** In `BEGIN IMMEDIATE`, load and compare-and-swap the exact work row, lease generation, function/action, active scope basis, expiry, and retained authority predecessors.
2. **Closed kernel operation.** The kernel discovers the full work set internally and returns no reusable application authority.

Durable cases include:

- Jobs: `_snapback_jobs_v1`, using the exact `current_claim_id`, fence, claim expiry, action, and active generation.
- Pending effects: `_snapback_pending_effects` plus exact approver, operation digest, retained credential/grant/token predecessors, and decision state.
- Watches: exact watch row, owner, anchor grant, installation grant, `_auth_scope_bases`, function generation, expiry, and claim.
- Capability execution: exact capability-link row, minter session generation, authority instance, function/basis, use policy, and expiry.
- Asset callbacks: exact asset work ledger plus callback principal/grant and active deployment scope.
- Retained service work: `_auth_agent_credentials`, `_auth_grants`, `_auth_grant_tokens`, actor/effective principal rows, and exact work predecessor.
- Rehearsal, if retained: exact rehearsal grant, carrier digest, instance/app/boot binding, activation digest, window, counters, expiry, and non-production markers. It uses `SealedInternalService` or an exact operator ceremony, not a ninth general evidence lane.
- Startup reconciliation: a closed operation over kernel-discovered rows; it cannot return reusable invocation authority.

Codex supplies the durable-work/closed-operation distinction (`choke-codex.md:459-470`). Grok supplies the stronger live-tree correction for cron: `_snapback_jobs_v1` is a job row, while cron is held by `LocalCronRuntime`; no truthful `CronWorkClaim` exists today (`choke-grok.md:47-49`, `choke-grok.md:79`).

**OPEN and publication-blocking:** Cron must either gain a real durable due/claim predecessor or move into a closed kernel operation that derives the due entry internally from sealed runtime state and active deployment. Until that mechanism is compiled and generic cron `System` is gone, cron is not a legitimate minting lane.

## 7. Standing rulings

### 7.1 Ruling 6: `config.verify`

`config.verify` is outside the authority-transition evidence lanes. It is an exact, powerless probe operation and cannot mint `KernelVerifiedEvidence`, `System`, an application principal, or an internal-service claim.

Its permit may:

- Read one named config entry and exact revision.
- Use its secret only through the declared probe adapter.
- Contact only the manifest-declared target/origin.
- Return a bounded result.
- Update only that entry’s verification state after rechecking the revision.

It cannot read or write application or AuthorityFacts tables, invoke arbitrary functions, enqueue work, alter membership/auth/config values, or create a reusable principal (`llp/0292-authority-straight-path.plan.md:452-479`).

Administrator-route authentication hashes/verifies the presented administrator secret directly. It must not wrap an existing `Result<(), Error>` as a claim or “verified” value, as Grok’s review warns (`choke-grok.md:37-49`).

### 7.2 Ruling 7: mandatory administrator anchor

Ruling 7 is expressed as the `OwnerTrustAnchor` predecessor of operator evidence.

The consequences are exact:

- New file-backed stores require explicit anchor provisioning before serving.
- No automatic derivation from an environment value or legacy token file.
- No grace period.
- No caller-supplied digest at open.
- No ordinary admin authentication result converted into `Operator`.
- Restore, import, protected erasure, rotation, and similar operator operations authorize only their exact registered purpose.
- Fork creates a new anchor.
- Disaster restore creates a new anchor and retires predecessor live authority.
- Missing, mismatched, or stale anchor generation fails closed.

These requirements follow the author ruling (`llp/0285-kernel-authorization-closure.spec.md:153-160`) and LLP 0292’s required-pair posture (`llp/0292-authority-straight-path.plan.md:481-507`).

## 8. Mechanical gate and residual

### 8.1 What the LLP 0284 suite can check

The pinned mechanism is syn-parsed Rust, `cargo metadata`, and `rustc --message-format=json` span assertions. Rustdoc JSON is unavailable on Rust 1.97.0 and a nightly override is forbidden (`llp/0284-workspace-security-gate-threat-model.spec.md:102-110`).

Within syn-visible source, the gate can ratchet:

- `KernelVerifiedEvidence` and its component types are module-private.
- Every field has private visibility and the exact declared shape.
- There is exactly one visible struct-literal mint site.
- Forbidden derives and explicit impls are absent.
- No public constructor, factory, conversion, deserializer, authority Boolean, or evidence-bearing callback exists.
- Evidence, private intents, private mutations, and permits do not occur in public signatures.
- `ResolvedAppAuthority`, `System`, `AdminBypass`, generic `PreparedAuthority`, privileged membership variants, public writer/provenance discriminators, and named claim roots are absent.
- Public `PreparedOperation<Kind>` fields are private and forbidden construction traits are absent.
- Protected SQL literals and typed writers occur only beneath `authority_transition`, and every catalog-declared protected object appears in the registry.
- No public raw connection or feature-enabled protected writer exists.
- Every purpose has one matching mutation, verifier registration, row-map entry, and subject-class rule.
- `cargo metadata` covers every reachable workspace package and additive feature cell.
- Hostile dependent-crate fixtures fail at the marked attack span when attempting construction, cloning, conversion, deserialization, `System`, membership administration, raw protected SQL access, feature-enabled test access, or direct writer invocation.

### 8.2 What it cannot prove

**VERIFIED:** Syn does not expand all macros, build a complete cross-crate symbol graph, perform generic substitution, inspect body flow, or detect arbitrary helper indirection and renamed sinks (`llp/0284-workspace-security-gate-threat-model.spec.md:598-626`, `llp/0284-workspace-security-gate-threat-model.spec.md:648-719`). LLP 0284 explicitly states that its direct-signature discriminator check does not prove that caller-constructible data never selects privilege (`llp/0284-workspace-security-gate-threat-model.spec.md:748-770`).

Therefore LLP 0291’s description of its full invariant as “gate-checkable” is too strong (`llp/0291-authority-forgery-surface.research.md:411-438`).

The precise unprovable part is the semantic witness-to-successor correspondence:

- For every real or dynamically generated AuthorityFacts write, that an evidence value existed.
- That evidence was minted only after every necessary predicate succeeded.
- `database(e) = database(w)`.
- `transaction(e) = transaction(w)`.
- `subject(e) = effective_subject(w)`.
- `authority_class(e) = authority_class(w or returned operation)`.
- `purpose(e) = purpose(w)`.
- `predecessors(e)` is the complete policy-required predecessor set.
- Possession proof was actually verified.
- Verification preceded the write.
- The successor and write set equal the evidence digest.
- Runtime authorizer behavior covers every preparation, trigger, cache, attachment, and dynamic-SQL edge.

No combination of syn, metadata, and rustc diagnostic spans proves those body-level and runtime statements.

### 8.3 Documented residual

The residual is:

> The gate proves structural unconstructability, API confinement, feature closure, and syntactically visible writer location. It does not prove the completeness or semantic sufficiency of verifier predicates, nor evidence-to-write correspondence.

It is carried by:

1. The frozen 46-family ledger, including every feature predicate, entry point, returned in-memory authority, table/column, current writer, and replacement purpose.
2. A per-purpose verification map naming every presented input, durable query, absence check, generation, subject-class rule, predecessor, successor field, writer, and publication fence.
3. Same-transaction assertions that deliberately race revocation, expiry, generation change, anchor rotation, and policy activation.
4. Runtime authorizer bypass tests for every protected object and SQL form.
5. Replay, rollback, clock regression, and ambiguous-commit fault injection for every lane.
6. Independent review of every ledger row against the exact integrated SQL and exact purpose/mutation code.
7. A qualification digest binding the ledger, gate output, tests, and reviewed integrated commit.

This avoids LLP 0283 F-2’s error of turning a syntactic count into a closure claim (`llp/0283-post-rearchitecture-followups.plan.md:173-202`).

## 9. Source disagreements and selections

The table covers every substantive divergence observable in the checked-in source files. `choke-grok.md` is a reviewed summary and transcript, not the underlying design it links from a temporary path (`choke-grok.md:49-55`); no claim from that unavailable artifact is treated as verified.

| Divergence | Codex source | Grok source | Selection and reason |
|---|---|---|---|
| Evidence visibility and entry signature | Completely private evidence; outer operation accepts only private intent and has no evidence parameter (`choke-codex.md:108-115`, `choke-codex.md:221-247`). | Crate-private commit accepts transaction, evidence, and mutation (`choke-grok.md:85-93`). | **Codex.** Module-private custody is stronger and prevents a kernel sibling from becoming a new evidence supplier. |
| One versus two chokepoints | One operation can return opaque admitted authority (`choke-codex.md:268-293`). | Explicitly requires durable and in-memory constructor chokepoints (`choke-grok.md:65-71`). | **Grok’s coverage, LLP 0292’s shape.** One owner handles both result forms, but in-memory construction is separately enforced. Generic legacy carrier types are rejected. |
| In-memory carrier | Public opaque `AdmittedAuthority`; sync preparation becomes private (`choke-codex.md:268-293`). | Kernel opaque claims feed sync preparation; summary permits sync-private `ResolvedAppAuthority` and calls the DAG uncompiled (`choke-grok.md:25-32`). | **Neither carrier unchanged.** Use exact `PreparedOperation<Kind>` and delete `ResolvedAppAuthority` entirely, as LLP 0292 requires. |
| Evidence field set | Database identity, transaction epoch, nonce, lane, subject, purpose, predecessors, time, write set, successor digest, non-send marker (`choke-codex.md:134-150`). | Summary names database, predecessor, subject, purpose, clock floor, store version, and proof kind (`choke-grok.md:61-65`). | **Codex base plus Grok’s compatible store-version/proof-kind additions.** Codex is stronger on transaction and successor binding. |
| Outer intent versus mutation parameter | Caller supplies private intent; kernel derives the transition (`choke-codex.md:225-264`). | Internal commit uses a purpose×mutation one-to-one composite (`choke-grok.md:41-45`, `choke-grok.md:85-93`). | **Codex at the boundary; Grok internally.** Mutation never crosses the module boundary, but one-to-one composite variants prevent partial multi-write ambiguity. |
| SQL scanner as force | Requires protected-object registry and SQLite authorizer (`choke-codex.md:295-340`). | Says lexical SQL scanning is only a ratchet and force comes from public-writer plus in-memory-constructor cuts (`choke-grok.md:61-67`). | **Both at distinct layers.** Grok is right about proof claims; Codex’s runtime authorizer is retained as fail-closed enforcement. |
| Module layout | Says writers move beneath the authority module but does not settle exact Rust visibility (`choke-codex.md:110-114`). | Corrects illegal sibling `pub(in ...)` to nested modules using `pub(super)` (`choke-grok.md:35-45`). | **Grok.** It is the only source that addresses the legal Rust privacy shape. |
| Scope of runtime protection | Protects all mutations of authority objects, including apparent revocation (`choke-codex.md:327-335`). | Focuses on closing authority-increasing facts through the Layer B/C cuts. | **Codex.** Protecting all mutations prevents reclassification attacks through “decreasing” writers. |
| Rehearsal | Defines a separate ninth evidence lane (`choke-codex.md:472-484`). | Defaults to sealing rehearsal under operator/non-production authority (`choke-grok.md:137-143`). | **Grok.** The mandated eight proof kinds remain closed; rehearsal uses exact operator or sealed-internal evidence. |
| Guest/prospective-human constraints | Encodes a prospective-human subject but does not state every forbidden widening (`choke-codex.md:159-173`). | Requires explicit class and budget gates; guest bearer cannot grant, watch, link, or approve effects (`choke-grok.md:69-73`). | **Grok.** Purpose binding alone is insufficient if a weak subject class may select a strong purpose. |
| Pending effects and protected erasure | Covered generally as work/operator operations but absent from Codex’s purpose list. | Makes both explicit closure work and forbids a public `OwnerAnchor` (`choke-grok.md:25-32`, `choke-grok.md:73-79`). | **Grok.** Both become named purposes and cannot remain implicit families. |
| `config.verify` | Recommends a powerless `ConfigProbe` but, before the ruling, retains a compatibility alternative (`choke-codex.md:796-809`). | Requires hashing the presented administrator secret and never minting `System` (`choke-grok.md:73-79`). | **Grok, resolved by ruling 6.** The compatibility alternative is obsolete. |
| Cron | Treats internal services generically as durable claims or closed operations (`choke-codex.md:459-470`). | Verifies that cron has no job-row predecessor and rejects a fictional `CronWorkClaim`; remaining `System` is a publication blocker (`choke-grok.md:47-49`, `choke-grok.md:79`). | **Grok.** It is grounded in the live ownership distinction and does not invent durable evidence. |
| Administrator anchor | Requires a database-bound owner anchor but leaves sidecar/keychain/catalog placement to an author ruling (`choke-codex.md:811-823`). | Defaults to hashing the presented admin secret, using owner-only custody, and exposing no `OwnerAnchor` (`choke-grok.md:73-79`, `choke-grok.md:137-143`). | **Partially resolved.** Ruling 7 selects mandatory explicit provisioning and no digest fallback. The exact cryptographic and sidecar format remains OPEN rather than invented as verified fact. |
| `Deref`/raw database compatibility | Deletes `auth_database_mut` and the wide privileged database surface (`choke-codex.md:295-340`). | Defaults to demoting leaking methods first and retaining `Deref` unless later proved necessary (`choke-grok.md:137-143`). | **Codex/LLP 0292.** With no stability obligation, remove `DerefMut`; retain read-only `Deref` only if the gate proves its entire reachable surface powerless. |
| Migration shape | Ten staged family waves, a shrinking legacy ledger, and 15–25 landings (`choke-codex.md:522-670`, `choke-codex.md:735-747`). | Thirteen PRs with atomic table-family cuts and no synthesized-evidence intermediate (`choke-grok.md:111-131`). | **Neither schedule.** LLP 0292’s accepted flag-day deletion controls. Grok’s atomic “SQL move + public cut + fixture” rule is retained inside phases 2–3, but no legacy/native path survives. |
| Cost estimate | 20–40 engineering days (`choke-codex.md:735-747`). | Three to six weeks (`choke-grok.md:131-133`). | **No selection.** Both are unmeasured and irrelevant to mechanism acceptance. |
| Compilation confidence | Lists unresolved borrow, authorizer, async movement, delivery, and reconciliation questions (`choke-codex.md:781-794`). | Explicitly says the chosen DAG and entire design were not compiled (`choke-grok.md:31`, `choke-grok.md:55`). | **Agreement, not closure.** All such claims remain OPEN until compiled. |

Two source statements are plainly unusable as final authority:

- Codex’s staged legacy migration conflicts with the later accepted delete-and-rebuild direction.
- Grok’s crate-private evidence parameter and possible retained `ResolvedAppAuthority` are weaker than LLP 0292’s required end state.

The chokepoint concept is correct only with custody of verification, evidence, durable writes, and returned in-memory authority. A public evidence-consuming function by itself would be the same failed design moved one API earlier.

## 10a. Prototype results (2026-08-20) — all nine now answered

A throwaway compiled prototype was built to answer §10 rather than leave it as inherited
debt (LLP 0285 §8 risk 7). Evidence: `prototypes/authority-chokepoint/EVIDENCE.md`.

| § | Question | Result |
| --- | --- | --- |
| 10.1 | Borrow coexistence | **YES**, but only in one shape |
| 10.2 | Authorizer mutability during a transaction | **YES** |
| 10.3 | Movement without `Clone` | **SOLVED** — take-once request slot; see the §10.3 design |
| 10.4 | Crate DAG | **YES** |
| 10.5 | Delivery handoff | **YES** — authenticated durable receipt |
| 10.6 | Cron as a closed operation | **YES** — durable due/claim row with generation CAS |
| 10.7 | Administrator anchor | **ANSWERED** — see Appendix A |
| 10.8 | Commit-uncertainty reconciliation | **YES**, structurally |
| 10.9 | Inherent-impl hosting | **YES** |

**§10.3 blocked implementation and is now solved.** A move-only operation compiles in a `Send` async future and a
detached thread, but the current HTTP extension carrier does not:

```text
error[E0277]: the trait bound `PreparedOperation<QueryKind>: Clone` is not satisfied
  note: Extensions::insert requires T: Clone + Send + Sync + 'static
```

The design must replace that carrier with move-once extraction or another single-owner
handoff. **Adding `Clone` is not viable** — it is the capability-duplication the whole design
exists to prevent, and the prototype correctly refused to add it to make the code compile.

Two further results are worth carrying into implementation:

- **§10.1** compiles only when `Connection` is split from a connection-local
  `Arc<Mutex<PermitState>>`. The naive owner reborrow fails conclusively:
  `error[E0499]: cannot borrow *store as mutable more than once at a time`.
- **§10.9** confirms §9's selection of grok's nested `pub(super)` layout was correct, and that
  the rejected sibling spelling is genuinely illegal:
  `error[E0742]: visibilities can only be restricted to ancestor modules`.

§10.7 is now specified in **Appendix A**. **All nine §10 questions are answered**, and no
author ruling remains open on this spec.

The original question list follows.

## 10. Open implementation questions

Neither source design was originally compiled; LLP 0285 records that debt explicitly (`llp/0285-kernel-authorization-closure.spec.md:595-598`). The prior compiler prototype and the focused §10.3 prototype now resolve eight of these nine questions structurally. The administrator-anchor protocol in question 7 remains open. Compiler success establishes viability, not semantic correctness.

1. Whether `rusqlite::Transaction`, a permanently installed authorizer, transaction epoch/nonce state, dynamic membership schema, and protected statements can coexist without conflicting borrows.
2. Whether authorizer state may safely change while a transaction exists; if not, whether a dedicated connection-local permit cell or a different protected-writer arrangement preserves atomicity.
3. **RESOLVED YES, with a private take-once request slot.** The operation remains non-`Clone`; only an `Arc<Mutex<Option<T>>>` slot is cloneable, and all slot clones share the same single value. A custom Axum extractor takes the value once and returns it by value. The exact middleware → `Next::run(Request<Body>)` → handler extractor → detached `Send + 'static` task path compiles and passes. A second take returns a closed error. See §10.3 and `prototypes/authority-chokepoint/http-handoff/`.
4. Whether the kernel can own password/provider computation without reversing the crate DAG.
5. Whether delivery handoff uses a private move-only lease or a cryptographically authenticated durable receipt.
6. Whether cron can be represented as a closed kernel operation over sealed runtime state or requires a new durable due/claim row.
7. The exact administrator-anchor KDF/MAC, sidecar format, rotation protocol, and staged physical-restore recovery behavior.
8. Whether commit-uncertainty reconciliation can return generated secrets without retaining evidence or an authority-bearing plan.
9. Whether the authority module can host every required inherent implementation without violating crate ownership or reopening sibling visibility. Rust’s inherent-impl rule is a known architectural constraint (`llp/0283-post-rearchitecture-followups.plan.md:270-277`).

A prototype must resolve these with `cargo check --all-targets --workspace` before implementation proceeds beyond the authority core. A compiler success would establish structural viability, not semantic correctness.

### 10.3 Resolution: private take-once HTTP handoff

The real insertion site is
`crates/snapback-server/src/server.rs:14022-14041`, inside
`enforce_registered_route_policy_inner`. That middleware performs asynchronous
credential and policy work, prepares the current authority carrier, inserts
request-local values, and then calls `next.run(request).await`. The downstream
handlers use Axum extractors. Axum 0.8.9's `Next::run` accepts only
`Request<Body>`, `http::Extensions::insert` requires the inserted type to be
`Clone + Send + Sync + 'static`, and Axum's general `Extension<T>` extractor
clones `T`.

The selected transport is:

```rust
struct TakeOnce<T> {
    inner: Arc<Mutex<Option<T>>>,
}

impl<T> Clone for TakeOnce<T> {
    fn clone(&self) -> Self {
        Self { inner: Arc::clone(&self.inner) }
    }
}

impl<T> TakeOnce<T> {
    fn take(&self) -> Result<T, TakeOnceError> {
        let mut slot = self.inner.lock().map_err(|_| TakeOnceError::Poisoned)?;
        slot.take().ok_or(TakeOnceError::AlreadyTaken)
    }
}
```

The real carrier and extractor must be private to the common server module that
owns the policy middleware and exact handler. Its constructor, cell, and
`take` method are not public API. It exposes no `Deref`, reference-returning
getter, replacement method, conversion, or serialization. The custom
`FromRequestParts` implementation obtains `&TakeOnce<_>` through
`Extensions::get`, atomically takes the operation, and returns the move-only
`PreparedOperation<Kind>` itself. The handler never receives a cloneable slot.
The slot accepts only an already kernel-prepared value; it has no callback,
factory, default/empty public constructor, or path that can mint or reconstruct
an operation.

The `Clone` implementation duplicates only an `Arc` to one state machine. It
does not clone `T`; its trait bounds require `T: Send + 'static`, not
`T: Clone` or `T: Sync`. Competing extractors can cause denial by taking first,
but cannot produce two operations. Privacy confines even that take capability
to the designated server module. Request cancellation drops an untaken
operation with the request instead of leaving it in a process-wide registry.

Every unavailable state fails closed:

- First take moves the only `PreparedOperation<Kind>` out of `Some` and leaves
  `None` under the same mutex.
- A sequential or concurrent second take returns `AlreadyTaken`; it never
  returns `None` as an ordinary anonymous/public path and never reconstructs an
  operation.
- A missing slot and a poisoned mutex return the same class of internal
  refusal. Poison is not recovered by taking the guarded value.
- If extraction succeeds but later async work is cancelled, ordinary Rust drop
  semantics destroy the owned operation; it is not put back or replayed.

The focused prototype uses the repository's actual Axum 0.8.9 and `http` 1.5.0
types. `cargo check --all-targets` succeeds, and five tests pass. The end-to-end
test crosses real Axum middleware and `Next`, extracts once, moves the
operation into `tokio::spawn`, and has the middleware attempt a second take
after the handler. Dedicated tests prove sequential and concurrent second-take
failure. Exact output and negative compiler diagnostics are retained in
`prototypes/authority-chokepoint/EVIDENCE.md`.

Alternatives were considered as follows:

| Shape | Compiles? | Preserves one operation? | Disposition |
|---|---|---|---|
| Private `Arc<Mutex<Option<T>>>` request slot plus custom extractor | Yes; full Axum path and detached task pass. | Yes; atomic `Option::take`, with closed missing/taken/poisoned errors. | **Selected.** It matches the existing middleware/handler cut and request lifetime. |
| Kernel-side typed registry keyed by opaque powerless ID | Yes; insert/remove and second-remove tests pass. | Yes, if removal is atomic and the lookup API is confined. | Rejected here. It adds a process-lived claim registry, cancellation cleanup, ID binding, expiry, and leak/DoS obligations when the request already provides the right lifetime owner. It remains a possible fallback only if a future path truly outlives the request. |
| Pass the operation directly through the handler's own call path | Yes when one async function prepares and directly calls the exact handler. | Yes; ordinary Rust move semantics suffice. | Rejected for the current HTTP topology. The central policy middleware and routed handler are separated by `Next`; `Next::run(request, operation)` fails with E0061. Co-locating preparation and handlers would rewrite the registered policy/precedence flow rather than solve this carrier seam. |
| Framework request-scoped owner outside extensions | No compatible owner is already threaded. `Next::run` accepts exactly `Request<Body>`; wrapping the body with an operation fails with E0308. Direct operation insertion still fails with E0277. | Not applicable on the current `Next` boundary. | The request's extension map is Axum's request-local typed owner. The selected private slot uses that owner without making the operation cloneable. |

This resolution does not change §4's authority operation, evidence binding, or
one-use semantics; it adds only the HTTP transport detail to §4.3. It does not
change §5's forcing model. The §5 clarification says that the private slot is
the sole safe clone exception at this seam and that neither the operation nor
any authority constructor becomes cloneable or public.

## 11. Acceptance criteria for LLP 0292 phases 2–3

The mechanism is ready to build from only when:

1. The exact evidence shape and privacy rules in §3 are accepted.
2. The authority-purpose, subject-class, predecessor, mutation, and protected-write registry covers all 46 LLP 0291 families.
3. Every public authority writer, generic authority constructor, `System` acquisition, privileged membership discriminator, raw database seam, and production feature fixture is assigned to deletion.
4. Every durable AuthorityFacts mutation is lexically confined and runtime-refused without an active matching permit.
5. Every returned principal or prepared operation is created by evidence consumption and cannot authorize a later durable transition without fresh transactional revalidation.
6. All eight legitimate proof lanes have reviewed durable-row maps.
7. Delivery, cron, administrator-anchor, authorizer/borrow, and async-movement questions are resolved by compiled prototypes.
8. `config.verify` remains a powerless probe and cannot reach the authority-transition operation.
9. The administrator anchor is mandatory from store creation, with no derivation, grace period, or digest-at-open path.
10. The gate reports only the structural claims in §8.1 and carries the semantic residual in §8.3 without claiming the full LLP 0291 formula is mechanically proved.
11. Existing session, service, room, connection, outbox, rollback, ambiguity, and final-publication fence tests remain authoritative.
12. The exact integrated mechanism passes independent review, transaction races, authorizer bypass tests, commit fault injection, all additive feature cells, and `cargo check --all-targets --workspace`.

Until then, the direction is accepted, but the mechanism remains designed rather than compiled.


---

# Appendix A — the administrator anchor (resolves §10.7)

**Added 2026-08-20.** This closes the last open question in §10, under author ruling 7 (anchor
required outright: no derivation, no grace period, no digest-at-open) and author ruling 9 (go
to the best final state).

**Shape:** a required two-member anchor — a public generationed verifier record in
`_snapback_meta`, plus a strict owner-only, generation-specific sidecar holding a random
Argon2 pepper. **The raw administrator token is never stored in either member.** A presented
raw token is processed with Argon2id v1.3 using the sidecar pepper and an instance/generation
binding as associated data; the derived 32-byte root verifies a full-length HMAC-SHA-256 tag
in the database. The database record is the active-generation pointer; **the sidecar alone
grants nothing.** This confirms the `_snapback_meta` path §10 suggested, and introduces **no
table and no `schemas/` change**.

**Not serveable:** new stores, incomplete ceremonies, pair mismatches, and disaster-restored
or forked stores without a newly provisioned target anchor. **A fork always mints a new
anchor** — it must never inherit the parent's administrator.

**One trap it names explicitly.** Serve-time credential resolution today prefers a nonempty
`SNAPBACK_ADMIN_TOKEN`, else the sibling token file, else mints one
(`crates/snapback-server/src/admin.rs:2418-2422`, `:2462-2539`). The ceremony must not mistake
that for anchor derivation: **the configured token is only a comparison reference, while the
independently presented raw token is the KDF input.** Confusing the two would reintroduce
exactly the digest-at-open fallback ruling 7 forbids.

**Parameters are closed, not advisory.** If a target cannot support the 64 MiB offline Argon2
profile, implementation must **stop and reopen §10.7** — it may not silently choose cheaper
parameters.

§13 below lists the consistency amendments this requires of the main spec, including replacing
proof kinds `OperatorRestore`/`OperatorImport` with a single `AdministratorAnchor` and amending
the proof-mechanism count from eight to seven.

## 1. Outcome

**INFERRED — DESIGN.** Close LLP 0293 §10.7 with a required two-member administrator anchor:

1. A public, generationed verifier record in `_snapback_meta`.
2. A strict owner-only, generation-specific sidecar containing a random Argon2 secret (“pepper”).

The raw configured administrator token is never stored in either member. A presented raw token is processed with Argon2id v1.3 using the sidecar pepper and an instance/generation binding as associated data. The derived 32-byte root verifies a full-length HMAC-SHA-256 tag stored in the database.

The database record is the active-generation pointer; the sidecar alone grants nothing. Every operator operation rechecks the active pair and generation in its own kernel transaction and mints one private, single-use `KernelVerifiedEvidence`.

Provisioning and rotation are explicit offline operations under the instance lock. They accept raw tokens only through non-argv carriers. New stores, incomplete ceremonies, pair mismatches, and disaster-restored or forked stores without newly provisioned target anchors are not serveable.

This confirms the `_snapback_meta` path suggested in LLP 0293. It introduces no table and no `schemas/` change.

No author ruling remains open. The author already selected mandatory explicit provisioning, no derivation, no grace, and no digest-at-open in ruling 7 (`llp/0285-kernel-authorization-closure.spec.md:153-161`). The proof-kind correction in §8 is a necessary consistency amendment to LLP 0293, not a new product-policy choice.

## 2. Evidence labels and governing constraints

This document uses:

- **VERIFIED — CURRENT:** established by the current tree, followed by `file:line` evidence.
- **VERIFIED — RULING:** a binding author or accepted-design statement, followed by `file:line` evidence.
- **INFERRED — DESIGN:** the concrete proposed mechanism.
- **LIMIT:** a security boundary this design does not claim to cross.

**VERIFIED — RULING.** Ruling 5 directs the project to prefer the simplest correct end state over compatibility machinery because no installed base depends on stability, while preserving already-published artifacts and real local databases (`llp/0285-kernel-authorization-closure.spec.md:119-143`; `CLAUDE.md:157-162`). Published exact versions are immutable and a failed candidate remains quarantined rather than unpublished (`llp/0041-packaged-dev-loop.rfc.md:562-591`). Therefore an underspecified anchor must not ship speculatively.

**VERIFIED — RULING.** Ruling 7 requires explicit owner-anchor provisioning from the raw token under the instance lock, without legacy/environment derivation, a grace period, or caller digest (`llp/0285-kernel-authorization-closure.spec.md:153-161`). LLP 0293 makes new file-backed stores unserveable until provisioning and requires new anchors for forks and disaster restores (`llp/0293-authority-transition-chokepoint.spec.md:394-422`, `llp/0293-authority-transition-chokepoint.spec.md:464-480`). LLP 0292 separately requires a faithful export to carry the anchor deliberately, a disaster restore to create a new one, a fork always to mint a new one, and rotation to use an atomic generation transition (`llp/0292-authority-straight-path.plan.md:481-507`).

**VERIFIED — CURRENT.** The compiled prototype resolves the structural questions while explicitly leaving only §10.7’s administrator-anchor protocol open (`llp/0293-authority-transition-chokepoint.spec.md:577-591`; `prototypes/authority-chokepoint/EVIDENCE.md:232-246`).

## 3. Current-state findings

**VERIFIED — CURRENT.** The current local administrator token is `sbat_` plus a UUIDv4 value documented as 122 bits of CSPRNG randomness. Its conventional sibling appends `.admin-token` to the instance artifact name (`crates/snapback-auth/src/auth/admin_token.rs:5-18`). Serve-time credential resolution currently prefers a nonempty `SNAPBACK_ADMIN_TOKEN`, otherwise reads the sibling token file, otherwise mints and writes a token (`crates/snapback-server/src/admin.rs:2418-2422`, `crates/snapback-server/src/admin.rs:2462-2539`). The anchor ceremony must not mistake that resolution behavior for anchor derivation: the configured token is only a comparison reference, while the independently presented raw token is the KDF input.

**VERIFIED — CURRENT.** Ordinary administrator authorization currently accepts a derived console credential before falling back to the raw administrator token (`crates/snapback-server/src/admin.rs:4079-4104`). Protected erasure currently accepts either that derived credential or the raw master credential and records an unkeyed SHA-256 credential digest/class (`crates/snapback-server/src/admin.rs:4106-4163`). That operator path must be deleted. A console credential remains ordinary `AdminRead`/`AdminWrite` only, as its governing design already says (`llp/0017-admin-console-inspection-surface.rfc.md:549-584`).

**VERIFIED — CURRENT.** `_snapback_meta` is already a generic `key TEXT PRIMARY KEY, value TEXT NOT NULL` store (`crates/snapback-kernel/src/storage.rs:5988-5995`), and current code reads JSON values by key and performs transactional upserts there (`crates/snapback-kernel/src/storage.rs:6491-6525`, `crates/snapback-kernel/src/storage.rs:13504-13511`). New internal metadata keys therefore require no application-schema manifest or `schemas/` change.

**VERIFIED — CURRENT.** The kernel has strict owner-only primitives that open without following symlinks, require a regular file owned by the effective user, exact mode `0600`, one link, and no extended access ACL, and fail closed on unsupported hosts (`crates/snapback-kernel/src/secure_file.rs:1-9`, `crates/snapback-kernel/src/secure_file.rs:80-92`, `crates/snapback-kernel/src/secure_file.rs:133-154`). It also has create-new `0600` writes, no-replace same-filesystem rename, and parent-directory `fsync` (`crates/snapback-kernel/src/secure_file.rs:295-353`, `crates/snapback-kernel/src/secure_file.rs:356-414`, `crates/snapback-kernel/src/secure_file.rs:506-524`). The anchor sidecar uses this strict path, not the permission-repairing compatibility reader.

**VERIFIED — CURRENT.** A file-backed server holds an exclusive database-instance lock, and a conflicting process receives `WouldBlock` rather than sharing the database (`crates/snapback-kernel/src/instance_lock.rs:1-6`, `crates/snapback-kernel/src/instance_lock.rs:36-77`). Physical restore already has a persistent target reservation tied to an exact absent target (`crates/snapback-kernel/src/instance_lock.rs:163-191`, `crates/snapback-kernel/src/instance_lock.rs:485-524`).

**VERIFIED — CURRENT.** The current backup/restore protocol stages strict owner-only files, hashes through retained descriptors, publishes a complete same-filesystem directory by rename, and explicitly does not claim atomic replacement of independent files (`llp/0057-auth-provider-protocol.spec.md:1367-1449`, `llp/0057-auth-provider-protocol.spec.md:1451-1475`). Restore currently publishes a closed declaration and, before bind, revokes restored sessions; v2 also terminates restored agent credentials, grants, and scoped tokens (`llp/0057-auth-provider-protocol.spec.md:1477-1531`). This design extends that staged protocol without weakening those authority-retirement effects.

**VERIFIED — CURRENT.** Supported fork creation already classifies `_snapback_meta` for rotation, rotates the administrator-token sidecar, creates fresh authority sidecars in empty staging, and scrubs/mints the cloned database before publication (`crates/snapback-kernel/src/instance_fork.rs:156-198`, `crates/snapback-kernel/src/instance_fork.rs:697-729`, `crates/snapback-services/src/instance_fork/service.rs:1343-1404`). Its governing design says no parent sidecar is inherited except an explicit config opt-in, the child receives a fresh administrator token, and a hand-made `cp` is outside the managed fork protocol (`llp/0158-instance-forking.rfc.md:621-640`, `llp/0158-instance-forking.rfc.md:659-718`, `llp/0158-instance-forking.rfc.md:797-816`). The anchor becomes another mandatory `Rotate` member of that closed custody inventory.

## 4. Threat model

### 4.1 Required resistance

**INFERRED — DESIGN.** The mechanism must resist:

1. Offline guessing after theft of the database alone.
2. Offline guessing after theft of both the database and owner-only sidecar.
3. Swapping a sidecar, anchor row, generation, or verifier from instance A into instance B.
4. Rollback to a retired generation.
5. Passing a caller-selected digest or ordinary administrator result around the kernel verifier.
6. A crash between filesystem publication and database activation.
7. A supported backup, restore, or fork accidentally making independent instances share operator authority.

### 4.2 Explicit limit

**LIMIT.** A byte-for-byte copy of the complete database, matching active sidecar, and store binding is cryptographically the same logical instance. Without an external registry, TPM, or other non-copyable root, local cryptography cannot distinguish “faithful relocation” from “copied every byte.”

This design assigns that operation one meaning: it is a faithful copy of the same instance and only one copy may be served. If both copies will exist independently, the operation is a fork and must re-anchor. The existing local-fork threat model already declines to claim containment against a malicious process running as the same OS user (`llp/0158-instance-forking.rfc.md:824-855`).

Copying only A’s sidecar, only A’s anchor metadata, or any mixed subset into B fails. Copying the complete authenticated identity set deliberately changes B into A’s logical identity; it is not silently accepted as a distinct B.

## 5. Exact cryptographic construction

### 5.1 Identifiers and canonical encodings

**INFERRED — DESIGN.** Generate all random values with the kernel CSPRNG:

- `store_binding`: 32 random bytes, displayed as unpadded RFC 4648 base64url.
- `anchor_nonce`: 16 random bytes. `anchor_id` is `sbaa_` followed by the unpadded base64url encoding.
- `generation`: unsigned 64-bit integer, initially `1`; JSON encodes it as fixed-width 20-digit ASCII decimal.
- `salt`: 16 random bytes.
- `pepper`: 32 random bytes, present only in the strict sidecar and transient zeroizing memory.

Decoders reject padded, noncanonical, wrong-length, duplicate, unknown, or case-folded encodings. Integer fields reject signs, whitespace, and non-fixed-width generation strings.

The administrator token input `P` is the exact UTF-8 byte string presented through the non-argv carrier. The carrier may remove exactly one terminal LF and its optional preceding CR. It performs no other trimming or Unicode normalization. Empty input, NUL, remaining control characters, leading/trailing whitespace, or more than 4096 bytes is rejected before cryptography. The active configured credential is decoded under the same rule, and equality is constant-time.

Every cryptographic message is a fixed layout. Quoted literals include the final NUL byte; integers are unsigned big-endian:

```text
X = "snapback.administrator-anchor.kdf.v1\0"
    || store_binding[32]
    || anchor_nonce[16]
    || generation_u64be[8]
    || "argon2id-v19-m65536-t3-p4-o32\0"

SC = "snapback.administrator-anchor.sidecar.v1\0"
     || store_binding[32]
     || anchor_nonce[16]
     || generation_u64be[8]
     || "argon2id-v19-m65536-t3-p4-o32\0"
     || salt[16]
     || pepper[32]
     || created_at_ms_u64be[8]

VM = "snapback.administrator-anchor.verifier.v1\0"
     || store_binding[32]
     || anchor_nonce[16]
     || generation_u64be[8]
     || "argon2id-v19-m65536-t3-p4-o32\0"
     || sidecar_commitment[32]
```

All lengths after the domain literals are fixed, so concatenation is unambiguous. A future profile requires a new literal and format version; a reader never substitutes local defaults for a stored profile.

### 5.2 KDF, commitment, and MAC

**INFERRED — DESIGN.** The active profile is exactly:

```text
R = Argon2id(
      version = 0x13,
      password = P,
      salt = salt,
      secret = pepper,
      associated_data = X,
      memory = 65,536 KiB,
      iterations = 3,
      parallelism = 4,
      output_length = 32 bytes)

sidecar_commitment = SHA-256(SC)
verifier = HMAC-SHA-256(key = R, message = VM)   // full 32-byte tag
```

Use constant-time comparison for the full verifier. Zeroize `P`, `pepper`, `R`, and intermediate Argon2 buffers when verification ends. KDF work runs on a bounded blocking-crypto pool and never while a SQLite writer is held; current password-provider work already uses that execution shape (`crates/snapback-auth/src/auth/provider.rs:1429-1454`).

The parameters are not invented. RFC 9106’s second recommended Argon2id profile is 64 MiB, three iterations, four lanes, a 128-bit salt, and a 256-bit tag; it is the memory-constrained recommended option ([RFC 9106 §4](https://www.rfc-editor.org/rfc/rfc9106.html#section-4)). Argon2 also standardizes optional secret and associated-data inputs, which this design uses directly rather than introducing a pre-hash construction ([RFC 9106 §3.1](https://www.rfc-editor.org/rfc/rfc9106.html#section-3.1)). HMAC-SHA-256 is used because HMAC is a standard keyed message-authentication construction rather than a bare digest comparison ([RFC 2104](https://www.rfc-editor.org/rfc/rfc2104.html)).

The operation is deliberately expensive but rare: provisioning, startup verification, and protected operator operations are not ordinary application request lanes. No implementation may lower the profile, truncate the MAC, omit the secret/associated-data inputs, or add a “fast” digest verifier without reopening §10.7.

### 5.3 Attack analysis

**INFERRED — DESIGN.**

- A database-only thief has neither `pepper` nor `salt`, so the database verifier is not an offline token oracle.
- A thief with both members can test guesses, but every test pays the fixed Argon2id cost.
- Existing minted tokens are already high entropy, but Argon2id also protects explicitly configured tokens with less entropy.
- The random salt prevents equal tokens from sharing roots.
- The sidecar pepper prevents the public database verifier from being sufficient by itself.
- `X` binds the KDF result to the store, anchor, generation, and profile.
- `sidecar_commitment` binds every decoded sidecar field, including the private pepper, to the database record.
- `VM` and HMAC bind the verifier to the same store, anchor, generation, profile, and exact sidecar.

A mixed row/sidecar, changed generation, profile substitution, or sidecar replacement therefore fails before evidence minting.

## 6. Durable pair and custody

### 6.1 Database metadata

**INFERRED — DESIGN.** Use only `_snapback_meta`:

- `authority_store_binding_v1` — canonical base64url `store_binding`. Created with the new-format store, preserved by faithful relocation, replaced by fork and disaster-restore minting.
- `administrator_anchor_state_v1` — one strict compact JSON tagged union.
- `administrator_anchor_audit_v1/<audit-id>` — one immutable compact JSON receipt per completed provision, rotation, restore activation, import, or protected erasure. `audit-id` is `sbaudit_` plus UUIDv7. A receipt contains no raw token, pepper, root, or reusable verifier input.

Absence of `administrator_anchor_state_v1` while the store binding exists means exactly `unprovisioned`. Its tagged states are:

```text
provisioning     { operation, candidate }
active           { active }
rotating         { operation, active, candidate }
cleanup_pending  { operation, active, retired }
restore_pending  { operation, source_anchor_digest, candidate_or_null }
```

An anchor descriptor is exactly:

```text
anchorId
generation
kdfProfile
sidecarFile
sidecarCommitmentSha256
verifierHmacSha256
createdAtMs
activatedAtMs (active descriptors only)
```

The JSON object additionally carries:

```text
kind = "snapback.administrator-anchor.state.v1"
formatVersion = 1
storeBinding
```

Binary fields use unpadded canonical base64url. Commitment and verifier fields use exactly 64 lowercase hexadecimal digits. Timestamps are unsigned decimal strings bounded to the project’s portable millisecond range. Parsers deny unknown and duplicate fields.

The database state is authoritative. A sidecar not selected by the active descriptor grants nothing. Every operator transaction reads `authority_store_binding_v1` and the complete active descriptor in its own transaction. Comparison includes generation, filename, commitment, verifier, and profile. This is the mandatory in-transaction generation check.

### 6.2 Sidecar

**INFERRED — DESIGN.** For database path `D`, take its native-OS basename and append:

```text
.administrator-anchor.<anchor_id>.g<generation-20-decimal>.json
```

The directory is exactly `D`’s directory.

A sidecar is compact UTF-8 JSON followed by one LF, at most 4096 bytes, with fields in this writer order:

```json
{"kind":"snapback.administrator-anchor.sidecar.v1","formatVersion":1,"storeBinding":"<43-char-base64url>","anchorId":"sbaa_<22-char-base64url>","generation":"00000000000000000001","kdfProfile":"argon2id-v19-m65536-t3-p4-o32","salt":"<22-char-base64url>","pepper":"<43-char-base64url>","createdAtMs":"<decimal>"}
```

The parser is semantic rather than byte-hash-based, but closed:

- Exact kind, version, and profile.
- No unknown or duplicate fields.
- Exact decoded lengths and canonical encodings.
- Exact database-derived basename.
- At most one final LF.

`sidecar_commitment` is recomputed from decoded fields using `SC`, so whitespace or field-order changes do not create a second semantic representation.

The file is a strict regular owner-only file: effective-user owner, exact `0600`, one hard link, no extended access ACL, no symlink traversal, no permission repair, and no operation on a host lacking that validation.

Creation uses a same-directory create-new temporary named:

```text
.<final-name>.tmp.<operation-id>
```

Publication is file `fsync`, strict descriptor revalidation, no-replace rename, and parent-directory `fsync`. Final generation files are immutable and never overwritten.

The sidecar is deployment authority, not application data. It is excluded from ordinary data export, dump, reset, and console inspection. A full authority-aware backup includes it only as an explicitly named strict member with an exact manifest hash. Raw `.admin-token` and derived `.console-credentials` files are not anchor members.

### 6.3 Cross-resource crash rule

**INFERRED — DESIGN.** SQLite and a sibling file cannot commit atomically. The protocol therefore never claims they do:

1. A transaction records a non-active pending state.
2. The candidate sidecar is published and durably synced.
3. A new transaction re-reads the pending state, strict-reads and verifies the sidecar, and changes the database pointer to `active` or the successor generation.
4. Retired-file cleanup occurs after activation.

Startup serves only an `active` state with an exact valid pair. Any pending state produces a recovery diagnostic.

A crash before database activation cannot make the candidate authoritative. A crash after activation cannot leave the active sidecar absent because sidecar publication and `fsync` preceded the database commit. Orphan candidates are removed only by an exact operation-ID recovery or abort path.

## 7. Provisioning

### 7.1 Interface and input custody

**INFERRED — DESIGN.** The local operation is:

```text
snapback admin anchor provision --db <path> --token-stdin
snapback admin anchor provision --db <path> --token-fd <number>
```

There is no `--token`, `--token-digest`, verifier, root, anchor-ID, salt, pepper, or generation input.

Interactive stdin disables echo; automation uses a pipe or inherited descriptor. The numeric descriptor identifier may appear in argv; the secret may not.

Environment variables and an existing owner-only token file may identify the **active configured credential**, but neither is silently fed to the KDF. The same raw bytes must be independently presented through stdin/fd and compare equal to the active configured credential.

The active configured credential resolver is frozen for the ceremony. It uses configured precedence with auto-mint disabled:

1. A nonempty configured environment value wins.
2. Otherwise, use an existing strict owner-only administrator-token file.
3. Otherwise, fail with a configuration diagnostic.

This is verification against configuration, not derivation from configuration. A newly created store may create its ordinary administrator token during explicit store creation, but the later anchor operation still requires the administrator to re-present it.

Derived `sbcc_` console credentials, HTTP authorization results, digests, encoded roots, and previous receipts are categorically rejected.

### 7.2 Provisioning state machine

**INFERRED — DESIGN.** Provisioning is the sole bootstrap exception to “operator evidence precedes an operator write,” because no anchor evidence can exist before the first anchor. Its authority is lexically limited to the three metadata key families and one candidate sidecar. It cannot mutate application data or any AuthorityFacts table.

The exact sequence is:

1. Acquire the exclusive `DatabaseInstanceLock`; refuse if a server or another ceremony holds it. Open the database through kernel file-identity checks. Require a new-format `authority_store_binding_v1` and no anchor state.
2. Read the raw token from the non-argv carrier, resolve the frozen active configured credential without minting, and compare them in constant time.
3. Generate `anchor_nonce`, generation `1`, salt, pepper, operation ID, and audit ID. Compute the commitment, Argon2 root, and verifier outside a SQLite transaction.
4. `BEGIN IMMEDIATE`; re-read the store binding and anchor absence; insert `provisioning { operation, candidate }`; commit and sync the database durability set.
5. Publish and `fsync` the exact candidate sidecar.
6. `BEGIN IMMEDIATE`; re-read the same provisioning record and binding; strict-read the sidecar; recompute its commitment, Argon2 root, and verifier from the independently presented raw token; constant-time compare; write `active` and the immutable initial audit receipt in one commit.
7. Sync the SQLite durability set, zeroize secret memory, and release the instance lock.

If the process loses the presented token, recovery never substitutes a digest:

```text
snapback admin anchor recover --db <path> --token-stdin
snapback admin anchor recover --db <path> --token-fd <number>
```

For a valid exact provisioning candidate, recovery may complete step 6. `anchor abort` may instead delete only the exact operation-owned candidate inode and remove the matching `provisioning` record. It cannot abort an active generation.

At startup, an active pair is verified with the raw active configured credential. This is verification of already-provisioned state, not creation or derivation of state. Missing state is never auto-filled.

## 8. Expression as `KernelVerifiedEvidence`

### 8.1 Necessary LLP 0293 amendment

**INFERRED — DESIGN.** Amend LLP 0293 §3.2 before acceptance: replace `OperatorRestore` and `OperatorImport` in `proof_kind` with one `AdministratorAnchor` variant.

Restore and import are purposes, not cryptographic proof mechanisms. Keeping them as proof kinds leaves protected erasure and rotation with no honest variant and encourages another bypass.

The resulting closed enum is:

```text
Bearer
Password
RecoveryCode
DeliveryProof
StepUpProof
AdministratorAnchor
SealedInternalService
```

Amend the “eight legitimate proof lanes” wording in LLP 0293 §11.6 to “seven legitimate proof mechanisms.” Keep the larger purpose registry, adding exact `RotateAdministratorAnchor` and `RecoverAdministratorAnchorCeremony` purposes.

Acceptance of this design ratifies those corrections. No separate author ruling is required because LLP 0293 remains in Review and the change removes a mechanism/purpose category error without changing ruling 7.

### 8.2 Verification and minting

**INFERRED — DESIGN.** An operator route may enter the chokepoint only with the raw master administrator token. Protected erasure no longer calls the ordinary admin/console resolver. Restore, import, rotation, and recovery likewise do not convert `AdminWrite` into operator authority.

The verifier:

1. Compares the presented raw token with the frozen active configured credential.
2. Derives `R` and the candidate HMAC outside the writer on the bounded crypto pool.
3. Begins the operation transaction and derives the open `EvidenceDatabaseIdentity`.
4. Re-reads the store binding and exact active descriptor.
5. Strict-reads the descriptor-selected sidecar, recomputes its commitment, and constant-time compares the full HMAC.
6. Checks the exact purpose, target keys or artifact digest, durable time, write set, catalog generation, and purpose-specific predecessors.
7. Reaches the sole private `KernelVerifiedEvidence` struct-literal mint site.

The evidence contains:

- `proof_kind = AdministratorAnchor`.
- `subject = Operator { anchor_id, anchor_generation, operator_audit_id }`.
- `authority_class = Operator`.
- The exact purpose, such as one protected-erasure request, one named restore/import artifact digest, or one generation rotation.
- An `OwnerTrustAnchor` predecessor containing:
  - `store_binding`;
  - digest of the complete active database descriptor;
  - anchor ID and generation;
  - KDF profile;
  - sidecar commitment;
  - active-configuration epoch and source class;
  - operation digest.
- Exact catalog, generation, time, and protected-write-set predecessors.
- The existing private database identity, transaction epoch, nonce, successor digest, and non-`Send`/`Sync` marker required by LLP 0293.

Evidence contains no raw token, salt, pepper, Argon2 root, verifier MAC, sidecar bytes, or public “verified” Boolean.

Consumption writes the immutable operator audit receipt in the same transaction as the authorized mutation. The transaction rechecks the active generation immediately before installing the permit. A value prepared under generation `g` cannot be consumed after generation `g+1` activates.

## 9. Rotation

### 9.1 Interface and prerequisites

**INFERRED — DESIGN.** Rotation is offline and explicit:

```text
snapback admin anchor rotate --db <path> \
  --old-token-fd <number> --new-token-fd <number>
```

Stdin may replace one carrier only when the other uses a distinct inherited descriptor. Neither token may appear in argv.

The administrator first installs the successor raw token as the active configured credential through the ordinary configuration-custody path. Rotation then requires:

- The predecessor raw token, which must verify the current anchor.
- The successor raw token, which must constant-time match the now-active configured credential.
- An active, exact, non-pending anchor pair under the exclusive instance lock.

The values may be identical, allowing a pepper/salt rekey without changing the administrator token. The kernel never accepts an old or new digest.

### 9.2 Generation transition

**INFERRED — DESIGN.** Rotation retains `anchor_id`, increments `generation` exactly once, and creates a new salt, pepper, sidecar, verifier, operation ID, and audit ID under the same `store_binding`.

1. Acquire the instance lock. Because the server must be stopped, no HTTP request, background worker, or SQLite transaction can be in flight. An unresolved provisioning, rotation, or restore ceremony refuses rotation.
2. Verify the predecessor token against generation `g`; verify the successor token against active configuration; compute candidate `g+1` outside the writer.
3. Commit `rotating { active: g, candidate: g+1 }`.
4. Publish and sync the immutable `g+1` sidecar.
5. In `BEGIN IMMEDIATE`, re-read `rotating`, reverify both exact pairs, mint and consume `AdministratorAnchor` evidence for `RotateAdministratorAnchor`, and commit `cleanup_pending { active: g+1, retired: g }` plus the audit receipt. This commit is the linearization point: generation `g` is no longer valid.
6. Delete the exact retired anchor sidecar and exact persisted `.console-credentials` sidecar, then sync their parent directory. Process-ephemeral console claims are already gone because the serving process is stopped.
7. Commit `active { g+1 }`, sync SQLite, zeroize both raw tokens and roots, and release the lock.

If cleanup crashes, startup returns recovery-required and does not serve, even though `g+1` is cryptographically valid. Recovery verifies the exact `g+1` pair using the successor raw token, completes only the recorded retired-file deletion, and marks the state active. It never rolls back to `g`.

Rotation invalidates:

- The predecessor raw token when its value changed.
- The predecessor sidecar.
- Every persisted or ephemeral derived console credential and claim.
- Every unconsumed `KernelVerifiedEvidence`.
- Every prepared operator operation bound to `g`.

It does not revoke unrelated application-user sessions merely because the operator anchor rotated.

Changing configured-token state without matching anchor rotation makes startup fail `TOKEN_INVALID`; it never triggers automatic re-anchoring.

Generation `18446744073709551615` cannot rotate and returns a generation-exhausted diagnostic. No wrap, reset-to-one, or new anchor ID is allowed through rotation. New anchor IDs are reserved for new-store, fork, and disaster-restore incarnations.

## 10. Backup, faithful copy, fork, and physical restore

### 10.1 Distinct meanings

**INFERRED — DESIGN.**

| Operation | Anchor material in result | Binding / anchor / generation | Administrator action before serving |
|---|---|---|---|
| Backup artifact | Exact database record and active sidecar are explicit manifest members; no raw token or console credential | Preserved but inert | None; an artifact is not serveable |
| Faithful relocation/copy | Exact pair travels deliberately | Preserve all three | Install and re-present the same raw configured token; declare relocation rather than independent copy |
| Fork | No parent anchor sidecar, raw token, or console credential crosses | New binding, new anchor ID, generation `1` | Re-present the fork’s fresh configured token and complete target provisioning before sentinel removal |
| Disaster restore | Backed-up pair is predecessor evidence only and never active | New binding, new anchor ID, generation `1` | Configure and re-present a target token; complete re-anchor and authority retirement before publication |

A backup manifest format increment adds `administrator-anchor.json` as an exact `0600` member and records its SHA-256 plus the database anchor-descriptor digest. Backup fails if the source active pair is absent, pending, mismatched, or changes under the lock. Ordinary data export continues to exclude it.

A faithful relocation is the same logical instance at a new location. It preserves the pair and verifies it with the same raw token before bind. If performed through physical-restore machinery, the existing restore declaration’s session/agent/token retirement rules still apply; “faithful” here means administrator-anchor identity, not exemption from separate auth-restore policy. Keeping the source independently serveable turns the operation into a fork and is refused by the supported workflow.

Fork adds `*.administrator-anchor.*.json` to `SIDECAR_CUSTODY` as `Rotate`, adds both anchor metadata keys to the `_snapback_meta` rotation transform, and cannot leave the quarantine sentinel until the fresh fork token provisions and activates a generation-1 pair. It never copies the parent sidecar and never uses the parent token as target input.

### 10.2 Disaster-restore state machine

**INFERRED — DESIGN.** Disaster restore extends the existing target reservation, retained-descriptor staging, declaration, same-filesystem rename, and sentinel protocol.

The static `restore-declaration.json` becomes format version 2 and contains exactly:

```text
formatVersion = 2
declarationId = UUIDv7
authorityMode = "disaster-reanchor"
sourceArtifactDigestSha256
sourceAnchorDescriptorSha256
targetStoreBinding
targetAnchorId
targetAnchorGeneration = "00000000000000000001"
```

It contains no token, pepper, root, verifier, source path, or caller digest used as authority. The source digests identify the artifact being retired; they do not authorize opening it.

The stages are:

- **R0 — reserved/quarantined.** Acquire the persistent exact target reservation. Create a same-filesystem `0700` staging directory and sentinel before any restored byte arrives.
- **R1 — artifact validated.** Through retained descriptors, validate the backup manifest, database, auth keyring, backed-up anchor structure, and manifest commitments. The predecessor sidecar remains an inert staging member and is never installed at the target active filename. The predecessor HMAC is not treated as target authority.
- **R2 — restore pending.** In one staged-database transaction, generate a new `store_binding` and generation-1 anchor ID; replace copied anchor metadata with `restore_pending`; apply the existing restored-authority retirement/scrub rules; advance durable time; and record the source artifact/anchor digests. The sentinel makes every earlier crash state unserveable.
- **R3 — target candidate durable.** The administrator configures a target raw credential and presents the same bytes via stdin/fd. Under the target reservation, the bootstrap-limited provisioner creates the candidate record and durably publishes its new sidecar. The predecessor token is neither required nor accepted.
- **R4 — anchor and restore commit.** In `BEGIN IMMEDIATE`, verify the candidate pair using the raw target token; mint and consume `AdministratorAnchor` evidence for `RestoreAuthorityCatalog { artifact_digest, declaration_id }`; atomically install the active generation, commit the restore receipt and operator audit, and complete all catalog retirement/admissibility changes. The active sidecar was already fsynced.
- **R5 — staged durability complete.** Sync the database durability set, required sidecars, declaration, sentinel, and staging directory. Delete the inert predecessor anchor sidecar by exact staged inode and sync again.
- **R6 — published/quarantined.** Rename the complete staging directory to the absent target and fsync the parent. The sentinel travels, so rename or parent-fsync ambiguity never makes the instance serveable.
- **R7 — live.** Recovery/startup reopens by retained identity and verifies the declaration, restore receipt, active generation-1 pair, and target raw configured credential. Only then remove the sentinel and fsync the directory. The instance may bind afterward.

Until R7, the following fail closed:

- Listener bind.
- Admin and application routes.
- Session or console-credential minting.
- Cron, jobs, and effects.
- Protected erasure.
- Import, rotation, and other operator lanes.

Only exact local `restore status`, `restore recover`, and `restore abort` operations under the target reservation are available.

### 10.3 Restore crash recovery

**INFERRED — DESIGN.** No raw token is written to a journal. Any recovery crossing R2–R7 therefore requires the administrator to re-present the target raw token through stdin/fd and requires it to match active target configuration.

Recovery resolves from exact local evidence:

- R0–R1 with no committed `restore_pending` may resume from the source artifact or abort by unlinking only descriptor-owned staging inodes.
- R2 without a candidate remains `restore_pending`. Serving reports recovery-required. Resume requires the target token and creates a fresh candidate.
- R3 with a candidate sidecar but no active database pointer revalidates the operation ID, commitment, target binding, and raw token, then may perform R4. The sidecar alone never authorizes.
- R4–R5 reverify the active pair and restore receipt, finish exact inert-file cleanup and durability, then publish.
- R6 at the target path revalidates target inode, declaration, receipt, database identity, and active pair. If all match, it performs R7; otherwise it leaves the sentinel and reports pair-invalid or recovery-required.
- R7 is idempotently complete. Reusing the declaration ID cannot repeat authority retirement or rotate the anchor.

Abort is available only before R4. Once the active-anchor/restore transaction commits, recovery must finish forward; it cannot resurrect the predecessor anchor or catalog. Ambiguous rename is resolved from exact target/staging identities and the receipt, never from a registry guess.

## 11. Stable diagnostics

**INFERRED — DESIGN.** Diagnostics never contain a token, token digest, pepper, root, verifier, or sidecar contents.

### `SNAPBACK_ADMIN_ANCHOR_NOT_PROVISIONED`

Condition: a new-format store has `authority_store_binding_v1` but no anchor-state record.

Message:

> This instance has no administrator anchor. Stop the instance and run `snapback admin anchor provision --db <path> --token-stdin` with the raw active administrator token; digests are not accepted.

Details:

```text
state: "unprovisioned"
digestAccepted: false
requiredCarrier: "stdin-or-inherited-fd"
```

Startup/readiness and protected operator endpoints treat this as unavailable, not wrong-token.

### `SNAPBACK_ADMIN_ANCHOR_TOKEN_INVALID`

Condition: the active database/sidecar pair is structurally exact, but no raw token was presented, the token is malformed, it differs from active configuration, or its derived HMAC does not match.

Message:

> The raw administrator token did not verify the active administrator-anchor generation. Re-present the configured raw token; a console credential or digest cannot authorize this operation.

Details:

```text
presented: <boolean>
anchorId
generation
configuredSource: "environment" | "owner-file"
```

The diagnostic does not distinguish “wrong configured token” from “wrong anchor token,” avoiding a finer oracle. It remains clearly distinguishable from never provisioned.

### `SNAPBACK_ADMIN_ANCHOR_PAIR_INVALID`

Condition: database state says active, but the selected sidecar is absent, malformed, non-strict, has the wrong filename, binding, ID, generation, profile, or commitment.

Message:

> The administrator-anchor database record and owner-only sidecar are not an exact pair. Restore the exact sidecar only for a faithful relocation, or run the recorded recovery ceremony; provisioning a replacement over this state is forbidden.

Details identify only the failed field class and expected basename, anchor ID, and generation.

### `SNAPBACK_ADMIN_ANCHOR_RECOVERY_REQUIRED`

Condition: state is `provisioning`, `rotating`, `cleanup_pending`, or `restore_pending`, or a restore sentinel remains.

The message names the exact local recovery command and carries:

```text
state
operationId
anchorId (when known)
generation (when known)
```

It never suggests serving, deleting files by hand, accepting a digest, or falling back to the predecessor generation.

### Other closed codes

- `SNAPBACK_ADMIN_ANCHOR_BUSY` — the instance or target lock is held.
- `SNAPBACK_ADMIN_ANCHOR_GENERATION_EXHAUSTED` — rotation would overflow `u64`.
- `SNAPBACK_ADMIN_ANCHOR_CUSTODY_UNSUPPORTED` — strict owner/ACL/no-replace/durability primitives are unavailable.
- `SNAPBACK_ADMIN_ANCHOR_CONFIG_REQUIRED` — no active raw configured credential exists; provisioning never auto-mints one.
- `SNAPBACK_ADMIN_ANCHOR_ALREADY_PROVISIONED` — provision was requested over active state; use rotation.

These replace, for operator lanes, the current broad `SNAPBACK_ADMIN_TOKEN_REQUIRED`, whose message presently distinguishes only whether a token was presented and points to header/environment/token-file acquisition (`crates/snapback-server/src/admin.rs:4220-4235`). Ordinary admin routes may retain that code; anchor-gated operations may not.

## 12. Verification and acceptance gates

**INFERRED — DESIGN.** Closing the semantic question does not waive LLP 0293’s compiled-prototype and implementation-review gates. Before implementation may publish:

1. Add fixed known-answer vectors covering exact `P`, salt, pepper, associated data, `R`, sidecar commitment, and HMAC, including a vector produced independently from the implementation under review.
2. Verify the exact profile: Argon2id v0x13, 65,536 KiB, `t=3`, `p=4`, 16-byte salt, 32-byte secret, 32-byte output, full HMAC-SHA-256.
3. Negative-test every single-field substitution across two stores, two anchor IDs, two generations, and two profiles; test database-only and sidecar-only theft models.
4. Prove raw token accepted, console credential rejected, digest rejected, automatic environment/file derivation absent, and ordinary `AdminWrite` unable to become `Operator`.
5. Fault-inject before and after every database commit, sidecar write, file `fsync`, no-replace rename, directory `fsync`, retired-file unlink, restore-directory rename, and sentinel unlink.
6. Require recovery to yield exactly unprovisioned, active-old, active-new, recovery-required, or pair-invalid—never a serveable mixed state.
7. Race-test stale-generation evidence and prepared operations against rotation. They must fail the in-transaction generation check.
8. Exercise backup, faithful relocation, disaster restore, fork, same-token rekey, changed-token rotation, configuration changed without rotation, generation exhaustion, unsupported custody host, and ambiguous publication.
9. Assert zero `schemas/` drift and no new application-visible table. Inventory the three `_snapback_meta` key families and sidecar custody rule.
10. Scan serialized, logged, diagnostic, and test-hook surfaces for raw token, pepper, root, verifier input, and evidence fields. Confirm zeroization and bounded KDF concurrency.
11. Compile the exact sidecar/KDF/evidence path in the §10 prototype and pass `cargo check --all-targets --workspace`.
12. Obtain independent cryptographic implementation review before any immutable artifact is published.

The cryptographic design itself is **not OPEN**: it selects standardized primitives and an exact published Argon2 profile. Implementation review proves that code matches the closed design. If a target cannot support the 64 MiB offline profile, implementation must stop and reopen §10.7; it may not silently choose cheaper parameters.

## 13. Required LLP 0293 acceptance edits

**INFERRED — DESIGN.** Incorporate this design into LLP 0293 as follows:

1. Replace §6.6’s OPEN paragraph with §§5–10 of this design.
2. Mark §10.7 resolved by this design and the required compiled/fault-injection prototype.
3. Replace proof kinds `OperatorRestore` and `OperatorImport` with `AdministratorAnchor`; amend the proof-mechanism count from eight to seven.
4. Add exact operator purposes for protected erasure, restore, import, administrator-anchor rotation, and ceremony recovery, all using the single anchor proof mechanism.
5. Add the stable diagnostic inventory and backup/faithful-copy/fork/disaster-restore matrix to the acceptance criteria.
6. Retain LLP 0293’s existing privacy, one-mint-site, transaction nonce, write-set, and consume-once rules unchanged (`llp/0293-authority-transition-chokepoint.spec.md:50-153`).

With those edits and the compiled/fault-injection proof, §10.7 is closed. No compatibility derivation, grace period, caller digest, console-credential operator path, or `schemas/` drift remains.