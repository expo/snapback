# LLP 0141: Snapback as an embeddable Rust library

**Type:** RFC
**Status:** Implemented
**Systems:** Packaging, Distribution, HTTP surface, Runtime, Security/authorization, Developer experience, Local server lifecycle
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (v0.2, round-1 dual-family reconciliation — artifacts
in `llp/reviews/0141-embeddable-rust-library.{fable,codex}.md`, both
NOT READY. Corrects four false or overstated as-built claims (the
handler-bridge operation inventory, the acceptance-suite claim, "every
internal type is nominally public", and `RouteSpec`'s independent-axis
count); rebuilds D2 and D3 on reservation-by-mechanism rather than
enumerated denylists that must chase a moving first-party surface; makes
the route registry a build artifact rather than a process-global
projection; adds the policy-carrying subtree-mount alternative and
adjudicates it; narrows D4 to production-posture construction after
recording the embedding constructors that already exist; adds the
availability, cancellation, and panic-containment axis D5 previously
omitted and withdraws the capability-manifest row as a trust signal;
expands D6 from one Cargo error into the actual distribution program;
and rescopes the RFC so only D1, D4, and D5 are proposed as decisions, with
D2/D3 explicitly demand-gated. Open questions grew from 6 to 17.)
2026-08-01 (v0.3, round-2 dual-family reconciliation — Fable READY,
Codex NOT READY; artifacts appended to the same two files. Both families
independently found two residues v0.2's corrections missed: the handler
bridge accepts 22 operation names across 21 arms because
`action.externalEffectBegin`/`action.externalEffectInitiated` share one,
and the corrected constructor inventory still omitted the public
`from_snapback_with_secret_read_operator` seam. Codex additionally found
the motivation table still pricing "one portable file" as low-cost while
D6/OQ17 hold it open — verified against the built binary, which links
`@rpath/hermesvm.framework` and carries absolute checkout rpaths — and a
contradiction between the Summary's proposed-decision set and D7's.
The affordance is split into two rows, the decision set is stated
consistently as D1/D4/D5, and the `ibex-windows-dll-staging` dependency
is corrected from conditional to unconditional.)
2026-08-01 (v0.4, round-3 dual-family reconciliation — Fable READY,
Codex NOT READY on two incomplete-correction residues, both applied: the
Summary's constructor list had not received the four-constructor
correction applied to §Current state and D4, and D7's heading still read
"decide two" against a D1/D4/D5 decision set. Fable additionally found
the `handle_host_call` range citation overshooting by six lines; the
function closes at `crates/snapback/src/runtime.rs:2124`. No new design finding in either
family; both report the surviving text settled.)
2026-08-02 (implementation — Charlie Cheever asked to implement the RFC's
proposed scope. D1 lands as the documented `snapback::embed` façade with the
existing 48 modules retained under `#[doc(hidden)]` for source compatibility;
the `0.x` promise is patch-compatible/minor-breaking and is independent of
`wire_version`. D4 lands as `embed::production(include_bytes!(…))`, feeding the
baked closed artifact carrier into the exact CLI-owned auth, worker, readiness,
listener, and shutdown lifecycle, plus `crates/snapback/examples/embedded_todo.rs`. D5 lands as
a fixed `SelfHostedSingleTenant` native-code posture with no hosted-admission,
route-registration, or native-operation controls on the façade. D2/D3 remain
demand-gated and unbuilt; D6 remains a separate blocking distribution program,
so Implemented names the D1/D4/D5 decision set defined by D7 rather than
claiming crates.io or one-portable-file completion.)
**Related:** LLP 0009, LLP 0010, LLP 0024, LLP 0031, LLP 0033, LLP 0041,
LLP 0044, LLP 0051, LLP 0060, LLP 0064, LLP 0070, LLP 0093, LLP 0099,
LLP 0102, LLP 0122, LLP 0139

## Summary

