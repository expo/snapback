# LLP 0303: Subject/authority correlation policy — the derive-not-supply ruling

**Type:** Decision
**Status:** Accepted
**Systems:** Auth, Sync, Engine, Kernel, Server
**Author:** Claude (Opus 5), commissioned by Charlie Cheever (author ruling
2026-08-24, in session supervising LLP 0283 F-1)
**Date:** 2026-08-24
**Revised:** 2026-08-25 (p — the fix inherits the defect; the guard test rarely tries the live route)
**Related:** LLP 0283, LLP 0298, LLP 0285, LLP 0274,
`issues/20260824-liveness-row-bucket-assignment.md`,
`issues/20260824-entitlement-predicates-for-the-live-sites.md`

## Ruling

Author ruling 2026-08-24, on the 45 open authorization questions covering 68 liveness-only
factory rows (`issues/20260824-liveness-row-bucket-assignment.md`).

**The recommendations recorded in this document are approved. Implement them.**

## The governing principle

Across all 45 questions the defect has one shape: an authority is validated for liveness, the
subject it acts on is supplied independently by the caller, and nothing ties the two together.
The ruling is therefore a single rule with enumerated exceptions:

> **The subject must be derived from the authority, not supplied alongside it.** Where a
> mismatched pair can be constructed and then rejected, prefer removing the parameter so the
> mismatch is unconstructible. Verification is the weaker outcome and requires a stated reason.

Exceptions are not "trusted callers". They are flows that are **cross-principal by design**, and
each carries its own binding rule rather than a relaxation.

## Corollary — the artifact must carry provenance, not just type

Added 2026-08-24, after the first three implementation lanes were each blocked by an executable
review for the same reason.

Deriving the subject from the authority usually means introducing an artifact — a seal, an
operation identity, a bound attempt, a witness — that only the verifying path can produce. Three
independent lanes built such an artifact and each shipped the same hole:

- **Q03** sealed the revocation attempt by type. A reviewer resolved a real plan, built a *second*
  `LocalDatabase::memory()`, committed against that disposable database, and handed the resulting
  seal to the live coordinator. The live durable row stayed `(generation 1, revoked_at None)` while
  the live projection accepted the seal and revoked the session.
- **Q05** made the operation identity a provider pointer plus an RNG nonce, where the `RandomSource`
  is caller-supplied and the repository already ships constant sources that repeat every byte. Two
  operations on one provider could receive equal identities.
- **The authority seal** bound a `LeaseToken` that could still prepare two genuinely different
  authorities.

Each artifact proved *"something of the right type exists"*. None proved *"this specific instance
produced it."* A type-only seal is not a correlation; it is a forgery machine as soon as a second
instance of the right type can be constructed — and under `test-support`, public constructors for
second instances generally can be.

> **Any artifact introduced to carry a derivation must identify the instance that produced it, and
> the consumer must verify that it is the instance now consuming it.**

**Ask it by shape, not by intent.** Two lanes reported "no new seal, witness, marker, token, or
provenance identity was introduced" while introducing several — one added `AuthenticatedHostedTarget`,
the other eight `Prepared*` and `Retained*` carriers. Neither was being careless: those words name a
category of *purpose*, and a `PreparedEffectApproval` does not feel like a seal to the person who
wrote it. The question that cannot be mis-answered is:

> **Does your diff add or modify any type that travels between a verification and an effect?**

If yes, it is an artifact under this corollary, whatever it is called.

Four questions settle it, and a lane that introduces such an artifact answers all four explicitly:

1. Which instance produced this?
2. Can a second instance of the same type produce an equal one?
3. Can `test-support` staple it to an outcome it did not come from?
4. **Is it `Clone`, and if so what stops a clone being used twice?**

Question 4 was added after a reviewer defeated a lane whose artifact *was* consumed by value:

```rust
verified2 = verified.clone();
install(verified, db0);
install(verified2, db1);
```

