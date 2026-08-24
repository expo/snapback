# Mandatory authority/subject/effect correlation — revised design

Status: Revised proposed design — requires fresh independent review; no implementation or
capability claim
Date: 2026-08-23
Revised: 2026-08-24
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Related: LLP 0058, LLP 0059, LLP 0283 F-1, LLP 0290, LLP 0293, LLP 0298,
  issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md,
  issues/20260823-origin-bound-commit-capsule-design.md,
  issues/20260824-authority-validated-subject-supplied-separately.md,
  issues/20260824-correlation-design-review-synthesis.md,
  issues/20260824-uncorrelated-staging-entry-point-inventory.md

## Review disposition

The first revision is rejected. Its useful direction survives, but its chosen origin mint,
separate pending/guard protocol, and non-caller-carrier story do not.

Two mutually blind reviews returned **adopt with changes**. A later adversarial review assumed
the proposal had been implemented faithfully and produced working compositions against R1, R4,
and R5. The following findings are verified against the current tree:

1. Authority publication, finite-service publication, and rehearsal state can be attached after
   root authority preparation. An origin minted at root preparation therefore identifies an
   incomplete authority.
2. Function preparation mutates elevation-root provenance, evaluates the exact function policy,
   and retains the function identity, requirement, consent, and matched service-grant scope only
   in `PreparedInvocation`. Two function preparations from one prepared root are not the same
   authorized operation.
3. A root-origin comparison at the final cut cannot distinguish those two function/effect
   instances. A guard for F1 can satisfy a pending value staged for F2 if both carry only the
   root origin.
4. Grant-revocation planning validates admission but accepts the affected user and grant as
   independent strings. The legitimate public plan/gate factory can therefore produce the
   supposedly closed terminal carrier for the wrong caller.
5. `persist_service_deadline_if_due` performs a durable terminal write outside the proposed
   eight generic kernel cuts.

The coherent head and tail of Grok's review are incorporated below. Its middle was corrupted and
is **unread, not cleared**. This revision therefore cannot claim that the complete Grok review was
incorporated or that independent review is complete.

This document uses three confidence terms:

- **VERIFIED FACT** means the cited current code was inspected.
- **TYPE RULE** means the proposed reachable safe-Rust surface has the stated construction rule.
- **DETECTION BOUND** means the rule cannot make a future source edit impossible; a named gate or
  review detects expansion instead.

“I could not construct a violation” is never used as a synonym for “a violation is impossible.”

## Decision: replace origin-pair comparison with one operation product

Adopt a sealed, operation-scoped product protocol. Do not implement the first revision's early
`AuthorityOrigin`, independent `PendingAuthorizedCommit`, or generic
`CorrelatedCommitGuard<R>` design.

The end state has two identities with different jobs:

1. A private **final-authority origin** is minted only after the complete publication/service/
   rehearsal authority and exact operation or function policy have been fixed. It prevents an
   independently assembled authority from masquerading as that final preparation.
2. A private **effect-instance identity** is minted when one exact authority, subject tuple,
   intent/plan, and liveness reservation become one product. It distinguishes F1 from F2 and one
   effect from another even when both descend from the same final authority.

The effect identity is the commit correlation identity. Root equality alone is never sufficient.

The durable staging operation consumes the product and returns a new staged state of that same
product. The commit operation consumes the staged product. No supported signature accepts a
pending value, subject, plan, reservation, terminal gate, admission guard, or final guard as a
second independently selectable argument.

The governing property is wider than the original design:

> For every in-scope durable effect, the authority class, exact subject tuple, operation scope,
> staged intent/plan/ticket, and final liveness retention are constructed as one opaque product
> from one verification cut. Safe code in the supported caller class cannot select any of those
> axes independently at staging or commit.

This is not merely “subject authority matches reservation authority.” It covers the case where an
authority is validated while the user, grant, actor, session, function, asset, watch, batch,
ticket, plan, or other subject it acts on is supplied independently and nothing binds them.

## Verified breaks in the first revision

### R1 — the proposed mint was before authority assembly

**VERIFIED FACT.** `PreparedAuthority` root construction sets `publication`,
`service_publication`, `authorization_stream_incarnation`, and `rehearsal_fence` to `None`
(`crates/snapback-sync/src/auth/invocation.rs:2814-2832`). The current public attachment surface
includes:

- `PreparedAuthority::with_fenced_publication` (`invocation.rs:1918`);
- `PreparedAuthority::with_service_publication` (`invocation.rs:1952`); and
- `RehearsalAuthorityBinding::bind` (`invocation.rs:1745`).

Production attaches connection publication after preparation
(`crates/snapback-server/src/server.rs:16418-16435`) and attaches both stream and service
publication after service preparation (`crates/snapback-engine/src/local/engine.rs:8250-8274`).

