# Design: structural authority-to-publication binding for authorized effects

Status: Proposed — design accepted; capsule construction-origin slice built, core binding not built
Created: 2026-08-22
Updated: 2026-08-23
Related: issues/20260822-claims-versus-enforcement-is-endemic.md (Critical 1 and 2),
LLP 0058, LLP 0059

## Why

The endemic-class audit found that `PreparedBearerAuthority` and `ResolvedServiceAuthority`
correctly preserve authority/publication identity as opaque bundles, and that the guarantee is
then **discarded** by the public `with_fenced_publication` / `with_service_publication`
builders, which accept an arbitrary carrier. `reserve_authorized_effect` trusts whatever is
attached. A session authority paired with the stream-only anonymous publication reserves only
the stream counter, so logout drains that session's real leaf and never sees the permit.

This design says how to close it. An independent read confirmed the gap is real and located the
precise loss: **"The split-phase algorithm itself is sound for a correctly constructed authority.
The structural defect is the loss of identity between resolution and reservation."**

The substitution is endemic to `PreparedAuthority`, and checking another correlated field at an
individual destination cannot establish correspondence. The bounded commit capsule now has a
separate construction-origin seal: AppState checks preclaimed engine bindings against the exact
Local graph before minting one private runtime destination. That closes only the capsule's
`{state B, admission A, authority A}` splice. It does not prove correspondence between resolved
authority and a publication attached inside `PreparedAuthority`; that core design remains to be
built. The capsule's remaining residual register is
`issues/20260822-capsule-structural-residuals.md`.

## The load-bearing result

For sessions, a detached (resolved, carrier) pair **cannot be checked at all**. The carrier
contains neither `session_id` nor `authority_instance_id`, and generation is not unique, so
there is no sound equality test between two detached values. This rules out the obvious remedy
of a validating setter: any such check would be a guess. The remedy must be to preserve the
opaque bundle end to end and never expose a constructor that accepts its two halves — i.e.
make carrier substitution inexpressible rather than detected.

For service principals the private fence state does carry a full witness, so a check is
possible in principle, but there is no construction-safe accessor and `resolve_act` is a
liveness operation rather than an identity getter. The same preserve-the-bundle answer applies.

## Consequence for the landed stream-provenance work

> "The same private binding classification must drive both authorized-effect reservation and
> stream-attempt provenance. Otherwise the stream-provenance work merely moves the trust in a
> substituted carrier to another security boundary."

The R1 stream fix now derives provenance from these very carriers. That is the right shape and
it inherits this gap: it relocated the trust rather than removing it. Neither change is
complete without this one.

## Design

## Required invariant

A `PreparedAuthority` eligible for caller-authorized publication or durable-effect reservation must be constructible only from one of these closed origins:

1. An opaque session bundle containing its resolved session and exact session publication.
2. An opaque service bundle containing its resolved service identity and exact service publication, plus the stream publication captured for the same application authority graph.
3. An explicitly stream-only anonymous, admin, or operator origin.
4. An explicitly carrier-free Dev, system, terminal, watch, callback, or host-settlement origin.

No API may accept a separately supplied `ResolvedAppAuthority` and raw publication carrier. Carrier fields are set exactly once inside the origin-consuming constructor. There are no post-construction publication setters.

The same private binding classification must drive both authorized-effect reservation and stream-attempt provenance. Otherwise the stream-provenance work merely moves the trust in a substituted carrier to another security boundary.

## What identity is available

