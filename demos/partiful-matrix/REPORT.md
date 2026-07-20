# Partitime build report

## Web and Apple-native authoring across Snapback, Supabase, Convex, and SQLite

**Date:** 2026-07-19

**Demo:** [`demos/partiful-matrix/`](./)

**Build diary:** [`diaries/0016-partiful-matrix.diary.md`](../../diaries/0016-partiful-matrix.diary.md)

**Scope:** web and native authoring experience, backend modeling, integration friction, generated artifacts, runtime wiring, Acto automation, verification, and honest capability limits

> In this report, **Contract** means Exact's Contract UI language and runtime,
> not a blockchain smart contract.

## 1. Executive summary

Partitime is one Partiful-style product implemented as an explicit 3×4 matrix:

| Authoring surface | Snapback | Supabase | Convex | SQLite |
|---|---:|---:|---:|---:|
| React | Built and browser-tested | Built and browser-tested | Built and browser-tested | Built and browser-tested |
| Contract | Built and browser-tested | Built and browser-tested | Built and browser-tested | Built and browser-tested |
| Vanilla JS | Built and browser-tested | Built and browser-tested | Built and browser-tested | Built and browser-tested |

It was then extended as a 2 authoring systems × 2 Apple platforms × 4
providers matrix:

| Native authoring surface | macOS | iOS | Provider modes |
|---|---|---|---|
| SwiftUI | Built; app acceptance 4/4 | Built; app acceptance and XCUITest 4/4 | Snapback, Supabase, Convex, SQLite |
| Exact + Contract | Built; Acto 4/4 | Built; Acto 4/4 | Snapback, Supabase, Convex, SQLite |

The native rows deliberately share one JSON gateway and poll once per second.
They compare UI authoring, application state, carrier behavior, and automation;
they do not compare each provider's native Apple SDK. That boundary especially
matters for Snapback: its web cells retain the direct generated push path, while
its SwiftUI and Exact native cells use the same gateway as the other providers.

The experiment held the product model, seed fixture, normalized row shapes,
operation names, visual direction, personas, and acceptance claims constant.
React and Vanilla JS additionally share the same stylesheet, so their comparison
isolates rendering and lifecycle machinery rather than visual design. The
variables were the UI authoring system and backend implementation. All twelve
cells support:

- event discovery;
- event detail;
- event creation with an atomic host RSVP;
- RSVP changes with one row per event/person;
- a guest list;
- wall posts;
- a deterministic three-event starting fixture.

The result was not one universal winner. Different choices won different parts
of the work:

- **SQLite was the fastest path to a concrete local backend.** There was no
  account, deploy, credential, network, SDK, or generated layer. The cost is
  that every capability above SQL—transport, lifecycle, hosted topology,
  diagnostics, and client contract—remains application work.
- **Snapback provided the strongest end-to-end contract.** It required more
  declarations up front, then generated typed refs, manifests, Contract
  bindings, argument schemas, capability facts, and a live adapter. Its build
  failures were the most protective and its Snapback×Contract cell had the
  least handwritten data plumbing.
- **Convex had the best unattended hosted deployment workflow.** A
  deployment-scoped key could typecheck, generate, deploy, and seed without
  interactive login. The main friction was configuration identity: the
  supplied URL and deploy key referred to different deployment surfaces.
- **Supabase/Postgres had the most familiar relational modeling.** Foreign
  keys, unique constraints, and `ON CONFLICT` expressed the invariants
  directly. However, the supplied publishable key returned HTTP 401, so this
  build used a secure server-side Postgres adapter. It therefore did not test
  the most interesting Supabase client features: `supabase-js`, RLS, Auth, or
  Realtime.
- **React was the easiest place to produce bespoke web visual polish.** It also
  owned every subscription and polling lifecycle detail by hand.
- **Contract was the best Snapback data-authoring experience.** Generated
  links and explicit async regions eliminated React's live-query hook. Against
  non-generating backends, however, handwritten provider manifests and binding
  metadata outweighed that advantage.
- **Vanilla JavaScript produced by far the smallest runtime bundles, but the
  largest handwritten frontend row.** Gateway-backed cells emitted about 13.5
  KB of minified JavaScript and Vanilla×Snapback emitted about 211 KB. The row
  needed 522 local source lines for rendering, provider selection, and explicit
  subscription ownership before counting build configuration or its shared
  stylesheet.
- **Snapback's headless client proved framework-neutral.** Generated refs,
  idempotent provisioning, push subscriptions, mutations, and connection state
  worked from ordinary browser modules without React or Exact. Push removed
  polling; it did not remove the author's obligation to dispose subscriptions
  and fence late callbacks.

The strongest high-level finding is architectural: a 3×4 comparison should not
be twelve copied applications. One shared product contract plus provider
conformance made differences attributable. The strongest caution is equally
important: routing Supabase and Convex through the same gateway made the
comparison controlled, but less idiomatic. The report distinguishes the
adapters actually tested from each platform's full product.

## 2. What was held constant

### 2.1 Product contract

Every backend exposes the same logical operations:

| Operation | Kind | Product meaning |
|---|---|---|
| `listEvents` | query | Ordered public discovery feed |
| `eventDetails` | query | One event by public ID |
| `guestList` | query | RSVPs for one event |
| `eventWall` | query | Chronological wall posts |
| `createEvent` | mutation | Create event and its host seat |
| `rsvp` | mutation | Insert or change one person's response |
| `postMessage` | mutation | Append a wall post |

The normalized records are also shared:

- `EventRow`: stable `_id`, title, emoji, description, location, time, host,
  and visual accent;
- `RsvpRow`: stable `_id`, event, user, display name, and status;
- `PostRow`: stable `_id`, event, author, message, and explicit timestamp.

The fixture is committed once at [`shared/seed.json`](./shared/seed.json). The
Snapback seed is a projection into Snapback's table envelope; SQLite,
Supabase, and Convex seed idempotently from the shared records.

### 2.2 User interface

All three authoring rows implement the same two screens:

1. a branded discovery feed with persona switching and event creation;
2. an event page with location, RSVP controls, guest list, and wall.

The rows share product behavior and test IDs. React uses components, hooks, and
CSS. Contract uses `.contract` components, query/mutation bindings, actions,
derived values, and explicit async slots. Vanilla JS uses escaped HTML
templates, direct DOM event binding, a small state object, and an explicit
generation-scoped subscription owner. Vanilla imports React's CSS but none of
its JavaScript or runtime packages.

### 2.3 Identity and authorization boundary

The personas Ada, Grace, and Eve are trusted local demo identities. They are
sent as user IDs to make per-person RSVP behavior testable. The matrix does
**not** claim:

- production authentication;
- session security;
- Supabase RLS;
- tenant isolation;
- invite secrecy;
- authorization parity across the four platforms.

This was deliberate. Adding four different auth systems would have made auth,
not authoring or data integration, the dominant variable.

### 2.4 Freshness boundary

The tested transports differ and are labeled in the UI:

| Backend | Transport exercised in this matrix |
|---|---|
| Snapback | Push live queries |
| Supabase | One-second polling through the local gateway |
| Convex | One-second polling through the local gateway |
| SQLite | One-second polling through the local gateway |

Supabase and Convex both offer native realtime mechanisms. The matrix does not
claim otherwise; it simply did not exercise those mechanisms in this build.

## 3. Architecture of the experiment

The three authoring rows share product facts, while each backend owns storage and
mutation semantics:

```text
                         shared model + seed + acceptance claims
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
         React surface          Contract surface        Vanilla surface
              │                       │                       │
       MatrixProvider           Exact handles           MatrixProvider
              │                       │                + SubscriptionScope
       ┌──────┼──────┐         ┌──────┼──────┐         ┌──────┼──────┐
       │ four backend│         │ four backend│         │ four backend│
       │    modes    │         │    modes    │         │    modes    │
       └──────┼──────┘         └──────┼──────┘         └──────┼──────┘
              │                       │                       │
       push or gateway       generated links or        push or gateway
                                  provider seam
```

