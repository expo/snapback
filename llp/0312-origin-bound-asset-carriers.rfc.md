# LLP 0312: Seal callback authority and derive width-plan provenance

**Type:** RFC
**Status:** Draft
**Systems:** Authorization, Assets, Storage, Kernel, Services, Sync, Engine,
Server, Test support, Operations
**Author:** Codex / Charlie Cheever
**Date:** 2026-08-26
**Revised:** 2026-08-26
**Related:** LLP 0039, LLP 0044, LLP 0055, LLP 0058, LLP 0225, LLP 0276,
LLP 0291, LLP 0303, LLP 0311,
`issues/shelved/20260824-implementation-plans-remaining-p2-rows.md`

## Summary

F145 and F272 have the same desired property but do **not** have the same
carrier lifetime or origin. They should not share one generic wrapper.

This RFC recommends two concrete carriers, only one of them new:

1. **F145 is not gated on a new carrier.** Seal the existing
   `AssetCallbacksServicePrincipal`, add an opaque `DatabaseBinding` origin,
   retain `Clone` because the principal is durable and reusable, and move the
   public preparation operation to `LocalSnapback`. The engine derives the app,
   exact current scope basis, principal, and prepared authority in one graph.
   The old public fields and the public sync constructor that accepts a
   separately supplied principal disappear.
2. **F272 does need a new carrier.** `AuthorizedAssetWidthPlan` is a non-cloneable
   engine-owned route-stage value containing the rendered ticket, its exact
   `AuthorizedEffectReservation`, an `EngineAppStateGraphIdentity`, and one
   route-attempt identity. It is produced only by consuming an engine-derived
   width preflight through render and then reserving authority from the
   `PreparedAuthority` captured by that same preflight. There is no
   `bind(ticket, effect)` operation.

The F272 signature change alone is insufficient. The repository currently has
an unchecked lower consumer: the public, `#[doc(hidden)]`
`AssetAttemptsProofLocalExt::stage_width_variant_plan_proved_guarded` accepts an
arbitrary success closure, and `asset_resolve_width_variant` reaches it with
`|| Ok(())`. Five public engine entry points reach that helper. An
`AuthorizedAssetWidthPlan` cannot make those calls check a binding. F272 may be
implemented only in a batch that removes that dependent-reachable raw staging
surface and routes every caller-backed plan commit through the carrier. If the
crate boundary cannot be changed enough to do that, the honest result is that
F272 remains gated; a sealed top-level signature would be spelling, not effect
closure.

**Recommendation confidence: 0.84.** I am highly confident about the two
origins, the sealing rules, and the consumer census. The thing I am least sure
of is the smallest ownership change between `snapback-services`,
`snapback-sync`, `snapback-kernel`, and `snapback-engine` that can preserve
database-free rendering while making the raw kernel staging consumer genuinely
unreachable to dependents.

## Status and evidence basis

This is a design document, not an implementation. No signature or visibility
change is made here.

The repository was rebased onto the advertised `origin/main` at
`2d534c67db0896e2efad7855713122a73c2cb438` before this RFC was written. The
programme inventory, LLP 0303 revision (s), and LLP 0311 are present in the
repository's integrated history rather than that advertised main tip; this RFC
read them from commits `ad52c4e69`, `db1fb7048`, and `31158be4` respectively.
The source measurements below are against the rebased tree. `0312` was absent
from both that tree and all reachable repository history before assignment.

The measured blast radius is:

| Surface | Producers now | Consumers now | Checked-in live compositions |
| --- | ---: | ---: | ---: |
| F145 callback principal | two public database methods for one implementation | one public raw preparation method; one engine preparation call; liveness and projections downstream | one kernel fixture and one sync unit fixture |
| F272 plan/effect pair | one public ticket constructor/`prepare` chain plus every `PreparedAuthority::reserve_authorized_effect` call | one intended engine sink, one dependent-reachable raw kernel trait method, and one engine helper used by five public methods | two production routes and 18 calls in eight engine tests |

