# LLP 0313: The authority-creation chokepoint

**Type:** Spec
**Status:** Draft
**Systems:** Security/authorization, Storage, Auth, Rust core, Verification
**Author:** codex `gpt-5.6-sol` (read-only design), commissioned by Claude (Opus 5)
orchestrating LLP 0283 F-1, for Charlie Cheever
**Date:** 2026-08-26
**Revised:** 2026-08-26 (b — Landing A Round 4 hardening and executed witnesses)
**Related:** LLP 0283 (F-1), LLP 0285 (§5.1, §6 — superseded in part by this document),
LLP 0291 (the enumerated forgery surface), LLP 0303, LLP 0284, LLP 0225

## Why this document exists

LLP 0285 §6 splits F-1 into a *reachability* half (steps 2-4, implemented) and a *forgery*
half (steps 5-6, not started), and forbids reporting the former as F-1 closure. Step 5's
`ResolvedPrincipal` was held: LLP 0291 found that, as specified, it would **add** to the
authority surface rather than replace it.

LLP 0291's headline is why patching cannot finish the job: **there is no chokepoint.**
Authority creation is split across independent mechanisms — 30 no-feature and 16
additive-feature forgery families — and four consecutive independent review rounds each
found a *different* way to forge an authenticated principal, not variants of one defect.
Each round closed the named path; the next found another.

This document is the design that resolves the hold. It was produced read-only against
`dff67345c`, with every substantive statement labelled READ-CONFIRMED or INFERRED. That
labelling is load-bearing and must be preserved when quoting these conclusions.

**Status is Draft pending an owner decision on §11.** In particular §10 narrows the row
programme, which is a staffing decision, not an engineering one.

## Recommendation

**[INFERRED]** Supersede LLP 0285 §5.1 and historical step 5. Do not merge or recreate additive `ResolvedPrincipal`.

**[INFERRED]** Retain LLP 0291 §4’s `KernelVerifiedEvidence` shape, strengthened by LLP 0303. Evidence is module-private—not merely opaque or `pub(crate)`—and bound to the current database resource, creator process, transaction, subject, authority class, purpose, durable predecessors, verified time, exact write set, and successor digest.

**[INFERRED]** Do not expose a commit function accepting evidence. The public surface consists only of exact `ServingDatabase` ceremonies accepting untrusted selectors, raw possession material, provider cryptographic artifacts, or ordinary payload. The private kernel core performs verification, derives every authority fact, mints evidence, consumes it, and commits in one transaction.

**[INFERRED]** Narrow the row programme. Pause independent authority-carrier fixes; retain subtractive deletion, behavioral evidence, hostile compositions, and concurrency work that survives the reset. Use the rows as the reset’s acceptance ledger.

## 1. Verified baseline

**[READ-CONFIRMED]** LLP 0285 §6 separates steps 2–4, the reachability half, from steps 5–6, the forgery half. It explicitly forbids reporting steps 2–4 as F-1 closure and does not permit publication before step 6 at the earliest. [LLP 0285](llp/0285-kernel-authorization-closure.spec.md)

**[READ-CONFIRMED]** LLP 0285’s later rulings supersede the compatibility-oriented forgery migration and direct deletion/rebuild of the authority-creation surface.

**[READ-CONFIRMED]** The current Rust corpus contains zero `ResolvedPrincipal` occurrences. The name remains in documentation, so “zero repository occurrences” would be inaccurate. No `lane/f1-forge` ref is currently available.

**[READ-CONFIRMED]** LLP 0291 found 30 no-feature and 16 additive-feature forgery families, no chokepoint, and independent creation through durable and in-memory mechanisms. [LLP 0291](llp/0291-authority-forgery-surface.research.md)

**[READ-CONFIRMED]** LLP 0303 requires derive-not-supply, producer-instance provenance, producer and consumer coverage, lifetime-long binding, authenticated roots, replay resistance, resource-wide guards, all-feature enumeration, and fork failure. [LLP 0303](llp/0303-subject-authority-correlation-policy.decision.md)

**[READ-CONFIRMED]** Current source still exposes `LocalDatabase`, `ServingDatabase::adopt`, shared `Deref`, `auth_database_mut`, public `System`/`AdminBypass`, generic `PreparedAuthority`, public durable writer families, and additive-feature fixtures. Representative surfaces remain in [storage.rs](crates/snapback-kernel/src/storage.rs) and [invocation.rs](crates/snapback-sync/src/auth/invocation.rs).