**VERIFIED FACT.** `AuthCoordinator::prepare_anonymous_publication` is public and returns a
`FencedPublication` containing the stream fence but no session fence
(`crates/snapback-sync/src/auth/coordinator.rs:1569-1577`). A session-resolved authority can accept
that value through the same public setter. `FencedPublication` skips session generation,
terminal, pending-ticket, and deadline checks when its session field is absent
(`crates/snapback-sync/src/auth/session_projection.rs:644-676`). Therefore this composition is
valid through the current API:

```text
prepare session authority A
-> attach anonymous publication B for the same stream O
-> reserve effect from the assembled value
-> terminate session A
-> stage subject A
-> B keeps only stream O live
-> commit succeeds
```

Subject and reservation can be internally coherent in that attack. A later subject/reservation
origin comparison does not repair the missing session fence.

**VERIFIED FACT.** The service variant is caller-constructible too:
`ServiceAuthorityFenceRegistry` is public and implements `Default`
(`crates/snapback-auth/src/auth/service_fence.rs:647-669`); its public `register` accepts a
`ServiceAuthorityWitness` (`:817-826`); and every witness field is public
(`crates/snapback-types/src/auth/service_authority_contract.rs:17-27`).

**Conclusion.** Minting an origin at root preparation is wrong.

### Function scope and R4 — root identity is too coarse

**VERIFIED FACT.** `InvocationGate::prepare_function_classified`:

- mutates `elevation_root_provenance` (`invocation.rs:1794-1817`, `:2999`);
- evaluates the exact function requirement, consent, and service-grant scope
  (`:2999-3001`, `:3058` onward); and
- stores the function ID, kind, requirement, consent, matched scope, and invocation ID only in
  `PreparedInvocation` (`:2491-2536`, `:3002-3025`).

If a root-preparation origin were preserved through this function, F1 and F2 prepared from clones
of one root would share it even when their requirements and matched scopes differed. The proposed
R4 comparison of pending origin to guard origin would accept pending F2 plus guard F1.

**TYPE RULE.** A new function or operation preparation never preserves a final-authority origin.
It consumes an originless draft and mints a fresh final origin only after the exact policy result
has been stored. F1 and F2 therefore have distinct final origins. Independently, every effect
product minted from either function gets its own effect-instance identity, so two effects for F1
cannot be swapped either.

The current capsule exposes the same structural R4 class without hypothetical origins:
`PendingCommit` is an open `pub(crate)` trait, `FinalCommitCut::commit` accepts any implementing
pending value beside a reservation, and `WatchManagementPending::commit` checks only database
binding (`crates/snapback-server/src/server/commit_capsule.rs:159-192`, `:630-690`;
`crates/snapback-kernel/src/storage/watches.rs:300-338`). The inventory demonstrates B-pending +
A-capsule composition. Those separate surfaces are deleted below.

### R5 — a privately constructed terminal carrier is still caller-reachable

**VERIFIED FACT.** `LocalSnapback::plan_grant_revocation_service_terminal` performs only
`authority.validate_admission(...)`, then passes the independent `user_id` and `grant_id` to the
kernel (`crates/snapback-engine/src/local/engine.rs:5940-5955`). The bulk twin has the same shape
(`:5969-5984`). The kernel queries the supplied identifiers
(`crates/snapback-kernel/src/storage/auth_grants.rs:1020` region). The plan publicly exposes
`acquire_gate()` (`engine.rs:3302-3313`), while the write sink accepts the acquired admission
effect separately from the affected identifiers (`engine.rs:5958-5967`; kernel write at
`auth_grants.rs:1052` region).

The production route is correct only because it derives the user from the authority
(`crates/snapback-server/src/server.rs:17499` region). That is caller discipline, not closure.

**TYPE RULE.** Caller-initiated grant revocation has one product,
`CallerGrantRevocation`, whose only successful constructor:

1. consumes `FinalCallerAuthority<GrantManagement>`;
2. derives the owner from that authority—there is no `user_id` parameter;
3. asks the kernel for an owner-keyed exact `OwnedGrantRevocationPlan`;
4. reserves the caller-bound effect and closes the service-token set while both remain inside the
   same product; and
5. returns no plan, gate, token set, admission guard, or subject accessor.

The bulk form is a distinct `CallerBulkGrantRevocation` product with the same owner derivation.
The actor selector is intent data stored inside that product; it is not accepted again at commit.

**TYPE RULE.** The only durable consumers are
`commit(CallerGrantRevocation)` and `commit(CallerBulkGrantRevocation)`. They accept no authority,
owner ID, grant/actor ID, plan, terminal gate, or guard argument. A separate terminal carrier is
not accepted.

“Closed” means unreachable to code whose only capability is an ordinary caller authority. A
private struct with a public, `pub(crate)`, leaf-server, or kernel factory that an ordinary caller
can invoke is not closed.

### Durable write outside the proposed final cut