The counts distinguish symbols from effects. The two F272 values are produced
by separate calls; neither call alone produces the publication-plan effect.
Their live composition at the engine sink is therefore part of the producer
and consumer census required by LLP 0303, not merely a caller list.

## The invariant

For both rows, “cannot be constructed by a caller” means all of the following:

1. all carrier fields are private;
2. no public or dependent-reachable `new`, `from_parts`, `bind`, builder,
   struct-update, macro, or factory accepts the protected facts as caller
   assertions;
3. there is no `Default`, serde deserialization, `From`/`Into`, `TryFrom`,
   `Deref`, `AsRef`, tuple conversion, or public `map`/`replace`/`into_parts`
   path that manufactures, substitutes, or extracts the protected origin;
4. no public trait or `dyn Trait` return can manufacture the carrier or return
   a caller-selected implementation that does so;
5. no `#[doc(hidden)]` re-export or method supplies an equivalent construction
   path;
6. no dependent-reachable additive feature exposes `*_for_test`, raw field
   access, identity substitution, a builder, or a constructor;
7. `cfg(test)` may expose a unit-only adversarial seam inside the defining
   crate, but that seam must not compile for a dependent under feature
   unification;
8. `Clone` exists only when duplication is part of the stated capability
   semantics; it must be absent from a one-shot transition carrier;
9. every effectful consumer either accepts the carrier and validates its
   origin, or derives the protected facts inside the same trusted owner. A
   sealed producer with one unchecked peer consumer does not satisfy the
   invariant.

Privacy is therefore necessary but not sufficient. The capability is the
closed producer-to-consumer path, not the struct spelling.

### Existing-type audit

`AssetCallbacksServicePrincipal` currently fails the first and ninth rules.
It derives `Clone`, `Debug`, `Eq`, and `PartialEq`; all four fields (`app_id`,
`actor_user_id`, `grant_id`, and `scope`) are public; and it has no database or
graph origin. It does **not** currently derive `Default` or serde, implement a
conversion or builder, have a `*_for_test` constructor, return through a
`dyn Trait`, or use a `#[doc(hidden)]` re-export. Its defining module is public,
however, and the sync unit test at `auth/invocation.rs` constructs a literal.
`LocalDatabase::ensure_asset_callbacks_service_principal` and its
`ServingDatabase` wrapper are public producers.

`AssetWidthPlanTicketV1` and `AuthorizedEffectReservation` have private fields
and neither is `Clone`, `Default`, serde-deserializable, or constructible by
`From`/`Into` or a builder. That opacity is real but incomplete:

- `AssetWidthPrepareTicketV1::new` is public and `prepare(self)` publicly
  produces `AssetWidthPlanTicketV1` from caller-supplied asset, store, app, and
  quota facts;
- `snapback-services` exposes the width ticket types publicly; the server uses
  crate-private re-exports for its route implementation;
- additive `remainder-tests` exposes `store_for_test` and
  `replace_store_for_test`, including an `Arc<dyn AssetStore>` substitution;
- `PreparedAuthority::reserve_authorized_effect` publicly and legitimately
  produces an effect reservation, but shares no request, attempt, publication,
  or graph identity with a width ticket;
- additive `test-support` exposes `#[doc(hidden)]` reservation observation and
  mutation methods. They do not construct a reservation, but they are
  dependent-reachable and must not become a way to change correlation;
- `snapback-kernel::services_assets` is itself `#[doc(hidden)] pub`, and its
  public extension trait accepts arbitrary facts plus any closure returning
  `Ok`. That is an equivalent unchecked consumer even though it does not
  manufacture either opaque input type.

The default graph therefore already permits independent production of both
F272 inputs. The additive union is wider: `remainder-tests` permits store
replacement and `test-support` permits effect-reservation mutation and
observation. Unit-only route pause hooks under `cfg(test)` are different: they
are not dependent-reachable and may remain if they exercise the real producer.