Both installs succeeded and wrote `(id, epoch, floor) = (1, 4, 9)` to both databases. **Consumption
by value is not linearity when the type derives `Clone`.** Ask question 4 of every type in the diff,
including types the lane did not author but did make reachable — and check whether consumers take the
artifact by reference, since then a second use needs no clone at all.

Question 3 is not a lesser one. `test-support` is not a safety boundary in this repository: a
feature-enabled public API is part of the surface, so "only tests can do that" does not answer it.
Uniqueness must also not rest on caller-supplied randomness — a provider-owned monotonic source is
the mechanism; a nonce is defence in depth.

The accepted shape already exists: `EngineAppStateGraphIdentity` is a private `Arc<()>` compared
with `Arc::ptr_eq` (`crates/snapback-engine/src/local/engine.rs`). Reuse it rather than inventing
another.

### Coverage, not just the primitive

Added after Q03 round 3, where the primitive was right and the lane still shipped an exploit.

Q03 bound its revocation path correctly — `Arc<()>`, `Arc::ptr_eq`, private constructor — and an
executable review confirmed the original exploit dead. It then walked in through `finish_rotation`,
which had kept the *unsealed* type, and through `finish_issuance`, whose binding check inspected only
revocation plans and so was a no-op for an issuance plan carrying `revocations: Vec::new()`.

The worst composition needed **no second database and no durable commit at all**: plan through the
ordinary production API, premark, skip the commit entirely, and hand `finish_rotation` a
caller-built `AuthTransactionAttempt::Committed { .. }` — every field public. The live projection
accepted a commit that never happened.

> **A binding applied to one path while its sibling paths keep the raw type is not a binding.** The
> unbound sibling is the whole attack surface, and it is usually the one nobody demoed.

So a lane that introduces a binding must enumerate **every** entry point that can mutate the same
durable state and bind all of them, or state explicitly which are left unbound and why they cannot
authorize finalization. Partial coverage must be declared, never assumed from the fixed path.

Check the binding *predicate* too, not only its presence: Q03's issuance check ran, passed, and
proved nothing, because it examined a collection the attacking plan left empty.

### Why coverage kept leaking: both lanes chose VERIFY where DERIVE was available

Q03 and Q05 reached round 3 and round 4 with the same story — correct primitive, leaking coverage —
and the common cause is a disposition choice this ruling already warned about.

A binding compared at a call site is **VERIFY**. It must be repeated at every carrier that can
authorize a durable mutation, and any carrier added later silently opts out. That is not a
maintenance risk in the abstract; it is what both lanes actually shipped. Q05 was reachable
**through the production API with no `test-support` at all**: `AddressAdmission` minted one identity
and `plan_mint_session` cloned it, so two mint plans were one operation, and `into_issue` released
one operation's plaintext against another operation's durable session.

The reviewer's fix for that names the alternative exactly:

> mint inside `plan_mint_session`, or take `AddressAdmission` by value so a second plan is
> unconstructible.

That is **DERIVE**, and it is what this ruling prefers. Two rules follow:

1. **Mint identity where the object is created, not upstream of it.** An identity minted at
   admission and cloned into each plan makes every plan from that admission the same operation. Mint
   per plan.
2. **Consume by value what must not be reused.** `self` rather than `&self` turns "a second one
   would be rejected" into "a second one cannot be built" — and needs no check at any call site,
   including sites that do not exist yet.

Reach for a comparison only when the pairing genuinely cannot be made unconstructible, and say why
in the landing. A lane answering a coverage finding by adding one more comparison is treating the
symptom; the finding is evidence that the disposition was wrong.

### Derivation is a lifetime property, not a constructor event

Found when a lane correctly derived three fields in a constructor and a reviewer set all three back
immediately afterwards, from a separate dependent crate, with two executed compositions:

- `advance_authenticated_authorization` took an independently supplied authorization.
- `replace_authenticated_expectation` took an independently supplied authorization, version stream
  **and** issuer ID.