**[READ-CONFIRMED]** The checked-in row-attack ledger marks 22 attacks `CLOSED`, but contains only 26 attacks against a 134-row source inventory. The current consumer audit separately found 41 of 110 examined open rows blocked on other consumer seams. This confirms meaningful progress but not convergence.

## 2. Reconciliation

**[INFERRED]** `ResolvedPrincipal` is not equivalent to `KernelVerifiedEvidence`. It is only the possible `subject + authority_class` projection of evidence.

**[INFERRED]** It lacks the transaction, exact purpose, complete durable predecessors, time, write set, successor digest, and consumption state required by LLP 0291 §4. A reusable resolved principal can become stale, cross databases, authorize another purpose, or be regenerated by rerunning its producer.

**[INFERRED]** LLP 0285 step 5 should therefore be superseded. Its queries, tests, and durable-resolution knowledge may be harvested, but its type and adapters should be discarded.

**[INFERRED]** LLP 0291’s shape survives with two corrections:

- **[INFERRED]** Evidence never crosses the authority core boundary or appears as a commit parameter.
- **[INFERRED]** Restore and import are purposes; their proof mechanism is `AdministratorAnchor`.

**[INFERRED]** A private `VerifiedSubject` may exist only inside evidence or a local verifier state. It is never returned, serialized, cloned, cached, or accepted by a public API.

## 3. Module and visibility design

**[INFERRED]** Use this layout:

```text
snapback-kernel/src/storage.rs
    mod authority_transition;

storage/authority_transition/mod.rs
    mod core;
    mod prepared;
    // exact public inherent methods on ServingDatabase

storage/authority_transition/core/mod.rs
    mod evidence;
    mod permit;
    mod registry;
    mod verifier;
    mod bearer;
    mod password;
    mod recovery;
    mod delivery;
    mod step_up;
    mod administrator;
    mod internal_work;
    mod writers;

storage/authority_transition/core/writers/*.rs
    pub(super) functions only
```

**[INFERRED]** `KernelVerifiedEvidence`, `VerifiedSubject`, `AuthorityClass`, `AuthorityPurpose`, `DurablePredecessor`, `VerifiedTime`, `AuthorityMutation`, permits, and transaction identity use inherited visibility inside `core`. They are not `pub(crate)`.

**[INFERRED]** `ServingDatabase` remains public with private fields. `LocalDatabase` becomes `pub(crate)`.

**[INFERRED]** Delete:

- **[INFERRED]** `ServingDatabase::adopt` and `adopt_with_*`.
- **[INFERRED]** `auth_database_mut`.
- **[INFERRED]** `Deref`, `DerefMut`, `AsRef<LocalDatabase>`, and `Borrow<LocalDatabase>`.
- **[INFERRED]** Public `LocalDatabase::open` and `memory`.
- **[INFERRED]** Any snapshot extractor or accessor returning `LocalDatabase`.

**[INFERRED]** Add exact `ServingDatabase::open` and `ServingDatabase::memory` constructors that install the permanent authorizer, establish the resource origin, and perform recovery internally.

**[INFERRED]** `DatabaseBinding` remains public and cloneable because it is powerless. Strengthen it to contain durable store identity, live graph allocation identity, and creator-process identity. Matching checks the current process so inherited post-fork bindings fail closed.

## 4. Private evidence and permits

**[INFERRED]** The evidence type is structurally:

```rust
struct KernelVerifiedEvidence<'tx> {
    transaction: &'tx TransactionIdentity,
    single_use_nonce: NonZeroU128,
    proof_kind: ProofKind,
    subject: VerifiedSubject,
    authority_class: AuthorityClass,
    purpose: AuthorityPurpose,
    predecessors: NonEmpty<DurablePredecessor>,
    time: VerifiedTime,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
    _not_send_sync: PhantomData<Rc<()>>,
}
```

**[INFERRED]** `ProofKind` has exactly:

```text
Bearer
Password
RecoveryCode
DeliveryProof
StepUpProof
AdministratorAnchor
SealedInternalService
```

**[INFERRED]** `AuthorityClass` contains only derived classes such as human, delegated service, autonomous service, operator, internal work, and non-production rehearsal. It contains no `System`, `Admin`, `Anonymous`, `Seed`, or `Import`.