The external/local comparison providers share a small Bun gateway. This kept
browser CORS, secret custody, request shape, and polling cadence controlled.
It also means that the Supabase and Convex cells are not examples of their
idiomatic frontend SDK usage.

## 4. Evidence and quantitative results

### 4.1 Verification

The final proof consisted of:

- **13/13 provider checks** across all four backends;
- **43/43 retained browser checks** across all twelve cells: the original
  per-cell flow plus four vanilla lifecycle checks and three Snapback
  fallback-disabled push-provenance checks;
- **4/4 React production builds**;
- **4/4 Contract production builds**;
- **4/4 Vanilla JS production builds**;
- **3/3 Vanilla subscription-lifecycle checks**, covering active-handle
  teardown, late handle resolution, stale observer delivery, and terminal close;
- React TypeScript check passing;
- Snapback codegen passing deterministically;
- Convex deploy, typecheck, code generation, and idempotent seed passing;
- Supabase schema creation and seed passing against isolated
  `partiful_matrix_*` tables;
- the repository LLP reference audit passing;
- the demo setup registry and destructive-on-mount guard passing;
- no credential values found in source or generated client artifacts.

The provider suite verifies more than reads. For every backend it exercises:

1. the canonical ordered fixture;
2. idempotent RSVP per event/person;
3. create event;
4. atomic host seat;
5. wall post;
6. normalized row shapes.

Temporary Supabase and Convex write-loop rows are removed after the test, but
cleanup refuses to act unless the event belongs to the dedicated acceptance
principal and has an `[acceptance]` title. The test therefore does not grow
persistent remote junk or expose a broad delete primitive.

The retained browser suite verifies three shared claims per cell:

1. the cell boots and reports the correct authoring/backend identity;
2. the canonical feed renders;
3. event navigation and RSVP convergence work through the rendered UI — the
   oracle reads Eve's actor-specific row, selects a different status, and
   requires a different observed value after the mutation, so seeded data from
   another guest cannot satisfy it.

Every Vanilla cell has a fourth browser claim: detail owns exactly three active
subscriptions, navigating back disposes them, and feed converges with exactly
one active subscription. The separate lifecycle suite forces the stale and late
promise cases a real backend cannot make deterministic on demand.

Every Snapback cell has an additional transport witness. It relaunches with
polling fallback disabled, performs an out-of-band mutation, requires a live
connection and an unsolicited DOM transition, and retains the `guestList`
subscription's push establishment event. The latency instrument performs two
warmups followed by seven alternating RSVP transitions, then retains every
sample plus the median and p95 under the preregistered comparison protocol. A separate
synthetic-prerequisite run proves that missing Chrome or server binaries emit a
committed `ok: false`/`outcome: skip` receipt and exit nonzero rather than
printing a green-looking skipped pass.

Remote-provider availability is classified separately from required local
proof. The gateway initializes Snapback and SQLite independently, probes a
canonical read on every backend, and records only health codes—not credential
values. Supabase or Convex outages become explicit per-cell
`remote-dependency` skips; they are excluded from local aggregation and never
reported as passes. Snapback or SQLite preflight failures remain hard setup
failures. All managed server and build processes use bounded TERM→KILL cleanup,
and a cleanup survivor makes the retained receipt non-pass.

This 2026-07-20 refresh now closes Step 0. The SwiftUI baseline and a clean
Exact carrier revision both built freshly for macOS and iOS on the remote
Xcode 26.3 instrument. All sixteen native cells retain passing local evidence
or declared remote-dependency skips, and both authoring systems retain native
hit reachability. The authoritative manifest finishes at 19/19 Step 0 claims;
Exact mirrors the manifest, schema, protocol, lock, and self-reference-safe
completion aggregate, while an independent cross-repository receipt binds the
final byte digest and both registered Exact validators. The earlier Xcode 26.6
SDK-discovery timeout remains useful diagnostic history below, but it is not
the qualifying carrier result.

### 4.2 Handwritten backend source

The following counts are physical source lines, including comments and blank
lines. They are useful as a scale signal, not a productivity benchmark.

| Backend | Backend-specific handwritten lines | What is included |
|---|---:|---|
| SQLite | 87 | schema, seed, queries, mutations, scoped test cleanup |
| Supabase | 88 | DDL, seed, queries, mutations, scoped test cleanup |
| Convex | 133 | 15 schema + 76 functions + 42 HTTP adapter |
| Snapback | 168 | 32 schema + 75 function declarations + 61 handlers |

The shared gateway server and credential loader add 84 lines used by
Supabase, Convex, and SQLite. Snapback's 168 source lines generated **30 files**
covering API refs/types, manifests, argument schemas, Contract bindings, and
artifact identity. The table therefore does not say “SQLite delivers more in
87 lines.” It says SQLite reached the experiment's narrow behavior fastest,
while Snapback recorded and generated substantially more cross-layer contract.

### 4.3 Handwritten frontend source

| Authoring row | Product/view and boot | Provider/binding glue | Total counted lines |
|---|---:|---:|---:|
| React | 249 | 100 | 349 |
| Contract | 293 | 142 | 435 |
| Vanilla JS | 349 | 173 | 522 |

React's 249 includes `App.tsx`, `main.tsx`, and the stylesheet. Contract's 293
includes two `.contract` screens, helpers, and boot. Contract's 142 includes
the generic provider plus the stable link registry and handwritten binding
metadata required to support non-Snapback providers from one source.
Vanilla's 349 is its imperative DOM application. Its 173 combines the 100-line
provider with the 73-line `SubscriptionScope`. It imports React's 41-line
stylesheet rather than duplicating it; counting every source line the row
executes would therefore make its total 563, while 522 is the incremental
handwritten row.

This result needs interpretation:

- In the **Snapback-only** path, much of Contract's local binding glue could be
  removed in favor of direct generated imports; the matrix keeps the stable
  registry so one Contract source can serve four backends.
- React's provider module includes both its hand-owned Snapback subscription
  lifecycle and the generic polling provider.
- Contract expresses most styling inline in view nodes; React puts 41 dense
  lines in a separate stylesheet. Physical line count does not capture CSS
  declaration density.
- Vanilla needed explicit escaping, DOM event rebinding, input preservation,
  busy/error rendering, lifecycle generations, and page-hide cleanup. Removing
  the UI runtime reduced emitted bytes but did not reduce authoring volume.

The honest conclusion is not “framework-free uses less code” or “Contract uses
less code.” Neither did in this four-provider experiment. Contract removed live
data lifecycle code in the generated Snapback cell, then paid it back as
metadata and binding glue for providers that do not generate Contract artifacts.
Vanilla removed framework runtime bytes, then paid for rendering and lifecycle
semantics in application source.

### 4.4 Production JavaScript bundle size

These are the emitted minified JavaScript asset sizes from the final local
builds. Deterministic gzip counts use `gzip -cn`, which excludes filenames and
timestamps. No bundle-tuning work was done.

| Cell | Minified JavaScript | Deterministic gzip |
|---|---:|---:|
| React × Snapback | 402,091 bytes | 113,676 bytes |
| React × Supabase | 203,288 bytes | 64,072 bytes |
| React × Convex | 203,284 bytes | 64,071 bytes |
| React × SQLite | 203,284 bytes | 64,072 bytes |
| Contract × Snapback | 718,997 bytes | 190,879 bytes |
| Contract × Supabase | 388,479 bytes | 105,447 bytes |
| Contract × Convex | 388,469 bytes | 105,447 bytes |
| Contract × SQLite | 388,469 bytes | 105,446 bytes |
| Vanilla × Snapback | 211,357 bytes | 54,039 bytes |
| Vanilla × Supabase | 13,539 bytes | 4,897 bytes |
| Vanilla × Convex | 13,535 bytes | 4,896 bytes |
| Vanilla × SQLite | 13,535 bytes | 4,896 bytes |

