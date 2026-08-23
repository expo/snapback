# Implementation plan: structural authority-to-publication binding

Status: In progress — independent early slice implemented; Steps 2–8 not started
Created: 2026-08-22
Updated: 2026-08-23
Related: issues/20260822-authority-publication-binding-design.md (the design),
issues/20260822-claims-versus-enforcement-is-endemic.md,
issues/20260822-landed-fence-tests-do-not-prove-non-substitutability.md

## Why this is the critical path

The accepted design is now the root cause behind findings in three separate places:

- the test audit's top four findings, including that **all 38 macro-generated split-phase race
  tests are green under a zero-line mutation**, because every fixture pairs authority A with
  reservation A while the guarded sinks accept independently sourced values;
- the watch-management CRITICAL, where `CommitCapsuleDestination::bind` validated one AppState
  component and copied the rest;
- the landed stream-provenance work, which derives R1 provenance from the very carriers that can
  be substituted — relocating the trust rather than removing it.

Nothing else on the queue unblocks those. This plan says how to build it.

## Convergent validation

The plan was written against the watch branch **before** its capsule fix landed, and
independently prescribed the same remedy that fix implemented: package the destination
components in one private binding and stop copying `AppState.snapback` separately. Two
independent derivations reaching the same shape is the strongest signal available that the
design generalises.

## The verdict on the design

**Proceed. The core conclusion does not need revision** — a detached session `(resolved, carrier)`
pair cannot be validated, so the opaque bundle must survive intact.

One amendment is required: the private graph binding must also **seal the capsule destination
tuple** (database, admission controller, commit authority), not merely tag caller origins. That
is an extension of the accepted graph-binding requirement, not a replacement.

## The shape of the answer

`PreparedAuthority` gains one private, exhaustive binding — `DevMode`, `CarrierFree(reason)`,
`StreamOnly`, `Session`, `Service`, `ConnectionBound` — which becomes the **sole** source of
resolved identity, reservation order, direct-vs-outer-connection ownership, authorized-vs-
carrier-free posture, stale diagnostics, R1 stream provenance, and process/application graph
identity.

## Two things worth knowing before committing to this

**There is an independent early slice.** After watch management lands, the capsule destination
seal can land on its own — one private runtime binding, `bind` using it, the separately cloned
transaction authority removed, and a spliced-AppState A/B test. **It does not touch
`invocation.rs` or R1 at all**, so it is available immediately and carries no conflict risk.

**Step 5 is the one that matters.** It is the first step that satisfies the core requirement, and
its invariant is the whole point: *session A plus anonymous or service carrier B cannot produce a
`PreparedAuthority`, therefore reservation on that hybrid is not expressible.* Steps 3–4 exist to
migrate consumers so that Step 5's churn stays small. Anyone shortening this plan should preserve
Step 5 and cut elsewhere.

**Scale, honestly:** eight steps, 26 publication-setter sites, 49 `reserve_authorized_effect`
sites (50 once watch management lands), and 35–55 call sites in the largest migration step. This
is the largest single change the program has proposed.

## Census staleness

Line numbers move when the two in-flight branches land, so **re-run the census immediately after
both land** before starting Step 2.

## Baseline and decision

Analysis baseline: `origin/main@41a09e2e865a`. Incoming branch evidence is cited against stream R1 `46667db76` and watch management `58d40abd5`. Re-run the census immediately after both branches land because line numbers will move and the watch branch increases the reservation count from 49 to 50.

Proceed with the accepted design. Its core conclusion does not need revision: a detached session `(resolved, carrier)` cannot be validated, so the opaque bundle must survive intact (`issues/20260822-authority-publication-binding-design.md:21-32`).

One narrow amendment is required before implementation:

- The private graph binding must also seal the capsule destination tuple—database, admission controller, and commit authority—not merely tag caller origins.
- `CommitCapsuleDestination::bind` in the watch branch checks only the admission lease, then copies `runtime.snapback` and `runtime.commit_capsule_binding` independently (`58d40abd5:crates/snapback-server/src/server/commit_capsule.rs:84-107`). That permits a hybrid `AppState`.
- Package the three destination components in one private `CommitCapsuleRuntimeBinding`. The capsule must use its internally retained `SharedSnapback`, not the separately accessible `AppState.snapback`.

