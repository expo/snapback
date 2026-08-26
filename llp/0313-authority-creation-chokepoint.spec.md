# LLP 0313: The authority-creation chokepoint

**Type:** Spec
**Status:** Draft
**Systems:** Security/authorization, Storage, Auth, Rust core, Verification
**Author:** codex `gpt-5.6-sol` (read-only design), commissioned by Claude (Opus 5)
orchestrating LLP 0283 F-1, for Charlie Cheever
**Date:** 2026-08-26
**Revised:** 2026-08-26 (d — Landing A round-3 hardening: private-memory-only
resource custody, file-backed activation refusal, connection-owned non-cloneable
WriterAuthorityV1, isolated machine-readable libtest execution, exact-output
fabricator mutation, and one defanging mutation per runtime probe); 2026-08-26 (c — Landing A round-2 hardening: evidence-sibling raw
custody, one callback composing WriterAuthorityV1, hostile-schema validation,
effect-time `OR ABORT`/row-count enforcement, row-derived successor facts, and
exact-name runtime/mutation gates); 2026-08-26 (b — Landing A design replacement: connection-owned
enforcement, generative scoped borrow, private derivation, fixed SQL, and an
executing runtime gate supersede the rejected retainable permit design); 2026-08-26
(a — initial design)
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

**[INFERRED]** Retain LLP 0291 §4’s verification obligations, strengthened by
LLP 0303, but do not embody their correspondence in a retainable evidence or
permit value. The connection-owning core privately verifies and derives the
subject, purpose, exact fixed writer, durable predecessors, time, and successor
inside the exact transaction and generative scope that commits them.

**[INFERRED]** Do not expose a commit function accepting evidence. The public
surface consists only of exact `ServingDatabase` ceremonies accepting untrusted
selectors, raw possession material, provider cryptographic artifacts, or
ordinary payload. The private kernel core owns the connection, verifies and
derives every authority fact, enters the protected effect scope, runs one fixed
writer, invalidates the scope, and commits in one control flow.

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
    mod evidence;    // private verify -> derive -> scope -> commit control flow
    mod registry;
    mod writers;     // fixed SQL only

storage/authority_transition/core/evidence/protected_tx.rs
    // raw handle and composite-callback custody; sibling to writers

