# Mandatory subject/commit authority correlation — design

Status: Proposed design — no implementation or capability claim
Date: 2026-08-23
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Related: LLP 0058, LLP 0059, LLP 0283 F-1, LLP 0290, LLP 0293, LLP 0297,
  issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md,
  issues/20260823-origin-bound-commit-capsule-design.md

## Decision

Adopt mandatory correlation, but **do not adopt the proposed two-argument
`commit_guard` as the terminal design**.

Changing

```rust
reservation.commit_guard(effect)
```

to

```rust
reservation.commit_guard(effect, &subject_authority)
```

is a useful migration ratchet: it makes the currently unexpressible comparison
expressible and makes the compiler identify callers that have no subject. It is not,
by itself, unskippable. A sink can stage under `subject_b` and then pass `subject_a`
beside `reservation_a`; the comparison succeeds while B's intent commits. The current
pairing and detached-action failures are already examples of a sink accepting two
independent axes (`crates/snapback-engine/src/local/engine.rs:5791-5811` and
`:1407-1467`). Adding a third independently selected occurrence of one axis does not
bind the first two.

The terminal shape is therefore:

1. mint a private **logical authority-origin identity** once at root authority
   preparation;
2. preserve that identity through sanctioned derivations and no others;
3. pair the prepared subject and the reservation it minted in one opaque
   `BoundAuthorizedEffect` carrier;
4. require every caller-authorized sink to derive both subject checks/staging and the
   final guard from that one carrier; and
5. replace the kernel's unconstrained `FnOnce() -> SnapbackResult<G>` callback with an
   exact final-cut protocol that carries and checks that origin at the SQLite commit.

There is no `unchecked`, `assume_correlated`, public proof constructor, unit-returning
fallback, or caller-implementable trait in this design. Non-caller commits use separate,
closed carriers for mode-only, terminal, durable-handoff, or named credential-ceremony
authority. They do not counterfeit a `PreparedAuthority`.

This design makes a mismatch impossible through the completed supported production
surface; it does not make a future source edit unable to add a new bypass. The inventory
and mutation gates below are what keep that surface closed over time.

## Verified inputs and limit of this pass

This pass treats the established census totals as inputs and verified the enforcement
code and representative members of every relevant shape. The census issue currently
records 54 engine signatures, 99 kernel signatures (one `cfg(test)`-only), and zero
comparisons (`issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md:12-19`).
Despite being described as the location of a full site table, the file on `origin/main`
contains totals and effect classes, not 153 per-site rows. I therefore do not claim to
have independently reproduced the census or to know that the examples below exhaust
every semantic subtype. A checked-in migration registry is phase 0 precisely so this
uncertainty does not survive into implementation.

The root defect is present as stated:

- `AuthorizedEffectReservation` privately retains a `PreparedAuthority`
  (`crates/snapback-sync/src/auth/invocation.rs:1254-1262`), cloned from the minting
  authority at reservation time (`:2194-2205`, `:2271-2274`).
- `commit_guard_classified` retains the reservation's service permit, validates the
  reservation's rehearsal authority, and locks the reservation's admission lease
  (`:1663-1716`). It receives and compares no subject authority.
- `RetainedLiveAuthority::matches` is a method on another type and compares mode,
  profile, and `AuthorityKey` (`:2420-2451`). `PreparedInvocation::authority` is also on
  another type (`:2538-2541`). Neither makes correlation expressible from a
  reservation.
- The eight raw engine surfaces really do accept an `AdmissionEffectGuard` and discard
  the reference before writing; examples are registration (`crates/snapback-engine/src/local/engine.rs:5702-5727`),
  pairing presentation (`:5846-5863`), and grant approval/denial (`:5875-5905`).
- Kernel transaction helpers really are polymorphic over any returned `G`; for example
  `commit_buffered_writes_for_lane` accepts
  `BeforeCommit: FnOnce() -> SnapbackResult<G>`
  (`crates/snapback-kernel/src/storage.rs:6357-6370`), and the leaf merely binds
  `_commit_guard = before_commit()?` before committing (`:6292-6323`, `:7247-7260`).
  Consequently `|| Ok(())` is type-correct.

## Property and vocabulary

For one durable caller-authorized effect:

- the **subject origin** is the logical root from which the authority used to authorize
  and stage the effect was derived;
- the **reservation origin** is the logical root retained by the
  `AuthorizedEffectReservation`; and
- correlation holds exactly when the two private origin tokens are the same allocation.

The desired invariant is:

> Every caller-authorized durable COMMIT is performed while the admission, publication,
> service, and rehearsal guards retained for the same logical authority origin that
> authorized and staged that commit remain live.

“Same” deliberately does not mean the same user, session facts, source enum, admission
epoch, or Rust `PreparedAuthority` value. It means descent from one root preparation.
The subject may be a clone or a sanctioned reclassification of that root. A separately
prepared value is a different origin even when all visible facts are equal.

This is an effect property, not a function-name property. LLP 0297 includes any path
whose successful execution can change state surviving process restart and allows an
auxiliary classification only when the operation is non-durable, non-authoritative,
non-future-affecting, and has no trigger/output side effect
(`llp/0297-durable-effect-scope.decision.md:14-45`).
An unclassified site remains in scope (`:68-83`).

## The comparison predicate

### Candidate analysis

“Correctly admits” and “wrongly refuses/admits” below refer to concrete verified site
shapes, not an unrecorded per-row table. Where I could not construct a case, I say that;
that is not a proof that no case exists.

| Candidate | Correct admissions | Wrong refusals | Wrong admissions | Verdict |
| --- | --- | --- | --- | --- |
| Principal or user ID | Same-user grant management and pairing calls such as `mint_pairing_code_with_authorized_effect` (`engine.rs:5791-5811`) | Service principals without an effective user, system work, and credential ceremonies have no one user to compare | Two sessions for one user; a session and delegated service principal acting for that user; two service grants for one actor | Far too loose and incomplete |
| Session identity (ID, optionally generation) | Session-authorized effects and their source-changing derivatives | Every service-principal, revalidated-principal, system/operator, and credential-ceremony site | Two independently admitted requests in the same session; session identity also omits provider/deadline/rehearsal and `authority_instance_id` facts present in the resolved session (`invocation.rs:329-343`) | Too narrow as a domain and too loose within sessions |
| Principal plus `InvocationSource` | Ordinary same-source session calls | Legitimate nested mutation changes the source with `inherit_for` (`invocation.rs:2376-2395`); ask re-entry changes `HttpAsk`/`HttpMcp` to `HttpQuery` (`:2398-2416`); watch preparation changes `WatchManagement` to evaluation/reaction (`:1962-1988`) | The pairing fence already checks session user plus `AgentGrantManagement` source while accepting an unrelated reservation (`engine.rs:5819-5844`) | Demonstrably repeats the defect |
| Admission controller or `(controller, epoch)` | Every same-epoch route | I could not construct a legitimate current caller-backed site it wrongly refuses; that is not proof | Every concurrently admitted request in the epoch. `AdmissionController::owns_lease` compares only the controller `Arc` (`crates/snapback-auth/src/auth/admission.rs:211-222`) | Far too loose |
| Exact `AdmissionLease` token allocation | Clones and the source-changing derivations above, because lease clones share one `LeaseToken` (`admission.rs:816-820`) | I could not construct a required current derivation using a different lease; a live rerun does receive a new lease (`invocation.rs:2457-2482`), but it should be a new root for a new commit | `prepare_admitted_authority` is public and accepts an independently supplied lease and resolved authority (`invocation.rs:2711-2732`); cloning one lease can therefore prepare two different authorities under one token | Close, but still too loose |
| `RetainedLiveAuthority::matches`: mode + profile + `AuthorityKey` | Same session/service identity across the sanctioned source changes above | I could not construct a wrong refusal among the sampled caller-backed paths; that is not an exhaustive result | Separate preparations in the same session. For services, `AuthorityKey` omits token ID, effective user, scopes, expiry, and integration status (`invocation.rs:723-747`, `:577-614`), all of which exist in `ResolvedAppAuthority` (`:368-380`) | Use its encapsulated comparison *shape*, not its predicate |
| Full `ResolvedAppAuthority` equality | Clones and current source-only derivations | I could not construct a current sanctioned same-root derivation that changes `resolved`; that is not proof | Separately prepared authorities with byte-equal resolved facts; it ignores admission lease, publication fences, rehearsal state, source, and root preparation | Still too loose |
| Full `PreparedAuthority` field equality, including source | Exact clones | Nested mutation, ask, and watch derivations cited above; equality is also not presently implementable for all retained handles | Depending on omitted/non-equality fields, independently prepared equal facts can still collapse | Too strict where useful and unreliable where loose |
| Address identity of the `PreparedAuthority` struct | Only the same borrowed object | Nearly every current reservation: reservation mint clones the authority (`invocation.rs:2271-2274`), and server paths clone authorities before moving into Local, for example grant approval (`crates/snapback-server/src/server.rs:17426-17434`) | None constructed | Unusable. Pointer identity is correct only for a deliberately shared inner origin, not the outer struct |
| New private logical-origin `Arc` | Clones; `prepare_function`; nested mutation, ask, and watch derivations; service-scoped calls derived from the same preparation | I could not construct a legitimate sampled caller-backed effect requiring two root preparations. The missing 153-row table means implementation must verify this site by site; this sentence is not an impossibility claim | None through the proposed carrier API: a separately prepared authority receives a distinct allocation even with identical facts | Chosen predicate |