## Why there must be two carriers

The shared shape is “opaque value with its own origin.” The semantics differ:

| Property | Callback principal | Authorized width plan |
| --- | --- | --- |
| Origin | exact database allocation, plus current process | exact engine app-state graph and route attempt, plus current process |
| Lifetime | durable fact revalidated against current rows | one route-stage handoff around one plan transaction |
| Duplication | `Clone` is valid; callbacks may reuse the live principal | `Clone` is invalid; the transition consumes the plan |
| Payload | app, actor, grant, exact scope | rendered ticket and exact effect reservation |
| Consumer | preparation and every callback effect revalidation | guarded publication-plan transaction |
| Recovery | rederive from durable callback catalog and current scope basis | discard and rerun preflight/render/reservation |

A generic `EngineBound<T>` or `OriginBound<T>` would either make the callback
principal pretend to be one-shot, make the width plan pretend to be durable,
or add generic `map`, extraction, conversion, and trait seams that reopen the
construction audit. Sharing a private process-origin comparison helper is
appropriate. Sharing the public carrier type is not.

## Alternatives

### A. Seal the existing carrier with a private origin field

This is the right mechanism for F145. Make every principal field private, add
an opaque `DatabaseBinding` and current-process origin, and expose only
read-only field accessors needed by projections and diagnostics.

It fixes literal construction and cross-database replay when every effectful
consumer compares the origin before using textual fields. It does not bind an
independently produced width ticket to an effect reservation, and it does not
repair a consumer that reads the principal without checking it. Its security
failure mode is a forgotten check; its availability failure mode is an origin
false refusal. Existing field readers must migrate to getters, the sync unit
fixture must use the real database producer, and the engine must own the public
preparation operation. That is a low-to-medium migration with one production
preparation call.

### B. Introduce a new provenance-bearing carrier

This is the right mechanism for F272 only if provenance is produced as part of
the route-stage flow. A public `AuthorizedAssetWidthPlan::new(ticket, effect)`
or `bind(ticket, effect)` merely wraps the defect and is rejected.

The derived form fixes crossed ticket/effect pairs and cross-graph replay. It
does not fix raw staging consumers that never accept the carrier. Its security
failure mode is an alternate consumer or an extraction/substitution seam; its
availability failure mode is loss or incorrect rejection of the one-shot
value. Migration covers two production routes, 18 checked-in engine test call
sites, the preflight/render return types, and the lower raw consumer. That is a
medium-to-high migration.

Creating a second new wrapper around F145 would add no origin stronger than
the existing principal can carry, would contradict the Q22 instruction not to
add a peer token, and would leave two values that could be crossed. It is not
recommended.

### C. Make the effect take `LocalSnapback` and derive everything

This is the strongest and simplest public API for F145. The proposed
`LocalSnapback::prepare_asset_callbacks_authority(&mut self, function_id,
profile, admission)` derives app ID, current scope basis, durable principal,
and `PreparedAuthority` without accepting an authority assertion.

The same strategy can close synchronous legacy width entry points: an engine
method already holding `&mut LocalSnapback` and a `PreparedAuthority` can
preflight, render, reserve after rendering, and commit without accepting peer
tokens. It is not by itself a good shape for the asynchronous server routes.
Holding `LocalSnapback` or an authority permit across source reads, CPU render,
or blob I/O violates LLP 0058's split-phase boundary and expands lock and drain
latency. Releasing the engine and returning two peers recreates F272. The
failure mode is either a crossed handoff or an overlong permit/lock. Migration
is low for F145 and high for F272.

### D. One generic provenance wrapper for both rows

This superficially reduces type count. It fixes only private-field spelling;
it does not express database-versus-graph origin, reusable-versus-one-shot
lifetime, or the differing consumer obligations. Its likely failure mode is a
generic conversion or extraction API added to make one of the two flows fit.
Every callback and width caller would migrate. This alternative is rejected.