This is an extension of the accepted graph-binding requirement at `issues/20260822-authority-publication-binding-design.md:68-72`, not a replacement for it.

## Required end state

`PreparedAuthority` owns one private, exhaustive binding:

```text
AuthorityFenceBinding =
    DevMode
  | CarrierFree(ClosedCarrierFreeReason)
  | StreamOnly(PreparedStreamPublication)
  | Session(PreparedBearerAuthority)
  | Service(PreparedServiceAuthority)
  | ConnectionBound(PreparedConnectionRouteAuthority)
```

The binding is the sole source of:

- resolved identity;
- stream/session/service reservation order;
- direct versus outer-connection ownership;
- authorized versus carrier-free posture;
- stale diagnostics;
- R1 stream provenance;
- process/application graph identity.

No constructor accepts raw `(ResolvedAppAuthority, FencedPublication)` or `(ResolvedAppAuthority, ServiceAuthorityPublication)`. No sink accepts both `PreparedAuthority` B and reservation A.

## 1. Call-site census

Legend:

- **U** — survives unchanged.
- **M** — mechanical typed-constructor/signature migration.
- **J** — judgment required.

### Publication setters: all 26 sites

Neither setter survives. The current unsafe methods are at `crates/snapback-sync/src/auth/invocation.rs:1527-1544`.