### Chosen origin identity

Add a private field to `PreparedAuthority`, conceptually:

```rust
authority_origin: AuthorityOrigin // private Arc-backed identity
```

`AuthorityOrigin` has no serialized form, string ID, equality-derived public field, public
constructor accepting data, or accessor that returns its inner `Arc`. Its only comparison
is a private `matches`/`same_origin` operation using `Arc::ptr_eq`. This follows the
existing origin-bound graph seal: `EngineAppStateGraphIdentity` stores a private `Arc<()>`
(`crates/snapback-engine/src/local/engine.rs:3161-3167`) and composition compares it with
`Arc::ptr_eq` before assembling `AppState` (`:3418-3458`).

Mint a new origin only in root preparation, beside the existing construction at
`InvocationGate::prepare_admitted_authority_inner` (`invocation.rs:2735-2745`,
`:2814-2832`). Preserve it by ordinary `Clone`, by consuming authority into
`PreparedInvocation` (`:2912-2955`), and by the sanctioned source-changing constructors
listed above. `RetainedLiveAuthority::prepare_rerun` prepares under a fresh
`AdmissionLease` (`:2457-2482`) and therefore gets a fresh origin. A durable handoff or
revalidated-principal reconstruction likewise begins a new origin and must reserve anew.

The origin is a correlation identity, not authorization evidence. It does not replace
session/service freshness, source/target checks, grant scopes, rehearsal validation,
publication permits, or the admission mutex. It only answers whether two already
authorized artifacts descend from the same preparation.

## One carrier, not two independent parameters

The landed capsule supplies the carrier prior art. `CommitCapsuleReservation` privately
stores one `PreparedAuthority` and the reservation it minted, and exposes only borrowed
views inside the capsule (`crates/snapback-server/src/server/commit_capsule.rs:91-117`).
Its factory reserves from the stored authority (`:99-103`). The generalized carrier has
the same ownership rule:

```rust
// Public only across the internal sync -> engine crate boundary; fields stay private.
pub struct BoundAuthorizedEffect {
    subject: PreparedAuthority,
    reservation: AuthorizedEffectReservation,
}

impl PreparedAuthority {
    pub fn reserve_bound_effect(
        &self,
        effect: &'static str,
    ) -> Result<BoundAuthorizedEffect>;
}
```

The exact names are implementation choices; these visibility and custody rules are not:

- the constructor clones one subject and reserves from that same subject internally;
- fields are private;
- cross-crate visibility is limited to an opaque workspace-internal type and factory; the
  carrier is not re-exported as an application/user construction surface;
- no constructor accepts a subject and reservation separately;
- no `into_parts`, reservation accessor, origin-token accessor, or public clone of the
  reservation exists;
- a sink accepts the carrier, not `(authority, reservation)`;
- subject policy checks and staging borrow `carrier.subject()` internally; and
- the final cut consumes or mutably borrows that same carrier.

For example, the end-state pairing signature is conceptually

```rust
mint_pairing_code(bound: BoundAuthorizedEffect, user_id, ...)
```

and both `require_pairing_code_mint_authority` and the commit cut use `bound`. It is not

```rust
mint_pairing_code(subject: &PreparedAuthority,
                  bound: BoundAuthorizedEffect,
                  ...)
```

because that recreates the independent B/A composition.

Inside the carrier, guard acquisition compares the subject origin with the reservation's
retained origin using the private predicate before taking any locks. A mismatch returns a
new stable `SNAPBACK_AUTHORITY_ORIGIN_MISMATCH`-class diagnostic and performs no effect.
The comparison remains even though the constructor makes mismatch unconstructible; it is
defense in depth against future internal refactoring and supplies a direct mutation
oracle.

The proposed two-argument `commit_guard` is acceptable only as a temporary, non-claiming
migration API. It must become non-public or disappear when each vertical slice adopts the
carrier. Leaving it as the ordinary end-state API would leave caller-selected pairing as
the security boundary.