The Snapback cells are larger because the build includes the Snapback client
and adapter path. Contract bundles are larger than React bundles in this setup,
using Exact 0.1.2 packages and without a size-optimization pass. Vanilla makes
two major weights legible: roughly 198 KB raw is added by the Snapback client
path in the Vanilla builds, while roughly 190 KB raw separates the React and
Vanilla gateway builds. The latter includes framework/runtime and different
compiled application structure, so it is not a pure React-library measurement.
These are packaging results, not evidence about runtime speed.

### 4.5 What was not measured

No trustworthy clean-machine wall-clock study was captured. Dependency caches,
an already prepared Ibex runtime, remote network variance, and repeated builds
would make retrospective timing numbers misleading. This report therefore uses
source evidence, observed failure/recovery steps, build output, and acceptance
results rather than invented “minutes to complete” precision.

## 5. Build narrative

### 5.1 Credential readiness

The build started by validating credentials without printing them.

- Supabase's direct Postgres connection authenticated.
- The Supabase server secret authenticated against the REST root.
- The Supabase publishable key returned HTTP 401, including after it was added.
- The Convex deploy key authenticated for CLI operations.
- The supplied Convex URL was not the public query origin selected by the
  deploy key.

This immediately shaped the experiment. Shipping a database URL or privileged
Supabase key in a browser bundle was not acceptable. The Supabase column was
therefore implemented through a local server-side gateway. That preserved
credential safety and real Postgres behavior, but reduced the scope of the
Supabase comparison.

### 5.2 Shared product model first

Defining the records, operation names, personas, fixture, and expected behavior
before any backend work prevented four providers from drifting into subtly
different apps. It also made conformance mechanically testable. This was one of
the highest-leverage decisions in the build.

The shared model did impose a lowest-common-denominator shape. For example,
wall timestamps are explicit mutation inputs because Snapback's deterministic
handler bundle rejected ambient `Date.now()`. Once time became explicit for
Snapback, the same argument was carried through every provider.

### 5.3 Backend implementations

The implementation order made different classes of friction visible:

1. Snapback established the most declared and generated version of the
   contract.
2. SQLite established the simplest concrete persistence baseline.
3. Supabase translated that relational baseline to remote Postgres.
4. Convex translated the model into hosted functions, indexes, generated code,
   and stable public IDs.

### 5.4 Frontend implementations

React was built around one `MatrixProvider` interface. The component tree does
not branch on backend. Vite mode selects one of four provider builds.

Contract uses one feed component and one event component. A stable link registry
lets boot choose either:

- the real generated Snapback Contract surface; or
- Exact provider query/mutation handles backed by the gateway.

This preserved one Contract product source while keeping the Snapback cell on
its generated path.

Vanilla uses one ordinary JavaScript application and the same `MatrixProvider`
shape as React. Rendering is imperative: escaped HTML replaces `#root`, then
the current view binds its DOM events. A dedicated `SubscriptionScope` owns
one feed subscription or three detail subscriptions. Every navigation or
persona change advances a generation, disposes the old handles, rejects stale
callbacks, and disposes any handle that resolves after its view is gone. Vite
mode emits four builds; no UI framework package is installed.

### 5.5 Verification-driven cleanup

The proof caught several issues that a successful build alone would not:

- stale Snapback binary provenance;
- an early temporal hazard in React's connection callback;
- the need for a generation fence around late Vanilla subscription handles;
- the need for scoped cleanup of remote acceptance rows;
- Contract's warning that the create mutation writes an RSVP table the feed
  cannot observe;
- broken shorthand LLP anchors in two new `@ref` annotations;
- missing registration of the new demo in the generated-artifact and setup
  inventories.

The Vanilla extension adds two complementary proofs. A pure three-check suite
forces late handle resolution and stale observer delivery. The browser suite
then confirms that navigating detail→feed replaces three real provider handles
with one in every backend cell.

The result was better because the acceptance corpus exercised real user flows
instead of stopping at typecheck or bundle emission.

## 6. Snapback: detailed experience

### 6.1 What was pleasant

#### One source model produced a broad integration contract

The schema and function declarations generated:

- typed API references;
- TypeScript declarations;
- schema and function manifests;
- a capability manifest;
- a Contract data manifest;
- per-operation argument JSON Schemas;
- per-query and per-mutation Contract modules;
- runtime-link types and registry;
- artifact hashes and staleness identity.

None of React, Contract, or Vanilla JS had to infer Snapback semantics from
private server code. That made the Snapback column the most explicit and
reviewable end to end.

#### Push queries were genuinely less application plumbing

The four live query declarations were enough to provide initial snapshots,
updates, and connection state. React still had to own handle lifecycle, but it
did not have to build a server poller. Contract delegated the whole live data
plane to `createSnapbackContractSurface`. Vanilla used the same push seam as
React and made its remaining lifecycle ownership explicit in
`SubscriptionScope`.

#### Codegen failed protectively

The first handler used `Date.now()` for a wall post. Codegen returned
`BUNDLE_UNSUPPORTED_TIME`, wrote no artifacts, and left no silent stale output.
The correction—make `createdAt` an explicit input—was immediate. This is a
good example of Snapback asking for more explicit design while preventing an
ambiguous runtime dependency.

#### Non-destructive boot was clear

All three browser rows use one idempotent `ensureApp` call. None can reset the
backend. Reloading a cell or moving among React, Contract, and Vanilla preserves
data, which is essential for meaningful cross-surface behavior.

#### Provenance checks prevented a false pass

The first headless run found an existing server binary built from an older
commit and refused to trust it. The project bootstrap rebuilt and launch-smoked
the correct binary. A weaker harness would have used the stale executable and
possibly reported a misleading pass.

### 6.2 What was difficult

#### More handwritten declaration volume

The narrow behavior took 168 source lines before generation, nearly twice the
SQLite adapter. Validators, indexes, query modes, ordering, read/write sets,
and handler boundaries are explicit. That cost pays for generated artifacts and
diagnostics, but it is still an up-front authoring tax.

#### Deterministic execution changes API design

Injecting time is honest and reproducible, but a production wall should not
blindly trust a client timestamp. A server-clock primitive or a generated
trusted-time capability would be preferable.

#### Repository runtime preparation is heavier

The prepared local runtime was already available, but rebuilding the Snapback
binary still involved the Ibex/Hermes bootstrap and Cargo. That is qualitatively
heavier than starting Bun with SQLite. The packaged external developer loop is
not what this in-repository experiment exercised.

### 6.3 Where the effort went

Snapback moved effort **upstream** into declarations and generated contracts.
Less effort remained in HTTP normalization, polling, and Contract binding
metadata. It felt more like defining a small platform surface than writing a
thin database adapter.

## 7. Supabase: detailed experience

### 7.1 What was pleasant

#### Relational invariants were compact and familiar

Three tables expressed the model directly. Foreign keys connected RSVPs and
posts to events. A unique `(event_id, user_id)` constraint made duplicate RSVP
rows impossible. `INSERT ... ON CONFLICT` provided the desired idempotent
mutation shape.

This was the most conventional representation of the product invariants. A
reader familiar with Postgres can understand the integrity boundary without
learning a framework-specific schema language.

#### Idempotent provisioning was natural

`CREATE TABLE IF NOT EXISTS` plus seed inserts using `ON CONFLICT DO NOTHING`
made repeated local gateway starts safe. The provider conformance suite could
run repeatedly against the same remote database without duplicating the base
fixture.