### Recommendation

Use A and C together for F145: seal the existing principal and make the engine
derive the whole prepared authority. Use B for the asynchronous F272 handoff,
and C for any synchronous legacy width method that remains public. Do not add a
generic carrier and do not expose a binder that accepts the two current peers.

## F145 design: seal the existing principal

The conceptual shape is:

```rust,ignore
pub struct AssetCallbacksServicePrincipal {
    origin: DatabaseBinding,
    origin_process: ProcessIdentity,
    app_id: String,
    actor_user_id: String,
    grant_id: String,
    scope: ExactGrantScope,
}
```

This is illustrative, not an implementation prescription. `ProcessIdentity`
may be shared privately with engine graph checks. The requirements are:

1. only the database path that creates or re-reads the durable callback user,
   grant, and exact current scope basis can construct the principal;
2. `DatabaseBinding` remains opaque and compares allocation identity, not app
   text, path text, or copied durable IDs;
3. `Clone` copies the same binding and process identity. It does not mint a
   fresh origin;
4. public access is read-only. There is no origin getter returning a clonable
   raw token and no consuming decomposition;
5. `asset_callbacks_service_principal_is_live` checks process and database
   origin **before** interpreting app, actor, grant, or scope text;
6. the public sync operation
   `InvocationGate::prepare_admitted_asset_callbacks(profile, admission,
   principal)` is removed or made unreachable outside the trusted engine path;
7. the public engine operation is the Q22 target on `LocalSnapback`. It derives
   app ID, exact current scope basis, durable principal, and prepared authority
   while owning the same engine/database graph;
8. no raw callback authority constructor is added under `test-support`.

The target takes `function_id`, `profile`, and `admission`. Those inputs are
configuration and live admission objects, not caller assertions about the
durable callback principal. App ID and scope basis are deliberately absent.

### F145 producers and consumers

The repository has these production obligations:

- **Producer:** `LocalDatabase::ensure_asset_callbacks_service_principal`, plus
  the `ServingDatabase` forwarding method. These are one implementation and
  must stamp the exact database/process origin.
- **Composition producer:**
  `LocalSnapback::prepare_asset_callbacks_authority` reads the current scope
  basis and calls the database producer inside the same graph. It is the only
  public preparation owner after migration.
- **Raw consumer to remove:**
  `InvocationGate::prepare_admitted_asset_callbacks` currently accepts a
  separately supplied principal.
- **Effect check:** `LocalSnapback::validate_prepared_service_authority_classified`
  compares the callback principal to the resolved authority and calls
  `asset_callbacks_service_principal_is_live`. The liveness call must perform
  the origin check before its row checks.
- **Read-only consumers:** `HandlerAuthProjection::for_asset_callbacks`,
  `PreparedAuthority::canonical_auth_input`, the
  `PreparedAuthority::asset_callbacks_service` accessor, and the runner's
  receipt projection read actor/grant/app facts. They may use getters, but
  none is allowed to perform a durable callback effect without going through
  the effect check.
- **Effectful downstream consumers:** every engine site that accepts a
  `PreparedAuthority` for callback execution and calls
  `validate_prepared_service_authority_classified` before its durable effect.
  The implementation inventory must mechanically prove that dominance; a
  read-only projection is not a substitute.

Sealing makes raw preparation impossible only if the sync raw consumer is
removed. It cannot, by itself, make every future `PreparedAuthority` consumer
validate the nested principal: `PreparedAuthority` has many legitimate
variants and readers. Therefore the strongest honest claim is scoped. F145 is
closed when the sole callback preparation path is engine-derived and every
callback effect is dominated by classified service-authority validation. This
RFC does not claim that the Rust type system makes an unchecked future generic
`PreparedAuthority` consumer impossible. A landing must add a static consumer
inventory/check or centralize callback effects behind one checked engine
method; otherwise F145 remains review-dependent at the consumer edge.