| Carrier | Resolved identity | Carrier identity today | Can a detached pair be checked today? | Design consequence |
|---|---|---|---|---|
| Session | `user_id`, `session_id`, `provider`, `generation`, `authority_instance_id`, and deadlines (`invocation.rs:298-315`) | Stream incarnation and `Arc<StreamFence>`; optional session leaf with expected generation and `Arc<SessionFence>` (`session_projection.rs:419-428`, `:546-550`) | **No.** The carrier contains neither `session_id` nor `authority_instance_id`. Generation is not unique. From the two detached values alone there is no sound equality test. | Preserve `PreparedBearerAuthority` intact. Never expose a constructor that accepts its two halves. |
| Service principal | Actor, credential ID/generation, grant ID, token ID, effective user, scopes, token expiry, status (`invocation.rs:339-352`) | The private fence state contains a full `ServiceAuthorityWitness`: token, grant, actor, effective user, credential ID/generation, token deadline, and optional grant deadline (`service_authority_contract.rs:17-27`) | **In principle**, but not through a construction-safe public accessor. `resolve_act` is a liveness operation and may return terminal or unavailable; it is not an identity getter. | Preserve `ResolvedServiceAuthority`, which is already minted from the same durable resolution and witness registration (`engine.rs:5170-5185`). |
| Anonymous/stream-only | `ResolvedAppAuthority::Anonymous`, or trusted admin/operator classification | Stream incarnation and `Arc<StreamFence>`; `session: None` (`session_projection.rs:1140-1145`) | It can be bound only to the authorization stream. It cannot prove any session or service leaf. | Give it a distinct `PreparedStreamPublication` type. It must not satisfy a session-publication parameter. |
| Credential-free watch/callback/system | Revalidated principal, protected watch anchor, asset-callback principal, or `System` | Intentionally no caller publication | There is nothing to pair. Absence is legitimate and must remain explicit. | Construct an explicit carrier-free origin; do not infer it from `Option::None`. |

For sessions, the binding proof is provenance: `CoordinatorTopology::prepare_bearer_authority` resolves the session and obtains its publication from the same projected entry before returning the opaque bundle (`crates/snapback-sync/src/auth/coordinator.rs:1927-1954`). Duplicating partial scalar identity into a later checker would be weaker than preserving that bundle.

For services, `ServiceAuthorityFenceRegistry::register` already rejects disagreement when the same token fence is re-registered (`crates/snapback-auth/src/auth/service_fence.rs:824-898`). The corresponding resolved identity and publication are then stored privately together in `ResolvedServiceAuthority`. That existing pairing should cross the next boundary intact.

The stream publication also needs process-graph provenance, not merely a matching incarnation string. LLP 0059 forbids independent authority graphs for one database (`llp/0059-session-projection-and-client-barrier.spec.md:1219-1224`). Add a private, cloneable graph binding minted with the application authority graph and retained by stream/session/service origin bundles. Cross-graph assembly must fail inside the sole constructor; callers cannot bypass that constructor.

## Recommended API

Use **authority-owned sealed construction**.

### Closed origin types

Introduce opaque origin types along these lines:

```text
PreparedBearerAuthority
  = exact resolved session + exact session/stream publication + graph binding

PreparedStreamPublication
  = exact stream publication + graph binding

PreparedServiceAuthority
  = exact resolved service + exact service publication
    + exact stream publication when this is a direct caller route
    + graph binding

PreparedConnectionRouteAuthority
  = resolved connection authority + all connection-owned publications
    + explicit “outer connection fence owns this cut” posture

PreparedCarrierFreeAuthority
  = closed reason and resolved authority for Dev/system/watch/callback/host work
```

`PreparedAuthority` should hold one private enum rather than two independently optional fields:

```text
AuthorityFenceBinding =
    DevMode
  | CarrierFree(closed reason)
  | StreamOnly(exact stream carrier)
  | Session(exact bearer bundle)
  | Service(exact service bundle)
  | ConnectionBound(exact connection bundle)
```

Its `resolved`, publication carriers, stream classification, and diagnostic mapping are projections of that enum. They are not separately assignable fields.

### Construction entry points

