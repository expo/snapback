# LLP 0206: App-owned HTTP surfaces

**Type:** RFC
**Status:** Draft
**Systems:** Server, Routing, Assets, Auth, Runtime, Deployment, Client
integration, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-06
**Revised:** 2026-08-08 (Phase 4a amendments during implementation: the "only
new contract" claim in §Two delivery classes is corrected — `AppRequestContextV1`
is a third member, carrying path/params/query, excluding request headers on
authority and cache-poisoning grounds, and passing values raw; §Route
classification gains the Class B pattern rules — intersection-refuses,
ambiguity-refuses-rather-than-orders, no catch-alls — and records that the
gateway manifest now needs a matcher rather than string equality). 2026-08-08 (author rulings + survey findings, implementation
opened: the fallback route model is ratified with the path manifest carried by
LLP 0179's `AppDescriptor`; Class B is ratified as a fifth `FunctionKind`
variant; the read-lane requirement is recorded as type-enforced via `ReadLane`
rather than normative-only; `file:line` citations added throughout §Design; the
author authorized implementation directly from `Draft` without the LLP 0010
super-refine loop — see §Status). 2026-08-06 (author redirection before review: React SSR deferred
out of scope to a named future extension; the dynamic class recentred on
ordinary app code returning an HTTP response and reading app data directly,
which reuses the existing invocation and `ctx.db` machinery instead of adding
a renderer — §Design, §Non-goals, and the throughput/conformance postures
revised in step)
**Related:** LLP 0004, LLP 0011, LLP 0017, LLP 0031, LLP 0035, LLP 0039, LLP
0044, LLP 0047, LLP 0048, LLP 0053, LLP 0061, LLP 0063, LLP 0090, LLP 0103,
LLP 0189

## Summary

Snapback should serve a **bounded** set of app-owned HTTP surfaces: the URLs a
backend is forced to own because they must be co-located with the application
data and the authentication domain. Concretely — link-shareable pages carrying
Open Graph metadata, authentication and email landing endpoints, and
`/.well-known/*` deep-link association files.

This is deliberately **not** a proposal to make Snapback a web framework. The
scoping rule this RFC defends:

> Snapback owns the HTTP surfaces the backend is forced to own. Everything else
> belongs to Exact/Contract (rendering) or EAS Hosting (web application
> delivery).

The dynamic half is **ordinary app code that returns an HTTP response**. A
handler reads app data through the existing host-mediated API and returns bytes
with a status and content type. The author writes whatever markup they want; a
share page is a template string with `<meta>` tags. **React server-side
rendering is explicitly out of scope** and deferred to a named future extension
(§Non-goals, §Deferred). That deferral is what makes this RFC small: without a
renderer to reconcile across engines, the LLP 0048 conformance surface barely
grows and the throughput posture is ordinary handler cost.

Three things already exist and are not re-litigated here: the server already
serves static build-owned bytes under `/_snapback/*` (LLP 0031, LLP 0061), `/`
already content-negotiates HTML (LLP 0017), and handlers already read app data
through `ctx.db` host calls. What does not exist is a route class, an authority
argument, or a delivery contract for bytes an *app* owns.

The one genuinely hard decision is where app-owned routes live relative to
LLP 0031's reserved-prefix property. §Design states it as a decision requiring
ratification rather than resolving it silently.

## Motivation

### The north-star app cannot currently share a link

[LLP 0000](./0000-snapback.explainer.md) names the target as "something like
Partiful at a few hundred thousand monthly users." Partiful is a *link-shaped*
product: its core loop is pasting an invite URL into a group chat.

Link unfurlers in iMessage, WhatsApp, Slack, Discord, and every major social
surface fetch the URL and read `<meta property="og:*">` out of the returned
HTML. **They do not execute JavaScript.** A client-rendered invite URL unfurls
as a blank rectangle.

A corpus scan for open-graph, unfurl, crawler, and share-page handling returns
**nothing**. For a product whose benchmark application is built on shared
links, that is a product-shaped hole, not a missing optimization.

Note what this case actually requires: a few hundred bytes of HTML with `<meta>`
tags, populated from one row. It needs **data next to code**, not a rendering
framework. That observation is what sizes this RFC.