## The kernel final cut: the 99 sites require their own mechanism

The signature change on `AuthorizedEffectReservation` does **not** reach the 99 kernel
forwarding sites. Their contract is “return any `G`,” not “prove the staged origin is the
guarded origin.” The kernel discards the value after keeping it in scope
(`storage.rs:6292-6323`, `:7247-7260`). A caller can continue to return `()` or a guard
for another authority.

The fix is an exact, origin-carrying final-cut protocol, not a renamed generic callback.
Conceptually the vertical flow is:

```text
BoundAuthorizedEffect
  ├─ subject view ──> policy check and staging ──> PendingCommit(origin)
  └─ reservation ──> correlated final guard(origin)
                                            │
PendingCommit compares both private origins ┴─> SQLite COMMIT
```

The kernel protocol has three concrete pieces:

1. **`PendingAuthorizedCommit` records the subject origin.** The engine creates/stages it
   only through an operation that receives the bound carrier's subject view. It is opaque
   outside the kernel and has no public constructor from an origin token or raw
   transaction.
2. **`CorrelatedCommitGuard<R>` records the reservation origin and owns all guard
   retention.** It holds the admission guard directly and an otherwise opaque `R` that
   retains publication, service, rehearsal, and the reservation. The generic parameter
   is retention *inside a concrete proof type*; it is not the present unconstrained
   callback result. Its only reachable production factory requires the private subject
   and reservation origins and acquires the admission guard itself. It cannot be
   synthesized from `()`, an arbitrary closure, a boolean comparison result, or an
   already-held `AdmissionEffectGuard` reference.
3. **Only `PendingAuthorizedCommit::commit(CorrelatedCommitGuard)` can issue SQLite
   COMMIT.** It compares its subject origin with the guard's reservation origin, then
   commits while the guard remains live. A mismatch rolls back. Forwarders pass the
   opaque pending value or a concrete final-cut port; they do not remain generic over
   `G`.

The current crate direction matters: `snapback-auth` and `snapback-sync` already depend
on `snapback-kernel` (`crates/snapback-auth/Cargo.toml:16-31` and
`crates/snapback-sync/Cargo.toml:19-31`), while the kernel does not depend upward
(`crates/snapback-kernel/Cargo.toml:19-40`). Therefore the small origin/final-cut
vocabulary and the mutex-owning admission primitive must live in the kernel or a new leaf
crate below both kernel and auth. The kernel must not import `PreparedAuthority` or
`AuthorizedEffectReservation`.

The preferred implementation is to relocate the process-local admission core
(`AdmissionController`, `AdmissionLease`, and `AdmissionEffectGuard`) to a kernel-owned
module and re-export it from auth. A new leaf crate below both kernel and auth is an
acceptable equivalent. The lower module can then define this exact constructor shape:

```rust
// schematic: all fields and origin access remain private
AdmissionLease::correlated_commit_guard<R>(
    subject_origin: &SubjectCommitOrigin,
    reservation_origin: &ReservationCommitOrigin,
    retention: R,
) -> Result<CorrelatedCommitGuard<R>>
```

It first compares the opaque origins, then acquires the admission guard once, and returns
one concrete outer type that owns both the mutex guard and `retention`. Kernel leaves may
be generic over `R`, but they require `CorrelatedCommitGuard<R>`; `R` alone and `()` do
not satisfy the contract. The two origin views are obtainable only inside the bound
carrier/final-cut assembly, not through public accessors.

For final-cut timing, `BoundAuthorizedEffect` may create an opaque one-shot
`AuthorizedFinalCut<R>` whose private callback yields that concrete guard after staging.
The 99 forwarders carry this object unchanged, and the leaf passes its recorded subject
origin into it and compares the returned guard's origin again. The public callable
contract never accepts an arbitrary closure. This preserves “guard last” without
preserving “caller returns any G.” If this dependency reshape proves impractical,
implementation must return to design review; retaining `FnOnce() -> Result<G>` is not an
acceptable fallback.

The existing `CommitCapsuleAuthority`/`ExactCommitRows` demonstrate the lower-layer
pattern: private database binding is compared when the kernel-minted witness is consumed
(`crates/snapback-kernel/src/storage.rs:837-917`). They do not themselves prove subject
correlation, because `CommitCapsuleAuthority` is cloneable and currently exposed
(`:837-855`).

### Forwarding rule

Every one of the 99 signatures must end in one of these exact forms:

- caller-correlated `PendingAuthorizedCommit` + `CorrelatedCommitGuard`;
- a closed mode/system final cut;
- a terminal-accounting final cut;
- a durable-handoff claim final cut; or
- a named auxiliary/non-durable operation outside LLP 0297's four durability criteria.

There is no generic `BeforeCommit`, generic `G`, or closure returning an unconstrained
type. Pure forwarding helpers carry the same opaque pending/final-cut object; they do not
open and re-box it at every layer. This is how the fix reaches all 99 rather than stopping
at the engine boundary.

## Sites with no single `PreparedAuthority`

Absence of a `PreparedAuthority` is a demand to classify the authority, not permission to
bypass correlation.

### Batch and fan-out

A fan-out may have many recipients but still one initiating authority origin. Immediate
push currently reserves once for a caller-authorized request
(`crates/snapback-engine/src/local/engine.rs:7374-7418`), while the server creates fresh
reservations at the batch-claim and transmitting transactions
(`crates/snapback-server/src/server.rs:2609-2670`). Each durable transaction gets one
bound carrier descended from the initiating origin; recipient IDs are intent data, not
authority identities.

If a batch genuinely combines work from multiple authority origins, it must partition
the transaction by origin or first commit a durable handoff and let a worker claim each
unit under the handoff authority. It cannot pass the first subject, a set of subjects, an
“all equal enough” key, or system authority over a mixed transaction. I could not
construct a verified current immediate-push call that requires a mixed-origin SQLite
COMMIT; that is a migration hypothesis, not proof.

### Service-scoped calls

A `ServicePrincipal` is already a `PreparedAuthority` carrying credential generation,
grant, token, effective user, scopes, expiry, and integration status
(`invocation.rs:368-380`). It uses the same logical-origin carrier. Comparing only
`AuthorityKey` would lose several of those facts (`:600-610`); origin identity preserves
the exact preparation without forbidding legitimate delegation.

### System, operator, terminal, and durable-handoff paths

These receive different, sealed carriers, never a fake caller subject:

- `ModeCommitOrigin` is minted only by the closed source/mode classifier for genuinely
  mode-owned effects.
- `OperatorCommitOrigin` is minted only from the process-bound operator authority. The
  existing operator authority uses a private process identity
  (`crates/snapback-engine/src/local/engine.rs:3169-3175`).
- terminal accounting consumes its existing terminal gate and cannot be selected by an
  ordinary caller-authorized sink;
- durable-handoff work commits under a kernel-verified claim for the durable work item,
  not the authority that originally enqueued it.

These types must not share a public enum constructor or implement a public “commit proof”
trait. A private kernel enum may unify their leaf implementation after the type-specific
constructors have validated them. LLP 0293 already requires internal service to be
obtainable only from a durable work claim or a closed kernel operation, never a generic
`System` acquisition (`llp/0293-authority-transition-chokepoint.spec.md:394-444`).
This preserves LLP 0058's existing split: caller-backed sites reserve live authority,
mode-only sites have no session publication, terminal accounting is a distinct ruling,
and irreversible work transfers to a durable handoff
(`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1376-1416`).

The existing nested-action classification is useful input, not an automatic exemption:
Cron, watch evaluation/reaction, and config verify are classified mode-only, while other
sources are caller-bound (`crates/snapback-server/src/server.rs:797-858`). Each mode-only
case must show the closed scheduler/worker origin that authorizes its durable effect.

### Credential ceremonies and the raw guards

Two raw sites genuinely do not begin with a `PreparedAuthority`:

- agent pairing receives a route `AdmissionLease`, an agent credential, and pairing proof
  (`server.rs:17295-17317`);
- public/invited agent registration receives a route `AdmissionLease` and registration
  policy/invitation (`:17325-17362`).

Give these named carriers such as `PairingPresentationCommit` and
`AgentRegistrationCommit`. Each carrier is created only after the route admission and
the credential/invitation verification that supplies its subject, then flows through the
kernel as an exact ceremony final cut. It is not an “unchecked” variant: only that one
kernel operation accepts the carrier, and the carrier cannot authorize an arbitrary app
write.

The other raw sites already have a `PreparedAuthority` at the server. Grant approval, for
example, clones it, acquires its raw guard, and passes the guard independently from user,
session, and request IDs (`server.rs:17401-17441`); denial and revocation do the same
(`:17450-17467`, `:17492-17542`). They migrate to `BoundAuthorizedEffect`. The raw engine
entry points are deleted, not kept as a compatibility escape hatch.