**VERIFIED FACT.** `persist_and_validate_prepared_service_authority_classified` calls
`persist_service_deadline_if_due` before its read-only validation
(`crates/snapback-engine/src/local/engine.rs:7626-7641`). The latter is public and, for unmanaged
embedders, directly calls `terminalize_expired_service_authority` (`:7643-7671`). This is a durable
write outside all eight `before_commit()` cuts. The managed server's owned expiry choreography is
better composed, but the lower public plan/gate/commit pieces remain reachable
(`server.rs:18179-18204`; `engine.rs:6151-6189`).

**TYPE RULE.** Managed and embedded expiry both consume one
`ExpiredServiceAuthorityCommit` product. Its constructor derives the deadline and token set from
one opaque service publication, owns the terminal premark/drain state, and returns no independent
plan or gate. The current direct persistence and separate commit APIs are deleted. Therefore the
unmanaged path is not retained as an exception.

## Final authority assembly

### Type state and corrected mint point

The authority owner defines two disjoint states:

```rust
// Schematic names. Fields and constructors are private to the authority owner.
struct AuthorityDraft<K> { /* resolved authority plus incomplete assembly */ }
struct FinalCallerAuthority<K> {
    origin: FinalAuthorityOrigin,
    scope: ExactOperationScope<K>,
    retention: FinalAuthorityRetention,
}
```

**TYPE RULE.** `AuthorityDraft<K>` has no origin. Only the authority-owner module can attach or
replace stream/session publication, finite-service publication, rehearsal state, attribution, or
elevation provenance on a draft.

**TYPE RULE.** `FinalAuthorityOrigin` is minted as the last step of the consuming transition from
`AuthorityDraft<K>` to `FinalCallerAuthority<K>`:

- for a function-backed operation, after function kind, ID, requirement, consent, matched grant
  scope, elevation provenance, and every publication/rehearsal carrier are fixed;
- for an authority-only operation, after the exact closed route/operation kind and every
  publication/rehearsal carrier are fixed.

This is the corrected mint point.

**TYPE RULE.** `FinalCallerAuthority<K>` exposes no attachment, replacement, `into_parts`, origin,
raw publication, raw service witness, raw admission lease, raw guard, or general-purpose
reclassification operation. Its fields are private. It is not `Copy`, `Default`, serializable,
deserializable, or constructible through `Clone`/`From`/`TryFrom`/`FromStr`. An exact multi-cut
workflow consumes one final authority into a parent product and privately mints one child effect
instance per durable transaction; it does not clone the final authority back into caller custody.

**TYPE RULE.** The final type does not implement the draft's attachment methods. The draft has no
origin to preserve. Attachment-after-origin is therefore unrepresentable through the supported
safe API, rather than discouraged by comments.

**TYPE RULE.** Session, anonymous, service, rehearsal, and internal authority assembly use
different opaque input products. An `AnonymousRouteAuthority` cannot satisfy the session or
service finalizer's parameter type. A session finalizer receives one coordinator-minted product
that already contains the exact resolved session and its session-bearing publication; it does not
accept `ResolvedAppAuthority` and `FencedPublication` separately. A service finalizer likewise
receives one resolver-minted product containing the resolved service identity, stream publication,
and finite-service publication; it accepts none of those three values separately.

**TYPE RULE.** `NestedMutation`, ask re-entry, watch-function preparation, and `LiveRerun` are new
operation preparations and mint fresh final origins. `inherit_for(LiveRerun)` is removed as an
origin-preserving operation; the existing fresh admission behavior of `prepare_rerun` remains and
now also produces a fresh final origin. Ordinary continuation inside the same already-finalized
operation may borrow the final authority but cannot reclassify it.

### Assembly surfaces deleted or narrowed

The same landing that introduces final assembly removes these current surfaces:

1. `PreparedAuthority::with_fenced_publication` as a public post-preparation method.
2. `PreparedAuthority::with_service_publication` as a public post-preparation method.
3. `RehearsalAuthorityBinding::bind(PreparedAuthority, ...)` as a public post-preparation method.
4. `AuthCoordinator::prepare_anonymous_publication() -> FencedPublication` as a value accepted by
   caller-authority assembly; its replacement returns an anonymous-only product.
5. Public/default construction of `ServiceAuthorityFenceRegistry` outside its one composition
   owner.
6. Public `ServiceAuthorityFenceRegistry::register(ServiceAuthorityWitness, ...)`.
7. Public fields and caller construction of `ServiceAuthorityWitness`.
8. Any public or cross-crate `AuthorityOrigin::mint`, origin constructor, inner-`Arc` accessor,
   equality-derived token field, serialization, or conversion.

Making these functions `pub(crate)` in a broad crate does not satisfy the deletion. The surviving
draft assembly operations are private to the module that obtains the relevant coordinator/kernel
evidence and are absent from caller-class reachability.