## F272 design: one derived route-stage carrier

The carrier's conceptual shape is:

```rust,ignore
pub struct AuthorizedAssetWidthPlan {
    origin: EngineAppStateGraphIdentity,
    origin_process: ProcessIdentity,
    attempt: AssetWidthRouteAttemptIdentity,
    plan: AssetWidthPlanTicketV1,
    effect: AuthorizedEffectReservation,
}
```

The type is owned by the engine-facing layer, has private fields, is
`#[must_use]`, and is not `Clone`. Its exact crate may follow the ownership
refactor, but the engine is its trust owner: neither server routes nor services
rendering can assemble it.

The production flow is:

1. A caller-backed engine preflight takes the exact `PreparedAuthority`, app
   graph, asset, and requested width. It performs the existing read probe and
   returns either `AlreadyReady` or an opaque preparation carrying a private
   graph origin, private route-attempt identity, the captured authority, and a
   neutral render job.
2. The route consumes that preparation on the blocking renderer. Rendering
   retains no live effect reservation, authority permit, commit guard, or
   `LocalSnapback`, as LLP 0058 requires. The returned rendered preparation
   still carries the same private origin, attempt, and captured
   `PreparedAuthority`. That value is a recipe that must revalidate when it
   later reserves; it is not itself a live permit.
3. After rendering, an argument-free method on the rendered preparation
   reserves `AuthorizedEffectReservation` from its captured authority and
   consumes itself to produce `AuthorizedAssetWidthPlan`. The route does not
   supply a reservation, graph identity, attempt identity, ticket, app ID, or
   store. Test pause/probe behavior surrounds this real operation; it does not
   gain a dependent-reachable constructor.
4. `LocalSnapback::asset_width_plan_with_authorized_effect(&mut self, plan)`
   consumes the carrier. Before opening the staging transaction it checks the
   current process, compares the carrier graph with the current
   `EngineAppStateGraphIdentity`, and checks that all internal attempt
   components are the same allocation. It then invokes the existing guarded
   staging transaction with the contained reservation and consumes the plan.
5. The resulting put and later commit tickets keep LLP 0058's existing
   reservation boundaries. F272 binds the publication-plan cut; it does not
   stretch that reservation across external blob I/O.

The route-attempt identity is deliberately not a request ID string, digest,
asset ID, variant key, or publication ID. Those values may collide by retry or
be caller-controlled. It is an allocation identity generated by the trusted
preflight and never exposed or serialized. The plan and effect do not become
peers and then get compared; one consuming producer creates their only valid
composition.

### No binder and no extraction

The following APIs are forbidden even if their fields are private:

```rust,ignore
AuthorizedAssetWidthPlan::new(ticket, effect)
AuthorizedAssetWidthPlan::bind(ticket, effect)
AuthorizedAssetWidthPlan::from((ticket, effect))
plan.into_parts()
plan.replace_effect(effect)
builder.ticket(ticket).effect(effect).build()
```

There is also no `dyn AuthorizedAssetWidthPlanProducer`, because a caller could
supply an implementation. Rendering may return a neutral result, but only the
opaque engine-derived preparation can turn it into the authorized carrier.

### F272 producers and consumers

The default graph contains:

- **Ticket producer:** `AssetWidthPrepareTicketV1::new` followed by
  `prepare`. This is public and currently accepts caller-supplied store, app,
  and quota facts. Under the recommendation it becomes neutral rendering only
  or moves behind the engine-derived preparation; it cannot feed a durable
  plan consumer directly.
- **Effect producer:** `PreparedAuthority::reserve_authorized_effect`. It
  remains a valid general producer, but the width-plan instance is reserved
  only by consuming the captured rendered preparation.
- **Pair producer:** the two server route sequences at
  `server/asset_routes.rs` independently render and reserve, then call the
  engine sink. Neither prior call alone produces the effect. Both sequences
  migrate to the consuming producer above.