> **Deriving at construction establishes nothing if the object exposes setters for the derived
> fields.** The subject must be derived for as long as the object can act, not for the instant it was
> built.

A lane that derives a field must therefore enumerate **every** method that can mutate it, and for
each one either remove it, make it derive from the same authority, or make it consume the object so
a mutated value cannot outlive its verification. State the complete list in the landing: a method not
enumerated is a method not fixed.

### A derivation is only as strong as its root

The same review found the chain's root was caller-constructible. `LiveInvalidationIssuer::new` only
**shape-checked** a caller-built `AuthenticatedBootIssuer` — it did not authenticate the MAC or prove
the boot sequence had been reserved — and the type is `Clone` while its consumer merely **borrows**
it. A dependent crate built two independent issuers from one fake descriptor with an unreserved boot
sequence, bound both to clones of one database view, and installed different streams.

> **Deriving from a forgeable authority derives nothing.** Follow the chain to its root and check that
> the root authenticates rather than shape-checks.

Note the ordering of strength, because lanes keep reaching for the weakest: consuming by value is
weaker than it looks when the type is `Clone`; **borrowing is weaker still**, since it does not even
pretend to be single-use.

### The wrapper is not the binding: combinators and recycling

A lane derived its room selection from a database-produced carrier — correctly — and a reviewer
defeated it twice without touching the derivation, by keeping the carrier and swapping what was
inside it.

**Transform-in-place.** `StagedAuthorizationMutation::map` preserves the carrier and replaces its
contents:

```
test_support::stage_authorization_seed(seed_A) -> .map(|_| seed_B) -> normal writer-gate commit
```

A and B had identical room selectors but different durable row IDs. **B committed; A did not.** The
exact-selector-equality check passed, because the selectors genuinely did match — it was verifying a
property that survived the swap, while the artifact was stapled to an outcome it never produced.

**Recycling.** `run_installed` plus a public `take_unused`: reserve seed A, discard its payload
without committing, take the raw reservation, reinstall it, and commit a distinct same-selector seed
B. **B committed.** A reservation that can be recycled into a different mutation is exactly the split
the row existed to close.

> **A carrier binds nothing if a method can preserve it while replacing its contents.** Enumerate
> every method that can transform contents in place (`map`, `and_then`, `convert`, `into_*`), extract
> a reusable inner value (`take_*`, `into_inner`, `into_parts`), or re-install something previously
> obtained. For each, say whether it can yield a carrier whose contents were not produced by whatever
> authorised the carrier.

An unused or cancelled artifact must be **cancellation-only**, never a reinstallable capability.

### Removing a constructor is not removing the capability

Two lanes closed their named construction routes in the same cycle, both verifiably, and both were
defeated by an unnamed route that produced the same value.

- One removed three `commit_*_for_test` functions and every public fn taking a caller-chosen
  `&mut LocalDatabase` from its provider. A reviewer then used `AuthDatabasePlan::execute`, public and
  **needing no feature flags at all**, to plan on the live database, premark the live coordinator,
  build the commit plan through a second provider, execute against a shadow database, and finish on
  the live coordinator. All three flows were accepted while every table, column and row in the live
  database stayed byte-identical.
- The other privatised every field of `ExactGrantScope` and removed `Deserialize`, `Default`, `From`,
  builders and `from_exact`. A reviewer then used public `reconcile_auth_scope_bases` plus
  `current_exact_scope` — readers, not constructors — to manufacture
  `(fn:ordinary, Mutation, basis=1, authority_creating=true)` in a **disposable database** while the
  real function declared `authority_creating=false`.

> **Closing the ways a value can be *constructed* does not close the ways it can be *obtained*.** A
> reader that pulls the value out of a caller-named database is a constructor with extra steps.

So a lane must enumerate every public path that can **produce or reconstruct** the value, not merely
those that build it: readers and accessors, anything that round-trips through a database or a
serialised form, anything with `execute`/`commit`/`apply`/`run`/`install` on a plan or carrier, and
anything reachable through a `pub use` re-export from a private module — `snapback_kernel::storage`
re-exports private submodule types, so module-private is not privacy. For each, state whether the
value is derived from the same authority that will consume it.