### The data is already right there

Snapback's shape makes the dynamic case unusually cheap. A handler already runs
next to the application's SQLite database and already reads it through
host-mediated calls under server-derived authority (LLP 0004, LLP 0039). A
dynamic page is therefore **a query-shaped invocation whose result is an HTTP
response instead of a typed row set** — the same runtime, the same authority
model, the same read path, a different return envelope.

Compare the ordinary alternative: a separate web tier that re-authenticates,
re-authorizes, and round-trips to the database over the network for data the
backend already has locally. Serving these pages from the process that owns the
data removes a network hop, a second auth surface, and a second deployment.

### The rendering half is committed; the serving half is unowned

[LLP 0063](./0063-partitime-platform-roadmap.plan.md) Workstream 3 already
gates production-web work on the client side:

> Production-web delivery is part of this surface, not a separate afterthought:
> browser history and deep links, **SSR/SSG authority**, hydration, document
> metadata, and `basePath` behavior. The controlling Exact baseline is Active
> Exact 0288 — Contract is officially Exact's web production target…

and

> **Commerce (pressure test 3) requires anonymous and SEO rendering, so the
> production-web gate precedes it.**

So SSR/SSG *authority* has an owner and an executable-acceptance requirement.
What has no owner is the answer to `GET /party/abc123` — the server-side act of
resolving a route, reading data under authorization, and returning a response.
This RFC claims that seam and nothing else. When Exact's SSR authority lands,
it becomes a *consumer* of this surface rather than a competitor to it.

### Auth landings force a second trust boundary, not just a second host

[LLP 0011](./0011-auth-and-permissions.rfc.md) is strict that this is runtime
work: success must be "**transactional from the verified request**", "never
contingent on a webhook", and "**Webhook verification belongs to the runtime,
before the adapter.**"

Auth is v1. OAuth `redirect_uri` landings, magic links, email verification,
password reset, and one-click unsubscribe (RFC 8058 requires a real POST
endpoint) are all *URLs a browser opens on the app's domain that must return
something and mutate session state*.

Today a Snapback app must stand up a second host for these. That host must
share the auth domain and cookie scope, so the cost is not an extra deploy — it
is an **extra trust boundary around the most security-sensitive part of the
system**, against LLP 0011's intent and
[LLP 0060](./0060-hosted-auth-security.rfc.md)'s posture.

### Deep links require files only the origin can serve

`apple-app-site-association` and `assetlinks.json` are mandatory for iOS
Universal Links and Android App Links, must be served from the application's own
domain over HTTPS with exact content types, and are the mechanism by which a
shared link opens the app rather than the browser.
[LLP 0090](./0090-resumable-query-snapshots.rfc.md) already depends on deep
links mounting screens. Two small static files currently require an entire
separate host.

### The tax lands hardest on the self-host audience

The value is **unevenly distributed across targets**, and the asymmetry should
drive the design:

- **Self-hosted / single-instance container-VM:** one process, one encrypted
  volume, one domain, one certificate, one deploy, one backup. Adding a second
  host and certificate pipeline to serve a handful of endpoints roughly doubles
  the operational surface — on exactly the audience the MIT "run anywhere,
  including for other people" posture exists for.