## One exact effect product

### Product state machine

Each durable operation kind `K` has one product state machine:

```text
FinalCallerAuthority<K> + ExactIntent<K>
  -- exact owner factory; subject derived/verified; reserve liveness;
     mint EffectInstance --> AuthorizedEffect<K, Unstaged>

AuthorizedEffect<K, Unstaged>
  -- consuming stage --> AuthorizedEffect<'tx, K, Staged>

AuthorizedEffect<'tx, K, Staged>
  -- consuming final cut; one admission acquire last --> CommitOutcome<K>
```

The names are schematic. The custody rules are not.

**TYPE RULE.** The exact owner factory consumes the final authority and complete exact intent or
plan. It derives the subject tuple from the final authority where possible. When a target selector
must come from the request, the kernel lookup is keyed by both the authority-derived owner and the
selector and returns a private owner-bound value. No product constructor accepts a caller-supplied
user/owner ID as evidence.

**TYPE RULE.** `EffectInstance` has one private mint site inside that exact product factory. It has
no public constructor, accessor, clone-independent reconstruction, string form, serde, conversion,
or caller-visible equality operation.

**TYPE RULE.** `AuthorizedEffect<K, Unstaged>` privately owns the exact final authority, subject
tuple, complete intent/plan, publication/service/rehearsal permits, and effect identity. There is
no standalone `AuthorizedEffectReservation` in a migrated family.

**TYPE RULE.** Staging is a consuming method on that carrier. Every carrier-independent sibling
that can stage, prepare, preview, plan, return, or mutate the same intent is deleted in the same
landing. It is not retained as a wrapper.

**TYPE RULE.** The staged state owns the pending transaction/buffer/ticket and the still-unarmed
final liveness retention. Neither half is returned or accessible. The staged product is not
`Clone`, `Copy`, `Default`, serde-capable, convertible, or decomposable.

**TYPE RULE.** Commit consumes the staged product. No supported commit signature accepts a second
authority, subject, intent, plan, ticket, pending value, reservation, terminal gate, raw admission
guard, callback, or generic return value.

**TYPE RULE.** If an internal implementation splits a staged transaction from retention to satisfy
borrowing, both halves carry the same private `EffectInstance` and can be reunited only by one
private consuming function. Neither half crosses the owner-module boundary. The leaf compares the
effect identities before arming. Final-authority equality is not accepted as a substitute.

This makes F1-guard + F2-pending unrepresentable through the supported product API even when both
effects share a caller, session, root preparation, or final function authority.

### The final admission cut

The first revision's `CorrelatedCommitGuard<R>` is removed. A generic retention parameter creates
the forbidden `CorrelatedCommitGuard<()>` and caller-selected-retention class unless its complete
inhabitant set is sealed. This revision uses a concrete private retention type instead:

```rust
struct CommitRetention<'a, K> {
    admission: AdmissionEffectGuard<'a>,
    authority: FinalAuthorityRetention,
    effect: EffectInstance,
    operation: PhantomData<K>,
}
```

**TYPE RULE.** `CommitRetention<'a, K>` is private to the final-cut owner, has no public
constructor, no generic `R`, no unit inhabitant, and no conversion from an already-held
`AdmissionEffectGuard`. Its lifetime `'a` is tied to the exact admission lease retained by the
product.

**TYPE RULE.** The only transition into the armed state performs, in order:

1. pure final-origin/effect-identity checks;
2. all fallible policy, rehearsal, service, publication, database-binding, liveness, deadline,
   and commit-readiness checks;
3. any uncertainty-carrier preparation that does not enter admission; and
4. exactly one acquisition of the admission effect guard, last.

**TYPE RULE.** The armed state has exactly one consuming method: issue the already-prepared SQLite
or other durable commit while `CommitRetention<'a, K>` is a field of that state. No callback,
`check_live`, validation, mode transition, caller code, or other admission-entering operation is
callable from the armed state. Guard drop precedes post-commit publication/finalization.

The current two mutation leaves call `check_live()` after `before_commit()`
(`crates/snapback-kernel/src/storage.rs:6292-6294`, `:7247-7249`). Their migrated types compute a
private `CommitReady<K>` before arming; there is no post-arm `Check` type parameter.

## Kernel and durable final-cut surface

The 99 kernel matches in the earlier census are forwarding occurrences, not 99 semantic seams.
The current generic protocol converges on eight `before_commit()` invocations:

1. HostPlan mutation at `crates/snapback-kernel/src/storage.rs:6292`.
2. Buffered mutation at `storage.rs:7247`.
3. Asset-attempt/publication transaction at `storage/asset_attempts.rs:485`.
4. Stream-attempt persistence at `storage/settlement.rs:148`.
5. Client-mutation acknowledgement at `storage/settlement.rs:510`.
6. Asset-read/lifecycle transaction at `storage/asset_reads.rs:225`.
7. Direct auth transaction at `storage/auth.rs:1740`.
8. Commit-certainty auth transaction at `storage/auth.rs:1791`.