## Non-reentrant admission mutex: replace, never wrap

`AdmissionLease::validate` locks `AdmissionState`
(`crates/snapback-auth/src/auth/admission.rs:951-958`). `effect_guard` locks the same mutex
and returns an `AdmissionEffectGuard` that owns the `MutexGuard` (`:960-996`,
`:1015-1022`). The mutex is non-reentrant. Calling either method while an old effect guard
is live can deadlock. This is the established nine-instance re-entrant failure class; the
existing design record states the governing rule as “replace, never wrap”
(`issues/20260822-critical-direct-route-fence-design.md:135-144`).

The implementation order is fixed:

1. compare the two `AuthorityOrigin` allocations with pure `Arc::ptr_eq`; no admission or
   service lock is touched;
2. perform rehearsal and service/publication retention in the established lock order;
3. acquire the admission effect guard exactly once and last;
4. move that existing guard into `CorrelatedCommitGuard` — do not acquire a second guard
   around it;
5. run no `AdmissionLease::validate`, `effect_guard`, mode transition, caller callback, or
   other admission-entering operation below that point;
6. commit, then drop the correlated guard before any post-commit work.

This is the existing normative order: retain caller permits outside Local, install the
service witness, and acquire the mode guard last at the deepest commit cut
(`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1338-1374`).

The landed capsule currently acquires one reservation guard immediately before commit and
drops it immediately afterward (`crates/snapback-server/src/server/commit_capsule.rs:630-682`);
that is the retention shape to preserve. The new comparison goes before its line 659
acquisition. It never wraps that acquisition.

Kernel leaves must also move any re-entering check above the final cut. Today the generic
cut is followed by `check_live()` (`storage.rs:6292-6294`, `:7247-7249`). Implementation
must inspect each such callback: if it can enter admission, move it before guard
acquisition; if it cannot, type/name it as a non-admission kernel check. “I could not make
this callback re-enter” is not sufficient evidence because its generic type does not
encode that property.

## Migration without a flag day

The migration unit is a complete vertical slice: caller/server classification, engine
subject use, kernel forwarders, leaf final cut, and tests. Migrating only the engine or
only the leaf recreates caller discipline at the seam.

### Phase 0 — freeze the population

Add a checked-in registry with one row for each of the established 153 signatures and
every LLP 0297 in-scope durable commit leaf. Each row records file/symbol, production vs
test, effect class, subject source, kernel leaf, and migration state. A generator/checker
must fail on unregistered guarded/transaction signatures and on count increases. The
existing issue is not a sufficient registry because it has no per-site table.

Provable claim: **census frozen at the patterns the checker recognizes**. The durable
effect property remains false.

### Phase 1 — introduce origin and a transitional mandatory comparison

Mint/preserve the origin, add the private predicate, and require the temporary
`commit_guard(effect, subject)` at migrated engine sites. Delete the one-argument form for
those sites; an exact allowlist retains it for unmigrated sites and only decreases.

Provable claim: **migrated guard calls reject a directly supplied mismatched origin**.
This is not route closure: a caller can still pass the reservation's authority instead of
the staging authority. The repo-wide property remains false.

### Phase 2 — land the kernel final-cut substrate

Introduce `PendingAuthorizedCommit`/`CorrelatedCommitGuard`, relocate the admission core
as required, and migrate one small kernel family end to end. Maintain an exact allowlist
of generic `BeforeCommit` signatures and `|| Ok(())` callers; it only decreases. Do not
wrap an existing `AdmissionEffectGuard` during compatibility.

Provable claim: **the named migrated kernel leaves cannot commit with `()` or an origin-
mismatched proof through their supported API**. Unmigrated leaves remain open.

### Phase 3 — caller-backed vertical slices

Migrate coherent families: capability links/invitations/pairing mint; mutations and
settlement; ask/push; asset attempts/reads/publication; auth grants; remaining engine
families. Each sink accepts one `BoundAuthorizedEffect`, derives all subject use from it,
and uses the concrete kernel final cut. Remove each registry allowance in the same
commit.

Provable claim per landing: **ROUTE-CLOSED-FOR-MIGRATED-SINKS**, naming the exact sinks.
Do not say PROPERTY, systemic fix, all guarded writes, or 153-site closure.

### Phase 4 — non-caller classes and raw guards

Migrate mode/system, operator, terminal, durable-handoff, and credential-ceremony paths
onto their closed carriers. Delete the eight raw engine entry points and direct raw
`AdmissionEffectGuard` acquisition for durable effects. Any site that cannot be honestly
classified returns to design review; it does not receive an exception.