- **Intended consumer:**
  `LocalSnapback::asset_width_plan_with_authorized_effect`, which becomes the
  only caller-backed width-plan staging consumer.
- **Unchecked kernel consumer:**
  `AssetAttemptsProofLocalExt::stage_width_variant_plan_proved_guarded`,
  publicly reachable through a `#[doc(hidden)]` module and public database
  access, accepts arbitrary plan facts and `|| Ok(())`.
- **Unchecked engine composition:** private
  `asset_resolve_width_variant` uses that raw consumer with `|| Ok(())`.
  It is reached by public `asset_deliver`,
  `asset_strict_delivery_prepare_width`, `asset_signed_url_issue`,
  `asset_signed_url_prepare_width`, and `asset_deliver_public` when width is
  requested.
- **Authorized production callers:** the current strict-delivery and
  signed-URL routes use the intended sink at two sites.
- **Checked-in test callers:** eight engine tests make 18 direct calls to the
  intended sink. These are live compositions and must migrate through the real
  preflight/render/reserve producer, not a `for_test(ticket, effect)` helper.

The public-immutable path is not allowed to fake an
`AuthorizedEffectReservation`. It is a distinct policy mode. Its width plan
must be derived inside the engine after the public-profile probe and enter a
private mode-specific staging path. That path must not accept caller-selected
policy or raw plan facts. The four caller-backed legacy methods either derive
the authorized carrier internally or are retired.

### The consumer-side negative result

With the current crate graph, changing only the engine signature does **not**
make an unchecked consumer impossible. The raw kernel trait remains callable
by a dependent, and its success closure is not proof of an authorization
binding. `#[doc(hidden)]` changes documentation, not reachability. Likewise,
private `asset_resolve_width_variant` is not a sufficient boundary because
five public methods reach it.

An F272 implementation therefore has this hard acceptance condition:

- the raw width-plan staging operation ceases to be dependent-reachable and
  accepts no arbitrary success closure;
- the transaction is co-located with the sealed carrier consumer, **or** its
  lower-layer API requires an opaque proof whose only producer consumes that
  exact carrier;
- all caller-backed engine paths use `AuthorizedAssetWidthPlan` or derive the
  same facts wholly inside the engine;
- the public-profile path uses a separate engine-derived policy proof and
  cannot be selected by a caller to bypass caller authority;
- no default or additive-feature API reconstructs the old raw path.

Rust has no cross-crate `pub(friend)`. If satisfying the first two bullets
requires moving the narrow transaction owner or an authorization-guard core
across crate boundaries, that is part of F272's migration cost. Replacing the
raw trait with another public trait, `#[doc(hidden)]` method, generic callback,
or public capability getter does not satisfy the condition. If the
implementation cannot meet it, F272 remains gated. This is the useful negative
result: the proposed carrier closes the intended engine sink, but the current
repository topology cannot make the effect-wide claim through a signature
change alone.

## `EngineAppStateGraphIdentity` lifecycle

`EngineAppStateGraphIdentity` already uses `Arc::ptr_eq`, the right primitive
for exact in-process graph allocation identity. F272 reuses it rather than
inventing an app ID, database path, UUID text, or peer token. The comparison
semantics are:

- **Clone:** cloning the identity retains the same `Arc`, so it compares equal
  inside the same graph. This is correct. The identity is evidence, not a
  single-use permit. `AuthorizedAssetWidthPlan` itself remains non-cloneable.
- **Rebuild:** constructing a new `LocalSnapback`/app-state graph in the same
  process allocates a new `Arc`. An old carrier refuses even when app ID,
  database path, and all ticket text are value-equal.
- **Restart:** the identity is not serialized. A new process creates a new
  graph allocation, and durable work is rederived. No carrier survives as a
  valid value across restart.
