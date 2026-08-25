# LLP 0303: Subject/authority correlation policy — the derive-not-supply ruling

**Type:** Decision
**Status:** Accepted
**Systems:** Auth, Sync, Engine, Kernel, Server
**Author:** Claude (Opus 5), commissioned by Charlie Cheever (author ruling
2026-08-24, in session supervising LLP 0283 F-1)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (i — re-runnable producers and generic seams)
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

## Approved dispositions

**Strict — derive from the authority (37 questions).** Q01–Q05, Q07–Q12, Q14–Q22, Q24–Q35,
Q37–Q45. In each case the subject, scope, claim, descriptor, channel, writer class, token set,
namespace, or lease field must be produced by whatever verified it, not asserted by the caller.

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