#### Bun's SQL client made the fallback viable

The direct Postgres URL worked, and tagged queries kept parameter binding
straightforward. The secure gateway path stayed small enough to remain
reviewable.

### 7.2 What was difficult

#### The publishable-key failure changed the attainable experiment

The publishable key returned 401. Using the secret key or database URL in the
browser would have been a security failure, so the build moved Supabase behind
the gateway. This was the right operational decision, but it means the result
cannot answer:

- what `supabase-js` felt like in React;
- how much RLS policy work the app required;
- whether generated Supabase types improved the loop;
- how Realtime channels compared with Snapback live queries;
- what Supabase Auth integration felt like.

The Supabase column is therefore a Postgres-on-Supabase comparison, not a full
Supabase application-development comparison.

#### Secret custody created a server requirement

Once the browser could not use a publishable credential, “hosted backend” no
longer meant “no local backend process.” A local Bun gateway became part of
development, deployment assumptions changed, and CORS/health/lifecycle became
our responsibility.

#### Persistent remote state required cleanup discipline

The suite uses a dedicated acceptance principal and guarded cleanup. Without
that, repeated create/post tests would accumulate data. Local memory databases
made isolation easier.

### 7.3 Where the effort went

Supabase moved effort into **database DDL and operational credential handling**.
The data model was easy; the configuration boundary dominated the experience.

## 8. Convex: detailed experience

### 8.1 What was pleasant

#### The unattended deployment workflow was excellent

The deployment-scoped key let the setup script run non-interactively. A single
flow performed function upload, generated TypeScript bindings, typecheck,
schema validation, index deployment, and finalization. The idempotent seed
mutation then prepared the product fixture.

This was the most “leave for lunch” hosted setup in the matrix.

#### Query and mutation functions were concise

Indexes made the important access patterns explicit:

- event by public ID;
- RSVP by event;
- RSVP by event and user;
- wall posts by event.

Function code stayed close to the product operations, and failures came back
through a clear query/mutation HTTP envelope.

#### The missing-tsconfig failure was actionable

The first deploy requested typechecking but had no `convex/tsconfig.json`. The
CLI stopped and named the remediation. Adding the standard config produced a
clean deploy. This was useful failure behavior.

### 8.2 What was difficult

#### The deploy key and URL selected different targets

The supplied `CONVEX_URL` was an HTTP-actions `.convex.site` origin that did not
match the development deployment selected by the deploy key. Deployment
succeeded, but seeding through that URL returned the wrong endpoint behavior.
Deriving the `.convex.cloud` query origin from the deployment-scoped key fixed
the mismatch.

This is an easy trap because both values look individually plausible. A setup
check should assert their deployment identity before pushing code or data.

#### Stable cross-backend IDs needed a parallel field

Convex generates document IDs. The shared fixture required stable IDs such as
`event_sunset`, so each document carries `publicId` and an index, then the
adapter projects it back to `_id`. The other stores could use the fixture ID as
their primary key directly.

#### The matrix did not use Convex's strongest client path

React did not use Convex subscriptions or `useQuery`; Contract did not receive
a generated Convex binding package. Both used the common HTTP gateway and
poller. That was controlled, but it made Convex look more like a generic remote
function service than an idiomatic Convex app.

### 8.3 Where the effort went

Convex moved effort into **hosted function/schema deployment and identity
normalization**. Once deployment identity was correct, the remote loop was
smooth.

## 9. Plain SQLite: detailed experience

### 9.1 What was pleasant

#### Lowest setup friction

`bun:sqlite` required no dependency installation, account, login, environment
variable, network request, deploy, or code generation. Starting the gateway
created a local file, schema, indexes, and deterministic seed.

#### State and queries were transparent

The app had four obvious `SELECT`s and three mutations. A unique constraint
carried the RSVP invariant. Debugging could be done by inspecting one local
file with ordinary SQLite tooling.

#### Acceptance isolation was cheap

The headless suite created a temporary database directory and deleted it on
cleanup. There was no remote state ledger to manage.

### 9.2 What was difficult

#### The application owns the platform

SQLite supplied durable SQL, not an application backend. The demo had to own:

- the gateway server;
- HTTP request/response envelopes;
- CORS;
- polling;
- connection-state mapping;
- process lifecycle;
- secret/config loading for shared gateway operation;
- any future auth and authorization;
- any future hosted or multi-instance story.

That burden was mostly invisible in the 87-line adapter because shared gateway
code sits outside the backend-specific count.

#### No generated compatibility boundary

The provider conformance suite protects behavior, but nothing fails at build
time if a TypeScript row projection silently drifts from the SQL schema. The
contract is convention plus tests.

### 9.3 Where the effort went

SQLite minimized **initial storage effort** and maximized **application-owned
infrastructure**. It is a compelling prototype baseline precisely because it
makes every added platform requirement visible.

## 10. React: detailed experience

### 10.1 What was pleasant

#### One provider interface isolated backend differences

The product components never check which backend they are using. The provider
owns Snapback push or gateway polling, and Vite mode emits four separate cells.
This made the React row straightforward to reason about and kept the visual
work independent of storage.

#### Local navigation was natural

Feed-to-event navigation is component state. Selecting an event immediately
switches the rendered view and rebinds the relevant queries without a page
reload.

#### Web styling was expressive

React plus CSS made it easy to add:

- responsive multi-column cards;
- sticky translucent navigation;
- persona chips;
- irregular event artwork;
- hover movement and shadows;
- desktop/mobile layout changes;
- precise type and spacing treatment.

React and Vanilla render the same richer CSS treatment; React was much more
economical to author because Vanilla deliberately reused the finished
stylesheet and still needed more application source.

### 10.2 What was difficult

#### Subscription lifecycle was handwritten

The provider/hook path owns:

- initial connection state;
- first snapshot application;
- update delivery;
- handle disposal;
- late handle resolution after unmount;
- polling scheduling;
- failure mapping;
- persona-dependent resubscription;
- query-argument identity;
- React StrictMode behavior.

An early version referenced a live handle from a connection callback before
the handle assignment was guaranteed. The final version keeps explicit latest
rows instead. This is the kind of temporal correctness React permits and tests
must catch.

#### Portability encouraged a lowest-common-denominator provider

The shared provider interface made the experiment fair, but discouraged
backend-native hooks. React×Convex and React×Supabase are therefore more
portable and less idiomatic than normal examples for those products.

## 11. Contract / Exact: detailed experience

### 11.1 What was pleasant

#### Snapback data wiring nearly disappeared

In Contract×Snapback, boot creates the generated Snapback Contract surface and
configures stable links. The `.contract` files declare query and mutation
bindings, while Exact owns query cells, subscription delivery, connection
state, action correlation, and disposal. There is no handwritten equivalent of
React's `useRows` hook.

#### Async UI states were structural

Every query region names loading, error, empty, and ready behavior. These states
were not optional afterthoughts. The authoring language forced them to exist.

#### The neutral provider seam worked beyond fixtures

`createProviderQueryHandle` and `createProviderMutation` were enough to mount
the same Contract product over Supabase, Convex, and SQLite. This demonstrated
that Contract's data seam is genuinely backend-neutral at runtime.

#### Static observability feedback was meaningful

The compiler warned that `createEvent` writes both `events` and `rsvps`, while
the feed binds only `events`. That is true: the feed observes the new event,
while the host seat becomes visible on the event screen. The warning did not
block the build, and it recorded a real cross-screen side effect.

### 11.2 What was difficult

#### Non-generating providers needed metadata and binding modules

The portable provider needed a Contract data manifest plus per-query and
per-mutation modules and `.contract-meta.ts` descriptors. Snapback generates
those. The other providers did not, so the matrix had to author a stable
registry and metadata layer by hand.