- `PreparedBearerAuthority::prepare(...)` remains the session preparation entry point, but calls a private constructor that consumes the sealed session origin. Its current implementation is already close to the desired shape (`coordinator.rs:515-541`).
- `AuthCoordinator::prepare_anonymous_publication` returns `PreparedStreamPublication`, not raw `FencedPublication` (`coordinator.rs:1520-1529`).
- Anonymous and admin preparation accept `PreparedStreamPublication`; session preparation cannot accept that type.
- Direct service preparation first captures `PreparedStreamPublication` outside Local, as LLP 0059 requires, then passes it into service resolution. The Local-owned resolver returns a complete `PreparedServiceAuthority`. The mandatory assembly verifies the private graph binding without acquiring a stream lock beneath Local. This preserves the required order at `llp/0059-session-projection-and-client-barrier.spec.md:1237-1247`.
- Connection preparation moves behind `BoundGrantAuthority` or a new `PreparedConnectionRouteAuthority`. The route layer must not extract its raw publications through `BoundGrantAuthority::publication` and overlay them afterward (`crates/snapback-server/src/server.rs:3755-3784`, `:3856-3871`, `:14087-14103`).
- Retained live authority stores and clones the complete private binding posture. It must not rebuild a raw authority and then attach only `service_publication`, as it currently does at `invocation.rs:1949-1974`.
- `InvocationGate::prepare_admitted_authority(resolved, ...)` becomes private to the common constructor. Public entry points accept closed origin types. Carrier-free constructors accept only their enumerated legitimate variants and sources.

Delete:

- `PreparedAuthority::with_fenced_publication`
- `PreparedAuthority::with_service_publication`
- public/test-support splitters that enable external reconstruction of a prepared authority
- raw connection-publication accessors used only for post-hoc overlay

Raw fence types may remain available to their fence implementation and bounded publication operations, but there must be no conversion from a raw fence to a `PreparedAuthority` outside the sealed constructors.

### Why this option

This directly preserves the proof already established at resolution. It also distinguishes anonymous stream authority from session authority, which today’s data cannot validate after separation.

Alternatives are weaker:

- A raw runtime equality assertion is impossible for session publications today because the carrier lacks `session_id`; after adding more fields it would still be vulnerable to call sites that never invoke the checker.
- A separate pairing token duplicates the proof already embodied by `PreparedBearerAuthority` and `ResolvedServiceAuthority`. A private graph binding is still useful for cross-component graph provenance, but it should live inside those bundles rather than become another caller-supplied argument.
- Merely making publication fields private does not help if the constructor still accepts `(resolved, publication)`.
- Typestate can prove “publication attached” but cannot prove that runtime session A owns publication A without carrying the same sealed origin. It would also multiply anonymous, service, connection, retained-live, and carrier-free states.

## Bind reservations to sink authorization

`AuthorizedEffectReservation` already owns a clone of authority A (`invocation.rs:1230-1238`, `:1777-1780`), and `commit_guard` correctly acquires mode from that stored authority (`invocation.rs:1291-1330`). The defect is that many sinks authorize using a separately supplied `&PreparedAuthority` B.

Change every authorized sink to accept the reservation as its sole authority-bearing argument:

```text
sink(reservation, ordinary request data)
```

The reservation exposes an opaque borrowed `AuthorizedAuthorityView`, or narrow delegating methods for `resolved`, `source`, canonical auth input, descriptor derivation, and function preparation. It must not accept or combine another prepared authority.

Examples:

- `mint_capability_link_with_authorized_effect` drops its `authority` argument and derives session identity from the reservation (`engine.rs:5339-5372`).
- `acknowledge_client_mutations_with_authorized_effect` derives both the descriptor and commit permit from the same reservation (`engine.rs:10939-10980`).
- Asset sinks drop their separate authority parameters, including `engine.rs:11996`, `:12309`, `:13257`, `:13299`, `:13348`, `:13464`, `:13569`, `:13633`, `:13808`, `:13840`, `:13858`, `:15044`, `:15088`, `:15143`, `:15204`, and `:15304`.
- The other dual-input sinks at `engine.rs:5454`, `:5538`, `:6043`, `:6279`, `:6312`, `:7101`, and `:11136` receive the same mechanical treatment.

The ordinary mutation path needs an owned composite because staging currently uses one cloned authority while commit receives a reservation separately (`crates/snapback-server/src/server.rs:27395-27442`; `crates/snapback-engine/src/local/engine.rs:17286-17343`):

