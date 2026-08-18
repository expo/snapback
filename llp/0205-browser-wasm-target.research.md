# LLP 0205: Snapback in the browser — a WebAssembly target

**Type:** Research
**Status:** Draft
**Systems:** Deployment, Runtime, Storage, Packaging, Local-first, Performance, Client integration, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-08
**Revised:** 2026-08-08 (author intent recorded, and it changes the weighting:
the browser instance is a **development** target — you build an app with only a
browser, then deploy somewhere else for production. Open question 1 is answered
by that; F4's claims obligation shrinks to a dev-target posture; and F3 is
promoted, because developing on one engine and shipping to another turns
LLP 0048 conformance from a nice-to-have into the feature's central correctness
risk. New §Fidelity is the graduation contract.)
**Related:** LLP 0002, LLP 0007, LLP 0023, LLP 0030, LLP 0035, LLP 0041, LLP 0046, LLP 0048, LLP 0126, LLP 0127, LLP 0129, LLP 0141, LLP 0168, LLP 0169, LLP 0181, LLP 0199

## Summary

Can a whole Snapback instance — the Rust core, its SQLite storage, and its
handler execution — run inside an ordinary web page?

**Finding: yes, and more cheaply than expected, but not by compiling
everything.** Three properties already in the tree remove the obstacles this
usually dies on. The remaining cost is ordinary engineering, and the riskiest
item is a mechanical one (SQLite against `wasm32` with a browser VFS), not an
architectural one.

The shape that works is **the Rust core and SQLite compiled to `wasm32`, with
handlers executing on the browser's own JavaScript engine**, the instance
hosted in a Web Worker. The shape that does not is compiling Hermes to
WebAssembly so that a JavaScript engine can run inside WebAssembly inside a
JavaScript engine.

**The intent is a development target, not a production one** (author,
2026-08-08). You build an app with nothing but a browser — the backend runs in
the page beside the app — and when you ship it, you deploy to a real target.
That reframing does most of the work in this document:

- it answers what a browser instance *is* — a third thing beside
  [LLP 0002](./0002-canonical-local-target.decision.md)'s canonical local target
  and the hosted targets, joining the dev-loop family with LLP 0023, 0030, 0041,
  and 0181;
- it shrinks the performance and claims questions to almost nothing, because a
  dev target serves one developer and promises no production property; and
- it **promotes engine conformance to the central risk**, because developing on
  the browser's engine and deploying to Ibex or workerd is precisely the
  works-in-dev-breaks-in-prod shape. See F3 and §Fidelity.

This document assesses feasibility and recommends a first step. It does not
propose a target profile, authorize implementation, or make any capability
claim.

## Question and scope

One question:

> What would it take to run a complete Snapback instance client-side in a
> browser, and what would it cost in properties the local target currently
> claims?

In scope: the execution, storage, transport, and conformance consequences.

Out of scope: whether the product wants this (§What it would buy sketches the
case but does not argue it); the local-first sync program (LLP 0126/0127/0129),
which syncs a slice *to* a device and is a different thing from putting the
authority *on* the device; and the browser persistence arm already specified in
LLP 0168/0169.

## Findings

### F1 — the embedding seam already exists, and this is the load-bearing one

[LLP 0141](./0141-embeddable-rust-library.rfc.md) is **Implemented**. Snapback
builds a `[lib]` target, `crates/snapback/src/main.rs` is four lines, and `server::app(state)`
returns a `tower::Service` that Rust integration tests already drive
**in-process**; `.bind(listener).serve()` is a separate network path.

A browser has no listening sockets, and that is normally where a port of a
server attempt stops. Snapback is already past it: a browser build calls the
same `Service` directly, or from a Service Worker's `fetch` handler. No new
seam, no architectural change.

*Confidence: high.* Directly observed; the in-process path is exercised by the
existing test suite on every run.

### F2 — the JavaScript engine is already a manifest variant, not an assumption

```rust
pub enum FunctionRuntime {   // crates/snapback/src/manifest.rs
    HostPlan(HandlerPlan),
    IbexModule(IbexModule),
}
```

Two execution paths already exist. A browser target is a **third variant** that
dispatches to the host engine — an extension of a shape that is already there.