**[INFERRED]** Anonymous access is absence of credentials under a purpose policy derived from active configuration—not an authority value.

**[INFERRED]** Evidence has exactly one syn-visible struct literal. It has no named constructor, `Clone`, `Copy`, `Default`, serde, conversions, `FromStr`, getters exposing components, `Debug` of evidence, callback decomposition, or cross-thread transfer.

**[INFERRED]** `TransactionIdentity` is created at `BEGIN IMMEDIATE` or the protected read cut. It contains the database origin, nonzero connection epoch, nonce registry, and connection-local authorizer permit cell.

**[INFERRED]** Evidence consumption validates the current process, database origin, transaction identity, nonce, proof/purpose/class relation, predecessors, time, mutation discriminant, write set, and successor digest. It removes the nonce and returns a private transaction-lifetime permit.

**[INFERRED]** `AuthorityPurpose` and `AuthorityMutation` are closed, one-to-one enums. Multi-table ceremonies are one composite mutation rather than separately callable writes.

**[INFERRED]** Every protected writer lives below `core::writers`, accepts a private permit, and has at most `pub(super)` visibility.

**[INFERRED]** The SQLite authorizer denies protected inserts, updates, deletes, replacements, triggers, schema operations, attached-database access, and dynamic membership effects unless the active permit’s exact write set authorizes them.

### 4.1 Landing A substrate constraints

**[READ-CONFIRMED]** Landing A remains private and inert. The authorizer substrate has no
production installation site, no public ceremony or re-export, and moves no protected writer.

**[READ-CONFIRMED]** An authorizer binds on first installation to identity derived from the
actual SQLite connection. A second connection receives a distinct permanently unarmed callback
cell and installation reports a mismatch; it never shares the first connection's permit cell.

**[READ-CONFIRMED]** The connection epoch is allocated internally, advances on every commit and
rollback callback, and fails closed on exhaustion. Commit and rollback clear active authority
independently of Rust destructor reachability, so leaking the permit and transaction cannot keep
authority alive or pin the cell against later legitimate work.

**[READ-CONFIRMED]** Permit drop clears the exact active permit and reinstalls SQLite's
authorizer, forcing already-live prepared statements to reauthorize before execution. The
execution-time pre-update hook separately observes semantic `INSERT`, `UPDATE`, and `DELETE`
effects. `REPLACE` therefore requires an exact `Replace` write-set entry for both its delete and
insert effects; a refused partial execution taints the transaction and its commit is rolled back.

**[READ-CONFIRMED]** Nonce registration requires a token constructible only inside the evidence
custodian. The reachable activation function consumes that registered nonce and checks the
mutation's canonical write set, exact connection, origin, epoch, and successor digest. A writer
can name activation but cannot use an earlier ceremony to mint or reactivate different authority.

## 5. Public prepared operations

**[INFERRED]** Replace `ResolvedAppAuthority` and generic `PreparedAuthority` with exact, opaque `PreparedOperation<Kind>` values.

```rust
pub struct PreparedOperation<Kind> {
    origin: PreparedOrigin,
    operation_id: KernelOperationId,
    target_digest: [u8; 32],
    subject_projection: HandlerAuthProjection,
    predecessor_digest: [u8; 32],
    policy_generation: u64,
    not_after_ms: u64,
    fences: ExactPublicationFences,
    _kind: PhantomData<Kind>,
}
```

**[INFERRED]** All fields and constructors are private. The type has no clone, serde, conversions, `map`, `and_then`, `into_parts`, `take_unused`, replacement, or reinstall path.

**[INFERRED]** A prepared operation may be `Send` for exact task transfer but is not generic authority and cannot authorize AuthorityFacts writes.

**[INFERRED]** Consumers prove possession structurally by accepting only `PreparedOperation<ExactKind>` by value. Kernel consumption rechecks current process, graph, target, policy generation, time, and fences.

**[INFERRED]** HTTP uses a private `Arc<Mutex<Option<PreparedOperation<Kind>>>>` request slot. The slot—not the operation—is cloneable. A private extractor atomically takes the operation once; missing, repeated, or poisoned extraction fails closed.

**[READ-CONFIRMED]** Checked-in prototype evidence reports successful compilation of the connection/permit split, SQLite authorizer, nested writer visibility, durable delivery receipt, cron due/claim, take-once Axum handoff, and move-only task transfer. This commission did not rerun those checks.