- **POSIX fork:** pointer identity alone is insufficient. The child inherits
  the same virtual addresses and reference-count state, so `Arc::ptr_eq` can
  falsely accept an identity minted by the parent. Both
  `EngineAppStateGraphIdentity` and the database-origin comparison used by
  F145 must include a private creator-process identity and compare it with the
  **current** process, not merely compare the two stored PIDs. After a fork,
  every inherited graph is fail-closed in the child. The child must `exec` or
  construct a fresh `LocalSnapback`; there is no rebind operation for inherited
  carriers.

A PID alone is not identity and PID reuse is not relied upon. Within a live
process, allocation identity remains the discriminator. Across a fork, the
current-PID check detects inheritance. Across restart, non-serialization and a
fresh allocation apply.

The implementation should emit stable diagnostics distinguishing a forked
origin from an ordinary graph mismatch. Suggested dispositions are
`SNAPBACK_ENGINE_GRAPH_FORKED`,
`SNAPBACK_AUTH_ASSET_CALLBACK_ORIGIN_MISMATCH`, and
`SNAPBACK_ASSET_WIDTH_PLAN_ORIGIN_MISMATCH`; the implementation may align
names with the diagnostics registry before landing.

## Feature-additive surface

The audit and acceptance tests run twice:

1. against the ordinary default dependency graph; and
2. against the additive union of workspace features, because Cargo features
   unify and no security argument may rely on a dependent not enabling a test
   feature.

In the union:

- `snapback-services/remainder-tests` currently exposes width-ticket store
  observation and replacement through `Arc<dyn AssetStore>`;
- `snapback-sync/test-support` exposes `#[doc(hidden)]` reservation identities,
  failure injection, and scope probes;
- kernel/server test-support features expose additional helpers and re-exports;
- unit-only `cfg(test)` pause hooks in the server are not reachable by a
  dependent and may exercise races without becoming constructors.

The recommended carriers expose no constructor, origin replacement, peer
binder, `dyn Trait` factory, or decomposition in either graph. Additive tests
must obtain F145 through real database reconciliation and F272 through real
engine preflight/render/reservation. A test needing a crossed internal pair may
use a unit-only constructor in the defining module under `cfg(test)`; that
symbol must fail to resolve from a dependent crate with every feature enabled.

## Fixtures and acceptance evidence

### F145

Extend the existing checked-in callback-principal fixture rather than replacing
it with a type-only test:

1. build app graphs A0 and A1 and callback functions F0 and F1;
2. create value-equal callback user, grant, and exact scope text in both
   databases;
3. prove clones from A0 remain accepted by A0;
4. prove an A0 principal refuses in A1 before durable liveness text is used;
5. prove a rebuilt A0 graph refuses the old principal;
6. prove deactivation, revocation, expiry, and changed scope basis still refuse
   within the correct origin;
7. prove the production callback runner obtains its authority through the new
   `LocalSnapback` operation;
8. add a dependent compile-fail surface test showing that struct literals,
   default, serde, conversions, raw constructors, and test-support construction
   are unavailable.

The existing sync literal fixture must migrate to the real producer. A
compile-fail test proves spelling; the cross-graph runtime fixture proves the
effect.

### F272

Preserve the repository's eight engine fixtures and make their 18 compositions
use the real producer. Add a focused matrix with tickets T0/T1 and reservations
E0/E1 from attempts R0/R1 and graphs A0/A1:

- each exact production-flow plan commits once;
- a whole A0 carrier consumed by A1 refuses before the transaction and leaves
  `_snapback_asset_publications_v1` unchanged;
- an engine-internal unit-only adversarial mismatch of route-attempt components
  refuses and leaves the table unchanged;
- the old public crossed spelling `sink(T0, E1)` does not compile;
- default and all-feature dependent surface tests cannot call a raw staging
  consumer with `|| Ok(())`;
- the strict-delivery and signed-URL route fixtures exercise the exact
  preflight/render/reserve/plan/put/commit ordering;