Both exploits reached for a **second database**. That recurs often enough to be a first check in its
own right: if a caller can name the database, they can manufacture whatever that database says.

**A note on verifying these fixes.** The supervising session confirmed both lanes' removals by direct
measurement — `commit_*_for_test` 2 → 0, `&mut LocalDatabase` parameters 1 → 0, `from_exact` 1 → 0 —
and all of those were true. The measurements were correct and the conclusion drawn from them was
wrong, because *symbol removed* is not *capability removed*. Verify the capability, not the symbol.

### Two corollaries, both found by removing the obvious thing first

A lane did the right thing twice — deleted `Clone` from its artifact, and deleted an artifact type
outright — and a reviewer defeated both from an external dependent crate.

**Single-use is a property of the pipeline, not of the artifact.** `verify_admission_envelope_prebind`
took the envelope **by reference** and cloned it internally into each result. So the reviewer called
the *verifier* twice on one envelope and installed both results: both installs succeeded, both
databases held `(id, epoch, floor) = (1, 4, 9)`, and the two authorities had distinct allocations.

> Removing `Clone` from an artifact is irrelevant when its **producer** can be re-run to mint another.
> Ask where single-use is enforced across the whole chain — envelope → verifier → artifact → install
> — and enforce it at the first step that can be repeated, by consuming the input or by recording
> that it has been consumed.

**Deleting a type does not delete its seam.** The same lane removed `AuthenticatedHostedTarget`, and
a public generic `derive_from_authenticated_hosted_target_at` remained, handing **the four raw target
fields to caller code** and returning an arbitrary `T`. A dependent returned an owned value, cloned
it, and combined it with attacker-chosen incarnation and nonce. The consumer took `&self`, so it was
repeatable.

> A callback that hands out a value's parts **is** that value, with extra steps. Deleting the struct
> changes the spelling, not the surface. Either the derivation happens inside the crate and returns
> something the caller cannot decompose, or the parts must carry producing-instance identity that the
> consumer verifies.

Both corollaries share a shape with the constructor case above: the lane closed the route named in
the finding, and the capability persisted one step upstream or one level of indirection away. When
answering any of these findings, state where the capability now lives, not merely what was deleted.

### Move semantics protect the handle, not the fact

Four lanes were reviewed in one round after each had adopted by-value consumption — the fix this
document had been recommending. **All four were defeated by the same thing**, which makes it a
property of the approach rather than four mistakes:

- One lane's `commit_plan()` clones the operation binding, so commit producers stay replayable and a
  later no-op can settle an earlier durable commit.
- One lane's `reserve_invalidation_boot_issuer()` can be called twice while the first registry is
  still live; the second issuer then authenticates retirement through the first boot.
- One lane's public generic producers reconstruct the capability from arbitrary payloads.
- One lane consumed its `HostedAdmissionEnvelope` by value — and the envelope remains
  **deserializable**, while `select_admission_for_now` reconstructs a fresh equal value on every
  call.

> **Consuming a value by move makes that Rust binding single-use. It does not make the underlying
> fact single-use.** If the value can be deserialized from bytes, re-read from storage, or re-minted
> by calling its producer again, then "single-use" is a property of one local variable and nothing
> else.

This is why the progression `Clone` → remove `Clone` → consume by value keeps failing. Each step
narrows *how many handles you can hold*, and none of them touches *how many times the fact can be
made*.

**Single-use of a fact requires durable state.** A replay ledger, a consumed-nonce table, a
monotonic counter checked against durable storage, a row whose absence means "already used" — some
record that survives the process and that the second attempt must contend with. A type-system
property cannot express it, because the type system does not know what happened last Tuesday.

So a lane claiming single-use must answer: **what durable record makes the second attempt fail, and
where is it written?** If the answer is "the value was moved", the claim is about a variable. If a
signed document, a serialised envelope, or anything reconstructible from bytes is involved, the
answer must be durable or the claim is false.