## 6. Legitimate minting ceremonies

**[INFERRED]** An unconstructible value is created through custody, not trusted input:

1. **[INFERRED]** An exact public ceremony accepts raw proof material, cryptographic artifact, work identifier, and ordinary payload.
2. **[INFERRED]** Expensive cryptography runs under kernel custody outside the writer and returns a private row-digest/generation-bound computation—not a Boolean.
3. **[INFERRED]** The core opens the transaction and allocates transaction identity, nonce, and verified time.
4. **[INFERRED]** It reloads every subject, proof, policy, generation, scope, work, and anchor predecessor from that database.
5. **[INFERRED]** It derives subject, authority class, purpose, writer, provenance, scopes, time, write set, and successor.
6. **[INFERRED]** It constructs the sole evidence literal.
7. **[INFERRED]** It immediately consumes evidence into the permit and performs one composite mutation or creates one exact prepared operation.
8. **[INFERRED]** Commit uncertainty is reconciled through a powerless operation ID and exact durable receipt, never retained evidence.
9. **[INFERRED]** Publication revalidates all session, service, room, connection, mode, and exposure fences.

**[INFERRED]** Public methods do not accept effectful `now_ms`; verified time comes from a database-owned clock and persisted bounded floor. Test clocks are injected only into owning-crate test database construction.

**[INFERRED]** Operator ceremonies use the mandatory store-bound administrator anchor. Console/admin-write success is not operator evidence. Fork and disaster restore create a new anchor.

## 7. Eleven mechanisms

| # | Mechanism | Disposition |
|---:|---|---|
| 1 | **[READ-CONFIRMED]** In-memory authority: R14–R18, U30, F15–F16. | **[INFERRED]** Delete `ResolvedAppAuthority`, generic `PreparedAuthority`, `System`, `AdminBypass`, unmanaged/synthetic preparation, generic sinks, and public push admissions. Rebuild with exact prepared operations. |
| 2 | **[READ-CONFIRMED]** Raw planned session issuance: U03–U11. | **[INFERRED]** Delete public plans, all-field successors, and raw attempt/commit entry points. Rebuild password, recovery, delivery, guest/open-policy, and rotation ceremonies. |
| 3 | **[READ-CONFIRMED]** Password/change/rotation/challenge/capture: U12–U15, W04. | **[INFERRED]** Delete `verified` booleans, caller step-up rows, caller profiles/modes, digest-only rotation, and public commit joins. Rebuild from exact proof and active store policy. |
| 4 | **[READ-CONFIRMED]** Identity helpers: U16 and guest/recovery/provisioning. | **[INFERRED]** Delete fake verified claims, direct insertion, unguarded recovery rotation, and independent address/subject joins. Rebuild exact delivery, recovery, guest, and provisioning ceremonies. |
| 5 | **[READ-CONFIRMED]** Agent principal and credential issuance: U17–U21. | **[INFERRED]** Delete split create/issue APIs, caller-selected modes/classes/profile, and ID-only issuance. Rebuild composite registration under invitation, active-open-policy, owner, or integration proof. |
| 6 | **[READ-CONFIRMED]** Pairing, grants, tokens, OAuth, retained service: U22–U23, R06–R08. | **[INFERRED]** Delete partial APIs and bearer-free tuple resolution. Rebuild exact actor/effective-subject relation, consent, request, grant, token, and scope transitions. |
| 7 | **[READ-CONFIRMED]** Watch owner/anchor: R11–R12, U25–U26. | **[INFERRED]** Delete record-from-parts creation and ID-only execution. Rebuild create, renew, and execute from exact prepared owner/integration, function generation, scope, claim, and durable watch. |
| 8 | **[READ-CONFIRMED]** Callback, capability, lease, sender, membership, pending effect, erasure, and push authority. | **[INFERRED]** Delete public ensure/mint/reconcile/authenticator/from-parts/writer/provenance/step-up/push roots. Rebuild exact purposes. Delete dormant authorized leases until a real consumer exists. |
| 9 | **[READ-CONFIRMED]** Rehearsal authority: R09, U27. | **[INFERRED]** Delete outright. Reintroduce only if later justified as an exact non-production administrator/internal ceremony. |
| 10 | **[READ-CONFIRMED]** Logical import, physical restore, fork/lifecycle: U28–U29 and §III. | **[INFERRED]** Preserve private staging, validation, scrub, rescue, GC, and swap algorithms. Rebuild authority creation behind the administrator anchor; reject imported live authority. |
| 11 | **[READ-CONFIRMED]** Additive feature/test fixtures: F01–F16 and related seams. | **[INFERRED]** Delete from production feature closure. Keep only owning-crate `cfg(test)` helpers or harness scenarios using production ceremonies. |

