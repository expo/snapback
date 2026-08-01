# LLP 0141: Snapback as an embeddable Rust library

**Type:** RFC
**Status:** Draft
**Systems:** Packaging, Distribution, HTTP surface, Runtime, Security/authorization, Developer experience, Local server lifecycle
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** —
**Related:** LLP 0009, LLP 0010, LLP 0024, LLP 0031, LLP 0033, LLP 0041,
LLP 0051, LLP 0060, LLP 0064, LLP 0122, LLP 0139

## Summary

PocketBase ships as a Go library as well as a binary. An author writes their own
`main.go`, calls `pocketbase.New()`, hangs custom routes and hooks off the app,
and compiles one portable executable that is simultaneously the backend and the
custom business logic. This RFC asks whether Snapback should offer the same
shape, and concludes: **yes for embedding, no for the router.**

Three findings drive the design.

1. **The embedding seam already exists and is already load-bearing.** Snapback
   builds a `[lib]` target, `src/main.rs` is four lines, and
   `server::app(state).bind(listener).serve()` is a public, documented network
   path that the entire acceptance suite drives in-process. What is missing is
   not architecture — it is a curated API, a construction story, and a
   distributable crate.
2. **The specific PocketBase affordance quoted above —
   `se.Router.GET("/hello", handler)` — is the one thing Snapback has
   deliberately closed,** by two separate invariants (LLP 0060 D1's plaintext
   listener fence and LLP 0031's router↔registry parity). This RFC keeps both
   closed and proposes a policy-carrying registration API that recovers the
   ergonomics without the hole.
3. **Native extension belongs at the capability seams, not around them.**
   Snapback has two distinct native extension points — the handler capability
   bridge (`ctx.*`, `src/runtime.rs`) and the host-operation registry
   (LLP 0024, `src/host_ops.rs`). Widening either preserves LLP 0009's thesis
   that application code has no ambient authority. Linking arbitrary Rust into
   the server address space does not, and must therefore be a posture-gated
   capability rather than a global one.

The largest real cost is none of the above: **Snapback is not `cargo add`-able
today**, because `ibex-runtime` is a path dependency on a Hermes checkout that
does not exist on a stranger's machine. Everything in this RFC is available to
in-repo embedders immediately and to external embedders only after that is
solved.

## Motivation

### What is actually compelling about PocketBase's framework mode

It is worth separating three things that arrive bundled in the PocketBase pitch,
because they have very different costs in Snapback:

| Affordance | What it gives | Snapback cost |
| --- | --- | --- |
| **Single portable executable containing my app** | Deploy story: one file, `scp` it, run it | Low — the seam exists |
| **Custom routes/hooks in the host language** | Escape hatch when the declarative surface runs out | High — collides with two invariants |
| **Host language == app language** | No second runtime, no bridge, no serialization | Not available by construction |

The third is the source of most of PocketBase's coherence and Snapback cannot
have it. Go authors extend a Go server in Go. Snapback authors write JavaScript
that runs in a capability-limited Hermes VM, precisely so that application code
is not trusted (LLP 0009 §Summary). That asymmetry is the product, not an
accident, and it means "drop to the host language" can never be the *ordinary*
authoring path in Snapback the way it is in PocketBase.

What remains genuinely compelling — and worth building — is the first
affordance plus a *disciplined* version of the second.

### Who the embedder actually is

The PocketBase framing is "extend the backend." The Snapback framing is closer
to the inverse, and the customer set is different from the ordinary app author:

- **The existing-service embedder.** A Rust service that wants Snapback's
  live-query and sync tier as a component inside a process it already owns,
  rather than as a peer process to operate.
- **The native-capability embedder.** An app that needs something the sandbox
  legitimately cannot offer — a proprietary vendor SDK, a hardware interface, a
  codec, an FFI-bound model runtime — and today has no route to it at all.
- **The single-binary distributor.** Someone shipping a branded, self-contained
  executable with the app bundle baked in. This is the deploy-shape appeal and
  it needs no extension API whatsoever.
- **The test and tooling embedder.** Already served, already the largest
  consumer, and currently reaching through an uncurated module surface.

Only the second of these is an "extend Snapback" story. The rest are "embed
Snapback," which is easier and safer.

## Current state (as built)

Recorded so later revisions can tell design from description.

**The lib target exists but has no curated surface.** `Cargo.toml` declares
`[lib] name = "snapback"`, and `src/lib.rs` exports **48 `pub mod`
declarations** with five `pub(crate)` exceptions. There is no `embed` façade, no
`#[doc(hidden)]` discipline, and no stated stability boundary. This is an
*accidental* public API: every internal type in `server.rs` (44k lines),
`local.rs`, and `runtime.rs` is nominally public.

**The embedding path is real and specified.** `src/server.rs:13940` exposes
`pub fn app(state: AppState) -> SnapbackApp`. `SnapbackApp`
(`src/server.rs:13823`) implements `tower::Service<Request<Body>>` for direct
in-process dispatch and offers `bind(listener) -> BoundSnapbackApp`, whose
`serve()` / `serve_with_graceful_shutdown()` run the network path. LLP 0060 §D1
already names `server::app(state).bind(listener)` as *"the public embedded
network path"* and specifies its posture semantics, including that a detached
or `Unknown` posture fails closed for sessions. Embedding is therefore not a new
concept in the corpus — it is an under-serviced one.

**The router is private on purpose.** The doc comment at `src/server.rs:13815`
is explicit: keeping the inner `Router` private *"prevents the former accidental
composition where a context derived from one listener was served on another."*
LLP 0060 §D1 pins the rule it protects — transport posture derives from the
actual bound socket or an unforgeable listener-construction token, **never from
a caller-supplied boolean**.

**Every route carries a policy row.** `RouteSpec` (`src/server.rs:6989`) is
public and carries eleven independent axes: `method`, `path`, `class`,
`path_policy`, `policy`, `credential_resolution`, `invocation_authority`,
`legacy_body_policy`, `effect_policy`, `response_sensitivity`,
`session_overlay`. `router_from_registrations` (`:13761`) wraps each
registration in `enforce_registered_route_policy` middleware *before* merging
same-path methods, and `route_registry()` (`:13952`) projects the registry from
the same registrations that build the router — the mechanical parity guarantee
LLP 0031 §Enforcement requires, with the comment "there is no second
route-literal list that can drift outside policy." `RegisteredRoute` itself is
`pub(crate)` (`:7372`), so **an embedder cannot register a route today at all**.

**There are two distinct native extension seams, and they are not the same
surface.**

- *Handler capability bridge* — `handle_host_call` in `src/runtime.rs:1273`
  dispatches the operations JS handlers reach through `ctx.*`: `db.query`,
  `db.get`, `db.insert`, `db.patch`, `db.delete`, `runtime.log`, `runtime.now`,
  `runtime.id`, `permissions.requireRole`, and the action egress seam
  (`ctx.fetch` → `host.fetch`). This is the seam that widens what application
  code can do.
- *Host operation registry* — `execute_host_op` in `src/host_ops.rs:927`
  dispatches operator- and tooling-facing operations (`app.inspect`,
  `app.reset`, `schema.load`, `functions.load`, `function.run`, the `asset.*`
  family, `auth.mintSession`) reached over HTTP and catalogued in
  `guide/capabilities.md` under LLP 0024's operation registry. This is the seam
  that widens what an operator or agent can invoke.

An earlier reading of this design treated `host_ops` as the handler capability
surface. It is not; the distinction matters because the two seams have different
callers, different threat models, and different classification obligations.

**The handler bridge already fails closed on unknown operations.**
`src/runtime.rs:1276` gates the protected-query profile with a closed allowlist
and an explicit default-deny comment: *"Every other current/future host
operation is a denied mutable non-database input until the registry explicitly
classifies it"* (`SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`). A third-party capability
that has not declared its determinism and visibility class is therefore
automatically unusable in protected queries. This is exactly the property an
extension surface needs and it is already built.

**The crate is not distributable.** `Cargo.toml:27` reads
`ibex-runtime = { path = "vendor/ibex" }` — a bare path dependency, which
crates.io rejects outright. `build.rs` exists to emit the macOS `LC_RPATH` for
`hermesvm.framework` because Cargo does not propagate a dependency's
`rustc-link-arg` downstream (ENG-22664), and `scripts/bootstrap-ibex-runtime`
exists because a clean checkout of *this repository* cannot build without
fetching Hermes headers and frameworks first (LLP 0010 §Bootstrap diagnostic
codes). An external `cargo add snapback` fails at
`SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING` or earlier.

## Design

### D1. Curate the public surface before anyone depends on it

Independent of every other decision here, 48 bare `pub mod` declarations are a
liability. The moment a single external consumer exists, every internal
refactor in `server.rs` is a breaking change to an API Snapback never intended
to offer.

**Decision:** introduce `snapback::embed` as the sole supported embedding
façade, re-exporting the types an embedder legitimately needs, and demote the
rest. Two acceptable mechanisms, in preference order:

1. Narrow `src/lib.rs` to `pub(crate) mod` wherever the in-repo consumers
   (bins, tests, benches) allow it, and re-export deliberately from `embed`.
   This is the honest form but requires auditing every `snapback::` path in
   `tests/` and `src/bin/`.
2. If (1) is too invasive to land at once, keep the modules public but mark them
   `#[doc(hidden)]` and state in `src/lib.rs`'s crate docs that **nothing
   outside `snapback::embed` carries a stability promise**, then migrate
   incrementally.

Either way the stability boundary must be *written down* rather than implied.

**Do this regardless of whether the rest of this RFC is accepted**, and before
any crate is published.

### D2. Registration, not mounting

**Decision: do not expose the inner `Router`.** Expose route *registration*.

The proposed surface promotes `RegisteredRoute` construction to the public API
under `snapback::embed`:

```rust
let app = snapback::embed::builder(state)
    .register(
        RouteSpec::new("GET", "/hello", RouteClass::…, /* policy axes */),
        handler,
    )?
    .build();
```

The embedder must state the policy axes; there is no defaulted or inferred
variant. Their handler is wrapped by the same `enforce_registered_route_policy`
middleware as a built-in route, joins the same registration list that
`route_registry()` projects, and appears in the registry that LLP 0031's
parity check reads. The listener fence is untouched because the embedder never
holds a `Router` — they hold registrations, and composition still happens inside
`app()`.

This is strictly more ceremony than `se.Router.GET("/hello", ...)`. That is the
intended trade: PocketBase's custom routes are unauthenticated-by-default
handlers the author secures themselves, and Snapback's premise is that no route
exists without a declared policy. An untyped mounting hook would mint a class of
routes living outside the registry — the exact drift ENG-24594 closed.

**Constraints on the registration API:**

- Reserved path prefixes (`/_snapback/*`, `/auth/*`, `/live/*`, `/query/*`,
  `/mutation/*`, the admin surface) must be refused, with a stable error code,
  so an extension cannot shadow or intercept a first-party route.
- `RouteSpec.path` and `.method` are `&'static str` today; a registration API
  either keeps that constraint (embedders use string literals, which is fine) or
  the type gains an owned variant. Prefer keeping `&'static str`.
- Registration is build-time only. There is no dynamic route mutation on a
  running server; that would reopen the drift question.

### D3. Native extension widens capabilities; it does not bypass them

Two extension slots, matching the two seams identified above:

**D3a. Handler capability extension** (`ctx.*`). An embedder registers a named
native operation reachable from JS handlers. The registration must supply, at
minimum:

- a namespaced operation name that cannot collide with a first-party op
  (proposal: extension ops are required to carry a distinguishing prefix, so
  `db.*`, `runtime.*`, `permissions.*`, and `host.*` remain first-party);
- a **determinism and visibility classification**, so `handle_host_call`'s
  protected-query gate can admit or deny it explicitly rather than falling
  through to `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`;
- an invocation-mode restriction (query / mutation / action), since actions
  already deny database calls and the action host validates ops separately.

This is the seam that answers the interesting half of the PocketBase pitch. A
handler stays JavaScript, stays sandboxed, and gains a power — rather than the
author escaping the model to get one.

**D3b. Host operation extension** (LLP 0024). An embedder registers an
operator-facing operation in the `execute_host_op` registry, carrying an
authority requirement and a capability-index row. Lower priority than D3a: the
demand is real (custom admin tooling) but the workaround — a registered route
under D2 — is adequate.

Both slots must appear in `guide/capabilities.md` generation, or the capability
index silently stops describing the running server.

### D4. The single-binary story needs no new API

The deploy shape — one branded executable containing the server and the app
bundle — is achievable today with `include_bytes!` of the bundle, a custom
`main.rs`, and `server::app(state).bind(listener).serve()`. It is the cheapest
and probably highest-value item in this RFC.

**Decision:** ship it as a documented template (a `demos/` or `examples/` entry
plus a guide page) rather than as an API. The work is in the `AppState`
construction path, which is currently assembled by `cli.rs` through machinery an
embedder cannot easily reproduce — `AppState::new` (`src/admin.rs:827`) takes
`SharedSnapback`, `ReadLane`, `EphemeralApi`, and more. An embedder needs a
supported constructor of roughly the shape "given a data directory and an app
bundle, give me a serving `AppState`."

That constructor is the actual deliverable of D4, and it is a prerequisite for
D2 and D3 being usable by anyone outside this repository.

### D5. Security posture: gated, not global

LLP 0009's floor is that application code gets no ambient access to SQLite, the
filesystem, the network, environment variables, or secrets, and that all useful
powers arrive through explicit host APIs. Linked-in Rust has all of it, in the
same address space, above the sandbox, with no interposition possible.

For a **self-hosted single-tenant binary** this is fine and unremarkable: the
operator compiled the binary, so the extension code is as trusted as the server
code. It is the same trust relationship PocketBase assumes.

For **hosted or multi-tenant** operation it is incompatible with any isolation
claim, and LLP 0009 already treats hosted multi-tenant isolation as a separate
threat model rather than an extension of the local one.

**Decision:** native extension (D3) is a self-hosted capability. The hosted
service must be structurally incapable of loading embedder-supplied native code
— not merely configured not to. Concretely:

- The capability manifest gains an honest row reporting whether native
  extensions are present, so a client can tell an extended server from a stock
  one.
- A server with registered native extensions must not claim a hosted-tenant
  isolation posture.
- LLP 0033's license posture is checked before publication: an embeddable
  library invites linking that a binary distribution does not.

### D6. Distribution is the gate

Ordered honestly, because this determines what is *reasonable* rather than
merely desirable:

- **Available now, in-repo:** D1, D4, and D2/D3 for anyone building inside this
  repository or vendoring it. No blocker.
- **Blocked on Hermes distribution:** everything, for anyone external.
  `ibex-runtime = { path = "vendor/ibex" }` cannot be published; the crate needs
  a versioned `ibex-runtime` release carrying prebuilt Hermes artifacts for at
  least macOS arm64 and linux x64, or a build script that fetches and verifies
  them. This is a packaging program of the same order as LLP 0041's npm closure,
  and it belongs to LLP 0122's installed-product coherence line.

PocketBase's `go get` + `go build` → static binary is the bar. Matching it is
the expensive part of this RFC, and it is entirely separate from the API design.

## Consequences

- **Adopting D1 alone** removes a latent compatibility hazard at low cost and
  loses nothing.
- **Adopting D2** gives embedders the PocketBase affordance with policy
  ceremony attached. Some fraction of the appeal is the *absence* of ceremony;
  those users will be disappointed, and that is the correct outcome given
  LLP 0031.
- **Adopting D3a** is the most interesting and the most invasive: it makes the
  handler capability set open at the edges, which means the guide's capability
  index and the protected-query classification both become extensible surfaces
  rather than closed enumerations.
- **Declining all of it** is defensible. The JS handler surface plus the HTTP
  surface may simply be enough, and every hour spent on Hermes crate
  distribution is an hour not spent on the parity program.

## Open questions

1. **Is the target customer real?** This RFC asserts four embedder profiles.
   None is currently evidenced by a request. Before D2/D3 land, at least one
   should be grounded in an actual need — the bakeoff program (LLP 0139,
   LLP 0102) is the natural place to discover whether "I need native capability
   X" ever came up.
2. **Does D3a's classification requirement actually compose?** The
   protected-query gate is a closed allowlist with a security argument behind
   each entry. Whether a third party can supply a *sound* classification for
   their own op, rather than merely a claimed one, is unresolved. If they
   cannot, extension ops should be denied in protected queries unconditionally.
3. **`&'static str` in `RouteSpec`** — keep and require literals, or introduce
   an owned path variant with the accompanying registry churn?
4. **Where does the license posture land?** LLP 0033 was written for a binary;
   D5 flags this but does not decide it.
5. **Does the container-VM executor profile (LLP 0099) change D5?** A
   container-VM hosted model might make embedder-supplied native code tractable
   in a way the shared-process model does not.
6. **Sequencing against LLP 0122.** Should the Hermes crate-distribution work be
   scheduled at all before the npm/installed-product surface is coherent, or is
   this RFC's realistic near-term scope exactly D1 + D4 in-repo?

## Prior art

- **PocketBase** — the direct prompt for this RFC. Go library + single binary,
  `app.OnServe().BindFunc` for route registration, hooks on record lifecycle.
  The custom-route surface is unauthenticated by default. Its coherence comes
  from host language == app language, which Snapback structurally cannot match.
- **Supabase / Convex** — no embedding story; the server is a service you talk
  to. Convex's extension point is the function surface, analogous to Snapback's
  JS handlers.
- **SQLite** — the archetype of the embeddable-with-extension-API model
  (`sqlite3_create_function`), and the closest analogue to D3a: extensions widen
  what the query language can express rather than bypassing the engine.
- **LLP 0051 / LLP 0064** cover non-JS *clients*, not an embeddable *server*.
  They are adjacent and non-overlapping.