Type-level consumption remains worth having — it closes the accidental path and makes misuse a
compile error. It is a complement to the durable check, never a substitute for it.

### A durable record is checked at acquisition; a live handle outlives it

Four lanes implemented durable single-use correctly — the record written atomically with the effect —
and the first two reviews still found holes, in two different places. Both are about *when* the
durable state is consulted, not whether it exists.

**Cross-process, the handle survives the record.** A reviewer ran two processes against one SQLite
file:

```
Process A installed boot sequence 1 and stayed alive
Process B opened the same file and installed boot sequence 2
Process A then successfully issued another connection from sequence 1

FULL_HOLDING   sequence=1 connection_generation=1
FULL_ISSUED    sequence=2 issuer_sequence=2
FULL_STILL_LIVE sequence=1 connection_generation=2
```

The ledger was written and read correctly. The defect is that the durable check runs when a handle is
**acquired**, and the handle then keeps working after the durable state has moved on.

> **A durable record consulted only at acquisition is a cache.** If a live handle can outlive the
> record it was validated against, revalidate at the point of *use*, or make the handle unable to
> survive a change — a generation counter compared on every use is the usual shape, and this
> repository already carries one in the admission-fence epoch checks.

**And the key itself can be poisoned.** A second lane's ledger stored only the envelope digest, and
its commit carrier was caller-constructible across a public boundary. Pre-seeding the canonical digest
caused a **later genuine signed envelope to be refused as already replayed** — turning a security
control into an availability attack. A replay guard needs a separately stored request digest, so
*replay of the same request* is distinguishable from *a different request colliding on the key*, and
its commit carrier must be opaque and producer-bound.

Both findings share a shape with everything above: the mechanism was right and the boundary was one
step away from where it was checked. When claiming durable single-use, state **where the check runs**
and **what happens to handles issued before it**.

### A guard held in per-handle state is opt-in

A third review found the same class from the opposite direction. Where revision (k) is about a handle
that goes **stale**, this is about a handle that starts **unguarded**.

Executed from a dependent crate:

- Adopt a file-backed `LocalDatabase` into a ready `ServingDatabase`.
- Open **the same path again** with `LocalDatabase::open`.
- Call `second.schema_seed().apply_schema(...)` — producing, staging and reserving nothing.

The second handle begins at `AuthorizationInterlockState::Disabled`, which makes reservation
*optional*, and the public schema operation commits. The table was created and
`authorization_epoch_v1` advanced. The watched assertion read: *a second public LocalDatabase
committed an authorization transition without the staged carrier.*

> **A guard whose state lives on the handle is not a guard on the resource.** A second handle to the
> same durable resource starts fresh — and if "fresh" means "disabled", the guard is opt-in, which is
> to say optional, which is to say absent.

The interlock was correct for the handle that had been through the ceremony. The defect is that
being-guarded was a property of *that handle* rather than of *the database*, and the resource has no
memory of it.

So when a guard protects a durable resource, ask **where the guarded-ness lives**. If it is a field
on a handle, an in-memory registry keyed by handle, or a state machine initialised per open, then the
guard is defeated by opening the resource again — which any caller holding the path can do. The
guarded state must be derivable from the resource itself, so that every handle to it observes the
same answer.

Note the interaction with revision (k): together they say a durable guard must be **read from the
resource on every use**, not cached at acquisition (k) and not initialised per handle (this). Both
failures look like correct code in isolation, and both were found only by opening a second handle or
a second process.

### Enumerate the siblings, or the review will

Seven consecutive lanes in this programme produced a fix that was **correct where it was aimed** and
was then defeated by an adjacent path the fix did not reach. Not a flawed mechanism — an unreached
one. The pattern is consistent enough to stop treating as bad luck.