**[INFERRED]** `config.verify` remains a separate powerless probe and cannot mint evidence, an application principal, internal work, or application-table authority.

## 8. Green landing order

### First landable commit

**[INFERRED]** Land `feat(kernel): add private authority-transition core and structural registry`.

**[INFERRED]** It contains the private hierarchy, evidence/permit types, identities, purpose and protected-object registries, authorizer substrate, hostile shape fixtures, and gate checks. It exposes no public authority ceremony and does not route old caller facts through evidence.

**[INFERRED]** It must pass `cargo check --all-targets --workspace`. It makes no F-1 closure claim.

### Landing sequence

| Landing | Atomic scope | Claim |
|---|---|---|
| A | **[INFERRED]** Private core, identities, registries, permit/authorizer substrate, and structural gate. | **[INFERRED]** Green workspace; infrastructure only. |
| B | **[INFERRED]** Delete all feature-public authority writers/accessors and migrate their tests; remove `remainder-tests` and raw-SQLite laundering. | **[INFERRED]** Green workspace; closes only the additive fixture mechanism. |
| C | **[INFERRED]** Move every protected writer under the core; enable authorizer enforcement; privatize `LocalDatabase`; delete raw access/adoption/plans/discriminators; install vNext store binding/anchor; reconnect durable mechanisms 2–10. | **[INFERRED]** Green workspace; durable forgery cut, but in-memory F-1 remains open. |
| D | **[INFERRED]** Delete old in-memory authority vocabulary; install exact prepared operations and all engine/sync/server consumers; move HTTP handoff and service/room/publication fences together. | **[INFERRED]** Green workspace; earliest closure candidate. |
| E | **[INFERRED]** Final zero-legacy gate, all-family/row dispositions, races, fork/second-handle/process tests, authorizer bypass, ambiguity, fault injection, regeneration, cold install, and independent review. | **[INFERRED]** Only here may F-1 close and publication unblock. |

### Required atomic groups

**[INFERRED]** Writer relocation, authorizer enforcement, and deletion of every alternate protected writer move together. Giving old writers a generic permit would preserve the forgery.

**[INFERRED]** `LocalDatabase` privatization, raw accessor/adoption/dereference deletion, all cross-crate replacements, and snapshot non-adoptability move together.

**[INFERRED]** Old in-memory producer deletion, exact prepared-operation production, every consumer, nested/rerun behavior, and HTTP transport move together.

**[INFERRED]** Service-fence ownership, callback/factory deletion, durable terminalization, rollback/ambiguity handling, and publication integration move together.

## 9. Mechanical gate

**[INFERRED]** Define `ProtectedEffect` as:

- **[INFERRED]** Any protected-object mutation.
- **[INFERRED]** Creation/return of authenticated in-memory operation.
- **[INFERRED]** Creation/return/acceptance of an adoptable `LocalDatabase`.

**[INFERRED]** For every `cargo metadata` feature closure and effective-public item, the gate requires:

```text
Private evidence/components cannot be named, obtained, accepted, constructed,
cloned, converted, deserialized, decomposed, or reinstalled.

An item reaching ProtectedEffect is either:
  - one registered exact ServingDatabase ceremony, or
  - one exact PreparedOperation<Kind> consumer.

Every privileged parameter is classified as:
  raw-proof | target-selector | cryptographic-artifact |
  ordinary-payload | explicit-cross-principal-relation.

No parameter independently supplies:
  subject | authority class | writer | provenance | verified bool |
  requires-step-up | mode/profile/policy | time floor |
  durable predecessor | successor authority fact.

No public return/input/associated type/impl Trait/field/accessor/trait path
contains LocalDatabase or an adoptable equivalent.
```

**[INFERRED]** Extend the current syn scanner to check:

1. **[INFERRED]** Evidence visibility, exact fields, one literal, forbidden traits, and absence from exposed signatures.
2. **[INFERRED]** Writer and protected SQL custody below `core::writers`.
3. **[INFERRED]** Bidirectional equality among purpose, mutation, proof, subject-class, predecessor, write-set, verifier, entrypoint, and prepared-kind registries.
4. **[INFERRED]** Privileged parameters recursively through aliases, structs, enums, associated types, `impl Trait`, generic bounds, and local trait implementations.
5. **[INFERRED]** Generic indirection such as `W: MembershipWriterAccess`, not merely literal `MembershipWriter`.
6. **[INFERRED]** Call/reference sites for the core entry, permits, protected writers, prepared-operation literals, and catalog effects.
7. **[INFERRED]** `LocalDatabase` through `Self`, references, wrappers, aliases, associated types, fields, accessors, conversions, dereference, and adoption.
8. **[INFERRED]** Default, no-default, every additive feature, all features, and symbolic caller-feature visibility.
9. **[INFERRED]** Absence of old authority names and equivalent registered effects without allowlists.
10. **[INFERRED]** Creator-process identity and current-process validation on every provenance-bearing origin.

**[INFERRED]** Keep hostile dependent-crate `rustc --message-format=json` checks with primary-span assertions, but treat them only as spelling evidence.

**[READ-CONFIRMED]** Landing A's owning-crate decomposition witness now uses a named-field
pattern and is compiled alone so rustc reaches its late privacy check (`E0451`). The reinstall
witness makes a correctly typed call to the real private consumer and fails on reachability
(`E0603`), rather than on an intentionally wrong argument.

**[INFERRED]** Each LLP 0291 family and inventory row additionally needs an alternate-route effect witness using another producer and consumer. Refused runtime cases assert protected rows unchanged; accepted cases assert exact durable columns and receipts.

**[READ-CONFIRMED]** The security-boundary gate executes, rather than merely compiles, six named
Landing A regressions: leaked transaction ownership across raw `COMMIT`, cross-connection
authorizer reuse, live prepared-statement execution after permit drop, `REPLACE` under an Insert
permit, arbitrary writer reactivation, and epoch advance on commit and rollback. The gate requires
an `ok` result for every exact test name.

**[READ-CONFIRMED]** Syn, metadata, and compiler spans cannot prove complete body-flow semantics or evidence-to-write correspondence.

**[INFERRED]** Carry that residual with per-purpose verification maps; same-transaction revocation, expiry, generation, and anchor races; second-handle/process and fork tests; runtime authorizer matrices; replay/clock/rollback/ambiguity injection; and independent integrated review.

## 10. Row programme

**[INFERRED]** Narrow sharply. Do not continue authority-creation rows as independent implementation lanes.

**[INFERRED]** Pause any lane that:

- **[INFERRED]** Introduces or modifies a carrier between verification and effect.
- **[INFERRED]** Seals one producer while sibling consumers remain.
- **[INFERRED]** Adds another `Prepared*`, `Verified*`, seal, receipt, or provenance root outside the core.
- **[INFERRED]** Adapts a current writer to accept a new token.

**[INFERRED]** Continue only:

- **[INFERRED]** Final-state subtractive deletion, especially feature fixtures, raw database access, closure factories, rehearsal, and unused authorized leases.
- **[INFERRED]** Census, hostile compositions, fail-first tests, durable readback projections, and verification maps.
- **[INFERRED]** Fence/concurrency work that introduces no new authority carrier and survives the reset.
- **[INFERRED]** Independent non-authority correctness fixes outside the deletion set.

**[INFERRED]** Convert the row inventory from a staffing queue into an acceptance ledger. Every row receives one disposition:

```text
DELETED
ABSORBED(<AuthorityPurpose>)
POWERLESS
OUTSIDE-AUTHORITY-CREATION
```

**[INFERRED]** Retain the 22 currently closed attacks as regressions and predicate knowledge, but do not preserve their current carrier architecture merely to retain their spellings.

## 11. Acceptance ruling

**[INFERRED]** Accept that:

- **[INFERRED]** LLP 0285 step 5 is superseded.
- **[INFERRED]** LLP 0291’s evidence model, strengthened by LLP 0303 and private core custody, is the surviving implementation shape.
- **[INFERRED]** No public or crate-visible evidence-consuming commit gate is permitted.
- **[INFERRED]** The green landing sequence governs implementation.
- **[INFERRED]** The row programme is narrowed to permanent deletion and evidence work.
- **[INFERRED]** Landing E is the earliest point at which F-1 or publication may be reported unblocked.