```text
stage_authorized_mutation(reservation, request)
    -> StagedAuthorizedMutation { staged mutation, same reservation }

commit_staged_authorized_mutation(StagedAuthorizedMutation)
```

Staging derives `PreparedInvocation` from the reservation’s authority. The composite carries that same reservation to commit. Neither stage nor commit accepts another authority.

The bounded commit capsule is already close to the correct ownership shape: it accepts one authority, creates the reservation internally, and gives the transaction closure the reservation (`crates/snapback-server/src/server/commit_capsule.rs:558-619`). Its downstream sinks must follow the single-authority rule.

Keep `PreparedAuthority::reserve_authorized_effect(&self, effect)` source-compatible. It may continue cloning the authority internally. The structural guarantee comes from sinks having no B parameter, not from consuming the caller’s last clone.

## Migration inventory

Legend:

- **M** — mechanical use of an existing sealed bundle or the new typed stream wrapper.
- **J** — judgment required because the site currently relies on optional, connection-owned, retained, or synthetic carrier posture.
- **U** — reservation call expression survives unchanged.

### `with_fenced_publication` and `with_service_publication`

| Call site | Status | Migration |
|---|---:|---|
| `crates/snapback-sync/src/auth/coordinator.rs:540` | M | Have `PreparedBearerAuthority::prepare` invoke the sealed session-origin constructor. |
| `crates/snapback-sync/src/auth/coordinator.rs:3401` | M | Test uses the typed stream-only admin constructor. |
| `crates/snapback-sync/src/auth/invocation.rs:1965` | J | Retained live authority must clone a complete retained binding posture; preserve the fact that an outer connection may own the stream cut. |
| `crates/snapback-engine/src/local/engine.rs:7760` | J | Split optional anonymous preparation into explicit Dev/carrier-free and sessions/stream-bound entry points. |
| `crates/snapback-engine/src/local/engine.rs:7845` | M | Admin preparation consumes `PreparedStreamPublication`. |
| `crates/snapback-engine/src/local/engine.rs:7893` | J | Split Dev operator and sessions operator construction; remove the raw optional publication. |
| `crates/snapback-engine/src/local/engine.rs:7943` | J | Direct service preparation consumes a complete service origin rather than attaching the stream half. |
| `crates/snapback-engine/src/local/engine.rs:7944` | J | Same atomic direct-service construction; do not expose the service half independently. |
| `crates/snapback-engine/src/local/engine.rs:7968` | J | Use an explicit connection-service origin whose outer connection owns the stream fence. |
| `crates/snapback-server/src/server.rs:14097` | J | Remove post-hoc connection stream overlay; prepare directly from `BoundGrantAuthority`. |
| `crates/snapback-server/src/server.rs:14101` | J | Same change for the connection service carrier. |
| `crates/snapback-server/src/server/tests.rs:5296` | M | Keep the resolved `PreparedBearerAuthority` intact and call its preparation method. |
| `crates/snapback-server/src/server/tests.rs:7845` | J | Prepare from the complete service connection act. |
| `crates/snapback-server/src/server/tests.rs:7846` | J | Same complete connection origin. |
| `crates/snapback-server/src/server/tests.rs:8372` | J | Prepare from the session connection act rather than cloning its raw publication. |
| `crates/snapback-server/src/server/tests.rs:8486` | M | Use `PreparedBearerAuthority::prepare`. |
| `crates/snapback-server/src/server/tests.rs:19920` | J | Use the complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:21143` | M | Use `PreparedBearerAuthority::prepare`. |
| `crates/snapback-server/src/server/tests.rs:26856` | J | Construct a coherent service action fixture; declare whether the stream cut is direct or connection-owned. |
| `crates/snapback-server/src/server/tests.rs:27852` | J | This currently attaches token publication to a cron/system authority. Replace it with a coherent service-authority fixture; retaining this shape would perpetuate the defect. |
| `crates/snapback-server/src/server/tests.rs:30075` | J | Use the complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:30273` | J | Use the complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:31321` | M | Use `PreparedBearerAuthority::prepare`. |
| `crates/snapback-engine/src/local/tests/engine.rs:14715` | J | Rebuild the retained-live fixture with an explicit connection-owned or direct service binding. |
| `crates/snapback-engine/src/local/tests/engine.rs:26925` | J | Replace raw synthetic pairing with a coherent service-origin test factory; make its stream ownership explicit. |
| `crates/snapback-engine/src/local/tests/engine.rs:26965` | J | Same test-factory migration under managed admission. |

### `reserve_authorized_effect`

All 49 reservation call expressions can remain unchanged. Their surrounding sinks may change as described above.

| File | Call sites | Status |
|---|---|---:|
| `crates/snapback-server/src/server.rs` | `:2030`, `:2071`, `:2106`, `:12292`, `:27396` | U |
| `crates/snapback-server/src/server/commit_capsule.rs` | `:593` | U |
| `crates/snapback-server/src/server/asset_routes.rs` | `:45` | U |
| `crates/snapback-server/src/server/tests.rs` | `:31699`, `:32068`, `:32090`, `:32190`, `:32247`, `:32273`, `:33305`, `:36564` | U |
| `crates/snapback-engine/src/local/tests/engine.rs` | `:5060`, `:11013`, `:11056`, `:11102`, `:11108`, `:11124`, `:11130`, `:11180`, `:11188`, `:11197`, `:11203`, `:11224`, `:11230`, `:11278`, `:11285`, `:11292`, `:11298`, `:11315`, `:11352`, `:11413`, `:11420`, `:11427`, `:11533`, `:11551`, `:11563`, `:11631`, `:11638`, `:11645`, `:11651`, `:11666`, `:11800`, `:11807`, `:11816`, `:11823` | U |

The tests marked U may still need fixture-construction edits if they currently obtain authority through one of the deleted raw builders.

## Proof obligations

### 1. Session/anonymous cross-pair construction test

Create session authority A and a `PreparedStreamPublication` from `prepare_anonymous_publication`. Attempt to construct session authority from A’s resolved facts plus the anonymous publication.

The attempt must either:

- fail to compile because the anonymous type does not satisfy the session-origin constructor, or
- enter a private test-only malicious-parts constructor and fail before producing `PreparedAuthority` with a stable internal binding diagnostic.

Then retire A and assert there is no value on which `reserve_authorized_effect` can be called.

This catches the exact inert-fence path: a stream permit with no A-session counter. A normal correlated test cannot catch it because correlated A/A construction reserves the expected session leaf and therefore passes even while the substitution API remains available.

### 2. Public compile-fail doctest

Place a `compile_fail` doctest on `PreparedAuthority` showing that this is impossible:

```text
prepared_session.with_fenced_publication(anonymous_publication)
```

The fixture must fail specifically because:

- no publication mutator exists;
- the stream-only wrapper cannot be unwrapped into a session carrier; and
- `PreparedBearerAuthority` cannot be split through the production API.

This catches accidental reintroduction of a public raw attachment path. Runtime race tests cannot detect API surface regressions until a caller uses the new path.

### 3. Service cross-pair test

Resolve service A and service B. Attempt to construct an authority from A’s resolved service identity and B’s publication. Construction must fail before `PreparedAuthority` exists. Repeat with two authority graphs that share copied durable incarnation text to prove the private graph binding, not string equality, owns process topology.

A correlated service test proves service retirement behavior; it does not prove that the permit and resolved token came from the same resolution.

### 4. Reservation/sink A/B compile proof

Reserve authority A. Attempt to call a guarded sink with authority B and A’s reservation. This must fail to compile because the sink has no separate authority parameter.

Add a positive sink test where request identity names B while the reservation belongs to A; the sink must derive A from the reservation and reject the request’s B facts. This proves there is no ambient-authority fallback hidden behind the new signature.

### 5. Stream-provenance coupling

For every private `AuthorityFenceBinding` variant, assert both:

- its authorized-effect reservation posture; and
- its stream-attempt provenance classification.

There must be no independently supplied classification enum. The stream-provenance capability is intended to be opaque and constructor-derived, as in the landing’s `CallerAuthorized`/`ModeOnly` shapes (`46667db76:crates/snapback-sync/src/stream_attempt.rs:36-99`).

A cross-pair must fail before classification. A passing table of correlated `resolved` variants would not catch carrier substitution.

### 6. Existing ordering proofs

Retain terminal-first and reservation-first tests. They still prove the lifecycle protocol after construction identity is fixed:

- terminal first prevents reservation;
- reservation first drains before terminal durable commit;
- mode is acquired last;
- no guard crosses await or Local acquisition.

These tests prove ordering, not pairing, and must not be presented as substitutes for the negative construction tests.

## Risks

### Credential-free authorities

Do not infer carrier requirements from `ResolvedAppAuthority` alone.

- User-owned watch execution deliberately reconstructs `RevalidatedPrincipal` without a session carrier (`crates/snapback-engine/src/local/engine.rs:24804-24851`).
- Integration watches reconstruct a service-principal-shaped anchor without a scoped-token carrier at the same site.
- Asset callbacks deliberately use a bearer-free protected-catalog service (`crates/snapback-sync/src/auth/invocation.rs:2320-2360`).
- Cron and job actions use `System` with mode admission only (`crates/snapback-engine/src/local/engine.rs:22723-22779`).
- LLP 0058 explicitly keeps credential-free job/watch/webhook work mode-only (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1376-1402`).