The clearest instance. A lane derived the authorization interlock from durable storage and did it
well: an executable review confirmed second, third and separate-process handles all refused; that
staging rereads the durable fact and preparation rereads it *inside the same SQLite transaction*
before commit, with an IMMEDIATE transaction serialising the writer so no TOCTOU window exists; that
32 no-ops consumed nothing; and that no `From`/`Into`, serde, builder, clone or extraction route
relocated the carrier. Then:

```
identity_reap_guests_default_tombstone(9)
  result=Ok(GuestReapBatch { reaped: 1, ... })
  before_epoch=1   after_epoch=2
```

That operation never enters the mechanism at all. It takes a plain auth transaction with an **empty
commit guard** and advances the durable epoch directly. The guard was real; this path simply was not
behind it.

> **A fix that is not accompanied by an enumeration of its siblings is not finished, it is
> untested.** Whoever writes the fix must enumerate every path that reaches the same durable effect
> and say which ones now go through the new mechanism and which do not — including the ones that
> came back clean.

This inverts where the enumeration happens. Today it is a *review finding*: the implementer fixes the
named path, the reviewer hunts the siblings, and the lane spends another round. Making it a
**deliverable of the fix** costs the implementer one pass over the call graph — which it must do
anyway to be confident — and removes the most common reason these lanes fail.

Two practical notes, both learned the same way. `#[doc(hidden)]` is not a capability boundary; read
it as `pub` when enumerating. And an enumeration that finds an uncovered sibling but declines to
report it *because no executed witness exists yet* has still found it — the honest form is to name
it as unproven and close it anyway, rather than let its absence from the findings list read as
absence from the surface.

### An enumeration under default features is not an enumeration

Revision (n) said to enumerate the siblings. This says **where** to look, because two careful
enumerations over the same code both missed the same thing.

A lane closing an authorization interlock had its coverage checked twice by executable review. The
first found `identity_reap_guests_default_tombstone`; the second confirmed guest claim as the only
other direct epoch writer. Both were thorough, and both were reading **default features**. A third
review then found:

```
install_graph_corpus_streams_for_test  — public under additive `test-support`,
writes the caller-selected incarnation and epoch directly, no interlock

via ServingDatabase::auth_database_mut()  → result=Ok(())  epoch 0→1
via a separately opened LocalDatabase     → result=Ok(())  epoch 0→1
```

> **Enumerate across every feature combination a dependent can enable, not the one you build with.**

This matters more here than in most codebases, for a reason that is easy to forget: **Cargo features
are additive and unified across the graph.** A single dependent enabling `test-support` for any
reason — one integration test, one benchmark, one transitive crate — turns it on for *every*
compilation of that crate in that graph. There is no per-consumer scoping. So a `test-support`-gated
writer is not "only reachable in tests"; it is reachable by anything in a graph that contains a test.

The scale is on record: 172 class-C items in this repository are reachable from dependent crates,
**171 of them dependent-reachable**, and an independent line-level analysis found **zero** with any
legitimate embedder use.

Practically, an enumeration should state which feature sets it covered, and a review should treat
"default only" as incomplete rather than as an answer. The cheap check is to re-run the search with
each additive feature enabled and diff the candidate set; the writers that appear are exactly the
ones the default-feature pass cannot see.

### The fix inherits the defect, and the test that guards it usually doesn't try

Two patterns have now recurred often enough to state as rules rather than observations. Both concern
what happens *after* a lane has correctly identified and fixed its defect.

**A new durable guard inherits every question the old one failed.** Three lanes added durable state
to close a defect, and in all three the new state carried the same flaw one level up:

- a monotonic **replay floor** was added to stop replay after receipt expiry. `auth_gc()` accepts a
  caller-supplied timestamp, so `auth_gc(AUTH_MAX_SAFE_TIMESTAMP)` advances the floor to its maximum
  and **permanently locks out every future issuance, revocation, rotation, alarm and password
  change**;
- a **participant-provenance marker** was added to stop presence being treated as provenance. The
  marker turned out to be establishable by a composition of only public APIs, with no real issuer
  ever existing;