- the public-immutable fixture proves its policy probe, not a fake caller
  reservation, dominates width staging;
- fork qualification proves an inherited carrier refuses in the child even
  though raw pointer addresses compare equal there.

Table readback is mandatory after every refusal. An error value without proving
the publication table unchanged is not evidence for F272.

## Defect inversion and operator recovery

The recommended origins inherit the defect. A false mismatch reverses the
original harm from unauthorized acceptance to **permanent denial**. Name this
failure mode `ORIGIN_FALSE_REFUSAL`: a legitimate same-graph callback principal
or width plan is repeatedly refused because the origin was stamped, cloned,
or compared incorrectly.

Origin checks occur before the durable write. On the diagnostic:

1. stop or drain the affected process and confirm the callback/publication
   transaction did not commit;
2. restart into one fresh `LocalSnapback`/app-state graph rather than rebinding
   an old carrier;
3. rederive callback authority from the durable callback catalog and current
   scope basis;
4. discard a refused width carrier and rerun preflight, rendering, and
   reservation. The existing `asset.retry` operation remains the operator path
   for a durable asset attempt that needs a new drive;
5. if a clean restart still produces origin refusals, roll back or repair the
   binary and replay through the supported producer. Do not expose a bypass,
   origin setter, or raw constructor as a recovery mechanism.

Stable diagnostics must say whether the refusal was wrong database, wrong
graph, rebuilt graph, forked process, or mismatched route attempt. That
distinction is what lets an operator choose restart versus ordinary retry.

This design adds no durable monotone identity, generation, nonce registry, or
consumed-token table. Allocation identities die with their process, and a new
producer invocation unsticks a refused carrier. There is therefore no new
ceiling to compact, reset, or lower. Existing asset attempt retry ceilings and
publication-record retirement retain their existing recovery rules; the
carrier must not increment a durable retry counter merely because an origin
check refused before the transaction.

## Migration and landing boundary

F145 can land with Q22 after Q11/C005 as planned:

- private fields plus database/current-process origin and getters;
- real-producer test migration;
- engine-owned target preparation operation;
- deletion/narrowing of the raw sync preparation method;
- cross-database, rebuild, fork, liveness, and consumer-dominance evidence.

F145 is therefore simpler than the inventory label suggests: it is gated on
review of how to seal its existing carrier, not on invention of another
carrier.

F272 must land as one semantic batch:

- engine-derived preflight/render/reservation carrier flow;
- both production routes;
- the intended engine sink;
- all 18 checked-in engine-test compositions;
- the four caller-backed legacy width entry points and the public-profile
  entry point;
- removal or proof-bearing redesign of the dependent-reachable raw kernel
  staging consumer;
- default and additive-union surface checks;
- cross-attempt, cross-graph, rebuild, restart, fork, and unchanged-table
  evidence.

Do not land the carrier first while an unchecked consumer remains. That would
turn a gated row into a misleading partial closure.

## Recommendation and confidence

Adopt two semantically distinct carriers:

- **seal, do not replace,** `AssetCallbacksServicePrincipal`, and derive its
  complete prepared authority inside `LocalSnapback`;
- **introduce** `AuthorizedAssetWidthPlan` as a non-cloneable,
  `EngineAppStateGraphIdentity`-bearing route-stage carrier produced from one
  captured authority and one render attempt, never from two supplied peers.

Make process identity part of both origin checks so a POSIX fork fails closed.
Treat the raw kernel width staging trait and the five engine paths that bypass
the intended sink as part of F272's consumer obligation. If they cannot be
made unreachable or proof-bearing, do not claim F272 closed.

**Confidence: 0.84.** The recommendation follows the measured producer and
consumer graph and keeps LLP 0058's no-permit-across-I/O boundary. The single
thing I am least sure of is the minimal crate-ownership move needed to remove
the raw kernel staging escape hatch without widening a different public
capability. That uncertainty affects migration size, not the carrier or origin
semantics.