That is the central Contract finding: the authoring experience is excellent
when the backend generates the Contract boundary and merely adequate when the
application has to construct that boundary itself.

#### Boot-bound Snapback query scope shaped navigation

The Snapback multi-live surface binds one argument set per query name at boot.
The Contract event page therefore uses `?event=<id>` and reboots with
`eventDetails`, `guestList`, and `eventWall` scoped to that event. React and
Vanilla keep the selected event in local state.

The URL approach is deterministic and testable, but it is a product-shaping
constraint rather than an implementation detail.

#### Visual styling was verbose

Contract's inline node attributes expressed the intended hierarchy and palette,
but more advanced responsive and interactive polish was easier in CSS. The
Contract view source was 208 lines across two screens before helpers, boot, or
provider code.

#### Bundle size was materially larger

The Contract cells emitted roughly 388–719 KB of minified JavaScript versus
203–402 KB for React and 14–211 KB for Vanilla. This specific Exact package
version and build were not optimized for size, but the difference is large
enough to warrant follow-up.

## 12. Vanilla JavaScript: detailed experience

### 12.1 What was pleasant

#### The headless client was genuinely framework-neutral

Vanilla×Snapback imports the same `SnapbackClient` and generated refs as React.
It health-checks, provisions idempotently, establishes push live queries,
reports connection state, and runs mutations without React, Exact, or a
surface-specific protocol adapter. This is direct evidence that the shared
integration contract is usable outside the two favored UI systems.

#### The runtime footprint became much smaller

The gateway-backed cells emit about 13.5 KB raw / 4.9 KB compressed JavaScript.
Vanilla×Snapback emits about 211 KB raw / 54 KB compressed while retaining the
real push client. Sharing React's stylesheet kept the rendered visual product
constant and showed that responsive cards, hover treatments, typography, and
layout were CSS capabilities rather than React-only benefits.

#### Navigation and scope replacement were explicit

Feed/detail/persona state is a small object. Changing event arguments does not
reboot the surface. The lifecycle boundary is also legible: feed owns one
subscription, detail owns three, and `renew()` replaces the set. The browser
suite observes that exact 3→1 transition in all four cells.

#### Temporal failure cases were easy to isolate

The pure lifecycle suite can hold a subscription promise unresolved, advance
the view generation, deliver a stale callback, and then resolve the obsolete
handle. The callback is ignored and the handle is disposed. Doing this outside
a component runtime produced a small, deterministic proof of the race.

### 12.2 What was difficult

#### Framework-free was not code-free

The row added 522 local source lines: 349 for the DOM application, 100 for the
provider, and 73 for subscription lifecycle. It is the largest handwritten
frontend row in the matrix. JSX/state reconciliation, query regions, and
runtime event ownership disappeared, but their responsibilities did not.

#### Safe rendering became application code

Every dynamic string is HTML-escaped, CSS accent values are allowlisted, input
drafts are preserved across whole-root renders, button disabled state is
updated imperatively, and event listeners are rebound after every replacement.
React supplies escaping and declarative event ownership; Contract supplies a
structured view tree. Vanilla requires the author to review these boundaries.

#### Push did not eliminate lifecycle work

Snapback removes the poller from the Vanilla×Snapback cell, but the application
still owns argument identity, active handle sets, late promise resolution,
stale callback suppression, persona changes, navigation teardown, and page-hide
close. Contract×Snapback remains the only cell where the surface adapter owns
most of that plane.

#### Vite was still part of the product path

The row has no UI framework, but Vite still substitutes backend identity,
traverses the workspace module graph, bundles the Snapback client, and emits
four production targets. Direct unbundled browser ESM was not tested. The
correct claim is “framework-free browser JavaScript,” not “build-tool-free.”

### 12.3 Where the effort went

Vanilla moved effort **out of runtime dependencies and into application-owned
rendering and lifecycle semantics**. It is an excellent lower-bound packaging
instrument and a good proof of Snapback's framework neutrality. It was not the
most economical way to author this particular polished, stateful interface.

## 13. Cell-by-cell experience

### 13.1 React × Snapback

This was the richest React data path. Generated refs removed raw request-name
strings and push live queries removed polling. The tradeoff was handwritten
subscription lifecycle and a larger bundle. It is the strongest choice in the
matrix when bespoke web UI is more important than deleting React data plumbing.

### 13.2 Contract × Snapback

This was the cleanest overall data-authoring cell. Generated Contract artifacts
and the Snapback surface owned the most error-prone lifecycle work. Explicit
async states and compiler feedback improved UI honesty. The costs were
boot-bound navigation, more constrained styling, and the largest bundle.

### 13.3 React × Supabase

The React component experience was straightforward because the provider looked
like every other column. The actual Supabase-specific experience was thin:
server-side SQL, polling, and normalized JSON. It proved secure Postgres
integration, not the normal Supabase browser workflow.

### 13.4 Contract × Supabase

The Contract view worked unchanged, which is a meaningful portability result.
However, the application had to author Exact provider metadata on top of the
Supabase gateway. Without generated bindings, Contract added more integration
surface than React.

### 13.5 React × Convex

Deployment was strong; frontend integration was intentionally generic. The
cell worked and tested cleanly, but it did not experience Convex's native
subscription ergonomics. A follow-up using the Convex React client could
plausibly change the ranking.

### 13.6 Contract × Convex

This cell demonstrated runtime backend neutrality and also highlighted a
missing product opportunity: a Convex-to-Contract generator could delete the
handwritten manifest/binding layer just as Snapback codegen does.

### 13.7 React × SQLite

This was the quickest full local cell and the easiest to debug. It is the best
baseline for “can this product interaction work?” It is not the best baseline
for “can this become a hosted multi-user application without building a
backend platform?”

### 13.8 Contract × SQLite

Contract added structured async and action semantics to the simplest backend,
but SQLite generated none of the metadata Contract benefits from. The result
was robust and testable, yet less economical than React×SQLite for this scope.

### 13.9 Vanilla × Snapback

This is the strongest framework-neutrality proof in the matrix. Generated refs
and push work without a UI runtime, and the bundle is roughly half the size of
React×Snapback. The trade is 73 lines of explicit subscription scope plus
imperative view code that React or Contract would otherwise own.

### 13.10 Vanilla × Supabase

The browser bundle is tiny, but the Supabase qualification is unchanged: this
is a secure gateway to Postgres, not `supabase-js`, RLS, Auth, or Realtime. The
Vanilla surface adds essentially no backend-specific friction beyond the shared
provider.

### 13.11 Vanilla × Convex

This is another tiny portable cell over the controlled gateway. It verifies
that Convex function results need no framework runtime, while still omitting
Convex's native reactive browser client. It should not be compared with an
idiomatic Vanilla or React Convex subscription implementation yet.

### 13.12 Vanilla × SQLite

This is the smallest and most inspectable complete local cell. Its emitted
JavaScript is 13,535 bytes and its provider behavior is ordinary polling over
the Bun gateway. It is an excellent product-interaction baseline, with the same
hosting/auth/realtime ownership caveats as every SQLite cell.

## 14. Comparative scorecards

These scores summarize this build experience on a 1–5 scale. They are
judgment, not benchmarks. A score describes the implementation actually built,
including credential and adapter choices.

### 14.1 Backend experience

| Criterion | Snapback | Supabase | Convex | SQLite |
|---|---:|---:|---:|---:|
| Time-to-first-local-row | 3 | 3 | 3 | 5 |
| Invariant clarity | 4 | 5 | 4 | 4 |
| Generated client/Contract boundary | 5 | 1 in this build | 2 | 1 |
| Unattended hosted setup | 2 in this repo-local path | 3 | 5 | 1 |
| Build-time failure quality | 5 | 3 | 4 | 2 |
| Realtime exercised here | 5 | 1 | 1 | 1 |
| Local inspectability | 4 | 3 | 3 | 5 |
| Credential-free development | 5 local | 1 | 2 | 5 |