- a **monotone epoch trigger** was added to stop canonical replay. The trigger checks only
  `NEW.sequence == OLD.sequence + 1`, authenticating nothing, so an ordinary `UPDATE` from a raw
  connection replaces the singleton with an attacker-chosen owner.

> Whenever a fix introduces durable state, ask of the new state exactly what was asked of the old:
> **who can write it, can a caller advance or pre-empt it, is it monotonic structurally or only by
> convention, and is it written in the same transaction as the effect it authorises?**

Note the direction of harm inverts. The original defects let an attacker *do* something; these
successors let an attacker **deny service permanently** — a maximum floor, a poisoned marker, a
forged epoch. A fix for an availability-neutral defect that creates a stronger availability attack is
not progress.

**And the boundary test a lane writes for its own fix tends to exercise the guarded case.** Two
instances, both caught only by executable review:

- a membership boundary test called the very public factories that constitute the live route, and
  asserted only that `FunctionKind::Query` is refused. It never tried `Mutation` plus commit — which
  works, and commits a durable row;
- a migrated service test asserted `ScopedServiceRetired` on the branch where the disposition is
  **hardcoded**, rather than the branch where it is derived from the fence — so it passed with a live
  fence and proved nothing about terminalization.

> A boundary test must attempt the composition that **succeeds**, and fail first on it. A test that
> exercises the path already closed will pass forever without demonstrating anything.

The cheap discipline: for every new guard, write the test that would have caught the *original*
defect, confirm it fails against the unfixed code, and only then confirm it passes.

This is the same family as the constructor/setter case above: a derivation that holds at one instant
and is undone afterwards. Setters undo it by assignment; combinators undo it by rewrapping; recycling
undoes it by outliving its purpose. All three are answered by the same discipline — enumerate every
method that can separate the artifact from what authorised it, and state the list in the landing.

### A test can demonstrate the exploit and call it correct

The same review found that `committed_rotation_response_ignores_only_doomed_sibling_refresh_tickets`
already performed the caller-built-attempt composition as a **happy path**, and never read durable
token state. The suite was exercising the exploit and asserting it was fine.

This follows from the projection rule in
`issues/20260824-assertion-provenance-is-the-recurring-test-defect.md`: the test read
`(generation, revoked_at)` and rotation writes `token_hash`. A readback that omits the column a path
writes cannot see that path's mutation. When adding a per-path test, project the columns **that
path** writes, not the columns the previously-fixed path wrote.

### Enumerate the effect's siblings, not the entry point's

Revision (n) made sibling enumeration a deliverable of the fix. Two independent reviewers of the same
commit then disagreed about whether a row was closed, and the disagreement located a gap in that rule.

One reviewer enumerated **every mint factory** for the effect — engine raw, engine guarded, kernel,
serving, HTTP — found each one properly bound, and declared the row closed. That enumeration was
complete and correct for what it covered. The second reviewer ignored factories entirely and defeated
the row by **composition**: a public row-producer, `insert_email_session_for_test`, binds a generated
bearer hash to a caller-named subject, and that bearer is then accepted by the public raw mint, which
returns the plaintext secret. The repository already composed those two APIs in an existing test.

Both reviewers were competent; one asked the narrower question. So:

> Enumerating the sibling **entry points** of a fixed function is not enumerating the siblings of the
> **effect**. The question is not "what else calls this?" but "what else produces this?" — including a
> pair of public calls where neither alone produces it.

This is the same shape as
`issues/20260825-production-equivalent-is-not-a-clearing-rule.md`, where 166 items were cleared by a
rule that evaluated each helper in isolation: a claim that holds for one thing and fails for a pair.
It also recurs as the *partial APIs compose* finding against agent registration, where
`create_agent_principal` and `issue_initial_agent_credential` are individually harmless and jointly
produce the whole controlled state.

Two practical consequences:

- A row's enumeration must include the **producers of every input** the fixed path trusts, not only the
  alternate callers of the fixed path. A caller-plantable session row is an authority-producing API
  even though its name says `insert`.