**TYPE RULE.** Each family accepts only its exact staged operation product or an exact closed-class
product. Pure forwarders carry that opaque product unchanged. They are not generic over `G`,
`BeforeCommit`, a proof trait, a callback, or a retention type.

**TYPE RULE.** A family is not migrated until every raw/generic sibling that reaches the same
transaction primitive is deleted in the same landing. Replacing one signature while an alternate
raw or generic route reaches the same commit earns no closure claim.

The eight cuts are not the complete durable-effect population. The public service-deadline write
verified above proves that. Every direct commit/stage/plan/ticket surface in the staging inventory
is part of the migration even when it never reaches `before_commit()`.

The following current lower-level surfaces are specifically deleted, not wrapped:

1. `PendingCommit` as an implementable trait.
2. `FinalCommitCut::commit(reservation, pending)`.
3. `WatchManagementPending::commit(&CommitCapsuleAuthority)`.
4. Public/clonable `CommitCapsuleAuthority` access usable outside one consumed product.
5. Every generic `BeforeCommit: FnOnce() -> SnapbackResult<G>` in the eight families and their
   forwarding siblings.
6. Every `|| Ok(())` final-cut path.
7. Public `AuthorizedEffectReservation::commit_guard` and
   `commit_guard_classified` in migrated families.
8. A raw `tx.commit()` or equivalent durable cut reachable around the exact product consumer for
   a migrated family.
9. `persist_service_deadline_if_due`,
   `persist_and_validate_prepared_service_authority{,_classified}` as write-bearing validation,
   and `commit_expired_service_authority` as independently callable expiry writes.

The two commit-capsule guard acquisitions remain useful correlated prior art, but not proof of the
pending/guard product. Their current open pending surface is deleted by items 1–4.

## Closed products for every authority class

There is no shared public `CommitProof` trait, public proof enum, claimable mint root, generic
`System`, `unchecked`, `assume_correlated`, optional reservation, or unit fallback.

### Caller-bound ordinary effects

**TYPE RULE.** Caller-backed operations consume `FinalCallerAuthority<K>` and return only the exact
`AuthorizedEffect<K, State>` product. A sink that also accepts `&PreparedAuthority`,
`&PreparedInvocation`, a subject ID, or a standalone reservation is deleted.

### Caller-initiated terminal effects

**TYPE RULE.** An operation that both requires caller authority and terminalizes another authority
uses one product that contains the caller-bound effect and exact terminal plan. Grant revocation
and bulk revocation use the products specified under R5. Session/password plans and other
caller-initiated terminal families receive their own exact product types; no generic terminal
carrier is accepted.

The following R5 surfaces are deleted together:

1. `plan_grant_revocation_service_terminal(authority, user_id, grant_id, ...)`.
2. `plan_bulk_grant_revocation_service_terminal(authority, user_id, actor_id, ...)`.
3. Public `ServiceAuthorityTerminalPlan::acquire_gate()` for either caller path.
4. `revoke_grant_for_user(effect, user_id, grant_id, ...)`.
5. `revoke_grants_by_actor_for_user(effect, user_id, actor_id, ...)`.
6. Any kernel planner or writer that accepts the same owner/target strings without the private
   owner-bound product.

### Credential ceremonies

**TYPE RULE.** Pairing presentation and agent registration each have a named operation product.
The product constructor consumes the route admission and the verified credential/invitation
result in one owner module. Only that exact operation's stage/commit methods accept it. The raw
`AdmissionEffectGuard` entry points are deleted.

The eight raw engine entry points deleted in this migration are:

1. `register_agent_principal(effect, ...)`.
2. `mint_agent_invitation(effect, ...)`.
3. `mint_pairing_code(effect, ...)`.
4. `present_pairing_code(effect, ...)`.
5. `approve_grant_request(effect, ...)`.
6. `deny_grant_request(effect, ...)`.
7. `revoke_grant_for_user(effect, ...)`.
8. `revoke_grants_by_actor_for_user(effect, ...)`.

### Operator, durable handoff, and genuinely non-caller terminal work

**TYPE RULE.** Each class has a distinct exact product whose constructor is private to the module
that verifies its process identity, cryptographic artifact, or durable work claim. A constructor
is not `pub(crate)` in kernel and is not placed in a leaf server module callable by ordinary
caller code. No product is constructible from a caller authority or caller-supplied IDs alone.

**TYPE RULE.** Durable handoff products are bound to one durable work object and lease generation.
Operator products are bound to one process identity and operation. Non-caller terminal products
derive the affected subject from durable state or the opaque terminal observation. None can be
converted into another class or authorize an arbitrary application write.