*Confidence: high* that the enum is the right seam; *medium* on the effort to
add a variant, which was not measured.

### F3 — conformance machinery exists, and the dev-target framing makes it the central risk

[LLP 0048](./0048-v8-conformance-twin.rfc.md)'s conformance twin was built
because the Cloudflare target runs V8 rather than Hermes. Chrome's engine *is*
V8, so a Chrome-first browser target inherits most of that work.

The cost is not symmetric: Chrome-only adds one engine already largely covered;
all-browsers adds JavaScriptCore and SpiderMonkey too. Sequencing Chrome first
keeps the growth at one.

**But the dev-target framing inverts this finding's importance.** For a
production target, an engine difference is a portability concern among peers.
For a *development* target it is something worse: the author writes and tests
handler code against one engine and then deploys it to another. Every divergence
becomes a **works-in-dev-breaks-in-prod** defect, discovered after deployment,
by the author's users rather than the author.

That is exactly the hazard LLP 0048 exists to prevent, and it means a browser
dev target does not merely *inherit* the conformance twin — it **depends on it
as a product feature**. The corpus that today protects a Cloudflare deployment
would be protecting the dev loop itself.

Two consequences worth stating plainly:

- Chrome-first is not only cheaper, it is the only sequencing where the
  conformance surface stays honest at each step. Shipping all-browsers first
  would mean three engines' worth of divergence hiding behind a dev loop nobody
  has a corpus for.
- The RFC's promise is a *semantic* one, not a performance one. A dev target may
  be slow; it may not be subtly different.

*Confidence: high* on the mechanism existing and on the inversion argument;
*low* on the size of the corpus delta, which nobody has scoped.

### F4 — single-threading is a cost, not a barrier

This finding was revised during the conversation that produced this document,
and the revision is the useful part.

`crates/snapback/src/` carries roughly 100 uses of `std::thread`/`spawn_blocking`, and the read
lane runs a `ReaderPool` of WAL reader connections on blocking threads.
`wasm32-unknown-unknown` has no threads. The initial reading was that this made
a browser build a different architecture. That overstated it.

What actually survives single-threading:

- **The write path loses nothing.** It is *already* serialized behind a global
  mutex — single-writer by design on every target, which is the same DK-2
  authority decision LLP 0007 and LLP 0128 record. There is no parallelism there
  to lose.
- **The read lane's value is avoiding queueing behind *concurrent* writers.** A
  browser instance has one user, so most of that value was never being
  collected.
- **The real hazard is blocking, not throughput** — a synchronous SQLite call on
  the main thread janks the UI. The fix is a **Web Worker**, not threads. Off
  the UI thread, blocking is fine; this is already the standard pattern for
  OPFS-backed SQLite in the browser.

What genuinely remains: a long write — a local-first sync batch, say — holds the
single lane while the UI wants to read. That is
[LLP 0035](./0035-local-target-benchmarks.research.md)'s ~302,000 µs versus
~4,300–4,600 µs shape reappearing with a single user. The remedy is cooperative:
chunk the writes and yield between batches. Ordinary work.

Real threads *are* available via `wasm32` atomics plus `SharedArrayBuffer`, at
the cost of COOP/COEP headers on the serving origin — which forecloses casual
embedding and is probably not worth it if a Worker suffices.

**The residue is a claims obligation, and the dev-target framing shrinks it to
almost nothing.** This corpus measures and claims the read-lane property, and a
single-lane build does not have it — but a development target makes no
production promise in the first place, so the honest move is a capability row
saying "development target: single lane, single user, no throughput claim"
rather than a carefully hedged performance nonclaim. LLP 0002's canonical local
target already declares gaps of exactly this kind.

The one case where it still bites is a long local-first sync batch making the
dev UI stutter. That is a developer-experience annoyance, not a correctness or
claims problem, and chunking fixes it when someone finds it irritating enough.

*Confidence: medium-high.* The reasoning is sound and the Worker pattern is
well established, but no spike has been run.

### F5 — SQLite against `wasm32` is the riskiest mechanical item

`rusqlite` is used with the `bundled` feature, which compiles SQLite from C.
SQLite-to-WebAssembly is well trodden — sql.js, wa-sqlite, and SQLite's own
official WASM build all exist — but `rusqlite`-on-`wasm32` specifically is less
common than the plain C route.

