# LLP 0293: The authority-transition chokepoint mechanism

**Type:** Spec
**Status:** Review
**Systems:** Security/authorization, Storage, Auth, Rust core, Verification
**Author:** codex `gpt-5.6-sol`, synthesizing two independently commissioned designs
(codex `gpt-5.6-sol` and grok-4.6), orchestrated by Claude (Opus 5) for Charlie Cheever
**Date:** 2026-08-20
**Revised:** 2026-08-20 (a — initial synthesis)
**Related:** LLP 0292 (accepted direction), LLP 0291 (the enumerated surface),
LLP 0285 (§2 rulings 5-7; superseded in part), LLP 0283 (F-1), LLP 0284, LLP 0290, LLP 0059

## Why this document exists

LLP 0292 is the accepted *direction* — author ruling 5: delete and rebuild the
authority-creation surface rather than migrate the ~46 families LLP 0291 enumerated. What it
lacked was the *mechanism*. This supplies it, and is what LLP 0292 phases 2-3 build from.

**It is `Review`, not `Accepted`, and deliberately so.** §10 lists **nine blocking open
questions** that no source design compiled — borrow conflicts between a permanently installed
SQLite authorizer and an open transaction, whether `PreparedOperation<Kind>` can move through
async and detached paths without `Clone`, whether the kernel can own password/provider
computation without reversing the crate DAG, and whether the authority module can host every
required inherent impl without reopening sibling visibility. §10 says plainly: *"A prototype
must resolve these with `cargo check --all-targets --workspace` before implementation proceeds
beyond the authority core."*

## Provenance caveat, stated plainly

The two source designs were commissioned blind from different model families. However, the
grok source as captured is **a reviewed summary and transcript**, not the full underlying
design, which it referenced from a temporary path that did not survive. The synthesis
therefore explicitly does **not** treat claims from that unavailable artifact as verified, and
says so in §9. So this is closer to one complete design plus a substantial second opinion than
to two symmetric blind designs — weaker provenance than LLP 0285's, and worth knowing when
weighing §9's selections.

## The sentence that matters most

From §9, on why a chokepoint is only a chokepoint if it owns custody end to end:

> A public evidence-consuming function by itself would be the same failed design moved one API
> earlier.

That is the failure this whole program has hit eleven times. Any implementation must be
measured against it.

---

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
| Authority-surface custody | Public writers, all-field plans, privileged membership variants, closure factories, generation publishers, callback-principal constructors, generic `System`, and in-memory authority constructors are deleted. | Prevents authority from being created without protected SQL or from being created entirely in memory. |

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

## 10a. Prototype results (2026-08-20) — eight of nine answered, one BLOCKING

A throwaway compiled prototype was built to answer §10 rather than leave it as inherited
debt (LLP 0285 §8 risk 7). Evidence: `prototypes/authority-chokepoint/EVIDENCE.md`.

| § | Question | Result |
| --- | --- | --- |
| 10.1 | Borrow coexistence | **YES**, but only in one shape |
| 10.2 | Authorizer mutability during a transaction | **YES** |
| 10.3 | Movement without `Clone` | **NO — BLOCKING** |
| 10.4 | Crate DAG | **YES** |
| 10.5 | Delivery handoff | **YES** — authenticated durable receipt |
| 10.6 | Cron as a closed operation | **YES** — durable due/claim row with generation CAS |
| 10.7 | Administrator anchor | **STILL OPEN** |
| 10.8 | Commit-uncertainty reconciliation | **YES**, structurally |
| 10.9 | Inherent-impl hosting | **YES** |

**§10.3 blocks implementation.** A move-only operation compiles in a `Send` async future and a
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

§10.7 was not prototyped: the KDF/MAC, sidecar format, rotation protocol and staged
physical-restore recovery remain to be specified under ruling 7.

The original question list follows.

## 10. Open implementation questions

Nothing in either source design was compiled; LLP 0285 records that debt explicitly (`llp/0285-kernel-authorization-closure.spec.md:595-598`). The following are blocking questions, not implementation details to improvise:

1. Whether `rusqlite::Transaction`, a permanently installed authorizer, transaction epoch/nonce state, dynamic membership schema, and protected statements can coexist without conflicting borrows.
2. Whether authorizer state may safely change while a transaction exists; if not, whether a dedicated connection-local permit cell or a different protected-writer arrangement preserves atomicity.
3. Whether moving `PreparedOperation<Kind>` through current async and detached paths works without `Clone`.
4. Whether the kernel can own password/provider computation without reversing the crate DAG.
5. Whether delivery handoff uses a private move-only lease or a cryptographically authenticated durable receipt.
6. Whether cron can be represented as a closed kernel operation over sealed runtime state or requires a new durable due/claim row.
7. The exact administrator-anchor KDF/MAC, sidecar format, rotation protocol, and staged physical-restore recovery behavior.
8. Whether commit-uncertainty reconciliation can return generated secrets without retaining evidence or an authority-bearing plan.
9. Whether the authority module can host every required inherent implementation without violating crate ownership or reopening sibling visibility. Rust’s inherent-impl rule is a known architectural constraint (`llp/0283-post-rearchitecture-followups.plan.md:270-277`).

A prototype must resolve these with `cargo check --all-targets --workspace` before implementation proceeds beyond the authority core. A compiler success would establish structural viability, not semantic correctness.

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