These need explicit carrier-free origin variants. Treating every `ServicePrincipal` as requiring a service publication would break legitimate watch and callback execution.

### Connection-owned and retained-live fences

Connection acts already own exact stream/session/service carriers. Reattaching their raw carriers to an independently prepared route authority is the current dangerous seam, but simply requiring direct-route carriers everywhere would double-lock the same non-reentrant fence. The connection-origin constructor must record that the outer connection act owns the final stream cut.

Retained live authority likewise intentionally differs from a fresh direct bearer request. Its preparation at `invocation.rs:1949-1974` must preserve an explicit retained/outer-fenced posture rather than silently becoming carrier-free or directly reservable.

### Host settlement and bootstrap

Host settlement must retain its explicit trusted capability. It must not obtain caller-authorized classification by manufacturing an anonymous carrier.

Bootstrap’s incarnation-only binding at `crates/snapback-sync/src/auth/coordinator.rs:1814-1823` is diagnostic metadata, not an effect publication. It must remain unable to populate a caller-publication binding.

### Lock ordering

Direct service preparation must continue capturing the stream carrier before Local and service resolution, as required by LLP 0059 (`llp/0059-session-projection-and-client-barrier.spec.md:1237-1247`). The graph-binding comparison must be lock-free; it must not acquire a stream/session mutex beneath Local.

### Test-only escape hatches

`ResolvedServiceAuthority::synthetic_for_test` currently accepts separately supplied resolved authority and publication (`engine.rs:3267-3277`). Replace it with a factory that starts from one resolved scoped-token fixture and registers its witness itself. Any test-only malicious-parts constructor must be private to the defining module and return `Result`; it must not become a feature-gated public reconstruction API.

### Future drift

The private binding enum becomes the sole source for:

- reservation order and required carriers;
- terminal diagnostic selection;
- stream-attempt provenance;
- direct versus connection-owned publication;
- whether mode-only operation is legitimate.

Adding an authority source therefore requires an exhaustive constructor and classification edit. This is deliberate: a new raw `Option<FencedPublication>` would recreate the gap.

## Acceptance criterion

The work is complete when no production or test-support API can produce a `PreparedAuthority` by independently selecting resolved authority and publication carriers; every authorized sink obtains authorization facts and permits from one reservation-owned authority; and the session-A/anonymous-publication cross-pair is rejected before reservation is expressible.