Persistence wants an **OPFS-backed VFS**; IndexedDB works but is slower and
clumsier for a page-oriented store, and LLP 0168 already records that a
non-secure context strips Web Locks, which the browser persistence arm needs.

Because F1–F4 are cheaper than expected, **this is now the item most likely to
produce an unpleasant surprise**, and therefore the one to prove first.

*Confidence: medium.* The C path is certain; the Rust binding path is not
verified here.

### F6 — the async runtime needs feature surgery

`Cargo.toml` carries `tokio = { version = "1.48", features = ["full"] }`, which
does not build for `wasm32-unknown-unknown`. `rt`, `sync`, `macros`, and `time`
work; `net`, `fs`, `process`, `signal`, and `rt-multi-thread` do not. Mechanical,
but it touches many call sites and interacts with F4.

*Confidence: high* on the constraint; *low* on the effort, unmeasured.

### F7 — the missing storage seam is a smaller problem here than for Postgres

[LLP 0046](./0046-postgres-graduation-path.rfc.md) names the absent
async/transaction-aware store trait as its largest single engineering cost, and
the coupling has grown: `rusqlite` is imported across roughly fifty files in
`crates/snapback/src/`.

A browser build keeps SQLite, so it does not need the seam the way a Postgres
graduation does. But any browser-*specific* persistence would hit the same wall,
and the coupling makes `#[cfg]`-gating platform differences harder than it would
be behind a trait.

**[LLP 0199](./0199-core-modularization.decision.md) is the relevant vehicle**,
and the relationship runs both ways. Its accepted incremental boundary
extraction is what would make a browser target tractable — and conversely, a
`cargo check --target wasm32-unknown-unknown` on the `[lib]` target is an
unusually cheap **forcing function** that names platform coupling precisely,
file by file, without anyone having to argue about it. That diagnostic value
exists whether or not a browser target is ever built.

*Confidence: high* on the coupling; *medium* on the claim that a wasm check is a
useful modularization signal — plausible and cheap to test, not demonstrated.

## The two architectures

| | **A — core in WASM, host JS engine** | **B — everything in WASM** |
| --- | --- | --- |
| Rust + SQLite | `wasm32`, OPFS VFS | same |
| Handler engine | the browser's own, via a third `FunctionRuntime` variant | Hermes compiled to WebAssembly |
| Bundle | a few MB | tens of MB |
| Conformance delta | +1 engine (Chrome) or +3 (all browsers) | none — same Hermes everywhere |
| Concurrency | single lane in a Worker; declares its own profile | unchanged by the choice |
| Verdict | **the feasible one** | fidelity not worth the price |

B's only real argument is engine fidelity — the same Hermes semantics
everywhere, so LLP 0048's corpus never grows. That is a genuine benefit, and it
is not worth shipping a JavaScript engine compiled to WebAssembly to run inside
the JavaScript engine the browser already provides.

## Fidelity: the actual design problem

Once the target is a dev loop that graduates elsewhere, feasibility stops being
the interesting question and **fidelity** starts. The browser instance's job is
not to be fast. It is to be *indistinguishable in behaviour* from the target the
app will eventually run on, so that "it worked when I built it" survives
deployment.

That reframes the requirement list:

| Matters a lot | Matters little |
| --- | --- |
| Identical handler semantics across engines (F3) | Throughput |
| Identical query/mutation/live semantics | Concurrency |
| Deterministic reset and seed for the acceptance suite (LLP 0007) | HA, scale-to-zero, multi-region |
| Identical diagnostics — same `SNAPBACK_*` codes, same refusals | Cold-start latency |
| The same generated artifacts the real targets consume | Bundle size, within reason |

Two obligations follow that a production-target framing would not have produced:

1. **The acceptance corpus must run against the browser target**, not merely
   against the local one. A dev target whose acceptance story is "trust us" would
   invert the value — authors would be validating against something unvalidated.
2. **Graduation must be a non-event.** An app developed in the browser must
   deploy to Fly or Cloudflare with no source change. That is
   [LLP 0007](./0007-storage-portability.spec.md)'s portable contract and the
   same-app-facing-model promise in LLP 0014, now load-bearing for the dev loop
   rather than only for storage migration.