Important qualifications:

- Supabase's generated types, RLS, Auth, and Realtime were not exercised, so
  its generated-boundary and realtime scores describe this adapter only.
- Convex's native client subscriptions were not exercised.
- Snapback's score reflects an in-repository prepared runtime, not a clean
  external install.
- SQLite's hosted-setup score is low because hosting was not supplied, not
  because SQLite cannot be hosted inside an application server.

### 14.2 Authoring experience

| Criterion | React | Contract | Vanilla JS |
|---|---:|---:|---:|
| Bespoke web visual control | 5 | 3 | 4, fully manual |
| Snapback data plumbing | 3 | 5 | 3 |
| Generic-provider plumbing | 4 | 3 | 4 |
| Async-state completeness | 3 by convention | 5 structurally | 2, fully manual |
| Dynamic in-page navigation | 5 | 3 with boot-bound Snapback scopes | 5 |
| Static data-effect feedback | 2 | 5 | 1 |
| Bundle size in this build | 4 | 2 | 5 |
| Handwritten source economy | 5 | 4 | 3 |
| Familiarity/ecosystem | 5 | 2 | 4 for the platform, 1 for components |

## 15. Cross-cutting lessons

### 15.1 Generated integration is more important than backend syntax

The largest experiential difference was not SQL versus function handlers. It
was whether the backend generated the artifacts the frontend authoring system
needed. Snapback×Contract felt unusually cohesive because codegen crossed the
backend/frontend boundary. Contract over the other providers felt more manual
even when their backend code was shorter.

### 15.2 Controlled portability can hide native strengths

A common provider interface is excellent for attribution and dangerous for
product evaluation. It rewards the backend that best matches the shared seam
and suppresses backend-native capabilities. Any buying or architecture decision
should pair this controlled matrix with idiomatic implementations.

### 15.3 Credential failures are architecture events

The invalid Supabase publishable key did not merely delay setup. It moved
privileged access to a gateway, removed RLS/Auth/Realtime from scope, and changed
the deployment topology. Reports that omit credential friction omit real
engineering work.

### 15.4 Persistent remote tests need bounded ownership

Remote acceptance should not depend on destructive global reset and should not
leak rows forever. Dedicated principals, recognizable temporary records, and
guarded cleanup produced repeatable tests without broad delete authority.

### 15.5 Failure quality strongly affected velocity

The best failures named the violated contract and preserved state:

- Snapback codegen rejected ambient time and wrote no stale output.
- Convex deploy rejected missing typecheck configuration and named the fix.
- Snapback provenance rejected a stale executable.
- Contract warned about an unobservable cross-screen write.
- `ref-check` named invalid anchors.

The frustrating failures were identity/configuration mismatches that looked
plausible locally: publishable key 401 and Convex key/URL disagreement.

### 15.6 Runtime weight and authoring volume move independently

Vanilla is the smallest runtime row and the largest handwritten frontend row.
React is much larger on the wire and smaller in application source. Contract
is largest on the wire but smallest in author-owned Snapback lifecycle logic.
“Lightweight” is therefore meaningless unless it names runtime bytes, source
volume, lifecycle ownership, or build/deployment machinery.

### 15.7 Framework neutrality is a behavior, not an interface claim

The vanilla push cell is useful because it executes the real generated refs,
client, provisioning, subscription, mutation, and connection path. A TypeScript
interface saying “framework-neutral” would have been weaker evidence. The test
also exposed the boundary honestly: backend neutrality does not supply DOM
rendering or subscription scope ownership.

### 15.8 A diary and a report serve different purposes

The diary records chronological, concrete experience including false starts.
This report normalizes those observations into methodology, comparisons, and
recommendations. Keeping both prevents a polished conclusion from erasing the
actual build path.

## 16. Recommendations by use case

### Choose Contract × Snapback when

- the application is data-reactive;
- generated artifacts are valued more than ecosystem familiarity;
- explicit loading/error/empty states are desirable;
- URL/reboot scoping is acceptable for boot-bound query arguments;
- minimizing handwritten live-data lifecycle is a priority.

### Choose React × Snapback when

- bespoke web interaction and styling are primary;
- local state navigation should remain unconstrained;
- the team is comfortable owning subscription lifecycle correctly;
- generated backend refs and push queries are still valuable.

### Choose React × SQLite when

- the immediate goal is a local product spike;
- zero account/deploy friction matters most;
- one process and one local database are enough;
- the team accepts that auth, sync, hosting, and operational tooling remain
  future work.

### Choose Vanilla × Snapback when

- a small framework-free browser runtime matters;
- generated backend refs and true push are still required;
- the product UI is small enough that imperative DOM ownership stays bounded;
- the team is willing to own and test subscription scope explicitly.

### Choose Vanilla × SQLite when

- the goal is the smallest complete local interaction prototype;
- ordinary browser APIs and one Bun gateway are acceptable;
- component ecosystem, production auth, hosted topology, and push are not yet
  requirements.

### Re-evaluate React × Convex idiomatically when

- hosted deployment and native reactive queries are important;
- a fair Convex product decision is required;
- the shared gateway can be replaced with the native Convex client.

The current matrix likely understates this cell.

### Re-evaluate React × Supabase idiomatically when

- a working publishable key is available;
- RLS and Auth are part of the product question;
- Supabase Realtime and generated types can be included;
- the local privileged gateway can be removed.

The current matrix is not sufficient to judge the full Supabase developer
experience.

### Generate Contract bindings for non-Snapback providers when

- Contract is expected to be backend-neutral in practice, not only at runtime;
- provider manifests and per-binding metadata can be derived from Convex or
  Supabase schemas/functions;
- the goal is to reproduce the cohesive Snapback×Contract authoring loop.

## 17. Threats to validity

The report should not be read as a general backend benchmark for these reasons:

1. **One application shape.** Event discovery, RSVP, and wall posts do not
   exercise every data model.
2. **One builder and one repository context.** Familiarity and tool context
   affect experience.
3. **No production auth.** Auth and authorization often dominate real backend
   work.
4. **No native Supabase client path.** The publishable credential did not work.
5. **No native Convex subscription path.** The controlled gateway was retained.
6. **Polling parity is not realtime parity.** Only Snapback push was exercised.
7. **No performance benchmark.** Bundle sizes were measured; latency,
   throughput, fan-out, cold start, and cost were not.
8. **No clean-machine timing study.** Setup effort is qualitative.
9. **Specific package versions.** React 19, Vite 7/8, Exact 0.1.2, Bun 1.3.12,
   and the installed Convex version shaped results.
10. **Repo-local Snapback advantage.** Snapback's runtime and guide were already
    present in the workspace.
11. **Shared source by design.** The experiment measures provider integration,
    not the cost of maintaining twelve independent products.
12. **Smaller scope than Shindig.** Partitime omits Shindig's invite and
    resource-membership authorization model to keep the matrix controlled.
13. **Shared React/Vanilla CSS.** This deliberately isolates JavaScript
    authoring, but it does not measure the cost of independently styling a
    framework-free app.
14. **Bundled Vanilla path.** Vite remained in the loop; direct unbundled ESM
    compatibility was not tested.
15. **No startup milestone instrumentation.** Emitted bytes were measured, but
    parse, boot, first-data, and interactive timings were not.
16. **Browser-controller substitution.** The in-app browser plugin failed
    during setup, so rendered verification used the repository's established
    Chrome/CDP acceptance harness. The application proof is executable, but no
    separate in-app visual inspection was obtained.

## 18. Proposed follow-up experiment