The accepted LLP 0293 pattern is controlling: evidence mint and consumption remain in one private
owner; a public or cross-module factory accepting an evidence value is a capability downgrade
(`llp/0293-authority-transition-chokepoint.spec.md:50-153`, `:155-217`).

## Population and concrete work list

The old “two authority axes” and guard-call census are not the semantic population. The wider
predicate includes every production function that does any of the following:

1. validates or retains an authority/lease/guard while accepting a subject identifier, operation
   scope, intent, plan, pending value, ticket, buffered effect, or durable claim independently;
2. erases authority into strings or a ticket that a later durable consumer accepts;
3. constructs a plan/carrier/gate from independently supplied subject identifiers;
4. consumes such a plan/carrier/gate beside a separately supplied authority or subject; or
5. performs an LLP 0298 durable effect without an exact operation product.

That predicate includes no-reservation sites such as grant-revocation planning. A sweep limited to
`commit_guard` calls cannot establish completeness.

`issues/20260824-uncorrelated-staging-entry-point-inventory.md` is the concrete Phase-3 work list
and completion criterion. Implementation does not replace it with prose categories. For every
exact row identity in that file:

- `MOVE` means the product-consuming replacement lands and the old signature is deleted in the
  same change;
- `DELETE` means the listed surface is absent after the change;
- `KEEP` is retained only when its reachable signature itself makes independent subject selection
  impossible; a body that merely performs the expected check is insufficient and causes the row
  to be reclassified `MOVE` or `DELETE`; and
- `UNCLEAR` is resolved before any claim for its family.

The review packet describes that work list as 279 rows with 159 `MOVE`, 41 `DELETE`, 57 `KEEP`,
and one `UNCLEAR`. Those category figures total 258. At this branch's checked-in inventory, the
rendered classification labels are 158 `MOVE`, 41 `DELETE`, and 50 `KEEP`, with no `UNCLEAR`.
Therefore neither count set is a permitted completion checksum. Phase 0 must reconcile the receipt
and category totals; until then the exact checked-in row identifiers plus the file's re-derivation
procedure are authoritative. This discrepancy does not permit dropping a row or delaying the R1,
R4, or R5 design corrections.

The corrected mechanical measurements remain separate facts, not one semantic population:

- approximately 45 production `commit_guard`/`commit_guard_classified` calls in `engine.rs`;
- two server calls, including the previously missed `server.rs:932` nested-action call;
- eight raw `AdmissionEffectGuard` engine parameters;
- eight kernel final cuts; and
- 99 kernel forwarding occurrences, which are migration propagation, not seams.

`let _ = effect` in the raw engine bodies does not discard the guard: `effect` is a borrowed
reference and the caller's RAII guard remains live. Those sites lack correlation; they do not lack
retention. The prior feasibility buckets A=40, B=90, C=23, D=0 are planning counts only and are not
used as an inventory checksum.

## Migration phases and exact claim available at each phase

Every phase lists the strongest claim permitted immediately after that phase. No later-phase
property is borrowed early.

### Phase 0 — freeze and reconcile the population

Check in or correct the row-addressable registry generated from the staging inventory's
re-derivation procedure. Record each exact surface, production reachability, caller class, subject
source, durable effect, final cut, classification, replacement type, and deletion state. Reconcile
the count discrepancy above. Register the wider authority-plus-independent-subject predicate, not
“153 sites” as one population.

**Permitted claim:** **the exact recorded work list is frozen at the detector's declared search
boundary**.

**Why true then:** the checker compares stable row identities and rejects an unregistered change
to recognized authority/subject/staging/final-cut shapes.

**Not permitted:** semantic completeness, route closure, structural impossibility, or the durable
property. A new spelling, FFI path, or unrecognized authority erasure can evade the detector. That
is a **DETECTION BOUND**, not a type guarantee.

### Phase 1 — close final authority assembly

Introduce `AuthorityDraft<K>` and `FinalCallerAuthority<K>`, move all assembly before the final
mint, give new function/operation preparations fresh origins, and delete the eight assembly
surfaces listed above. Add downstream compile-fail fixtures for anonymous/session substitution,
service-witness construction, post-finalization attachment, public origin mint, and
origin-preserving `LiveRerun`.

Do not add the old two-argument `commit_guard(effect, subject)` as a durable acquisition API. If a
short-lived migration comparison exists on an unmigrated family, it is validation-only and is
deleted before that family begins Phase 2; it never returns or acquires an admission guard.

**Permitted claim:** **FINAL-AUTHORITY-ASSEMBLY-CLOSED for the named finalizer constructors**.

**Why true then:** only drafts have attachment operations, drafts have no origin, each exact
finalizer mints after scope/fences are fixed, and the listed post-origin construction surfaces no
longer compile.

**Not permitted:** any durable effect or route is correlated. Old staging and commit paths still
exist.

### Phase 2 — migrate kernel families one at a time