Provable claim: only the named class/sinks closed until the registry reaches zero legacy
rows.

### Phase 5 — close and claim

Delete the temporary two-argument API if independent axes remain possible, delete all
generic `BeforeCommit` and legacy/raw guard allowances, require a classification for
every LLP 0297 durable commit, run the mutation evidence below, and inspect the generated
zero-legacy registry.

Only then may the project claim:

> Through the supported production commit surface represented by the complete registry,
> a caller-authorized durable commit with mismatched subject and reservation origins is
> unconstructible, and all other durable commits require a closed typed authority class.

That is a structural claim about a frozen surface, not a mathematical claim that no
future code change can add a new commit path. If the registry checker recognizes only a
finite spelling set, say so in the evidence rather than calling discovery complete.

## LLP 0283 F-1 and LLP 0297

This work adopts LLP 0297's effect-based scope unchanged. It does not narrow “durable
effect” to SQLite helper names and does not use “auxiliary” as an escape hatch. The
registry must include publications, queues, receipts, filesystem/object-store effects,
and trigger-state changes when they meet LLP 0297's criteria
(`llp/0297-durable-effect-scope.decision.md:14-66`).

This design **does not supersede LLP 0283 F-1 itself**. F-1 records four authority-
transition/reachability defects and forbids capability-downgrade closure factories
(`llp/0283-post-rearchitecture-followups.plan.md:126-202`, `:297-315`). Origin
correlation neither proves F-1's root custody nor closes public SQLite reachability.

It **does supersede the remaining per-path caller-authority correlation fences** in the
F-1-adjacent authorized-effect program. Do not land more fences that accept independent
subject and reservation axes. Existing route fences may remain as temporary defense
until their vertical slice migrates, then should be replaced by the shared carrier and
kernel cut. F-1's closed root/callback-factory work, terminal accounting, mode-only
classification, and durable-handoff fences remain separate obligations. LLP 0283 itself
already says F-1 and the authorized-effect program are separate and that the property is
currently false (`llp/0283-post-rearchitecture-followups.plan.md:81-90`).

## Evidence and the shortest green-preserving mutation

Every test below names what it proves and the shortest production mutation that can keep
it green. If such a mutation exists, the test is supporting evidence only, not evidence
for the repo-wide property.

### 1. Predicate mismatch and sanctioned derivation tests

Create two root `PreparedAuthority` values with byte-identical resolved/session facts and,
separately, with a cloned admission lease. Assert A/A succeeds and subject B with
reservation A returns the exact mismatch diagnostic before any test commit counter moves.
Also assert `inherit_for(NestedMutation)`, ask re-entry, watch reclassification, and
ordinary cloning preserve correlation.

- Mutation that must make the negative test red: remove `Arc::ptr_eq`, compare
  `AuthorityKey`, compare resolved facts, or compare the admission lease.
- Shortest mutation that keeps this test green while the system is false: add or retain a
  sink that never calls the predicate, or let a sink stage with B and call the predicate
  using A/A.
- Verdict: evidence for the predicate only, never the repo property.

The positive derivation cases are also mutation oracles: adding `InvocationSource` to the
predicate must make nested/ask/watch cases red. A new untested derivation could still be
wrongly refused while these stay green, so the migration registry must name all derivation
constructors.

### 2. Opaque-carrier compile-fail tests

Downstream fixtures must fail to compile when attempting to:

- construct `BoundAuthorizedEffect` from `(subject_b, reservation_a)`;
- extract its reservation or origin token;
- call a migrated sink with a second subject;
- build or implement a fake correlated proof; or
- reuse the carrier after a consuming final cut where the operation is one-shot.

- Shortest mutation that keeps one fixture green while the property is false: add a
  differently named public constructor/sink, or leave an old sink enabled that the fixture
  does not call.
- Verdict: evidence for the named API closure only. It becomes population evidence only
  with the zero-legacy registry and public-surface inspection.

### 3. Kernel negative compile and runtime tests

Fixtures must fail to compile for `|| Ok(())`, `|| Ok(fake_guard)`, a caller-implemented
commit-proof trait, and direct `tx.commit()` through each migrated kernel family. A runtime
test must stage pending origin B, supply a real guard for A, observe rollback and the
origin-mismatch diagnostic, and verify the durable row/version/receipt is unchanged after
reopening the database.

- Mutation that must make these tests red: restore generic `G`, expose a proof
  constructor, skip the leaf origin comparison, or add a raw commit method in the tested
  family.