- **Look in the existing tests first.** Twice now the proof of a live composition was already written
  in this repository as a fixture — an existing test that composes two public APIs is evidence the
  composition is reachable, and it is cheaper to find than to derive.

A corollary for signature-based tooling: the privilege ratchet read the same 107 on both trees while
both of these compositions were live. **A flat ratchet is not evidence**; it counts declared paths, and
a composition declares nothing new.

## Approved dispositions

**Strict — derive from the authority (37 questions).** Q01–Q05, Q07–Q12, Q14–Q22, Q24,
Q26, Q28–Q29, Q31–Q38, Q40–Q44. In each case the subject, scope, claim, descriptor, channel, writer class, token set,
namespace, or lease field must be produced by whatever verified it, not asserted by the caller.

> **Enumeration repair (revision m).** As first published, that sentence carried the label "37
> questions" over printed ranges containing **41** identifiers. The ranges wrongly included Q23,
> Q25, Q27, Q30, Q39 and Q45, and omitted Q36. The document repairs itself: Q39 is classified below
> as an external effect that precedes proof of ownership by design; Q36 is ranked for
> implementation below with a DERIVE disposition; Q23's product dimension is listed as still open;
> and Q25, Q27, Q30 and Q45 are cross-principal flows whose plans retain exact *relation*
> verification rather than derivation. The ranges above are the repaired set and total exactly 37.
> The defect mattered: a label and its own enumeration disagreed by four, and every downstream
> count drawn from it inherited the error.

**Strict, with an explicit binding rather than ownership (2).**
- **Q06** — effect approval. The approver is deliberately a different principal from the
  reconstructed caller. The rule is *this approver, this pending effect, that effect's stored
  original authority* — **not** owner-only, which would break approval outright.
- **Detached-action sinks (S5, tracked with Q02/Q33)** — the caller may be a delegated service
  principal that does not own the effective user. The rule is same-origin correlation.

**Rate-limit rather than authorize (1).**
- **Q39** — challenge sends. An external effect precedes proof of ownership by design; the
  control is throttling and monitoring, not an authorization predicate.

**Priority order for implementation.**
1. **Q01** (5 rows) — attaching another principal's live channel bypasses session expiry,
   termination and deadline checks. Verified, not theoretical. Also constrains the architecture:
   any correlation identity must be taken *after* all attachments, never at root preparation.
2. **Q36** — minting a session for an email with no proof of ownership.
3. **Q10 with Q04** — self-asserted `authority_creating` consent in two places; the escalation
   primitive that turns one foothold into every privilege.

## Still open — approved in part only

Two questions were flagged as product decisions and remain open in their product dimension. The
ruling approves the *correlation* half of each; it does not choose the policy.

- **Q13 — who is billed.** Approved: whichever party is charged, it must be **derived** from the
  prepared authority rather than supplied. Open: whether the payer is the resolved principal or an
  explicit billing relationship that may differ from the actor.
- **Q23 — development-mode impersonation.** Approved: it must be **impossible, and tested as
  impossible**, for development mode to be active in a deployed environment. Open: whether
  in-development impersonation is unrestricted, owner-bound, or fixture-bound.

Do not treat either as settled by this ruling.

## Claim discipline this ruling does NOT grant

Implementing these does not license a structural-property, fence, or closure claim. Three
PROPERTY claims in this program were published and withdrawn as false. Each landing states what
it enforces, scoped to the functions and routes it changed.

Evidence bar, from what earlier rounds cost: every test watched failing first and quoted verbatim;
exact accepted/refused sets asserted; **durable rows read back and asserted**, because a test that
observes only method outcomes cannot prove a database property; and a mutation review including
comparison-operator mutations and subjects on both sides of the caller's lexical ordering.

## Severity context

Every defect behind these questions is reachable only from in-crate code, not remotely. These are
structural guarantees against future incorrect code, not open doors. That is why the strict answers
are affordable and why the program was not run as an incident.