A second phase should preserve the same fixture, normalized rows, test IDs, and
acceptance corpus while replacing only the external provider transports:

1. React×Supabase with a valid publishable key, `supabase-js`, generated types,
   RLS, and Realtime;
2. Contract×Supabase through generated Contract bindings over the same schema;
3. React×Convex with the native Convex client and subscriptions;
4. Contract×Convex through generated Contract bindings or a native reactive
   provider;
5. Vanilla×Snapback through direct browser ESM, or a precise recorded
   incompatibility and the smallest necessary wrapper;
6. a generated framework-neutral subscription scope, compared against the
   current 73 handwritten lines;
7. a real session-auth flow shared at the product-claim level;
8. cross-window mutation propagation for every cell;
9. clean-machine setup timing and first-change timing;
10. parse, first-data, interactive, bundle, latency, and request-count
    measurement.

That experiment would answer the question this controlled gateway version
cannot: how much provider-specific code returns when each backend is allowed to
show its native strengths, and whether generated Contract adapters can preserve
the current one-product comparison.

## 19. Final conclusion

Building all twelve cells changed the question from “which backend has the
shortest sample code?” to “where does each system place the work?”

- SQLite placed almost all work in the application, but made the first local
  implementation effortless.
- Supabase placed integrity in Postgres and operational friction at the
  credential/client boundary in this build.
- Convex placed work in hosted functions and deployment identity, with an
  excellent unattended deploy once configured correctly.
- Snapback placed work in declarations and codegen, then returned the broadest
  generated integration contract and the only push path exercised here.
- React placed work in lifecycle code and rewarded it with maximum visual and
  navigation flexibility.
- Contract placed work in explicit semantics and provider metadata, rewarding
  generated backends with a much smaller live-data burden.
- Vanilla placed work in imperative rendering and explicit subscription scope,
  rewarding it with dramatically smaller bundles and a clear lower-bound
  measurement of the browser client.

The most successful cell for coherent data authoring remains
**Contract×Snapback**. The best current balance for shipping this polished
consumer web product remains **React×Snapback**. **Vanilla×Snapback** is the
smallest proven push client, and **Vanilla×SQLite** is the smallest complete
local cell, though React×SQLite required less handwritten frontend source. The
most promising under-tested cell remains **React×Convex using Convex's native
client**, and the least fairly represented product remains **Supabase**, because
the publishable-key failure removed its normal browser, RLS, Auth, and Realtime
path from the experiment.

The durable outcome is not the ranking. It is the comparison harness: one
product contract, deterministic data, honest capability declarations, provider
conformance, and the same browser claims across every cell. That structure
makes the next comparison cheaper and more trustworthy than the first.

## 20. Apple-native extension

The follow-up held the Partitime fixture, operations, persona, provider
projection, and principal test IDs constant while adding sixteen native cells:

| Authoring | Platform | Snapback | Supabase | Convex | SQLite |
|---|---|---:|---:|---:|---:|
| SwiftUI | macOS | pass | pass | pass | pass |
| SwiftUI | iOS | pass | pass | pass | pass |
| Exact + Contract | macOS | pass | pass | pass | pass |
| Exact + Contract | iOS | pass | pass | pass | pass |

“Pass” has a deliberately specific meaning. Every SwiftUI cell passed the
in-app list/detail/RSVP acceptance path. All four iOS cells also passed the same
flow through XCUITest. The macOS app and UI-test targets built, but XCUITest
could not initialize UI automation on the remote machine because its test
runner lacked the required macOS automation permission; those cells are not
misreported as XCUITest passes. Every Exact + Contract cell passed a semantic
Acto flow with native hit reachability enabled for the event and RSVP taps.

Both rows are one-source implementations across macOS and iOS. They are not
eight provider forks. SwiftUI selects a backend from launch arguments and uses
one `URLSession` client. Exact selects a backend when Vite builds the native
bundle and uses one Contract data provider. The gateway normalizes all four
backends to the same `query` and `mutate` JSON envelope.

This topology made the authoring comparison controlled and made the backend
comparison intentionally shallow at the Apple edge. Supabase Realtime, Convex
subscriptions, and a hypothetical direct Snapback Swift client were not used.
Every native provider reports polling, and no native cell claims push.

## 21. SwiftUI versus Exact + Contract

### 21.1 SwiftUI experience

SwiftUI was the most direct route to an ordinary Apple application. A shared
model, `ObservableObject` store, `URLSession` client, and conditional app
delegate produced normal macOS and iOS targets. Platform adaptation, launch
arguments, accessibility identifiers, app lifecycle, and XCUITest all used
Apple's standard tools. There was no carrier revision to align with the app.

The cost was ownership. The Swift code explicitly owns polling, task
cancellation, loading/error state, navigation, data refresh after mutations,
JSON decoding, and accessibility annotations. The four application source
files total 822 lines before the 35-line XCUITest. That count is not a claim
that SwiftUI intrinsically needs more code—the Swift row includes its own
models, styling, and an in-process acceptance path—but it accurately describes
where this implementation placed the work.

The shared-source result was credible, not free. macOS needed activation and
window behavior; iOS needed simulator launch plumbing. Responsive composition
still had to be authored. SwiftUI's strongest advantage was that these were
well-known platform problems with first-party diagnostics and no translation
layer between the view code and Apple's accessibility tree.

### 21.2 Exact + Contract experience

Contract made application semantics unusually compact. One 204-line route
describes feed, detail, create, RSVP, guest list, wall, actions, async states,
and stable test IDs. The same route rendered on the Exact macOS AppKit/Hermes
host and iOS UIKit/Hermes host. Its query and mutation declarations made the
dataflow easier to audit than the Swift store's imperative refresh sequence.

That economy did not eliminate integration code. Because the four native cells
used the language-neutral gateway instead of generated Snapback surface links,
the app needed a 190-line polling provider, seven binding modules, seven
metadata files, and an explicit manifest. Contract's biggest web advantage—its
generated Snapback data plane—was therefore mostly controlled out of this
native experiment.

Exact also imposed a second compatibility surface: application bundle and
native carrier. A previously running host could connect to the new dev server
and appear live while retaining an older bundle. A clean, revision-aligned
carrier build took more than four minutes; the app's production Vite build took
roughly 9–14 seconds. The produced native startup asset was about 2.25 MB and
the main web asset about 1.30 MB minified. In observed debug launches, Hermes
evaluation dominated startup at roughly seven seconds.

The official scaffold exposed several rough edges during a clean build:

- its `@exact/guide` npm development dependency was unavailable, so the local
  Exact Guide had to be linked explicitly;
- the Exact Vite plugin required `src/console/index.html`, but the scaffold did
  not create it, producing an iOS JavaScript-console error overlay;
- direct Contract checking crashed while mounting the async query surface even
  though the production compiler and runtime accepted it;
- the iOS carrier requested a missing AppIcon unless the build setting was
  overridden;
- the carrier source referenced a macOS-only `nativeHostIdentity` value from
  its iOS compile path. A task-local Exact worktree patch was required to build
  the iOS host; that patch is evidence, not a Snapback repository change.

These are Exact scaffold/carrier/toolchain weaknesses, not all Acto
weaknesses. Acto frequently made the failures easier to identify.

### 21.3 What the comparison actually says

SwiftUI won carrier simplicity, native tool familiarity, and independence from
a framework revision. Exact + Contract won semantic density, explicit async
structure, and inspectable action/dataflow semantics. The trade was not
“declarative versus imperative”—both are declarative at the view layer. It was
first-party native ownership versus a cross-platform semantic runtime with a
larger carrier and compatibility envelope.

For a Mac/iOS-only product whose team already knows Swift, SwiftUI was the
lower-risk path in this experiment. Exact + Contract becomes more compelling
when the same semantic UI must span additional hosts, when Acto's structured
automation matters, or when generated provider bindings replace the manual
gateway adapter. Without those additional returns, the carrier cost was too
visible.