- Shortest mutation that keeps them green while the repo is false: add an unregistered
  commit helper or bypass in another family.
- Verdict: evidence for each named kernel family, not for all 99.

### 4. Per-sink swapped-origin tests with durable witnesses

For each caller-authorized vertical slice, create A and B with deliberately identical
user/session/source facts but distinct root origins. Stage the exact production intent as
B, attempt the final cut with A, and assert both the mismatch diagnostic and the absence
of the shortest durable witness after reopen. Positive A/A control must commit the same
non-empty effect. Pairing must check the pairing row/secret state; mutations must check
app rows plus version/settlement; asset paths must check attempt/receipt/quota state; push
must check claim/transmitting rows.

- Shortest mutation that keeps one test green while the property is false: bypass the
  guard in another sink, or make the tested operation a no-op. The positive non-empty
  control catches the latter, not the former.
- Verdict: route-closure evidence for the exact production sink only.

Tests whose callers always pass pre-correlated A/A are not evidence for correlation. That
is the precise reason the prior fences' tests stayed green while the property was false.

### 5. Single-guard/deadlock tests

At each migrated guard shape, test under a bounded timeout that the operation completes,
that the exact controller/epoch guard is held at the SQLite cut, and that the live-guard
count is exactly one. Exercise both success and refusal/drop paths. No hook may attempt to
lock the admission mutex merely to observe it; current test instrumentation is explicitly
lock-free (`admission.rs:999-1012`).

- Shortest mutation that keeps a timeout-only test green: drop the outer guard and commit
  unguarded, or acquire the wrong controller's guard.
- The exact guard-identity/count and negative transition race are required to make those
  mutations red.
- A different migrated site can still wrap twice while this test stays green; this is
  per-shape evidence.

### 6. Classification and inventory gate

Generate the registry from all known transaction/commit spellings and compare it with the
checked-in classification. Fail on a new generic `BeforeCommit`, raw
`AdmissionEffectGuard` durable parameter, one- or two-axis reservation sink, direct SQLite
commit outside a registered final cut, unclassified LLP 0297 effect, or an allowlist count
increase. Require zero legacy rows before the final claim.

- Shortest mutation that can keep this gate green: spell a commit through a mechanism the
  detector does not recognize, hide it behind FFI, or misclassify a durable effect as
  auxiliary.
- Verdict: a ratchet and population map, not proof by itself. Independent code review and
  the durable-effect tests are required.

### 7. Required mutation suite for the final property claim

The final evidence packet is acceptable only if it shows red results for at least these
production mutations against the integrated tree:

1. remove the origin comparison;
2. weaken it to principal, `AuthorityKey`, resolved equality, controller/epoch, or lease
   identity;
3. stage with B and guard with A;
4. restore `BeforeCommit: FnOnce() -> Result<G>` and return `()`;
5. expose a carrier/proof constructor or reservation accessor;
6. classify one caller-backed sink as mode/system;
7. wrap the new guard around an already-held admission guard; and
8. remove guard retention immediately before SQLite commit.

No individual green test establishes the property. The evidence is the conjunction of
the zero-legacy inventory, negative construction tests, real swapped-origin durable
tests, exact final-cut retention, and demonstrated mutation sensitivity. Even then the
honest wording is “violation is impossible through the inventoried supported production
surface.” It is not “I could not construct a violation,” and it is not a claim about
unrecognized future commit mechanisms.

## Open implementation questions that must not be guessed

1. **Complete semantic grouping of the 153 signatures.** The current issue lacks the
   promised per-site table. Phase 0 must reconstruct and review it before choosing slice
   order. This uncertainty does not change the root design.
2. **Admission-core relocation boundary.** A spike must confirm whether moving the three
   mutex-owning types into kernel is smaller than introducing a new leaf crate. The
   acceptance criterion is an exact non-forgeable kernel guard with no generic `G`, not a
   preferred module name.
3. **`check_live` below current guards.** Each concrete callback at
   `storage.rs:6293`/`:7248` must be traced to enforcement code. If any can reach
   admission, it moves before the final guard. Static inspection plus a re-entry mutation
   settles this; comments do not.
4. **Mixed-origin batches.** The checked-in registry must identify whether any current
   SQLite transaction actually aggregates more than one caller origin. If one exists,
   partitioning or durable handoff is required; widening equality to a set is rejected.

These are implementation-discovery questions, not permission to add a bypass. If any
answer invalidates the single-origin carrier for a real site, stop and amend this design
before coding that site.