storage/authority_transition/core/writers/*.rs
    pub(super) functions only
```

**[INFERRED]** `GuardedConnection`, `ProtectedTx`, proof-verifier state, derived
mutation state, the closed operation registry, and scope state are restricted
to the private `core` hierarchy. They are not `pub(crate)`.

**[INFERRED]** The raw fields of `GuardedConnection` and `ProtectedTx` live in
`evidence::protected_tx`. Writer modules are siblings of `evidence`, not
descendants of the field-defining module. A writer may name the opaque scoped
types and invoke one registered exact operation, but Rust privacy refuses
direct `Connection`, `Transaction`, or callback-state field access. Merely
placing private fields in `core` is insufficient because `core::writers`
inherits that privacy scope.

**[INFERRED]** `ServingDatabase` remains public with private fields. `LocalDatabase` becomes `pub(crate)`.

**[INFERRED]** Delete:

- **[INFERRED]** `ServingDatabase::adopt` and `adopt_with_*`.
- **[INFERRED]** `auth_database_mut`.
- **[INFERRED]** `Deref`, `DerefMut`, `AsRef<LocalDatabase>`, and `Borrow<LocalDatabase>`.
- **[INFERRED]** Public `LocalDatabase::open` and `memory`.
- **[INFERRED]** Any snapshot extractor or accessor returning `LocalDatabase`.

**[INFERRED]** Add exact `ServingDatabase::open` and `ServingDatabase::memory` constructors that install the permanent authorizer, establish the resource origin, and perform recovery internally.

**[INFERRED]** `DatabaseBinding` remains public and cloneable because it is powerless. Strengthen it to contain durable store identity, live graph allocation identity, and creator-process identity. Matching checks the current process so inherited post-fork bindings fail closed.

## 4. Connection-owned scope and private derivation

**[INFERRED]** The rejected Landing A permit design is superseded. There is no
caller-visible or retainable `AuthorityTransaction`, `AuthorityWritePermit`,
`ActivePermit`, transaction identity, nonce, connection epoch, mutation, write
set, or successor that can be paired after verification.

**[INFERRED]** `GuardedConnection` owns the actual `rusqlite::Connection`,
durable origin, resource binding, statement-cache policy, and authorizer cell.
The cell contains only one canonical `ScopePhase`; the generation moves inside
that phase across `Idle`, `Active`, and `Committing`. It contains no copied
origin, resource binding, database identity, lifecycle generation, or other
proxy that is compared later. The owner installs one composite authorizer while
taking ownership. Its single callback state owns the transition phase and the
existing `WriterAuthorityV1` policy; a denial by either limb denies the
statement. Activation may replace a previous callback only with this
composition, never with transition policy alone. There is no reusable
`install(&self, connection)` and no raw `Connection` accessor, conversion, or
dereference.

**[INFERRED]** Landing A does not accept a raw `Connection` and
`WriterAuthorityV1` independently. A private `InitializedConnection` opens a
connection-local `Connection::open_in_memory()` resource and creates its writer
policy as one object; activation consumes that object. The policy is not
`Clone`, its fields are not replaceable outside the raw-custody sibling, and no
post-activation handle can call `set_manifest` on the owned limb.

**[INFERRED]** Landing A explicitly refuses file-backed activation with
`SharedFileCustodyUnproven`. A SQLite authorizer is handle-local and therefore
cannot protect a shared file from a second connection that replaces a trusted
relation or writes a protected table directly. The durable resource-guard
blobs are caller-writable facts, not an authenticated root. File-backed support
must not be re-enabled until a later atomic landing either establishes exclusive
file custody or authenticates every effect-time file fact against a root the
caller cannot author. This dormant landing makes no file-backed protection
claim.

**[INFERRED]** `from_initialized` treats durable schema as hostile input before
installing the callback. It requires canonical case for the closed protected
table registry, exact column shapes for the resource guard, credential, and
session tables, no trigger whose source is a protected table, no attached
database, and no pre-existing virtual or shadow table. SQLite identifiers are
case-insensitive, so every runtime protected-name comparison is ASCII
case-insensitive as well. Schema validation is not the only enforcement:
effect-time rules independently close conflict replacement, trigger
suppression, trigger-target writes, and FK cascades.

**[INFERRED]** Scope opening is private to `core::evidence`. An exact ceremony
accepts raw proof/selectors and ordinary payload only, begins `IMMEDIATE`, reads
the durable resource guard on that exact connection inside the transaction,
verifies the proof, and privately derives the exact operation and successor.
No scope-opening argument supplies a write set, nonce, mutation, epoch,
generation, or successor.

**[INFERRED]** The privately selected writer is called through a higher-ranked
borrow:

```rust
for<'scope> FnOnce(&mut ProtectedTx<'scope>, &DerivedExactEffect) -> Result<T>
```

`ProtectedTx` does not implement `Deref`, expose `Connection` or
`rusqlite::Transaction`, commit or roll back, accept arbitrary SQL, prepare or
return statements, create savepoints, or access a statement cache.

**[INFERRED]** The wrapper alone transitions
`Idle(generation) -> Active(generation + 1) -> Committing -> Idle`, advances
the one canonical generation, and commits or rolls back. The authorizer derives permission from that
connection-owned lifecycle state; no `Weak<...>` allocation is a transaction
liveness oracle.

**[INFERRED]** Every protected writer lives below `core::writers`, receives
only `ProtectedTx<'scope>` plus privately derived exact values, and contains
registered fixed/parameterized SQL. The production surface contains no generic
execute/prepare method and no transaction-control SQL.

**[INFERRED]** `REPLACE` is not a protected operation. SQLite reports
`REPLACE` as `INSERT`, so the authorizer cannot distinguish it. The fixed writer
therefore spells `INSERT OR ABORT`, which overrides a hostile schema-level
`ON CONFLICT REPLACE`; duplicate keys must refuse with a constraint error and
leave the predecessor row unchanged. The ceremony also requires exactly one
affected row before commit, so `RAISE(IGNORE)`, `OR IGNORE`, and `DO NOTHING`
cannot report a successful authority transition with no durable successor.

**[INFERRED]** The password-session ceremony accepts no session identifier.
Inside the effect transaction it selects canonical `user_id`, digest, and
assurance generation from the verified credential row, derives the durable
session key from those row facts, and passes the opaque derived effect to the
exact writer. The lookup selector is never copied into successor state.

**[INFERRED]** Anonymous access remains absence of credentials under a purpose
policy derived from active configuration—not an authority value. Exact
ceremonies for bearer, recovery, delivery, step-up, administrator, and internal
work remain later-land work; Landing A exposes none of them.

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
3. **[INFERRED]** The connection-owning core opens `BEGIN IMMEDIATE`, advances
   its private scope generation, and derives verified time.
4. **[INFERRED]** It reloads every subject, proof, policy, generation, scope, work, and anchor predecessor from that database.
5. **[INFERRED]** It derives subject, authority class, purpose, writer, provenance, scopes, time, write set, and successor.
6. **[INFERRED]** It selects the one exact fixed writer and privately enters a
   generative `ProtectedTx<'scope>` borrow.
7. **[INFERRED]** The wrapper performs one composite mutation, transitions to
   `Committing`, invalidates the scope, and alone commits; no authority value
   crosses that sequence.
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

**[INFERRED]** Land `feat(kernel): add private connection-owned authority-transition scope and executing gate`.

**[INFERRED]** It contains the private hierarchy, connection owner, generative
protected transaction borrow, closed fixed-operation registry, authorizer
substrate, one unit-only exact ceremony, hostile runtime/shape fixtures, and
split gate checks. It exposes no public authority ceremony and connects no
legacy writer.

**[INFERRED]** It must pass `cargo check --all-targets --workspace`. It makes no F-1 closure claim.

### Landing sequence

| Landing | Atomic scope | Claim |
|---|---|---|
| A | **[INFERRED]** Private connection-owned core, generative scope, fixed writer registry, authorizer substrate, structural compile phase, and executing runtime phase. | **[INFERRED]** Green workspace; additive/inert infrastructure only. |
| B | **[INFERRED]** Delete all feature-public authority writers/accessors and migrate their tests; remove `remainder-tests` and raw-SQLite laundering. | **[INFERRED]** Green workspace; closes only the additive fixture mechanism. |
| C | **[INFERRED]** Move every protected writer under the core; enable authorizer enforcement; privatize `LocalDatabase`; delete raw access/adoption/plans/discriminators; install vNext store binding/anchor; reconnect durable mechanisms 2–10. | **[INFERRED]** Green workspace; durable forgery cut, but in-memory F-1 remains open. |
| D | **[INFERRED]** Delete old in-memory authority vocabulary; install exact prepared operations and all engine/sync/server consumers; move HTTP handoff and service/room/publication fences together. | **[INFERRED]** Green workspace; earliest closure candidate. |
| E | **[INFERRED]** Final zero-legacy gate, all-family/row dispositions, races, fork/second-handle/process tests, authorizer bypass, ambiguity, fault injection, regeneration, cold install, and independent review. | **[INFERRED]** Only here may F-1 close and publication unblock. |


### Custody finding (2026-08-26): Landing A cannot establish file-wide authority

An executing review demonstrated that a second connection to the same SQLite file can rename
the protected credentials relation, replace it with a same-named view over a caller-owned
table, and have the ceremony accept an attacker-chosen secret. A commissioned analysis then
answered whether that is closable inside Landing A. **It is not, and the limit is intrinsic:**
a per-connection SQLite authorizer enforces policy only on statements prepared through that
connection.

All three bypass cases are reachable in this repository today — a second in-process handle
(a checked-in test opens two `LocalDatabase` handles to one file; only the second
authority-graph claim is denied), an arbitrary same-user process (`DatabaseInstanceLock` is
an advisory sidecar `flock`, not mandatory access control), and other workspace code (four
crates may depend on `rusqlite`, and the lower-level open path does not itself take the
instance lock).

**Consequences for this specification:**

1. **Landing A remains acceptable as stated** — private, dormant, handle-local infrastructure —
   but its claim must say so plainly. It must never be read as evidence that same-file second
   handles or raw processes are refused. Two current tests invite exactly that misreading: the
   "cross-connection" test uses two *distinct in-memory databases*, and another opens a hostile
   raw connection to the same file and successfully rewrites the resource guard.
2. **The A→C sequence in §8 is incomplete.** Landing C claims a "durable forgery cut"; it
   cannot deliver one on a handle-local authorizer alone. LLP 0311 resource custody and gateway
   work must become a **prerequisite or atomic part of Landing C**.
3. **Landing C must choose a boundary and state it**, because the choice determines what any
   later F-1 claim can mean:
   - *Repository / trusted-native boundary* — every supported writable connection goes through
     one closed gateway, cooperating processes use the existing instance lock, and arbitrary
     raw same-user file access is **explicitly out of scope**; or
   - *Hostile raw-file-writer boundary* — authority moves outside SQLite, to OS or service
     isolation or an externally protected cryptographic root. That is deployment and migration
     work, not kernel work.

The full analysis, with citations for each reachable case, is at
`issues/20260826-landing-a-cannot-establish-file-wide-authority.md`.

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

1. **[INFERRED]** Exact private `GuardedConnection` ownership fields; absence
   of permit/transaction proxy types, raw accessors, escape traits, and public
   or crate-visible ceremonies.
2. **[INFERRED]** Opaque one-lifetime `ProtectedTx`, higher-ranked scope entry,
   scope activation private to `core::evidence`, and writer/fixed-SQL custody
   below `core::writers`.
3. **[INFERRED]** Bidirectional equality among purpose, mutation, proof, subject-class, predecessor, write-set, verifier, entrypoint, and prepared-kind registries.
4. **[INFERRED]** Privileged parameters recursively through aliases, structs, enums, associated types, `impl Trait`, generic bounds, and local trait implementations.
5. **[INFERRED]** Generic indirection such as `W: MembershipWriterAccess`, not merely literal `MembershipWriter`.
6. **[INFERRED]** Call/reference sites for the private core entry, protected
   writers, prepared-operation literals, and catalog effects.
7. **[INFERRED]** `LocalDatabase` through `Self`, references, wrappers, aliases, associated types, fields, accessors, conversions, dereference, and adoption.
8. **[INFERRED]** Default, no-default, every additive feature, all features, and symbolic caller-feature visibility.
9. **[INFERRED]** Absence of old authority names and equivalent registered effects without allowlists.
10. **[INFERRED]** Creator-process identity and current-process validation on every provenance-bearing origin.

**[INFERRED]** Keep hostile dependent-crate `rustc --message-format=json` checks with primary-span assertions, but treat them only as spelling evidence.

**[INFERRED]** The security-boundary gate has two non-substitutable phases:

1. a compile-fail phase (`cargo test --no-run` is allowed here) proving marked
   `ProtectedTx` commit/deref, raw-connection-accessor, and writer scope-opening
   expressions fail at their attack spans; and
2. an executing phase building the owning-crate libtest binary under default
   and additive `test-support` features, then launching one isolated process per
   exact fully-qualified test name. Each process must exit zero and emit the
   machine-readable libtest sequence proving `test_count=1`, that exact test
   started, that exact test completed `ok`, and the one-test suite passed.
   Test-authored sentinels remain diagnostics only and do not contribute to the
   verdict. Compiling without execution, a renamed or absent test, sentinel-only
   output, or fabricated exact-looking `test ... ok` lines is a gate failure.

**[INFERRED]** Landing A runtime acceptance directly attempts and refuses:
forgotten-scope/raw-COMMIT liveness, cross-connection authorization,
prepare-now/execute-later cache reuse, duplicate-key replacement, valid-proof
plus foreign-subject joining, stale copied generation, and unscoped protected
write. The stale-generation case replays a generation-1 scoped borrow during a
live generation-2 scope rather than corrupting the connection-owned state. It
separately proves the durable resource guard is reread inside the
effect transaction. The executed matrix additionally covers statement-level
`INSERT OR REPLACE`, schema-level `ON CONFLICT REPLACE`, `UPDATE OR REPLACE`,
UPSERT `DO UPDATE`, `INSERT OR IGNORE`, `DO NOTHING`, protected-source triggers,
FK cascades, canonical-case collisions, pre-activation virtual tables,
WriterAuthorityV1 composition, direct writer-side authorizer/state access,
close/address reuse, shared-file/second-handle mutation, and writer-policy limb
substitution or retained-clone disarming. Every runtime probe has at least one
defanging mutation that must make that exact named test fail at its marker. The
checked mutation runner also requires widened writer fields and policy-ownership
limbs to make their exact attacks compile, and requires an exact-line fabricator
to turn the machine-readable gate regression red.

**[INFERRED]** Each LLP 0291 family and inventory row additionally needs an alternate-route effect witness using another producer and consumer. Refused runtime cases assert protected rows unchanged; accepted cases assert exact durable columns and receipts.

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