## 22. What this taught us about Acto

### 22.1 Where Acto was strong

Acto provided something ordinary snapshot or DOM-style automation did not: it
combined a stable semantic tree with native hit-reachability evidence and an
action receipt. A tap could therefore be distinguished into three separate
claims: the semantic action dispatched, the target was physically reachable
through the native host, and the expected application state later appeared.

That distinction caught the most important iOS verification defect. The
`open-event_swim` action returned `dispatched: true`, but native reachability
returned `false` because a JavaScript Console overlay occupied higher host
chrome. A semantic-only test would have passed while a user could not perform
the action. After the console dependency was fixed and the overlay state was
removed, the same assertion passed.

Acto was also substantially more usable than macOS XCUITest on the remote host.
The latter failed before application interaction while enabling automation
mode; Acto exercised the full macOS flow without requiring that TCC-granted
test-runner path. Stable test IDs, dense semantic snapshots, event-sourced
waits, action/mutation receipts, and the `app-content` versus `host-chrome`
classification made failures specific rather than visual guesses.

### 22.2 Where Acto was weak and how to improve it

| Weakness observed | Consequence in this build | Improvement that would change the experience |
|---|---|---|
| Exact-only automation surface | SwiftUI needed XCUITest plus an in-app harness, so there was no single oracle across authoring rows | Define a small cross-runtime Acto agent protocol and ship a SwiftUI adapter over accessibility identifiers, navigation, waits, screenshots, and correlation IDs |
| Fast rerenders invalidate snapshot refs | A ref from a one-second polling snapshot failed with `STALE_REF`; retrying by stable `testId` worked | Make element handles re-resolve by stable view ID/test ID within a bounded lease, or expose a first-class locator object rather than a snapshot-bound ref |
| `observeAfter: settled` did not mean data-ready | Navigation settled while the detail query still showed loading; the test needed a separate `wait viewExists rsvp-going` | Let waits name query state, action completion, and render causality; distinguish animation-idle, render-idle, and dataflow-converged |
| A reachable agent could run stale bundle code | After a provider server restart, both hosts reconnected with `loadBundle=false`; targets were live but still labeled `sqlite` | Include app bundle hash, provider/build identity, carrier revision, and dev-server epoch in target discovery; reject or force reload on mismatch |
| Stale targets and orphaned host agents lingered | Discovery accumulated dead targets, fixed ports conflicted, and a new host fell back to an ephemeral agent port | Give targets explicit session leases, eager dead-target eviction, a `stop target` operation, and live-agent-first deterministic selection |
| UI receipts stopped at the provider boundary | Acto proved `respond("going")` dispatched and the UI converged, but not which gateway/backend request caused it | Propagate one correlation ID through Contract action → provider mutation → HTTP gateway → backend mutation → poll/query refresh → committed render |
| Host chrome was diagnosable but not actionable | Acto reported `WKChildScrollView`/`host-chrome`, yet the available touch-sequence path could not target or dismiss the higher JavaScript Console overlay | Put all visible host chrome in an automation tree with stable IDs and supported actions, including “Close JavaScript console” |
| Agent launch requirements were too implicit | A native host can run normally but never register when agent boot/token/port settings are missing | Make the normal Exact run command print and persist the full automation launch envelope; add a preflight that proves relay registration before tests start |
| Compatibility was discovered after launch | An older carrier registered but could not evaluate the aligned app correctly | Add a carrier/runtime/app compatibility handshake with explicit revisions and a fail-fast remediation or cached matching host artifact |

The central improvement is a causal session model. Acto already knows a great
deal about the semantic view tree and native hit path. It would become much
more trustworthy if every test attached to a declared tuple such as:

`carrier revision + app bundle hash + provider mode + backend correlation + target lease`.

That turns “the target is live” into “the intended application revision is
live, physically actionable, and causally connected to the mutation whose
result this wait observed.” The matrix repeatedly needed that stronger claim.

### 22.3 What should not be blamed on Acto

The missing console asset, unavailable scaffold dependency, iOS AppIcon build
setting, unguarded iOS carrier symbol, long cold carrier build, and Contract
check crash are adjacent Exact problems. Acto did not cause them. Conversely,
Acto deserves credit for making the console occlusion and host/runtime skew
visible. Improving the surrounding scaffold and carrier would still make Acto
feel dramatically better because users experience the system as one loop.

## 23. Backend lessons from the native matrix

Once the JSON gateway existed, the four native provider cells were nearly
identical at the UI layer. That was useful evidence: authoring-system
differences dominated provider differences because the experiment intentionally
standardized transport, freshness, error shape, and identity.

It also limited what could be learned about the providers:

- **SQLite** remained the easiest operational cell and the clearest local
  debugging baseline.
- **Supabase** reused the secure server-side Postgres path. The native work
  added no new evidence about its publishable client, RLS, Auth, or Realtime.
- **Convex** reused deployed functions through the gateway. The native work
  added no evidence about an idiomatic Swift client or subscriptions.
- **Snapback** needed a new 64-line gateway adapter around its generated client
  because no Swift client path was available. This preserved generated query
  and mutation identity on the server, but gave up push at the native edge.

The strongest backend lesson is therefore about product surface area. A great
browser integration is not automatically a native integration. If Snapback
wants first-class Apple adoption, it needs either a real Swift client or an
officially generated, well-instrumented gateway/client pair with auth,
correlation, cancellation, retries, and declared polling semantics. The
handwritten adapter was workable, but it moved Snapback closer to the same
lowest-common-denominator shape as the other providers.

## 24. 2026-07-19 native verification record and limits

- SwiftUI direct Swift compilation/typechecking: macOS and iOS pass.
- SwiftUI remote Xcode target builds: macOS and iOS pass with Xcode 26.3.
- SwiftUI in-app acceptance: 8/8 cells pass.
- SwiftUI iOS XCUITest: 4/4 provider cells pass.
- SwiftUI macOS XCUITest: target built; execution blocked by remote UI
  automation permission before app interaction.
- Exact + Contract production build: pass, 408 transformed modules.
- Exact carrier builds (historical run): macOS pass; iOS pass after a task-local Exact source
  fix and AppIcon setting override.
- Exact + Contract Acto acceptance with native reachability: 8/8 cells pass.
- Gateway real-provider probes: Snapback, Supabase, Convex, and SQLite pass.

Both native RSVP oracles first read the current Ada status, choose a different
status, perform the mutation, and require the new status. This matters because
the canonical `event_swim` fixture seeds Ada as `going`; a fixed “tap Going,
then find Going” assertion would only prove seeded rendering.

This was a simulator/remote-Mac development experiment, not a release archive,
signed-device, App Store, energy, memory, cold-start, offline, or adverse-network
study. The provider data plane was controlled through one local gateway. The
results support conclusions about authoring and tooling behavior; they do not
rank native SDKs that were not exercised.

## 25. Native conclusion

The native extension was worth doing because it changed several web-derived
assumptions. Contract's semantic density carried over well, but its native
advantage depends on a healthy carrier/tooling loop. SwiftUI required more
explicit state and transport code, yet the path from source to platform was
shorter and easier to trust. Provider choice mattered less than transport
normalization, while the absence of a direct Snapback Apple client became much
more visible.

Acto was one of the strongest parts of Exact when the app and carrier were
aligned. It found a real user-blocking overlay that semantic dispatch alone
would have missed, and it gave macOS automation proof where XCUITest could not
start. Its next leap is not more snapshot syntax. It is stronger session,
revision, host-chrome, and end-to-end causal identity—and a protocol that can
reach non-Exact native apps so comparative testing does not need two different
oracles.