| Call site | Status | Required migration |
|---|---:|---|
| `crates/snapback-sync/src/auth/coordinator.rs:540` | M | `PreparedBearerAuthority::prepare` consumes its sealed session bundle. |
| `crates/snapback-sync/src/auth/coordinator.rs:3401` | M | Use the typed stream-only admin fixture. |
| `crates/snapback-sync/src/auth/invocation.rs:1965` | J | Retain and replay the complete live binding, including outer-connection ownership. |
| `crates/snapback-engine/src/local/engine.rs:7760` | J | Replace optional anonymous publication with separate sessions-stream and explicit carrier-free entry points. |
| `crates/snapback-engine/src/local/engine.rs:7845` | M | Admin constructor consumes `PreparedStreamPublication`. |
| `crates/snapback-engine/src/local/engine.rs:7893` | J | Split Dev operator and sessions operator origins; remove `Option<FencedPublication>`. |
| `crates/snapback-engine/src/local/engine.rs:7943` | J | Direct service constructor consumes one complete service/stream origin. |
| `crates/snapback-engine/src/local/engine.rs:7944` | J | Same atomic service construction. |
| `crates/snapback-engine/src/local/engine.rs:7968` | J | Explicit connection-owned service origin; do not double-reserve the outer fence. |
| `crates/snapback-engine/src/local/tests/engine.rs:14715` | J | Rebuild retained-live service fixture with explicit direct/connection posture. |
| `crates/snapback-engine/src/local/tests/engine.rs:26925` | J | Replace raw synthetic service pairing with coherent registry-backed fixture. |
| `crates/snapback-engine/src/local/tests/engine.rs:26965` | J | Same under managed admission. |
| `crates/snapback-server/src/server.rs:14097` | J | Consume complete `BoundGrantAuthority`; remove raw stream overlay. |
| `crates/snapback-server/src/server.rs:14101` | J | Same for the service carrier. |
| `crates/snapback-server/src/server/tests.rs:5296` | M | Keep `PreparedBearerAuthority` intact. |
| `crates/snapback-server/src/server/tests.rs:7845` | J | Complete connection-service origin. |
| `crates/snapback-server/src/server/tests.rs:7846` | J | Same origin; no second service attachment. |
| `crates/snapback-server/src/server/tests.rs:8372` | J | Complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:8486` | M | `PreparedBearerAuthority::prepare`. |
| `crates/snapback-server/src/server/tests.rs:19920` | J | Complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:21143` | M | `PreparedBearerAuthority::prepare`. |
| `crates/snapback-server/src/server/tests.rs:26856` | J | Coherent direct or connection-owned service fixture. |
| `crates/snapback-server/src/server/tests.rs:27852` | J | Stop attaching a service publication to `System`; use a real service origin or explicit host/system origin. |
| `crates/snapback-server/src/server/tests.rs:30075` | J | Complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:30273` | J | Complete session connection origin. |
| `crates/snapback-server/src/server/tests.rs:31321` | M | Preserve the bearer bundle in the shared race fixture. |

### `reserve_authorized_effect`: all current 49 sites

All expressions are **U**. Their surrounding construction or sink calls may change.

| File | Sites |
|---|---|
| `crates/snapback-server/src/server.rs` | `:2030`, `:2071`, `:2106`, `:12292`, `:27396` |
| `crates/snapback-server/src/server/asset_routes.rs` | `:45` |
| `crates/snapback-server/src/server/commit_capsule.rs` | `:593` |
| `crates/snapback-server/src/server/tests.rs` | `:31699`, `:32068`, `:32090`, `:32190`, `:32247`, `:32273`, `:33305`, `:36564` |
| `crates/snapback-engine/src/local/tests/engine.rs` | `:5060`, `:11013`, `:11056`, `:11102`, `:11108`, `:11124`, `:11130`, `:11180`, `:11188`, `:11197`, `:11203`, `:11224`, `:11230`, `:11278`, `:11285`, `:11292`, `:11298`, `:11315`, `:11352`, `:11413`, `:11420`, `:11427`, `:11533`, `:11551`, `:11563`, `:11631`, `:11638`, `:11645`, `:11651`, `:11666`, `:11800`, `:11807`, `:11816`, `:11823` |

Watch management adds one test probe at `58d40abd5:crates/snapback-server/src/server/tests.rs:36422`. The capsule reservation moves to `58d40abd5:crates/snapback-server/src/server/commit_capsule.rs:718`. Expected post-merge count: 50, assuming neither branch drops a later-main site.

### Direct authority/reservation sinks

| Sink definition | Current callers | Status |
|---|---|---:|
| `engine.rs:5339` capability-link mint | `server.rs:25943` | M |
| `engine.rs:5454` capability-link revoke | `server.rs:26163` | M |
| `engine.rs:5538` agent invitation | `server.rs:14850` | M |
| `engine.rs:6043` ask spend | `server.rs:25272` | M |
| `engine.rs:6279` push claim | `server.rs:2079`; `server/tests.rs:32096,32159` | J |
| `engine.rs:6312` push transmitting | `server.rs:2115`; `server/tests.rs:32175` | J |
| `engine.rs:7101` immediate push reservation | `server.rs:2038`; `server/tests.rs:32074,32149` | J |
| `engine.rs:10939` client-ack inner | `engine.rs:11149` | M |
| `engine.rs:11136` client-ack descriptor | `server.rs:27199` | M |
| `engine.rs:11996` asset create | `asset_routes.rs:144` | M |
| `engine.rs:12309` asset inspect | `asset_routes.rs:165` | M |
| `engine.rs:13257` asset cancel | `asset_routes.rs:207` | M |
| `engine.rs:13299` TUS HEAD | `asset_routes.rs:372` | M |
| `engine.rs:13348` TUS patch preflight | `asset_routes.rs:462` | M |
| `engine.rs:13464` TUS patch commit | `asset_routes.rs:499`; `engine tests:5063` | M |
| `engine.rs:13569` TUS terminate | `asset_routes.rs:527` | M |
| `engine.rs:13633` finalize preflight | `asset_routes.rs:238` | M |
| `engine.rs:13808` finalize plan | `asset_routes.rs:268` | J |
| `engine.rs:13840` finalize complete | `asset_routes.rs:295` | J |
| `engine.rs:13858` finalize revalidated | `asset_routes.rs:324` | J |
| `engine.rs:15044` asset delivery | `asset_routes.rs:632` | M |
| `engine.rs:15088` strict-width preflight | `asset_routes.rs:577` | M |
| `engine.rs:15143` signed URL issuance | `asset_routes.rs:832` | M |
| `engine.rs:15204` signed-width preflight | `asset_routes.rs:776` | M |
| `engine.rs:15304` asset deletion | `asset_routes.rs:958` | M |

Each mechanical sink drops `&PreparedAuthority`; identity and descriptor operations move behind `AuthorizedAuthorityView` borrowed from the reservation. The push sites are judgment calls because their callers currently choose the guarded sibling through `has_fenced_publication()` at `server.rs:2027,2068,2103`; the watch branch broadens this to two booleans at `58d40abd5:server.rs:26546-26555`. Replace both with exhaustive binding-derived posture.

### Other split carriers that must be included

| Seam | Callers | Status |
|---|---|---:|
| `engine.rs:14075` finalize-plan inner: authority plus `Option<Reservation>` | `engine.rs:13802,13815,14060` | J |
| `engine.rs:14277` finalize-complete inner: authority plus `Option<Reservation>` | `engine.rs:13846,13871,14255` | J |
| `engine.rs:14655` asset-failure state: protected attempt plus optional reservation | `engine.rs:14144,14510,14650` | J |
| `engine.rs:13951` finalize cleanup ticket plus reservation | `asset_routes.rs:347` | J |
| `engine.rs:14960` width-plan ticket plus reservation | `asset_routes.rs:600,800`; engine tests `:11016,11105,11111,11183,11200,11206,11281,11295,11301,11416,11430,11536,11554,11634,11648,11654,11803,11819` | J |
| `engine.rs:14982` width-commit ticket plus reservation | `asset_routes.rs:615,815`; engine tests `:11059,11127,11133,11191,11227,11233,11288,11318,11355,11423,11566,11641,11669,11810,11826` | J |
| `engine.rs:17286` staged mutation plus reservation | `server.rs:27467` | J |
| Current capsule `commit_capsule.rs:558-577`: database plus authority | `server/tests.rs:36778` | J |
| Incoming `CommitCapsuleDestination::bind` | `58d40abd5:server.rs:26293`; tests `:37017,37401,37661` | J |
| Incoming capsule invocation | `58d40abd5:server.rs:26294`; tests `:37268` | J |
| Incoming watch stage uses a separately cloned authority | `58d40abd5:server.rs:26292-26318` | J |

### Secondary constructor blast radius

Deleting the raw common constructor affects 68 expressions beyond the named setters: 29 `prepare_admitted_authority` and 39 unmanaged `prepare_authority` calls.

They occur in:

- `crates/snapback-engine/src/local/engine.rs`: 12
- `crates/snapback-engine/src/local/tests/engine.rs`: 16
- `crates/snapback-sync/src/auth/invocation.rs`: 19
- `crates/snapback-server/src/server/tests.rs`: 13
- `crates/snapback-sync/src/auth/coordinator.rs`: 2
- `crates/snapback-engine/src/push/authority_tests.rs`: 2
- Four other engine acceptance/host files: one each.

Treat all 68 as **J** until classified by origin. Dev/system/watch/callback cases move to explicit carrier-free constructors; session/service tests must use coherent projection/registry-backed factories. The current public constructor accepts arbitrary `ResolvedAppAuthority` at `invocation.rs:2196-2218`, so leaving it generally callable would defeat the setter deletion.

Also remove or narrow:

- `PreparedBearerAuthority::into_parts`, including its public test-support form (`coordinator.rs:495-503`); current server-test uses are `:5266,8473,21132,31309`.
- `PreparedConnectionSessionAuthority::into_parts` (`coordinator.rs:426-433`) and `PreparedAnonymousConnectionAuthority::into_parts` (`:474-477`); production consumers include `server.rs:5700,5740,15659`.
- `ResolvedServiceAuthority::synthetic_for_test` and raw publication accessor (`engine.rs:3267-3285`).
- Connection publication accessors used by post-hoc overlay (`server.rs:3856-3871,14087-14103`). Internal bounded publish/reserve operations at `server.rs:4304-4315,6348-6352,6383-6387,6515-6523` should become methods on the intact bundle, not lose their behavior.

## 2. Sequencing with incoming branches

### Assumed landed shape

1. Stream R1 retains opaque `CallerAuthorized`, `ModeOnly`, and `HostSettlement` capabilities, but its classifier at `46667db76:crates/snapback-sync/src/stream_attempt.rs:77-99` is invalidated. It currently derives caller provenance from `(active_mode, resolved)`, the same substitutable state.

   Preserve:

   - opaque transition capabilities;
   - separate host-settlement methods (`stream_attempt.rs:379-400`);
   - transition-site dispatch.

   Replace:

   - `PreparedAuthority::stream_attempt_origin()` classification;
   - the correlated classifier test at `stream_attempt.rs:1509-1572`.

   R1 provenance must be projected directly from `AuthorityFenceBinding`.

2. Watch management lands with:

   - `has_service_publication()` added beside the existing boolean (`58d40abd5:invocation.rs:1534-1550`);
   - the boolean-based carrier-free branch at `58d40abd5:server.rs:26546-26555`;
   - `EngineAppStateBindings` returning admission and commit authority separately (`58d40abd5:engine.rs:3050-3063,3314-3335`);
   - `AppState` storing `auth_admission`, `commit_capsule_binding`, and `snapback` separately (`58d40abd5:admin.rs:2636-2643,2827-2900`);
   - the hybrid capsule binding defect at `58d40abd5:commit_capsule.rs:84-107`;
   - a second authority clone used for staging at `58d40abd5:server.rs:26292-26318`.

   All five structures are subsumed.

### Likely conflicts

- `crates/snapback-sync/src/auth/invocation.rs`: the private enum replaces publication fields, both setters, and both `has_*` methods.
- `crates/snapback-sync/src/stream_attempt.rs`: R1’s inherent classifier must delegate to the binding rather than `active_mode()/resolved()`.
- `crates/snapback-engine/src/local/engine.rs`: origin constructors, `EngineAppStateBindings`, and all guarded sinks.
- `crates/snapback-server/src/server.rs`: connection overlay, push/watch posture selection, mutation staging, and watch capsule staging.
- `crates/snapback-server/src/server/tests.rs`: both branches add or move large test blocks, so line conflicts are likely even where semantics are independent.

At the inspected stream tip, R1 does not textually edit `invocation.rs`; it adds an inherent implementation against `PreparedAuthority` from `stream_attempt.rs`. The user-reported landing may differ. Re-census the landed combined tree rather than merging against these snapshots.

### Independent early slice

After watch management lands, the capsule destination fix can land before the invocation refactor:

- package exact `SharedSnapback`, admission controller, graph identity, and commit authority in one private runtime binding;
- make `CommitCapsuleDestination::bind` use that binding;
- remove the separately cloned `transaction_authority`;
- add the spliced-`AppState` A/B test.

This slice does not need to touch `invocation.rs` or R1.

Implemented 2026-08-23. The destination-only graph identity added here seals
`EngineAppStateBindings` to the exact `LocalSnapback` used to mint the private runtime binding;
it is not Step 2's application-wide authority-origin binding. No `PreparedAuthority`
publication construction changed.

## 3. Landable staging

### Step 1 — Seal the capsule destination

**Implemented 2026-08-23.**

Refactor the incoming `EngineAppStateBindings`/`AppState` capsule fields into one private `CommitCapsuleRuntimeBinding`. `CommitCapsuleDestination` receives the prepared authority and the sealed runtime binding; it never copies `AppState.snapback` independently.

The transaction closure derives watch staging identity from the reservation’s view, not `transaction_authority`.

Invariant: no production API can combine admission graph A with database/commit graph B.

Estimated blast: 6–8 code files, 4 destination-binding call sites, 2 capsule callers, 1 watch stage.

### Step 2 — Add graph identity and closed origin producers

Add a private cloneable process graph identity at the graph-claim composition root, near `AdmissionController` (`crates/snapback-auth/src/auth/admission.rs:161-168`). Carry it through:

- coordinator topology and `PreparedBearerAuthority`;
- `PreparedStreamPublication`;
- service registration/resolution;
- connection route origins;
- capsule runtime binding;
- explicit carrier-free origins.

Add coherent test factories now, while the old APIs still exist.

Invariant: every legitimate producer can return a sealed, graph-bound origin. No behavior claim yet; legacy unsafe builders still exist.

Estimated blast: 8–11 files, roughly 10–15 producer seams.

### Step 3 — Migrate session, stream-only, and admin consumers

Move the mechanical sites first:

- bearer preparation;
- admin/anonymous stream preparation;
- shared session test fixtures;
- connection-session storage without exposing raw publication;
- relevant raw-constructor tests.

Keep legacy builders temporarily, but require zero production use for these origin classes.

Invariant: every session/stream/admin authority built inside the workspace preserves an existing sealed bundle.

Estimated blast: 7–10 files, approximately 20–30 constructor/test-fixture edits.

### Step 4 — Migrate service, connection, retained-live, and carrier-free consumers

Handle the judgment sites:

- complete direct service origin assembled with stream capture before Local;
- connection-owned service/session origins;
- retained-live complete posture;
- explicit `CarrierFreeReason::{Dev,System,Cron,Job,WatchEvaluation,WatchReaction,AssetCallback,HostSettlement,...}`;
- all remaining raw constructor tests and synthetic service fixtures.

Do not infer carrier-free posture from `Option::None`, source, or resolved enum.

Invariant: the workspace has no caller of a raw publication setter, splitter, or unrestricted resolved-authority constructor.

Estimated blast: 10–14 files, approximately 35–55 construction and fixture edits.

### Step 5 — Enforcement cut: make carrier substitution inexpressible

This is the first step that satisfies the core requirement.

- Replace independent `resolved`, `publication`, `service_publication`, and incarnation fields with private `AuthorityFenceBinding` (`invocation.rs:1183-1215`).
- Delete both publication setters.
- Delete carrier-exposing splitters and synthetic raw pairing factories.
- Restrict the common raw constructor to private binding projection; public entry points accept closed origins only.
- Rewrite `reserve_authorized_effect` (`invocation.rs:1734-1785`) as an exhaustive binding match.
- Derive R1 provenance from the same match.
- Delete `has_fenced_publication`/`has_service_publication`.
- Add compile-fail/public-API proofs.

Invariant: session A plus anonymous/service carrier B cannot produce a `PreparedAuthority`; therefore reservation on that hybrid is not expressible.

Estimated blast: 4–7 production files plus doctests/UI tests. Consumer churn should be small because Steps 3–4 already migrated it.

### Step 6 — Make the reservation the sink’s sole authority

Add an opaque borrowed `AuthorizedAuthorityView` on `AuthorizedEffectReservation`. It exposes only narrow projections needed by sinks: resolved identity, source, descriptor derivation, canonical auth input, and function preparation.

Remove the separate authority argument from all 25 direct sinks. Replace optional/boolean posture selection with a sealed effect-origin enum so a session authority cannot call a carrier-free sibling.

Invariant: `(authority_B, reservation_A)` is unrepresentable at a guarded sink. Request data may still name B, but authorization is derived from A and must refuse B’s facts.

Estimated blast: 5–7 files, 25 definitions, about 30 direct callers, plus carrier-free sibling callers.

### Step 7 — Bind staged/ticket operations and destination identity

Introduce owned composites:

- `StagedAuthorizedMutation { staged, reservation }`;
- finalize plan/complete/cleanup composites;
- width plan/commit composites carrying sealed operation-authority identity;
- watch pending value bound to the destination/reservation;
- a mandatory graph check before any reservation reaches a `LocalSnapback`.

Do not compare detached raw session carriers. Both sides are already coherent by Step 5; compare their opaque graph/operation identity.

Invariant: staged work or ticket B cannot be committed with reservation A, and reservation A cannot target Local B.

Estimated blast: 6–9 files and roughly 45–55 call edits, dominated by 33 width test calls and the finalize helpers.

### Step 8 — Consolidate proofs and documentation

Tests accompany every preceding step. This final slice removes obsolete helpers/claims, updates LLP references and the accepted issue, runs the affected corpus audit, and closes the issue only after all three inexpressibility cuts exist:

1. carrier/resolved: Step 5;
2. authority/reservation: Step 6;
3. ticket/destination/reservation: Step 7.

## 4. Blast radius

| Step | Estimated files | Estimated call sites |
|---|---:|---:|
| Capsule destination | 6–8 | 7–10 |
| Graph/origin foundations | 8–11 | 10–15 producers |
| Session/stream/admin migration | 7–10 | 20–30 |
| Service/connection/carrier-free migration | 10–14 | 35–55 |
| Enforcement cut | 4–7 | Mostly definitions/tests |
| Sink unification | 5–7 | 25 definitions, ~30 direct calls, additional mode siblings |
| Staged/ticket composites | 6–9 | 45–55 |
| Proof/docs cleanup | 5–9 | Test-only |

### API and data compatibility

Public Rust API changes are unavoidable:

- remove `PreparedAuthority::with_fenced_publication` and `with_service_publication`;
- change `AuthCoordinator::prepare_anonymous_publication` to return `PreparedStreamPublication`;
- remove test-support `PreparedBearerAuthority::into_parts`;
- restrict `InvocationGate::prepare_authority` and `prepare_admitted_authority`;
- change engine authority-preparation and guarded-sink signatures;
- remove `ResolvedServiceAuthority::synthetic_for_test` and its raw publication accessor;
- change incoming `EngineAppStateBindings::into_parts`.

Do not provide deprecated compatibility shims accepting raw parts; they would preserve the defect.

No HTTP, wire, npm protocol, database schema, or persisted-record change is expected. Graph identities, origin bundles, and operation bindings are process-local Rust carriers. If implementation starts requiring persisted graph tokens or serializing fence identity, stop and revise the design.

### Legitimate carrier-free paths

These must continue working through explicit origins:

- credential-free user watch evaluation/reaction (`engine.rs:24804-24855`);
- integration watch authority shaped like a service principal but backed by an anchor, not a token carrier (`engine.rs:24821-24839`);
- asset callbacks (`invocation.rs:2320-2360`);
- cron and jobs using `System` (`engine.rs:22723-22779`);
- Dev authority;
- host settlement and terminalizer work from R1;
- bootstrap incarnation diagnostics, which are not effect publication authority.

## 5. Test plan

### Existing 38 + incoming 8 race tests

Do not convert or delete the 46 runtime races. They prove real ordering, just not pairing:

- 10 management races from `server/tests.rs:31787-31824`;
- 6 immediate-push races from `server/tests.rs:32342-32369`;
- 22 asset races from `server/tests.rs:33421-33488`;
- 8 watch-management races from `58d40abd5:server/tests.rs:36494-36526`.

Rebuild their fixtures so they never split a bearer bundle. In particular, replace `prepared_test_session_route_authority`’s raw reassembly at `server/tests.rs:31299-31321` with `PreparedBearerAuthority::prepare`.

The tests remain per-site terminal-first/reservation-first proofs. Their old zero-line A/B weakness disappears because the sink signature no longer accepts B. Reintroducing a mode-only commit at a tested site must make terminal-first commit unexpectedly or reservation-first stop draining logout, failing the durable/session assertions.

### New negative and adversarial proofs

| Test | Kind | Required assertion | Shortest relevant production mutation |
|---|---|---|---|
| Session cannot accept stream-only publication; bearer cannot split; no setter exists | Compile-fail plus public-API snapshot | No `PreparedAuthority` value is produced | Restoring a setter/splitter makes the UI snippet compile or changes the API snapshot; test fails. |
| Service A cannot be paired with service carrier B | Compile-fail where types make it impossible | No raw pairing constructor exists | Restoring `synthetic_for_test(resolved, publication)` makes the snippet compile; test fails. |
| Service graph A plus stream graph B with copied incarnation text | Runtime constructor refusal | Stable graph-mismatch error before `PreparedAuthority` | Removing opaque graph comparison or comparing strings lets construction succeed; test fails. |
| Every guarded sink has no separate authority parameter | Compile-fail/API surface | Representative session, asset, descriptor, and mutation calls with `(B, reservation_A)` do not type-check | Restoring an overload changes compilation/API snapshot; test fails. |
| Request/resource B with reservation A | Runtime A/B | Sink derives A from reservation, returns typed authorization refusal, durable bytes unchanged | Reading caller identity from request/ambient B authorizes or changes state; test fails. |
| Reservation A applied to Local B | Runtime A/B | Refusal before staging; Local B byte-identical | Removing destination graph check commits or stages B; test fails. |
| Preclaimed admission/commit graph A plus `SharedSnapback` B | Runtime A/B | `AppState::try_new_for_server_startup` refuses before graph B is claimed | Removing the opaque graph comparison constructs `{state B, admission A, authority A}`; test fails. |
| Ticket/staged value B plus reservation A | Runtime binder refusal or compile-fail composite | No commit-capable composite, no state change | Ignoring operation identity produces a composite/commit; test fails. |
| Binding-to-reservation/R1 classification matrix | Unit test over every private binding variant | One exhaustive policy yields both reservation posture and R1 provenance | Reverting R1 to `(mode,resolved)` misclassifies carrier-free service-shaped watch authority; test fails. |
| Explicit carrier-free matrix | Unit/integration | Watch, callback, cron/job, Dev, and host settlement work only through their named origin | Replacing the origin with inferred `None` either becomes impossible or changes the expected variant; test fails. |

No finite test can prevent a future author from adding an entirely new internal bypass and modifying tests in the same change. The meaningful regression boundary is: restoring any public/test-support parts API, known raw constructor, sink overload, string-only graph check, or R1 resolved-value classifier fails without changing the tests.

### Tests/helpers to replace or delete

- Replace, rather than retain, R1’s correlated classifier test `prepared_authority_is_the_closed_stream_origin_classifier` (`46667db76:stream_attempt.rs:1509-1572`). The replacement must include carrier-bearing and carrier-free authorities with similar resolved shapes.
- Delete raw A/A reassembly inside shared fixtures (`server/tests.rs:31309-31321`); retain the race tests themselves.
- Delete the `has_fenced_publication()` assertion at `server/tests.rs:25849`; retain the credential-free watch-reaction behavior test using an explicit watch origin.
- Delete raw synthetic service-pairing helpers such as `engine.rs:3267-3277` and `server/tests.rs:28330-28338`.
- Do not add a runtime “validating session setter” test. The accepted design proves such validation is unsound (`authority-publication-binding-design.md:21-28`).

## 6. Risks and stop conditions

1. **Cross-crate ownership is the hardest design problem.** `PreparedAuthority` lives in `snapback-sync`, while `ResolvedServiceAuthority` currently lives in `snapback-engine` (`engine.rs:3258-3285`). If sealed service construction would require a public parts constructor to cross that dependency boundary, move or redesign the bundle. Do not add a “temporary” raw constructor.

2. **Connection ownership can double-lock non-reentrant fences.** `ConnectionBound` must record that the outer act owns the stream/service cut; it must not reserve the same carrier again (`authority-publication-binding-design.md:312-316`).

3. **Retained live is not a fresh bearer request.** Store the complete retained posture. Rebuilding raw authority and attaching only a service publication, as at `invocation.rs:1949-1974`, is prohibited.

4. **Direct service lock order is load-bearing.** Capture `PreparedStreamPublication` before Local, then perform service resolution. Graph equality must be lock-free (`authority-publication-binding-design.md:324-326`; current service-open choreography `server.rs:15649-15677`).

5. **Graph identity must originate once.** If admission, coordinator, service registry, and Local cannot all receive one opaque identity at graph claim, stop and revise composition. Incarnation strings are insufficient.

6. **Pointer identity may be too strict for multi-phase work.** If a legitimate retry re-resolves the same authority into a fresh wrapper, bind tickets to a sealed stable authority/graph identity, not a specific reservation allocation. Do not weaken this to unchecked scalar comparison.

7. **Carrier-free expansion must be closed.** Discovering a new legitimate background source requires a named variant and tests. It is not justification for `Option::None`.

8. **Public API breakage may expose external consumers.** If compatibility is required, offer only typed closed-origin replacements. Retaining raw setters behind deprecation would invalidate the acceptance criterion.

9. **Branch drift is expected.** Before Step 1, repeat the exact symbol census and compare it with the 26 setter, 50 expected reservation, 25 direct-sink, 68 raw-constructor, and split-ticket inventories above.

Abandon or reshape the approach if any implementation requires:

- validating detached session carrier identity;
- serializing process-local graph identity;
- an externally callable constructor accepting raw resolved authority and publication;
- stream/session lock acquisition beneath Local;
- an inferred carrier-free fallback;
- a capsule that again obtains database, admission, or commit authority from separate `AppState` fields.

## Verification and acceptance

Before affected Rust checks, run `scripts/bootstrap-ibex-runtime` as required by repository instructions. Each landing runs its crate-local tests plus:

- compile-fail/doc tests for `snapback-sync`;
- affected `snapback-auth`, `snapback-sync`, `snapback-engine`, and `snapback-server` tests;
- all 46 ordering races after the final signature cut;
- the new A/B destination, request, ticket, and provenance tests;
- `./ref-check --verbose`;
- `node scripts/check-inventories.mjs` when adding test files;
- the affected-scope LLP audit.

Final static acceptance:

- zero `with_fenced_publication` or `with_service_publication` expressions;
- no production/test-support bearer or service parts splitter;
- no carrier-bound public constructor accepting raw `ResolvedAppAuthority`;
- no guarded sink accepting both prepared authority and reservation;
- no staged/ticket commit accepting an unrelated reservation;
- no capsule destination assembled from independent runtime fields;
- reservation and R1 provenance both projected from the same exhaustive private binding.