Introduce the consuming operation product and migrate one of the eight kernel families end to end.
In the same landing, delete every alternate raw/generic stage, forwarder, callback, commit, and
direct-transaction entry for that family. Delete any validation-only two-argument comparison for
that family before the new one-acquire final cut becomes reachable.

**Permitted claim per landing:** **EXACT-FINAL-CUT-CLOSED for the enumerated family surfaces**.

**Why true then:** the only reachable family commit consumes its exact staged product; `()`, an
arbitrary `G`, a caller callback, a second pending value, and an already-held raw guard do not
satisfy any remaining signature; the private armed state acquires one admission guard last.

**Not permitted:** closure of another family or the wider authority/subject population.

### Phase 3 — execute the complete row-addressed work list

Process every exact row in
`issues/20260824-uncorrelated-staging-entry-point-inventory.md`. A vertical-slice landing includes
all `MOVE` replacements and `DELETE` siblings that reach the same effect. Re-audit every `KEEP`
against the signature-level rule above and resolve every `UNCLEAR`. The registry records the exact
row IDs closed by each landing and rejects a surviving old surface.

**Permitted claim per landing:** **PRODUCT-CLOSED for the enumerated row IDs and operation kinds**.

**Why true then:** each named staging operation consumes one exact product, each named commit
consumes its staged state, and every listed carrier-independent sibling for those row IDs has been
deleted.

**Not permitted:** “all 279,” “all guarded writes,” “systemic fix,” or the repository property
until the reconciled registry has no unresolved/move/delete legacy row and the non-caller products
below are complete.

### Phase 4 — close caller-terminal, ceremony, operator, and handoff products

Land `CallerGrantRevocation`, `CallerBulkGrantRevocation`,
`ExpiredServiceAuthorityCommit`, named credential-ceremony products, operator products, and
durable-handoff products. Delete the R5 surfaces, the eight raw engine entry points, the direct
service-deadline surfaces, public/default service registry construction, and every generic
mode/system proof factory.

**Permitted claim per product:** **CALLER-CLASS-CLOSED for the enumerated operation product and its
deleted factory/sink list**.

**Why true then:** the exact commit accepts one product; its only constructor derives or verifies
the subject in the authorizing owner; ordinary caller authority cannot obtain a different-class
product; and the old plan/gate/guard paths are absent.

**Not permitted:** closure of an unenumerated class or a repository-wide structural claim.

### Phase 5 — claim gate; not currently supportable

Phase 5 is not supportable from the current tree or current review record. It becomes eligible
only after all of the following are true:

1. Phase 1's publication/service/rehearsal substitution surfaces are deleted.
2. The inventory receipt/count discrepancy is reconciled and every exact row has a final state.
3. All eight kernel families have no raw/generic sibling.
4. Every LLP 0298 durable effect is classified as an exact caller product, exact caller-terminal
   product, exact closed non-caller product, or an enumerated auxiliary effect satisfying all four
   LLP 0298 criteria.
5. The mutation/compile-fail evidence below is green on the exact integrated content.
6. Grok's corrupted middle is re-requested or explicitly waived by the author, and a fresh
   independent adversarial review finds no material construction path.

**Permitted claim before all six conditions:** none beyond the exact Phase 1–4 claims.

**Permitted claim after all six conditions:**

> Through the reconciled supported production surface, a durable effect cannot be constructed
> with independently selected authority, subject, operation scope, staged intent/plan, and final
> liveness retention; every non-caller durable effect consumes an exact product closed to the
> caller class.

**Why true then:** every recorded producer/consumer has one consuming product signature and every
enumerated alternate construction/commit surface is deleted, with compile-fail and adversarial
mutation evidence for the reachable API.

This remains a **DETECTION BOUND** with respect to future source edits, unrecognized FFI/storage
mechanisms, unsafe memory fabrication, or detector blind spots. The type system makes violations
through the completed supported safe surface impossible; the registry and review detect attempts
to expand that surface.

## Required deletion and compile-fail evidence

Evidence is scoped. A passing test for one product never proves another product or the registry.

### Final assembly attacks

Downstream fixtures must fail to compile when attempting to:

1. attach anonymous publication to a session authority;
2. attach session/service/rehearsal state after final-origin mint;
3. construct or default a service registry/witness and install it;
4. mint, clone independently, serialize, or extract a final origin;
5. preserve a final origin through F1 -> F2, nested-function preparation, or `LiveRerun`; or
6. finalize a session/service authority from loose resolved and publication arguments.

Runtime mutation tests remove each finalizer's exact publication/scope binding and must turn red.
Compile failure proves only surface closure; the runtime mutations prove the private constructor's
checks are load-bearing.

### Effect-product and R4 attacks

Fixtures must fail to compile when attempting to:

1. construct a product from authority A plus subject/plan B;
2. stage through a carrier-independent sibling;
3. extract or replace the subject, intent, reservation, pending value, or effect identity;
4. stage F2 and commit with F1's product or retention;
5. reuse the unstaged or staged product after its consuming transition;
6. implement a pending/commit-proof trait;
7. create `CorrelatedCommitGuard<()>` or another arbitrary retention inhabitant; or
8. call a raw/direct commit beside the product.

An owner-module runtime test creates two child effects inside one exact multi-cut parent product;
a second test creates F1 and F2 through two different function preparations from equivalent former
root inputs. Each attempts the internal cross-pair and asserts rollback plus no durable witness
after reopen. Positive controls commit non-empty effects. These private tests exercise the
defense-in-depth identity comparisons without adding a production constructor for forbidden
states.

### R5 ownership attacks

Fixtures must fail to compile for a separate terminal plan/gate/raw-effect composition. Runtime
tests attempt session A + victim B grant ID through the sole constructor and verify that no product
is returned, no terminal premark is installed, and no durable row changes. Mutation tests replace
the owner-keyed lookup with a grant-ID-only lookup and must turn red.

That evidence supports the exact grant-revocation product. It does not prove other terminal
products.

### Single-acquire and final-cut attacks

For every migrated final-cut shape, instrumentation must establish:

1. zero admission guards before the private arm transition;
2. exactly one guard after it;
3. the exact controller/epoch and product effect identity at the durable cut;
4. no admission-entering callback below arm;
5. guard retention through the durable cut; and
6. guard drop before post-commit publication/finalization.

Required production mutations remove retention, acquire twice, acquire early, use another
controller, restore post-guard `check_live`, or restore `FnOnce() -> Result<G>`/`()`. Each must
turn the relevant evidence red.

### Inventory and alternate-surface attacks

The registry checker fails on:

1. a new authority-plus-independent-subject signature;
2. a new staging/plan/ticket type carrying authority-derived subject data without an exact product;
3. a new generic `BeforeCommit`, generic `G`, raw durable `AdmissionEffectGuard` parameter, open
   pending/proof trait, or optional reservation;
4. a new direct SQLite/object-store/filesystem/receipt/queue/trigger cut outside a registered exact
   product consumer;
5. a reintroduced deleted surface from this document or an inventory `DELETE` row; or
6. an auxiliary classification not enumerated against all four LLP 0298 criteria.

The shortest gate-preserving violation is a new storage spelling or unrecognized FFI path. Hence
this checker is a ratchet and population map, not proof by itself. Independent source review and
durable mutation tests remain required.

## Relationship to LLP 0283 F-1 and LLP 0298

This design does not supersede LLP 0283 F-1. Correlating a durable operation product does not prove
authority-root custody, close public raw SQLite, or repair a caller-claimable authority root. The
design adopts F-1's stronger rule: an authority or commit capability is not closed when it is
available through a public enum, `Default`, self-implementable trait, closure factory, public
constructor, `pub(crate)` cross-module factory, or caller-supplied evidence.

This design adopts LLP 0298's effect scope unchanged. Publications, object/file writes, queues,
receipts, and future-affecting trigger state remain in scope. An auxiliary effect is excluded only
when it satisfies all four accepted criteria and appears in the checked-in enumeration. An
unclassified effect remains in scope.

## Open implementation questions and stop rules

1. **Owner/dependency placement.** The final-authority mint, effect-product mint, concrete
   retention, and durable consumer must share one ownership boundary that both authority and
   kernel code can use without an upward kernel dependency. A new leaf crate or a kernel-owned
   subtree after moving the relevant admission/fence core are candidate placements. If a compile
   spike cannot preserve the private mint and single-product rules, stop and return to design
   review. A public origin mint, public trait, generic callback, or caller-supplied evidence is not
   a fallback.
2. **Borrowing across staged SQLite transactions.** The concrete staged product must retain its
   `'tx` and admission lifetimes without exposing pending/retention halves. If Rust cannot express
   the proposed state directly, a private owner-module enum is allowed. A cross-module
   `CorrelatedCommitGuard<R>`, `PendingCommit`, or raw transaction is not.
3. **Exact operation scopes.** Every function and authority-only route needs an exact `K` and
   subject tuple. If a current batch combines multiple caller origins, partition it or commit a
   durable handoff per origin. Widening an origin to a set or using the first/system authority is
   rejected. No mixed-origin batch was proved absent in this revision; absence remains an open
   inventory question, not an impossibility claim.
4. **Inventory receipt discrepancy.** Reconcile the row and classification totals before any
   count-based phase claim. The row-addressed file remains the work list meanwhile.
5. **Unread review material.** Re-request Grok's corrupted middle before Phase 5 or obtain an
   explicit author waiver. Do not describe it as incorporated.

These questions can change placement or migration order. They cannot weaken the type rules or
authorize an exception. If a real operation cannot be expressed as one exact consuming product,
stop and revise this design before implementing that operation.