Failing fidelity does not make the feature bad; it makes it a **trap**. A dev
loop that is subtly wrong is worse than no dev loop, because the errors surface
after deployment and the author has no reason to suspect their tooling.

## What it would buy

Not argued here, only named, so the feasibility finding can be weighed against
something:

Reordered for the dev-target framing:

- **A backend dev loop with no install at all.** No Rust toolchain, no Hermes
  bootstrap, no port, no process to babysit. Set against what this very
  document's machine needed — a Rust toolchain, a 172 MB submodule, cmake, and a
  from-source Hermes build — the contrast is the argument.
- **Server-free agent sandboxes.** Given LLP 0000's agent-first thesis, an agent
  that creates a complete instance inside a page — no ports, no processes, no
  cleanup, no orphaned state between runs — is a materially better feedback loop
  than one managing a server. Instance-per-tab makes isolation free.
- **A live playground in the documentation surface** (LLP 0195), where guide
  examples execute instead of being displayed. The guide is already
  build-embedded and served; this makes it runnable.
- **Onboarding that starts at a URL.** The distance between "read about
  Snapback" and "have an app running" becomes one navigation.

Deliberately *not* claimed, given the framing: production hosting, offline-first
end-user deployment, or anything the local-first program (LLP 0126/0127/0129)
owns. Those would each be a separate argument.

## Recommended first step

**Prove F5 before anything else.** The initial instinct was to spike the
threading model; F4's revision moved that down to known-cost engineering, which
leaves `rusqlite` + `bundled` + `wasm32` + an OPFS VFS as the item most likely to
be worse than it looks.

Then, in order:

1. `cargo check --target wasm32-unknown-unknown` on the `[lib]` target with
   tokio features cut back — valuable as an LLP 0199 coupling census regardless
   of the outcome.
2. A third `FunctionRuntime` variant dispatching to the host engine,
   **Chrome-first**, so the LLP 0048 corpus grows by one engine rather than
   three.
3. A Worker-hosted instance driving the existing in-process `tower::Service`.
4. A separate **development** target profile with its own capability manifest —
   single lane, single user, no throughput claim — following LLP 0002's practice
   for the canonical local target rather than LLP 0111's production nonclaims.
5. Run the existing acceptance corpus against it (§Fidelity), because a dev
   target validated only by inspection inverts the value it is supposed to
   provide.

## Open questions

1. ~~Is a browser instance a *target* or a *client*?~~ **Answered by the author,
   2026-08-08: neither — a *development* target.** You build with only a browser
   and deploy elsewhere for production. Recorded in §Summary; it is what
   promotes F3 and demotes F4.
2. **Chrome-first, or all-browsers from the start?** The LLP 0048 corpus delta
   differs by 3×, nobody has scoped either, and F3 argues Chrome-first is the
   only sequencing that stays honest.
3. **Does the OPFS VFS satisfy LLP 0007's storage-portability contract**, in
   particular deterministic reset/seed for the acceptance suite?
4. **What does a browser instance do about the LLP 0047 hosted execution
   limits?** Handlers would run on an engine Snapback does not control, in a
   process the user owns. Trusted-local is the honest posture and the dev-target
   framing makes it obviously right — LLP 0002's local target is trusted-local
   for the same reason — but it should be stated rather than assumed.
5. **Is the wasm-check-as-coupling-census claim in F7 real?** Cheap to test and
   would be useful to LLP 0199 independently.

## Confidence

Overall: **medium-high that Architecture A is feasible**, medium on cost.
F1 and F2 are directly observed in the tree. F4 is reasoned rather than spiked,
and was revised once already in the course of writing this — it deserves the
most scepticism of the findings that now read as settled. F5 and F6 are the
unmeasured mechanical items. No estimate here is grounded in a build attempt;
nothing has been compiled for `wasm32`.

## Status

Draft. Feasibility research from a design conversation on 2026-08-08; no
implementation, no target profile, and no capability claim. Every `crates/snapback/src/`
observation is reproducible from `b60e477e5`; the LLP 0035 latency figures are
quoted from that document and were not re-measured.