PocketBase ships as a Go library as well as a binary. An author writes their own
`main.go`, calls `pocketbase.New()`, hangs custom routes and hooks off the app,
and compiles one portable executable that is simultaneously the backend and the
custom business logic. This RFC asks whether Snapback should offer the same
shape, and concludes: **yes for embedding, no for the router. D1, D4, and D5
are the implemented decision set.** D5 is normative: it constrains anything
built later and lands alongside the two surfaces it governs rather than being
deferred with them.

Four findings drive the design.

1. **An embedding seam already exists and is already load-bearing.** Snapback
   builds a `[lib]` target, `crates/snapback/src/main.rs` is four lines, and
   `server::app(state)` returns a `tower::Service` that Rust integration tests
   drive in-process; `.bind(listener).serve()` is the network path LLP 0060 §D1
   names as *"the public embedded network path."* Four public constructors
   already exist (`AppState::from_snapback`,
   `AppState::from_snapback_with_secret_read_operator`, `AppState::detached`,
   `LocalSnapback::open`). The implementation adds the curated API and
   *composed production-posture* construction path. A distributable crate
   remains the separate D6 program.
2. **The specific PocketBase affordance —
   `se.Router.GET("/hello", handler)` — is the one thing Snapback has
   deliberately closed,** by two separate invariants (LLP 0060 §D1's plaintext
   listener fence and LLP 0031 §Enforcement's router↔registry parity). This RFC
   keeps both closed.
3. **Native extension belongs at the capability seams, not around them** — and
   must reserve its namespace *by mechanism*, not by enumerating today's
   first-party prefixes. The first draft of this RFC enumerated, got the
   inventory wrong, and produced a rule that admitted collisions into four real
   first-party namespaces. That is the argument for mechanism in miniature.
4. **The extension surfaces are not evidenced yet.** Construction and test
   embedding have real, demonstrated consumers. Route registration and native
   capability registration have none. D2 and D3 are therefore designed here but
   **demand-gated**, not proposed for acceptance.

The largest cost is none of the above: **Snapback is not `cargo add`-able**, and
the reason is a program rather than a bug (§D6).

## Motivation

### What is actually compelling about PocketBase's framework mode

Three things arrive bundled in the PocketBase pitch with very different costs in
Snapback:

| Affordance | What it gives | Snapback cost |
| --- | --- | --- |
| **App bundle baked into the executable** | No separate bundle to ship or mount | Low — the seam exists |
| **…and the result is one portable file** | Deploy story: `scp` it, run it | High — part of the D6 program |
| **Custom routes/hooks in the host language** | Escape hatch when the declarative surface runs out | High — collides with two invariants |
| **Host language == app language** | No second runtime, no bridge, no serialization | Not available by construction |

The first two rows must not be conflated, and v0.1 conflated them. Baking the
bundle in is cheap. Producing PocketBase's *one portable file* is not: the built
`snapback` binary today links `@rpath/hermesvm.framework/Versions/1/hermesvm`
and carries both `@loader_path/../Frameworks` and **absolute** `LC_RPATH`
entries into the developer's own checkout. It is not a self-contained artifact,
and making it one is D6 work (OQ17).

The third is the source of most of PocketBase's coherence and Snapback cannot
have it. Go authors extend a Go server in Go. Snapback authors write JavaScript
that runs in a capability-limited Hermes VM, precisely so that application code
is not trusted (LLP 0009 §Summary). That asymmetry is the product, not an
accident, and it means "drop to the host language" can never be the *ordinary*
authoring path in Snapback the way it is in PocketBase.

### Who the embedder actually is

Four candidate profiles. Their evidence status differs sharply, and §D7 gates on
it:

- **The test and tooling embedder** — *evidenced*. Rust integration tests under
  `tests/` drive `server::app` in-process and `LocalSnapback` directly.
- **The single-binary distributor** — *plausible, unevidenced*. Wants a
  branded self-contained executable with the app bundle baked in. Needs no
  extension API at all.
- **The existing-service embedder** — *unevidenced*. A Rust service wanting
  Snapback's live-query tier as a component in a process it already owns.
- **The native-capability embedder** — *unevidenced*. Needs something the
  sandbox legitimately cannot offer: a vendor SDK, a hardware interface, a
  codec, an FFI-bound model runtime.

Only the fourth is an "extend Snapback" story. No request for it exists in the
corpus today (OQ1).

## Baseline before implementation

Recorded so later revisions can tell design from description. Every claim below
was re-verified during the round-1 reconciliation; the first draft got four of
them wrong.

**The lib target existed but had no curated surface.** `Cargo.toml` declares
`[lib] name = "snapback"`, and `crates/snapback/src/lib.rs` exports **48 `pub mod`
declarations** with five `pub(crate)` exceptions and no `#[doc(hidden)]`
discipline. This does not make every internal type public — `server.rs` contains
hundreds of private items, and `RegisteredRoute`, `router_from_registrations`,
and `all_route_registrations` are all `pub(crate)`. The accurate claim is that
**every `pub` item inside 48 public modules is externally addressable**, with no
stated stability boundary.

**The embedding path is real and specified.** `crates/snapback/src/server.rs:13940` exposes
`pub fn app(state: AppState) -> SnapbackApp`. `SnapbackApp`
(`crates/snapback/src/server.rs:13823`) implements `tower::Service<Request<Body>>` for
in-process dispatch and offers `bind(listener) -> BoundSnapbackApp`, whose
`serve()` / `serve_with_graceful_shutdown()` run the network path. LLP 0060 §D1
names `server::app(state).bind(listener)` *"the public embedded network path"*
and specifies its posture semantics, including that a detached or `Unknown`
posture fails closed for sessions.

**Construction was partly public already.** `AppState::new`
(`crates/snapback/src/admin.rs:827`) takes `SharedSnapback`, `ReadLane`, `EphemeralApi`, and
more — but four public constructors already exist and are what the test suite
uses: `AppState::from_snapback(LocalSnapback, ServerContext)`
(`crates/snapback/src/admin.rs:1392`), `AppState::from_snapback_with_secret_read_operator`
(`:1399`, doc-commented "Trusted embedding variant that retains the non-network
minting seam"), `AppState::detached` (`:1408`), and `LocalSnapback::open(path)`
(`crates/snapback/src/local.rs:3281`). The gap is not "a constructor", and it is not the
secret-read seam either — that seam is already public. It is the *composed
production-posture* constructor (§D4).

**Embedding is used by Rust tests, not by the whole acceptance program.** Of the
integration test files under `tests/`, a minority reference `server::app` or
`.bind()`; a larger group drives `LocalSnapback` directly, never touching HTTP;
and the `tests/acceptance/*.mjs` suites drive a **spawned** server binary over
the network. The first draft's claim that "the entire acceptance suite drives it
in-process" was false.

**The router is private on purpose.** The doc comment at `crates/snapback/src/server.rs:13815`
is explicit: keeping the inner `Router` private *"prevents the former accidental
composition where a context derived from one listener was served on another."*
LLP 0060 §D1 pins the rule it protects — transport posture derives from the
actual bound socket or an unforgeable listener-construction token, **never from
a caller-supplied boolean**.

**Every route carries a policy row.** `RouteSpec` (`crates/snapback/src/server.rs:6989`) has
eleven fields: `method`, `path`, `class`, `path_policy`, `policy`,
`credential_resolution`, `invocation_authority`, `legacy_body_policy`,
`effect_policy`, `response_sensitivity`, `session_overlay`. They are **not
eleven independent axes**: the struct's own doc comment (`:6986`) records
`policy` as "a source compatible spelling of `path_policy`" that constructors
set together and the router refuses when unequal, and `method`/`path`/`class`
are identity rather than policy. `RouteSpec::new` takes eight arguments and
**defaults** `effect_policy` to `EffectPolicy::None` and `session_overlay` to
`SessionModeOverlay::NONE`, with `with_effect` / `with_session_overlay` builders
for the rest.

`router_from_registrations` (`:13761`) wraps each registration in
`enforce_registered_route_policy` *before* merging same-path methods, and
`route_registry()` (`:13952`) projects the registry from the same
registrations — LLP 0031 §Enforcement's mechanical parity guarantee, with the
comment "there is no second route-literal list that can drift outside policy."
Two shape facts matter for D2: `route_registry()` is an **argument-free,
process-global** projection of `all_route_registrations()`, and `SnapbackApp`
retains only `state` and the built `Router` — it does not retain its
registration metadata. `RegisteredRoute` is `pub(crate)` (`:7372`), so **an
embedder cannot register a route today at all**.

**There are two distinct native extension seams.**

- *Handler capability bridge* — `handle_host_call` (`crates/snapback/src/runtime.rs:1273–2124`)
  dispatches what JS handlers reach through `ctx.*`. The inventory is **21
  behaviour arms accepting 22 operation names, across eight namespaces**
  (`action.externalEffectBegin` and `action.externalEffectInitiated` share one
  arm at `:1819`, so the callable surface is one name wider than the arm count):
  `db.query`, `db.get`, `db.insert`,
  `db.patch`, `db.delete`; `runtime.log`, `runtime.now`, `runtime.id`;
  `permissions.requireRole`; `host.fetch`; `jobs.enqueue` (LLP 0070);
  `assets.attach` (LLP 0044); `membership.write`; and the `action.*` family —
  `action.metadata`, `action.externalEffectBegin`,
  `action.externalEffectInitiated`, `action.runMutation`, `action.streamOpen`,
  `action.streamRead`, `action.streamCancel`, `action.streamAttemptStart`,
  `action.streamAttemptSettle`. The first draft listed ten of these and omitted
  four whole namespaces; v0.2 corrected the namespaces but still missed the
  aliased name — which is the argument for D3a's reservation-by-mechanism twice
  over.
- *Host operation registry* — `execute_host_op` (`crates/snapback/src/host_ops.rs:927`)
  dispatches operator- and tooling-facing operations (`app.inspect`,
  `app.reset`, `schema.load`, `functions.load`, `function.run`, the `asset.*`
  family, `auth.mintSession`) reached over HTTP, catalogued in
  `guide/capabilities.md` under LLP 0024's operation registry, with the
  enforceable operation-policy registry owned by LLP 0031. `execute_host_op` is
  a closed match dispatcher, not by itself that registry.

An earlier reading treated `host_ops` as the handler capability surface. It is
not; the two seams have different callers, threat models, and obligations.

**The handler bridge already fails closed on unknown operations.**
`crates/snapback/src/runtime.rs:1276` gates the protected-query profile with a closed allowlist
and an explicit default-deny comment: *"Every other current/future host
operation is a denied mutable non-database input until the registry explicitly
classifies it"* (`SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`). Unknown ops error in all
modes (`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN`).

**The served guide is baked at Snapback's build time.**
`build.rs::emit_embedded_guide` embeds this repository's `guide/` tree into the
binary. An external embedder cannot add rows to that snapshot — which is why the
first draft's one-line capability-index requirement (§D3) was not implementable
as written.

**The crate is not distributable.** `Cargo.toml:27` reads
`ibex-runtime = { path = "vendor/ibex" }` — a bare path dependency, which
crates.io rejects. `vendor/ibex/Cargo.toml` *itself* carries path-only
dependencies on `capsec-semantics` (`:36`, and again at `:259`),
`ibex-sfe-format` (`:37`), `ibex-sfe-catalog` (`:38`), and
`ibex-windows-dll-staging` (`:260`) — the last an *unconditional*
`[build-dependencies]` entry, not a target-gated one, so it must be published
too. `vendor/ibex/ios/Frameworks` is
**74 MB** against crates.io's 10 MB compressed package limit. `build.rs` emits
the macOS `LC_RPATH` for `hermesvm.framework` because Cargo does not propagate a
dependency's `rustc-link-arg` downstream (ENG-22664), and
`scripts/bootstrap-ibex-runtime` exists because a clean checkout of *this
repository* cannot build without fetching Hermes artifacts first (LLP 0010
§Bootstrap diagnostic codes).

## Design

### D1. Curate the public surface before anyone depends on it

**Implementation status:** Implemented (2026-08-02).

Independent of everything else, 48 bare `pub mod` declarations are a liability.
The moment one external consumer exists, every internal refactor in `server.rs`
becomes a breaking change to an API Snapback never intended to offer.

**Decision:** introduce `snapback::embed` as the sole supported embedding
façade, re-exporting what an embedder legitimately needs, and demote the rest —
either by narrowing `crates/snapback/src/lib.rs` to `pub(crate) mod` where in-repo consumers
allow, or, if that is too invasive to land at once, by `#[doc(hidden)]` plus a
crate-level statement that **nothing outside `snapback::embed` carries a
stability promise**. Either way the boundary must be written down.

What the promise *is* — and how a `0.x` crate version relates to the LLP 0093
wire protocol and `wire_version` — is OQ16.

**As built (2026-08-02):** `crates/snapback/src/embed.rs` is the sole documented façade. It
exports the composed production builder and the evidenced low-level
test/tooling seam (`LocalSnapback`, `AppState`, `server::app`, and the bound app
types). The 48 legacy public modules remain addressable but carry
`#[doc(hidden)]`; crate-level documentation states that they have no stability
promise. For `0.x`, patch releases preserve `snapback::embed` source
compatibility while minor releases may break it. Rust API versioning is
independent of LLP 0093's wire protocol and `wire_version`.

### D2. Registration, not mounting — **designed, demand-gated**

**Do not expose the inner `Router`.** Expose route *registration*, with the
policy axes mandatory.

```rust
let app = snapback::embed::builder(state)
    .register(RouteSpec::new(…).with_effect(…).with_session_overlay(…), handler)?
    .build();
```

Three corrections the first draft got wrong:

**D2a. The registry must become a build artifact.** `route_registry()` is
process-global and `SnapbackApp` discards its registrations, so a builder-scoped
route set cannot appear in inspection or in LLP 0031's parity sweep without
either vanishing or mutating global state — and two differently-extended apps in
one process would interfere. The build must return an instance-scoped
projection (`BuiltSnapbackApp::route_registry()` or a build receipt), and
LLP 0031's sweep must be taught which registry it is checking. This is a real
shape change to a load-bearing invariant, not an additive API.

**D2b. Reserve by mechanism, not by enumeration.** The first draft listed six
reserved prefixes and missed `/action/*`, `/app/*`, `/assets/*`,
`/client-mutations/*`, `/connection*/*`, `/ephemeral/*`, `/outbox/*`, `/health`,
`/inspect`, and `/`. A hand-maintained reserved list is *itself* "a second
route-literal list that can drift outside policy" — the exact hazard this RFC
quotes approvingly. Two mechanisms, either acceptable, both better than a list:

1. **Confine extensions to a dedicated prefix** (`/ext/…`), so first-party
   growth can never collide by construction; or
2. **Derive the refusal from `all_route_registrations()`** at build time.

Neither removes the need for structural collision detection — method matching,
axum pattern overlap, implicit `HEAD`, generated `OPTIONS`, catch-all overlap
(OQ7).

**D2c. "No defaulted variant" was false, and validation obligations are
unstated.** `RouteSpec::new` already defaults two axes. More substantively,
LLP 0031 §Enforcement imposes rules D2 never addressed: `AppAuth` has no
sessions meaning by itself; a dev-only-authority route must carry an overlay for
sessions; registry validation refuses `Public` entries with sensitive response
types absent a typed projection. An embedder-facing API must state the
sessions-mode contract and which axis combinations `assert_valid()` refuses
(OQ8).

**Alternative considered: policy-carrying subtree mount.** One registry row
declares a policy envelope for everything under a reserved prefix, enforced by
the same middleware at the mount boundary. The registry stays honest
("everything under `/ext/` carries policy P"), parity is preserved, and most of
the PocketBase ergonomics survive. **Rejected as the primary shape** because
`ResponseSensitivity` and `EffectPolicy` are per-operation properties that a
subtree envelope cannot express without collapsing to the most permissive
member, which is precisely the classification loss the registry exists to
prevent. **Retained as a fallback** if per-route ceremony proves to be the thing
that kills adoption — the envelope is still strictly better than an untyped
mounting hook.

### D3. Extension widens capabilities; it does not bypass them — **designed, demand-gated**

**D3a. Handler capability extension.** A registered native operation reachable
from JS handlers, carrying:

1. a name in a **mandatory extension namespace** (`ext.` prefix), disjoint from
   every first-party namespace by construction. The enumerate-today's-prefixes
   approach failed in the first draft and would have failed again: `jobs.*` and
   `assets.*` both entered the bridge within the last month.
2. a **determinism and visibility classification**, so the protected-query gate
   can admit or deny explicitly;
3. an **invocation-mode restriction** (query / mutation / action);
4. **budget, deadline, and cancellation semantics**;
5. an **error and panic containment contract**.

Items 4 and 5 are new in v0.2 and are not optional. LLP 0009's isolation story
is per-invocation-class and its enforcement discussion is explicit that native
host work can only be abandoned after a bounded grace, not forcibly killed. A
third-party native op runs on host threads, potentially holding host locks, with
no watchdog: a hang or panic is a whole-server availability event, and an op
retaining state across invocations erodes the "runtime state does not leak
between invocations" property for data flowing through it. D5 answers the
*authority* question; it does not answer the *availability* one.

Four further semantics remain undecided and are the substance of OQ9–OQ12:
dependency witnesses for protected live queries; transaction, retry, and
settlement behaviour for mutation extensions; argument/result limits, schema
declaration, diagnostics, and secret redaction; and the confused-deputy surface
created when application JavaScript controls an extension op's arguments.

The conservative default — **deny every extension op in protected queries** — is
sounder than third-party self-classification and should be the starting posture.

**D3b. Host operation extension.** Lower priority; the workaround (a registered
route under D2) is adequate. It is also larger than the first draft implied: a
host-op extension must join dispatch, LLP 0031's `OperationSpec` registry and
its policy axes, profile requirements, transport projections and envelope
schema, guide surface-map checking, and capability-manifest inspection.

**Capability-index honesty.** The first draft required both slots to "appear in
`guide/capabilities.md` generation." That cannot work: the guide is baked from
this repository at Snapback's build time. An extended server needs a
runtime-composed index, a manifest-row mechanism, or an explicit disclaimer that
the index describes the stock surface only (OQ13).

### D4. Production-posture construction

**Implementation status:** Implemented (2026-08-02).

The deploy shape — one branded executable containing server and app bundle — is
the cheapest high-value item here and needs no extension API: `include_bytes!`
the bundle, write a `main.rs`, call `server::app(state).bind(listener).serve()`.

The gap is narrower than the first draft claimed, because `from_snapback`,
`from_snapback_with_secret_read_operator`, `detached`, and
`LocalSnapback::open` are already public — including, specifically, a
secret-read construction seam. What is missing is a supported **composed
production-posture** constructor: sessions auth provider, config and bundle
lifecycle, worker and readiness sequencing — the assembly `cli.rs` performs
around `:2558`. That constructor, plus a documented template under `examples/`,
is D4's deliverable.

D4 delivers the *bundle-baking* half of the single-binary story. The
*one-portable-file* half belongs to D6.

D4 is a prerequisite for D2 and D3 being usable by anyone outside this
repository.

**As built (2026-08-02):** `embed::production(&[u8])` parses a closed startup
carrier before startup can touch state; `production_from_manifests` constructs
the same carrier from the ordinary generated schema/functions pair (the normal
`artifacts.json` is an index, not a runtime carrier). Both return a
`ProductionBuilder`. `serve()` feeds the baked owned carrier through a private
`cli::run_embedded` entry into the ordinary `cli::run` composition: database
ownership, auth provider and mode activation, config/function publication,
revocation/coordinator/invalidation/lease readiness, critical workers,
listener-derived transport posture, readiness publication, and graceful
shutdown remain one code path. `crates/snapback/examples/embedded_todo.rs` is the documented
branded-binary template. The builder can select database, listener, readiness,
and declared-restore inputs; it cannot select hosted admission or omit the
production workers.

### D5. Security posture: gated, not global

**Implementation status:** Implemented as a constraint (2026-08-02).

LLP 0009's floor is that application code gets no ambient access to SQLite, the
filesystem, the network, environment variables, or secrets, and that all useful
powers arrive through explicit host APIs. Linked-in Rust has all of it, in the
same address space, above the sandbox, with no interposition possible.

For a **self-hosted single-tenant binary** this is unremarkable: the operator
compiled the binary, so extension code is as trusted as server code — the same
trust relationship PocketBase assumes. For **hosted or multi-tenant** operation
it is incompatible with any isolation claim, and LLP 0009 already treats hosted
multi-tenant isolation as a separate threat model.

**Decision:** native extension (D3) is a self-hosted capability. The hosted
service must be **structurally incapable** of loading embedder-supplied native
code — not merely configured not to.

**Withdrawn from v0.1:** the proposal that a capability-manifest row let a
client "tell an extended server from a stock one." Native code in the process
can alter whatever the server reports about itself, so a self-reported row is
not a trust signal. Distinguishing a stock server from an extended one requires
attestation of the build artifact, not a field in its own response (OQ14). The
weaker, still-useful form — an *honest operator-facing* record of what was
linked — survives.

A server with registered native extensions must not claim a hosted-tenant
isolation posture.

**As built (2026-08-02):** the façade reports the closed
`NativeCodePosture::SelfHostedSingleTenant` value and constructs only
`AuthDeploymentTarget::Local`; it exposes no hosted-edge/admission setter. D3
remains absent, so there is no native operation loader to misclassify. If D3 is
later activated, its feature/artifact split must preserve this structural
boundary rather than adding a configuration boolean to this builder.

**License direction corrected.** Snapback is MIT (LLP 0033, Accepted), so
outbound linking imposes nothing on anyone; the first draft had this backwards.
The live question is *inbound redistribution*: shipping prebuilt Hermes
artifacts inside a published crate (OQ15).

### D6. Distribution is a program, not a fix — **blocking, unscheduled**

The bare path dependency is the *first* error `cargo publish` reports, not the
gate. The full program:

- `ibex-runtime` needs a registry release — and so do its own path-only
  dependencies (`capsec-semantics`, `ibex-sfe-format`, `ibex-sfe-catalog`,
  `ibex-windows-dll-staging`).
- Ibex's build expects target-specific Hermes headers, libraries, compilers,
  provenance artifacts, and checkout-relative layouts. A published crate version
  does not by itself make those available.
- crates.io's 10 MB compressed package limit versus a 74 MB framework directory
  forces platform-split packages, a verified download step, or both.
- A framework living in a dependency's source cache is not a portable runtime
  layout beside the embedder's executable. Loader custody must be designed.
- Snapback's `build.rs` and Ibex's build script need a designed
  metadata/artifact handoff; "a release carrying artifacts" does not explain
  selection or discovery.
- **`cargo add` builds** and **the output is one portable file** are separate
  requirements. On macOS, Hermes is a dynamically loaded framework — so "single
  binary" may mean a relocatable bundle rather than one file (OQ17).

PocketBase's `go get` + `go build` → static binary is the bar. This is an
LLP 0122-scale packaging program and it is entirely separate from the API
design.

### D7. Scope: implement three, gate the rest — **implemented**

Reviewers converged on the observation that v0.1 decided four surfaces while
having evidence for one. Accordingly:

- **Implemented:** D1 (curated surface), D4 (production-posture construction and
  the baked-bundle template), and D5 as a standing constraint on anything built
  later.
- **Designed but demand-gated:** D2 (route registration) and D3 (native
  capability and host-op extension). Neither is built until a named consumer
  exists (OQ1). Both carry unresolved semantics (OQ7–OQ13) that should be closed
  *before* implementation, not during.
- **Blocking and unscheduled:** D6.

This keeps the RFC honest about what it knows.

## Consequences

- **D1 alone** removes a latent compatibility hazard at low cost and loses
  nothing.
- **D4** delivers most of the PocketBase appeal — the deploy shape — without
  touching any invariant.
- **D2** gives embedders the routing affordance with policy ceremony attached.
  Some fraction of PocketBase's appeal *is* the absence of ceremony; those users
  will be disappointed, which is the correct outcome given LLP 0031. It also
  forces a real change to how the route registry is scoped (D2a).
- **D3a** would make the handler capability set open at the edges, so the
  capability index and the protected-query classification both become extensible
  surfaces rather than closed enumerations — a larger commitment than it looks.
- **Declining D2/D3 entirely** is defensible. The JS handler surface plus the
  HTTP surface may simply be enough, and every hour on Hermes crate distribution
  is an hour not spent on the parity program.

## Open questions

**Scope and demand**

1. Is any embedder profile beyond test/tooling real? No request exists in the
   corpus. D2/D3 should not be built until one does.
2. **Resolved 2026-08-02:** construction only. Registration remains demand-gated.

**D1**

3. **Resolved 2026-08-02:** `#[doc(hidden)]` plus the crate-level disclaimer,
   preserving source compatibility while the façade settles.

**D2**

4. Is the route registry process-global, instance-scoped, or a build receipt
   once multiple differently-extended apps can exist in one process?
5. Dedicated `/ext/` prefix, or refusal derived from `all_route_registrations()`?
6. Does the subtree-mount fallback deserve promotion if per-route ceremony
   blocks adoption?
7. What algorithm rejects duplicate and overlapping method/path patterns,
   implicit `HEAD`, generated `OPTIONS`, and catch-all overlap?
8. What is the sessions-mode contract for an embedder route, and which axis
   combinations does `assert_valid()` refuse?

**D3**

9. Can a third party supply a *sound* determinism/visibility classification, or
   must extension ops be denied in protected queries unconditionally? How do
   native reads of mutable sources contribute dependency witnesses to live
   invalidation?
10. What transaction, retry, and settlement semantics apply to mutation
    extensions with external effects?
11. What deadline, cancellation, panic, resource-limit, thread-affinity, and
    abandoned-work rules apply — and what does the existing action host already
    impose?
12. How are extension argument/result schemas, size limits, diagnostics,
    redaction, and compatibility versions declared and enforced? What is the
    confused-deputy boundary when application JS controls the arguments?
13. How does the capability index describe an extended server, given the guide
    is baked at Snapback's build time?

**D5**

14. What build artifact makes hosted deployments structurally unable to contain
    extension code, and what attests it? (A self-reported manifest row cannot.)
15. What inbound license, SBOM, and trademark obligations attach to
    redistributing Hermes artifacts inside a published crate?

**D1 / D6**

16. **Resolved 2026-08-02:** during `0.x`, patches preserve façade source
    compatibility and minors may break it; the Rust API version is independent
    of LLP 0093's wire protocol and `wire_version`.
17. What does "single binary" mean on macOS, where Hermes is a dynamically
    loaded framework — one executable file, or one relocatable bundle? And what
    is the full publication graph (Snapback, Ibex, Ibex's internal crates,
    Hermes headers/libraries/compiler, platform selection, loader layout,
    package size)?

## Prior art

- **PocketBase** — the direct prompt for this RFC. Go library plus single
  binary, `app.OnServe().BindFunc` for route registration, hooks on record
  lifecycle, custom routes unauthenticated by default. Its coherence comes from
  host language == app language, which Snapback structurally cannot match.
  PocketBase also offers a JavaScript extension mode, which this RFC does not
  analyse — it is arguably the closer analogue to Snapback's existing handler
  surface and deserves its own comparison.
- **Supabase / Convex** — no in-process embedding surface; the server is a
  service you talk to, with official self-hosted deployments. Convex's
  extension point is the function surface, analogous to Snapback's JS handlers.
- **SQLite** — the archetype of embeddable-with-extension-API
  (`sqlite3_create_function`), and the closest analogue to D3a: extensions widen
  what the query language expresses rather than bypassing the engine. The
  analogy is imperfect — SQLite imposes lifecycle and policy restrictions on
  registered functions that D3a has not yet specified.
- **LLP 0051 / LLP 0064** are adjacent and non-overlapping: 0051 is the
  language-neutral data tier (mutation IR, recordable ctx, WASM handler
  artifacts) and 0064 covers client surfaces including JS ones. Neither
  addresses an embeddable server.