- **Cloudflare:** a gateway Worker and R2 already exist, and serving there
  correctly *bypasses* the Durable Object, which is desirable anyway given
  [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s per-app single-threaded read
  ceiling. There is no "one server" simplification because there was never a
  server, and [LLP 0103](./0103-expo-hosted-snapback.rfc.md) already reuses EAS
  Hosting's isolation, routing, domains, and metering.

This is therefore primarily a **self-host feature** with a contract the hosted
target satisfies through its gateway. It argues for implementing in the Rust
server first, not for one mechanism spanning both.

## Design

### Two delivery classes, deliberately separated

**Class A — build-owned static.** Bytes that ship with a release: client
bundles, CSS, images, `/.well-known/*` files. Public, immutable,
cache-forever, content-addressed. **Never enters the JS engine.**

This extends the authority argument LLP 0031 already makes for the console and
guide, which are public "only because they expose build-owned bytes, never
instance data or control." A site that ships with the release satisfies the same
test.

Byte storage should reuse [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s
content-addressing and immutable-blob layer — content addressing is exactly
right for hashed bundles — under a **new public delivery posture**, not under
0044's existing authorized posture. 0044's signed bounded delivery URLs,
per-intent read policies, and LLP 0053-projected invalidation are correct for
user uploads and wrong for public site bytes. 0044 also explicitly scopes out
"a CDN product," which this RFC does not reopen.

**Class B — dynamic response handlers.** Ordinary app code, invoked per
request, that reads app data and returns a response envelope: status, headers,
content type, body bytes. Author-written markup; no framework, no renderer, no
templating language mandated.

Class B is deliberately shaped as a **variant of the existing invocation
contract**, not a new runtime:

- it runs in the same engine under the same LLP 0047 hosted execution limits;
- it reads through the same host-mediated `ctx.db` surface under the same
  LLP 0039 server-derived authority — no new data path and no new authorization
  model;
- it is declared in the same manifest machinery as queries and mutations;
- the new contract is the **response envelope**, the route binding, and — added
  2026-08-08, see below — the **request context**.

**Request context (amendment, 2026-08-08).** The original text said the response
envelope and route binding were the *only* new contract. Implementing the
motivating case disproved that: a share link is `/party/{id}`, so a handler must
be told which id it was called for. `AppRequestContextV1` is therefore a third
contract member, carrying exactly:

- `path` — the concrete request path;
- `params` — the matched path parameters;
- `query` — the raw query string.

It rides the existing `HandlerInput.args` channel rather than a new `ctx`
member, which keeps the addition inside machinery both LLP 0048 engines already
agree on.

**Request headers are deliberately excluded.** Class B runs under a fixed
anonymous authority minted by the fallback; surfacing `cookie` or
`authorization` would create a credential path the invocation gate never
admitted, which is precisely what this RFC promises not to add. Header-varying
content on a cache-forever public URL is also a cache-poisoning hazard with
nothing forcing `vary`. The Open Graph case needs no header. Starting closed is
reversible; starting open is not.

**Values are raw and undecoded.** Percent-decoding is lossy (`%2F` is not `/`)
and was never ratified; handlers call `decodeURIComponent` themselves.

The rule that keeps this small: **Class B is a query, not a mutation.** A
handler that renders a page must not commit. Auth landings that must mutate
session state do so by invoking an existing mutation through the ordinary path,
which keeps LLP 0011's "transactional from the verified request" property
intact and keeps rendering off the write authority (§Read-lane).

Runtime-uploaded asset bytes are **not** a source for Class A. They are instance
data and would need their own authority argument; this RFC does not make one.

### Route classification — ratified 2026-08-08

[LLP 0031](./0031-server-route-taxonomy.spec.md)'s payoff is a static gateway
rule:

> any proxy or gateway can grant the full app-data surface with a **single
> reserved-prefix rule** (forward the root, refuse `/_snapback/*`) instead of
> re-deriving a hand-maintained allowlist. This is the "safe by construction"
> alternative…

App-owned pages want `/`, `/about`, `/party/abc123`. The root already carries
`/`, `/health`, `/query/{name}`, `/mutation/{name}`, `/connection/open`,
`/live/{name}/*`, `/outbox/{id}`, `/ephemeral/*`, and `/inspect`. An app page at
`/query` or `/inspect` collides outright.

| Option | Cost |
| --- | --- |
| App content under its own prefix (`/_site/*`) | No real product ships canonical URLs under a prefix; defeats the share-link motivation |
| Move app-data under a prefix, give the root to apps | Breaking change to every generated client and to LLP 0031's contract |
| **App routes as a fallback after app-data misses** | Preserves URLs; **breaks the single-prefix gateway rule** — a proxy can no longer statically classify a path |

**Resolution (ratified by the author, 2026-08-08):** the fallback option, plus a
**generated, machine-readable manifest of app-owned paths and prefixes**. A
gateway consumes a generated allowlist rather than a static prefix rule or a
hand-maintained list — preserving LLP 0031's "safe by construction" intent under
a different mechanism rather than abandoning it.

The manifest is a member of **LLP 0179's `AppDescriptor`**
(`packages/snapback-codegen/app-descriptor.mjs`), not a new artifact: 0179
already owns "one stable, language-neutral `AppDescriptor` containing the
complete generated application vocabulary," and app-owned routes are part of
that vocabulary. One generated surface, one thing for a gateway to read.

Reserved-prefix precedence is absolute and unchanged: `/_snapback/*` and the
enumerated app-data routes always win; app routes resolve only on miss. An app
route that shadows a reserved path is a **generate-time refusal**, not a runtime
surprise.

**Patterns (amendment, 2026-08-08).** Class B routes may declare a
single-segment capture, `/party/{id}`; Class A stays concrete, because a capture
over static bytes is a redirect or a cache rule, not a file. Three rules make
the generated manifest still classifiable:

- **Any set intersection refuses, not just containment.** `/{page}` is refused
  because it can produce `/health`; `/party/{id}` is admitted. Partial overlap
  is exactly the runtime surprise this section forbids — a `/{slug}` that serves
  `/about` but not `/health` would be discovered from a browser.
- **Two app routes that can claim one concrete path are refused as ambiguous**
  rather than ordered by specificity. A precedence rule is the one thing a
  gateway-facing manifest cannot carry, and this RFC spent static
  classifiability to buy a set of *disjoint* claims. The request-time matcher
  consequently needs no precedence rule at all.
- **Catch-alls (`{*rest}`) are refused** even though the router understands
  them. Unbounded depth complicates both overlap analysis and gateway reading,
  and no motivating case needs it. Additive later if one appears.

Consequence for the manifest: `app_owned_paths()` now returns patterns, so a
gateway needs a single-form matcher rather than string equality.

**What this costs, stated exactly.** LLP 0031's reserved-prefix property is not
merely documented — it is enforced structurally in
`RouteSpec::validate()` (`crates/snapback/src/server.rs:7555`), where an `AppData` route whose
path starts with `/_snapback/` is refused as "app-data route escaped the root
namespace" (`:7566`) and a malformed policy tuple is a startup panic. Adopting
fallback does **not** relax that check; reserved paths keep winning and keep
being validated. What changes is that a gateway can no longer classify a path by
prefix alone, and must read the generated manifest instead. The structural
enforcement stays; the *static classifiability from the path string* is what is
spent.

### Class B declaration — ratified 2026-08-08

Class B is a **fifth `FunctionKind` variant** (`crates/snapback/src/manifest.rs:7396`, today
`Query` / `Mutation` / `LiveQuery` / `Action`), not a `Query` carrying a route
binding.

Rationale: the enum is small and its match sites are exhaustive
(`crates/snapback/src/admin.rs:5375`, `:5393`, `:5423`; `crates/snapback/src/bundle.rs:629`, `:1344`;
`crates/snapback/src/args_contract.rs:556`), so the compiler enumerates the adoption work rather
than leaving it to be discovered. `RouteSpec`'s policy tuple also wants a
distinct `RouteClass` for this surface regardless, and a distinct kind keeps the
manifest legible to an agent reading it — LLP 0187's routing-over-coverage
concern.

### The read-lane requirement (normative)

App-owned responses **must not** queue behind the write authority.
[LLP 0035](./0035-local-target-benchmarks.research.md) measured a read during a
busy write at **~302,000 µs** through the global mutex against
**~4,300–4,600 µs** on the read lane — roughly 70×.

Therefore:

- Class A bytes never enter the JS engine or the authority at all.
- Class B executes on the read lane, never the write path.
- On Cloudflare, Class A is served by the gateway Worker from R2 plus the Cache
  API and **must not enter the Durable Object**; only Class B may.

Without this, a crawler hitting a public page becomes a denial-of-service
against the application's own write path. This is the single most important
constraint in the RFC.

**On the local target this is enforced by the type system, not by review**
(established by survey, 2026-08-08). `ReadLane` (`crates/snapback/src/local.rs:24800`) is a
distinct type with its own manifests, reader pool, and admission controller,
and it already "serves `/query` … without the global mutex" (`:24812`–`:24814`).
It is an axum extractor — `impl FromRef<AppState> for ReadLane`
(`crates/snapback/src/admin.rs:3201`) — while the write lane is a separate acquisition,
`state.snapback.clone().lock_owned().await` (`crates/snapback/src/server.rs:323`).

A Class B handler is therefore specified to take `ReadLane` and **not**
`SharedSnapback`. Such a handler is structurally incapable of reaching the write
path: there is no mutex to acquire from what it holds. The
query-not-mutation rule in §Two delivery classes is consequently a *type*
constraint on the local target, and the write-attempt refusal in §Acceptance
tests the manifest/registration layer rather than a runtime guard.

This is stronger than a normative rule and should be preserved as such by any
future target adapter: a target that cannot make the separation structural must
declare the weaker guarantee in its capability manifest rather than claiming
this one.

### Throughput posture

Because Class B is an ordinary handler rather than a render, its cost is
LLP 0035's warm-VM invocation floor (**~800–900 µs**) plus the handler's own
query work and serialization — the same shape already measured for queries, not
a new and heavier one. That is a materially better posture than a renderer-based
design would carry, and it is a direct consequence of the SSR deferral.

No number is claimed here. §Acceptance requires Class B throughput to be
measured on the local target before any capability-manifest entry, and the
capability index carries an explicit GAP row until it is.

### Conformance cost

[LLP 0048](./0048-v8-conformance-twin.rfc.md) already requires Hermes and V8 to
agree on handler behavior. Class B adds one thing to that surface: the response
envelope — status, headers, content type, and body bytes must be identical
across engines for the same input. That is an ordinary value-equality extension
to a corpus that already compares handler results.

This is the deferral paying for itself. A renderer would instead have required
agreement on markup emission, streaming behavior, and HTML escaping, where
divergence surfaces as wrong markup or hydration mismatch rather than a clean
typed error — a multiplicative cost on 0048 rather than an additive one.

## Deferred: React server-side rendering

Explicitly out of scope, recorded so the boundary is legible rather than
accidental.

Running a React server renderer inside a Class B handler is **plausible but
unverified**. Ibex carries a native HTTP server and `http`, `stream`, and
`stream-web` builtins, so `renderToReadableStream` and `renderToPipeableStream`
have the substrate they need; whether Hermes actually runs React's current
server renderer has not been tested.

It is deferred because it changes the cost structure of everything above: the
0048 corpus would have to cover rendered markup across two engines, throughput
would move from handler-shaped to render-shaped, and the surface would start
competing with LLP 0063 Workstream 3's SSR/SSG authority rather than serving it.

Revisit trigger: when LLP 0063 Workstream 3 lands SSR/SSG authority in Exact and
needs a server-side execution host, this RFC's Class B is the natural place to
put it — as a *separately gated extension* with its own 0048 corpus expansion,
not as a widening of this document's claim.

## Non-goals

- Becoming a general web framework or a competitor to EAS Hosting. The
  boundary: Snapback serves URLs that must be co-located with the data and the
  auth domain; EAS Hosting serves the web application, marketing site, docs, and
  Expo Router API routes.
- React server-side rendering (§Deferred).
- Mandating a templating language or shipping an HTML builder.
- A CDN product (LLP 0044 already scopes this out).
- Serving runtime-uploaded asset bytes as public site content.
- Owning SSR/SSG *authority* — that is LLP 0063 Workstream 3 and Exact 0288.
- Relaxing any LLP 0047 hosted execution limit for Class B code.
- Committing writes from a Class B handler.
- Multi-process or horizontally scaled serving.

## Acceptance

- An invite-shaped route returns HTML containing correct `og:*` metadata, read
  from real application data, to a client that executes no JavaScript.
- A Class A request completes without entering the JS engine, proven by
  instrumentation rather than by inspection.
- A Class B request served concurrently with a sustained mutation load shows
  read-lane latency, not global-mutex latency, against LLP 0035's two measured
  shapes.
- A Class B handler that attempts a write fails closed with a stable
  `SNAPBACK_*` diagnostic, and nothing is committed.
- An app route declaring a path that shadows `/_snapback/*` or an enumerated
  app-data route fails at generate time with a stable `SNAPBACK_*` diagnostic.
- The generated app-route manifest is sufficient for a gateway to classify every
  served path with no hand-maintained list.
- A `/.well-known/apple-app-site-association` request returns the exact bytes
  and content type Apple requires.
- An authentication landing endpoint completes transactionally from the verified
  request, per LLP 0011, with no second host in the path.
- The same Class B handler returns a byte-identical response envelope under both
  engines in the LLP 0048 corpus.
- Class B throughput is measured and recorded before any capability-manifest
  claim; the capability index carries an explicit GAP row until it is.

Every claim above is gated per
[LLP 0189](./0189-verification-cadence-and-claim-gating.decision.md): a claim
binds its qualification commit and the scoped evidence surface it names (D-3),
and the qualification digest covers the claim-relevant surface only — the Class
A/Class B runtime plus the checkers defining those claims' semantics — not the
shared proof harness or fixtures (D-4). This RFC declares no stricter per-claim
protocol under D-7.

## Resolved questions

- **Route model** — ratified 2026-08-08: fallback after app-data miss, with the
  path manifest carried by LLP 0179's `AppDescriptor` (§Route classification).
- **Class B declaration** — ratified 2026-08-08: a fifth `FunctionKind` variant
  (§Class B declaration).

## Open Questions

1. **What is the response-envelope contract?** Minimum is status, headers,
   content type, and body bytes. Open: streaming responses, byte-range support
   for Class A, and whether headers are an allowlist or a denylist.
2. **Does Class A justify a distinct `deliveryPosture` in LLP 0044**, or a
   separate build-owned byte store that merely reuses the content-addressing
   code? Note that today's static bytes are compile-time `include_str!`
   (`crates/snapback/src/admin.rs:102`, `:314`; `crates/snapback/src/server.rs:8003`), which cannot serve
   per-app per-release content — this is the one part of the RFC with no
   existing mechanism to extend.
3. **Does the read lane's `AdmissionController`** (`crates/snapback/src/local.rs:24810`) impose
   limits Class B would hit under crawler-shaped load, and should Class B carry
   its own admission budget?
4. **Where exactly is the EAS Hosting line** for hosted Snapback? §Non-goals
   states the principle; LLP 0103's division of responsibility should carry the
   operative form.

## Status

Draft. Written from a design conversation on 2026-08-05/06, revised 2026-08-06
to defer React SSR, and revised 2026-08-08 to record the author's route-model
and declaration rulings plus the `ReadLane` survey finding.

**The design stands; its first implementation does not.** The author authorized
implementing directly from `Draft` on 2026-08-08 — a deliberate, recorded
departure from Draft → Review → Accepted — and phases through the Open Graph
witness were built and tested against `cc4764d8`. `main` then advanced roughly
180 commits, including LLP 0199's core-modularization decision, and the author
set that implementation aside on 2026-08-09 to be redone. It is not on `main`
and this document should not be read as describing shipped behaviour.

Two findings from that pass are worth keeping regardless, because they were
established by reading the tree rather than by the code that was written:

- `ReadLane` being a distinct axum extractor makes the §Read-lane requirement
  enforceable by type rather than by review — recorded in that section.
- The `available()` flag reports the WAL reader pool, not the manifest snapshot,
  so gating a manifest read on it silently borrows the global write mutex. That
  is the exact denial-of-service the read-lane rule exists to deny, and it was
  the first bug the first implementation shipped.

This document did **not** run the LLP 0010 super-refine loop, and no external
review verdict binds any revision of it.

No capability claim is made. Per LLP 0189 D-3 every claim binds its
qualification commit; nothing here is qualified. The corpus scan supporting
§Motivation's Open Graph gap and the route-collision analysis in §Design were
reproducible at `cc4764d8`; the `file:line` citations added 2026-08-08 point at
that tree and predate LLP 0199's module boundaries, so they should be
re-derived before they are relied on.

**Renumbered** from 0190 to 0206 on 2026-08-09: `llp/0190` was taken by
`0190-zerobugs-retained-facts-local-evaluation.spec.md` while this document was
out of tree. This is its second renumber — it was drafted as 0188 before 0188
and 0189 landed.
