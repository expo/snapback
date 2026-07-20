# 0016 — Partitime: web 3×4 plus Apple-native 2×2×4

- **Demo:** `demos/partiful-matrix/`
- **Comparative report:** [`demos/partiful-matrix/REPORT.md`](../demos/partiful-matrix/REPORT.md)
- **Matrix:** web React, Contract, and Vanilla JS × four providers; native SwiftUI and Exact + Contract × macOS and iOS × four providers
- **Author:** Codex, with ccheever
- **Date:** 2026-07-19

## 2026-07-19 — one product, eight cells

Goal: build another Partiful-shaped app, but make it a controlled authoring
experiment instead of eight unrelated implementations. Every cell gets the
same deterministic three-event fixture and the same operation names:
`listEvents`, `eventDetails`, `guestList`, `eventWall`, `createEvent`, `rsvp`,
and `postMessage`. The React row shares one component tree and the Contract row
shares two `.contract` screens; each row is production-built four times with a
compile-time backend identity. Provider conformance passes 13/13 and the browser
matrix passes 24/24.

This is deliberately a smaller product than Shindig (Diary 0015). It has public
event discovery, event creation, RSVP, guest list, and wall posts, but no
invite/membership authorization model. Personas are trusted local demo
identities. That keeps the experiment about authoring and data providers rather
than making four incompatible auth systems the dominant variable.

### The shape of the comparison

| Cell | Data path | Freshness in this demo | Build result |
|---|---|---|---|
| React × Snapback | generated refs → `SnapbackClient` | push stream | pass |
| Contract × Snapback | generated Contract surface links | push stream | pass |
| React × Supabase | portable browser client → local Bun gateway → Postgres | 1s poll | pass |
| Contract × Supabase | Exact provider handle → same gateway → Postgres | 1s poll | pass |
| React × Convex | portable browser client → gateway → Convex HTTP API | 1s poll | pass |
| Contract × Convex | Exact provider handle → same gateway → Convex HTTP API | 1s poll | pass |
| React × SQLite | portable browser client → gateway → `bun:sqlite` | 1s poll | pass |
| Contract × SQLite | Exact provider handle → gateway → `bun:sqlite` | 1s poll | pass |

Only the Snapback column claims push/live behavior. Supabase and Convex both
have native realtime stories, but this experiment did not exercise them; the
UI says `polling · 1s` and the manifest repeats the limitation. Treat this as a
comparison of the adapters actually built, not a verdict that those services
are polling systems.

## Snapback experience

### What felt good

- **The generated path made the strongest cell the least ambiguous.** Four
  live queries and three mutations produced typed refs, the Contract data
  manifest, per-binding Contract modules, runtime links, and capability facts.
  React consumes the refs directly; Contract consumes a real
  `createSnapbackContractSurface`. No handwritten request schema or row
  normalization exists in that column.
- **The guide's boot rule held up.** Both surfaces have exactly one
  `ensureApp({ schema, functions, seed })`; neither exposes reset. Browser
  reloads and React↔Contract mutations remain visible. This mattered in the
  24-check matrix because every cell is revisited under a fresh page.
- **Push was materially less adapter code.** Once the query declarations were
  `.sync()`/live, the Snapback client delivered changes and connection state.
  The other columns needed a polling loop, fingerprint/previous-value state,
  error recovery, and a gateway lifecycle.
- **Fails-closed codegen gave one crisp correction.** My first handler used
  `Date.now()` for a post timestamp. Codegen refused the entire bundle with
  `BUNDLE_UNSUPPORTED_TIME` and wrote no stale artifacts. Passing `createdAt`
  as an explicit mutation arg made time a visible dependency and codegen went
  green on the next run.
- **The acceptance infrastructure caught a stale binary instead of lying.**
  The first headless run refused an older `target/debug/snapback` by commit
  identity. Running `scripts/bootstrap-ibex-runtime` rebuilt and launch-smoked
  the correct binary; the same test then passed 13/13. That was a useful failure,
  not ceremony.

### What felt bad or surprising

- **There is still a real source-volume tax before generation.** The Snapback
  backend is about 168 handwritten lines across schema/functions/handlers,
  compared with roughly 77 for the SQLite adapter. Much of the difference is
  explicit validators, live-query declarations, and read/write sets. Those
  facts pay for codegen and diagnostics, but the smallest local app is not the
  shortest in Snapback.
- **Time must be injected into bundled handlers.** The diagnostic was good
  enough that this did not become a guide gap, but it changes API shape:
  `postMessage` carries `createdAt` in all four providers so the shared contract
  stays honest. A server-clock primitive would be more tamper-resistant for a
  production wall.
- **The repository server helper defaults to `cargo run`.** Under concurrent
  work it waited on the Cargo build lock. The matrix acceptance deliberately
  launches the already-proven binary with a ready-file instead. This is test
  harness topology rather than an app-authoring problem, but it is observable
  friction in a busy checkout.

## Supabase experience

### What felt good

- **The relational model was direct.** Three `CREATE TABLE IF NOT EXISTS`
  statements, two unique/foreign-key constraints, and ordinary
  `INSERT … ON CONFLICT` were enough. The event/person RSVP invariant is a
  database constraint, not a read-before-write convention. Seeding is naturally
  idempotent.
- **Bun's Postgres client kept the secure fallback small.** Once connected,
  query and mutation code was familiar and the 13/13 provider suite proved the
  normalized shapes against the other backends.

### What felt bad or surprising

- **The publishable key never authenticated.** It returned HTTP 401 before and
  after the key was added. The direct Postgres URL and server secret did work.
  I chose the safe fallback: the browser only calls a local gateway; database
  URLs and privileged keys stay server-side. This means the cell tests real
  Supabase Postgres but not `supabase-js`, RLS, or Realtime. The limitation is
  printed in README/manifest rather than blurred into “Supabase support.”
- **That fallback moved a lot of value out of Supabase.** The adapter is about
  78 lines plus the shared gateway. Native auth, RLS policy ergonomics, generated
  types, and realtime channels—the interesting Supabase-specific parts—are not
  represented. Credential readiness changed the experiment's attainable
  scope even though it did not block completion.
- **Persistent remote fixtures require discipline.** Unlike the memory
  Snapback and temporary SQLite acceptance databases, the Supabase rows remain.
  The suite only performs an idempotent RSVP for `user_matrix_acceptance`; it
  does not spray created events or wall posts on every run.

## Convex experience

### What felt good

- **The deploy key enabled a genuinely unattended setup.** `npx convex deploy`
  typechecked, regenerated `_generated`, pushed schema/functions/indexes, and
  ran without interactive login. The idempotent `seed` mutation then populated
  the same fixture. This is a strong “go to lunch” workflow.
- **Queries and mutations were concise.** The Convex implementation is about
  79 lines across schema and functions. Index builders make the event and
  event/person access patterns obvious, and function errors travel through the
  HTTP API cleanly.
- **Deployment diagnostics were legible.** A missing `convex/tsconfig.json`
  made the first `--typecheck enable` deployment exit nonzero with the exact
  remediation. Adding the normal Convex tsconfig produced a clean deploy.

### What felt bad or surprising

- **The supplied `CONVEX_URL` was not the deploy-key deployment.** It was an
  HTTP-actions `.convex.site` origin associated with another target, while the
  deploy key selected a named development deployment. Deriving the public
  `.convex.cloud` origin from the deployment-scoped key fixed both seeding and
  runtime queries. A key+URL pair that silently names different deployments is
  an easy configuration trap.
- **Public IDs required a parallel identity field.** Convex `_id` values are
  deployment-generated; the cross-backend fixture needs stable
  `event_sunset`-style IDs. Every table therefore has `publicId` plus an index
  and normalizes it back to `_id`. Snapback and SQLite could use those IDs
  directly.
- **The best Convex client feature is absent here.** The gateway uses the HTTP
  query/mutation API and polls. A Convex-native React client would subscribe
  automatically and likely make React×Convex extremely pleasant. Keeping the
  portable data path controlled was useful scientifically, but it understates
  Convex's normal frontend ergonomics.

## Plain SQLite experience

### What felt good

- **It was the fastest backend to make concrete.** `bun:sqlite` needed no
  package, account, deployment, network, or credential parser. Schema creation,
  deterministic seed, query normalization, and mutations fit in about 77 lines.
  The provider passed first in both the headless and browser suites.
- **Local debugging was transparent.** A single ignored database file and four
  `SELECT`s made state inspection obvious. WAL mode and a unique event/person
  constraint were enough for this demo.

### What felt bad

- **Everything above storage is ours.** The gateway, browser poller, connection
  state, CORS, lifecycle, and eventual hosted topology are all application
  work. “Just SQLite” wins the first hour and loses more ground with every
  production requirement.
- **There is no generated contract.** The normalized TypeScript shapes and
  mutation names are conventions backed by the 13/13 conformance suite. Changing
  a column requires coordinated edits; nothing analogous to Snapback codegen
  fails closed before runtime.

## React experience

### What felt good

- **A provider interface made four builds cheap.** One 100-line provider module
  owns Snapback push and portable gateway polling; the 185-line component tree
  never branches on backend. Vite `--mode` produces four distinct bundles and
  dead-code elimination made the non-Snapback bundles roughly half the
  Snapback bundle size in this local setup.
- **Dynamic event selection stayed component state.** Feed → event detail is an
  immediate state transition. The provider hook tears down and rebinds the four
  selected-event queries as expected.
- **CSS is still React/web's unfair advantage.** The 41-line compressed style
  sheet delivered the more expressive responsive surface: sticky translucent
  nav, overlapping personas, irregular event art, hover motion, and mobile
  breakpoints. Achieving the same feel in Contract inline attributes took more
  view code and still had fewer effects.

### What felt bad

- **Subscription lifecycle remains hand-owned.** React needs disposal for
  late-resolving handles, dependency keys, connection state, polling timers,
  request failures, and StrictMode behavior. One early implementation even
  referenced the live handle from a connection callback before assignment;
  typecheck did not catch the temporal hazard, so I rewrote it around explicit
  `latestRows` state.
- **The common interface tends toward the lowest common denominator.** It made
  the comparison clean, but it also made Supabase/Convex polling providers look
  more alike than their idiomatic SDKs would.

## Contract / Exact experience

### What felt good

- **The Snapback cell is the cleanest data plane in the matrix.** The view uses
  ordinary query/mutation symbols while boot configures the generated surface
  once. Exact owns query cells, connection delivery, action correlation, and
  disposal. There is no Contract equivalent of React's `useRows` hook.
- **One `.contract` source served four provider implementations.** A small
  stable link registry lets the Snapback cell delegate to generated links and
  the other cells delegate to `createProviderQueryHandle` /
  `createProviderMutation`. This is the neutral provider seam working for a
  real non-Snapback matrix, not only a fixture.
- **The compiler forced complete async states and surfaced observability.** All
  query regions spell loading/error/empty/ready. It also warned that
  `createEvent` writes `rsvps` while the feed only binds `events`; that is true:
  the host seat is written atomically but becomes visible only after navigating
  to detail. The warning documents a real cross-screen effect.
- **Browser parity held.** The Contract cells passed the same boot/feed/detail/
  RSVP assertions as React, 12/12 for their row.

### What felt bad or surprising

- **Portable providers need substantial metadata.** The generic Contract
  provider is about 80 lines, then each stable binding needs a module and a
  `.contract-meta.ts` descriptor. Snapback generates all of that; Supabase,
  Convex, and SQLite do not. For this matrix the Contract row is not smaller
  overall than React once provider/meta glue is counted.
- **Static liveness facts cannot vary by Vite mode in one source module.** The
  stable bindings describe a live-capable query so the Snapback cell can expose
  its connection, while the generic runtime manifests honestly downgrade to
  poll. The runtime axis is correct, but a generated per-backend binding set
  would make the static story sharper.
- **Boot-bound Snapback scopes still require navigation.** Contract event
  selection writes `?event=` and reboots so `eventDetails`, `guestList`, and
  `eventWall` are configured with fixed args. React changes local state. This
  is the same product-shaping constraint Diary 0015 found.
- **View styling is explicit and verbose.** The Contract view source is 208
  lines across two screens versus React's 185-line component tree plus 41-line
  stylesheet. Contract wins on reactive/data plumbing in the Snapback cell,
  not on raw visual source volume here.

## Comparison distilled

- **Fastest local backend:** SQLite. No contest for time-to-first-row.
- **Strongest generated contract and live path:** Snapback. It asks for more
  up-front declarations and then deletes the most cross-layer ambiguity.
- **Most familiar invariant/storage modeling:** Supabase/Postgres, but the
  credential fallback prevented a fair test of its frontend product.
- **Best unattended hosted function deploy:** Convex. The deploy key workflow
  was excellent after the deployment-origin mismatch was understood.
- **Fastest route to bespoke visual polish:** React.
- **Best Snapback data authoring experience:** Contract. Generated links and
  async regions remove lifecycle code that React must own.
- **Best portable-provider experience in this exact experiment:** React by a
  small margin, because Contract's neutral seam currently requires handwritten
  manifests and binding metadata when a backend does not generate them.

The strongest architectural lesson is that “2×4” should not mean eight copied
apps. A shared fixture plus provider conformance made differences attributable;
the 24-check browser suite then proved each cell was real. The weakest part of
the experiment is equally clear: putting three columns behind one gateway made
transport comparison controlled but non-idiomatic. A follow-up matrix should
use native Supabase Realtime and native Convex subscriptions while preserving
the same product contract, then record how much backend-specific React and
Contract glue returns.

### Verification record

- Snapback codegen: pass, deterministic generated artifacts committed.
- React TypeScript: pass.
- Production builds: 4/4 React, 4/4 Contract.
- Provider conformance: 13/13, including create → host seat → wall post on every backend with scoped cleanup of temporary remote rows.
- Browser matrix: 24/24.
- Convex deployment and idempotent seed: pass.
- Supabase isolated schema/seed through direct Postgres: pass.

No Snapback guide gap was filed. The one Snapback-specific authoring failure
(`Date.now()` in a bundled handler) produced an immediate, stable, actionable
diagnostic and no stale output; the guide did not need to rescue the build.

## 2026-07-19 — Vanilla JavaScript makes it 3×4

The follow-up added one framework-free browser surface and built it four times,
against the same Snapback, Supabase, Convex, and SQLite implementations. The
product fixture, personas, operation names, query arguments, mutations, visual
stylesheet, and browser test IDs remained fixed. This broadened LLP 0063's
proposed focused Vanilla×Snapback control to the user's explicit four-backend
request; it did not add another backend model or copy the app four times.

### What was built

- one 349-line imperative DOM application in `surfaces/vanilla/src/main.js`;
- one 100-line provider module selecting Snapback push or the shared gateway;
- one 73-line `SubscriptionScope` owning generation changes, handle disposal,
  late handle resolution, and stale-observer suppression;
- four Vite production outputs selected at compile time;
- a three-check pure lifecycle suite;
- a fourth browser claim for every vanilla cell proving that detail's three
  subscriptions are disposed and replaced by feed's one subscription.

The vanilla row imports React's existing stylesheet rather than recreating it.
That made the rendered product deliberately comparable and exposed an important
fact: the polished CSS was a web-platform asset, not a React capability.

### What felt good

- **The headless Snapback client really was framework-neutral.** The same
  generated API refs, artifact identity, `ensureApp`, `liveQuery`, mutation,
  and connection axis worked from ordinary browser JavaScript. No React or
  Exact runtime was needed.
- **The gateway-backed bundles became tiny.** Supabase emitted 13,539 bytes,
  and Convex/SQLite emitted 13,535 bytes of minified JavaScript; each compressed
  to about 4.9 KB. The shared CSS was 8,089 bytes raw / 2,574 bytes compressed.
- **Snapback's client cost became visible.** Vanilla×Snapback emitted 211,357
  bytes raw / 54,039 bytes compressed. That is much smaller than React×Snapback
  because the framework runtime disappeared, while still including the real
  Snapback client and push adapter.
- **Imperative navigation was direct.** Feed/detail/persona changes were plain
  state changes followed by a render. Unlike Contract, changing event arguments
  did not require a surface reboot or URL-bound query scope.
- **Lifecycle ownership could be made explicit and testable.** `renew()`
  defines a sharp boundary: feed owns one subscription, detail owns three, and
  every boundary change disposes the old set. A generation token rejects late
  callbacks and disposes handles that resolve after navigation.
- **All provider code stayed shared.** The four cells differ only by the Vite
  mode constant, just like the React row. Supabase, Convex, and SQLite preserve
  the same polling label and security topology as before.

### What felt bad or surprising

- **Removing the framework did not remove application code.** The vanilla row
  has 522 handwritten application/provider/lifecycle lines before its 33-line
  Vite config, versus React's previously counted 349 including CSS and
  Contract's 435. Template strings, escaping, input preservation, DOM event
  rebinding, and busy/error transitions replaced framework machinery.
- **Safe HTML rendering became application work.** Every dynamic value needed
  escaping, accent classes needed allowlisting, and form values had to survive
  whole-view rerenders. React handled the escaping part automatically.
- **Event listeners are rebuilt after every render.** The implementation makes
  this bounded by replacing `#root`, but the author must reason about it.
  React's declarative event ownership was easier to review.
- **Data lifecycle remained hand-owned.** Snapback removed polling, not
  subscription disposal, stale update fencing, argument identity, or page-hide
  cleanup. Contract×Snapback still owns more of this data plane for the author.
- **The row is framework-free, not tool-free.** Vite transformed 18 modules,
  selected the backend, traversed the workspace ESM graph, and produced the
  measured bundles. Direct unbundled `<script type="module">` delivery was not
  tested, so this build does not claim that the current Snapback client graph
  can be served raw without a compatibility or bundling step.
- **The in-app browser controller could not connect.** Its plugin failed during
  setup before opening a tab. The repository's existing Chrome/CDP acceptance
  harness provided the rendered proof instead. This was verification-tool
  friction, not application behavior.

### Quantitative result

| Cell | Minified JS | Deterministic gzip |
|---|---:|---:|
| Vanilla × Snapback | 211,357 bytes | 54,039 bytes |
| Vanilla × Supabase | 13,539 bytes | 4,897 bytes |
| Vanilla × Convex | 13,535 bytes | 4,896 bytes |
| Vanilla × SQLite | 13,535 bytes | 4,896 bytes |

`gzip -cn` produced the compressed counts so filenames and timestamps do not
affect them. These are production-asset sizes, not network performance or
startup-time measurements.

### Updated comparison

- **Smallest runtime row:** Vanilla JS, by a wide margin.
- **Least handwritten frontend code:** React in this experiment, because JSX,
  state, event ownership, and HTML escaping replaced more code than the React
  runtime added to source.
- **Most explicit lifecycle implementation:** Vanilla JS. The costs are visible
  and independently testable rather than implicit in hooks.
- **Best framework-free data path:** Vanilla×Snapback. It exercises generated
  refs and push without a UI runtime, but still owns the subscription scope.
- **Best framework-free prototype path:** Vanilla×SQLite. Its emitted JS is
  tiny and its data behavior is easy to inspect, while the gateway still means
  it is not a no-backend static site.
- **Best coherent Snapback data-authoring path:** Contract×Snapback remains the
  winner because generated bindings remove more handwritten data lifecycle.
- **Best balance of visual authoring and source economy:** React remains the
  practical choice for this polished consumer UI despite its larger bundles.

### Verification record for the extension

- Vanilla production builds: 4/4.
- Vanilla browser row: 16/16.
- Full browser matrix: 40/40 across twelve cells.
- Vanilla lifecycle suite: 3/3, including late resolution and stale delivery.
- Existing provider conformance remains the backend proof: 13/13.

No guide-gap issue was filed. The guide correctly presents the headless client
as framework-neutral and does not claim a vanilla projection or unbundled ESM
recipe today. The absent paved path is product evidence for LLP 0063 Workstream
2 rather than guide prose contradicting a shipped capability.

## 2026-07-19 — SwiftUI versus Exact + Contract on macOS and iOS

The native follow-up added a second matrix: two authoring systems, two Apple
platforms, and the same four providers. I kept one source tree per authoring
system. SwiftUI switches provider at launch; Exact + Contract switches provider
when the native Vite bundle is built. Both use the same JSON gateway and say
`polling` in the UI. Native Snapback therefore does not inherit the browser
cell's push claim.

### What was built

- one shared SwiftUI app with macOS and iOS application and UI-test targets;
- one shared Contract route rendered by the Exact macOS and iOS hosts;
- a language-neutral `query`/`mutate` gateway path for Snapback, joining the
  existing Supabase, Convex, and SQLite adapters;
- internal Swift acceptance for both platforms;
- iOS XCUITest using the same event and RSVP claims for all four providers;
- an Acto acceptance script using semantic test IDs plus native hit
  reachability for both Exact hosts and all four providers.

### SwiftUI experience

SwiftUI felt unsurprising in a good way. `URLSession`, `ObservableObject`,
`Task`, accessibility identifiers, Xcode schemes, and XCUITest were the normal
Apple pieces. The same source compiled for macOS and iOS. When something failed,
there was no separate runtime/carrier revision to suspect.

The app also made every owned mechanism visible. I wrote the polling loop,
cancelled it, decoded JSON, refreshed after mutations, mapped navigation state,
handled loading/error states, and added the accessibility surface. The four
application source files reached 822 lines. Some of that is styling and the
in-app acceptance path, so it is not a clean language benchmark, but it felt
like ordinary application code rather than generated plumbing.

The remote Xcode host built both targets. Internal acceptance passed all eight
platform/provider cells. iOS XCUITest passed all four providers. macOS XCUITest
never reached the app because the remote runner timed out enabling UI
automation mode. I kept that as an infrastructure failure, not a green UI cell;
the macOS app build and internal acceptance were independently green.

### Exact + Contract experience

The good part was the Contract route itself. In 204 lines it expressed feed,
detail, creation, RSVP, guests, wall, async states, actions, and test IDs. One
route rendered on both hosts. Reading it felt closer to reading the product
than reading the Swift store and view implementation together.

The provider seam cost more than hoped because this was not the generated
Snapback surface path. The controlled gateway needed a 190-line Contract data
provider plus binding modules and metadata for seven operations. Once written,
it did make the four provider switches boring, which is exactly what the matrix
needed.

The carrier loop was the hard part:

- the official Exact scaffold depended on an unavailable `@exact/guide` npm
  package, so I replaced that with the local Guide link;
- the scaffold omitted console files that the Vite plugin assumed existed;
  iOS auto-opened a JavaScript Console with the resulting Vite error;
- direct Contract checking crashed on the async query surface even though the
  production compiler and runtime worked;
- the first remote host was revision-skewed from the app and could register
  while failing evaluation;
- a clean aligned macOS host build took more than four minutes, while app
  production builds were roughly 9–14 seconds;
- the iOS host requested a missing AppIcon and had an unguarded reference to a
  macOS-only `nativeHostIdentity` property. I used a task-local Exact worktree
  patch and an AppIcon build-setting override; neither is a Snapback change.

The debug bundle was also heavy: about 2.25 MB for the native startup asset and
1.30 MB for the main web asset, with roughly seven seconds observed in Hermes
evaluation. That made hot application authoring and cold carrier preparation
feel like two very different loops.

### Acto experience

Acto was better than I expected at proving Exact UI behavior. The dense tree
was readable, test IDs were stable locators, and taps returned both semantic
dispatch and native reachability. The RSVP receipt plus a later wait for
`my-rsvp-going` made the intended state transition explicit. All eight Exact
cells eventually passed this path.

The best finding was a failure. On iOS, tapping `open-event_swim` returned
`dispatched: true` while native reachability returned `false`; the hit view was
host chrome. A screenshot showed the JavaScript Console covering the app. A
semantic-only automation API would have certified a flow a user could not
perform. Acto did not.

The rough edges were equally concrete:

- polling rerenders made snapshot refs stale; retrying by `testId` worked;
- `observeAfter: settled` meant the interaction/navigation settled, not that
  the destination query had data, so I needed an explicit readiness wait;
- after changing provider servers, hosts reconnected with `loadBundle=false`
  and appeared live while still showing `sqlite`; provider-label assertions and
  cold launches prevented false cells;
- dead targets and orphaned agents accumulated, and a new macOS host fell back
  from occupied port 9437 to an ephemeral port;
- Acto diagnosed the higher host-console layer, but its available touch path
  could not target the console's close control;
- receipts stopped at the UI/provider boundary. They did not tie the action to
  a specific gateway request, backend mutation, poll refresh, and rendered
  result;
- Acto could not drive the SwiftUI control row, so the matrix needed two
  different automation systems.

What I want next is a causal target identity: carrier revision, app bundle hash,
provider mode, target lease, and a correlation ID that survives through the
backend and back into the committed render. I also want host chrome exposed as
an actionable automation tree and a small Acto agent adapter for ordinary
SwiftUI accessibility. Acto's semantic/native split is already valuable; those
changes would make “live” and “passed” much stronger claims.

### Backend and Snapback experience in native code

The shared gateway made UI authoring differences much larger than backend
differences. SQLite was still the easiest local baseline. Supabase and Convex
were uneventful because the server adapters already existed. That is useful for
control, but it teaches nothing new about their native SDKs or realtime paths.

Snapback needed a new 64-line server adapter around `SnapbackClient` and the
generated API/manifests. It preserved generated operation identity and real
Snapback execution, but native clients polled the gateway. This is the sharpest
Snapback lesson from the extension: the browser authoring surface is broader
than the Apple-native surface. A first-class Swift client, or an officially
generated gateway/Swift pair with auth and causal receipts, would keep more of
Snapback's web advantage intact.

### Verification record for the native extension

- gateway real-provider probes: 4/4;
- SwiftUI macOS/iOS Xcode builds: pass;
- SwiftUI in-app cells: 8/8;
- SwiftUI iOS XCUITest cells: 4/4;
- SwiftUI macOS XCUITest: blocked by remote UI-automation permission before app
  interaction;
- Exact + Contract production build: pass, 408 modules;
- Exact macOS host build: pass;
- Exact iOS host build: pass with the recorded task-local Exact fix and AppIcon
  override;
- Exact + Contract Acto cells with native reachability: 8/8.

The first version of both RSVP checks always selected `going`, which the
canonical swim fixture already seeded for Ada. The LLP pre-PR audit caught that
false convergence claim. The final oracles read the current value, select a
different status, mutate, and wait for that new value; all sixteen native cells
were rerun after the correction.

This extension did teach us something new. SwiftUI was not magically smaller,
but it had the shorter trust chain. Contract was semantically denser, but only
worth its carrier cost when cross-platform reach, generated bindings, or Acto
automation pay that cost back. Acto's strongest idea is the distinction between
semantic dispatch and real native reachability. Its weakest area is session and
causal identity around that excellent core.

I attempted to file the scaffold/Guide mismatch as the required Exact-project
`guide-gap` Linear issue, but the configured Linear connector required a new
OAuth authorization and returned no search or create access. No issue was
created; the gap remains recorded here and in the comparative report.

## 2026-07-20 — Step 0 turns the comparison into retained evidence

The original matrix was useful evidence but a weak gate. It could print a
green-looking `PASS ... skipped` when Chrome or the Snapback binary was absent,
its RSVP oracle could be satisfied by another seeded guest, and the Snapback
cells could silently fall back to polling. LLP 0063 Step 0 forced those three
ambiguities into explicit instruments.

The required-prerequisite path now writes an atomic receipt with `ok: false`,
`outcome: skip`, a named skip class, zero executed checks, and a nonzero exit.
The full browser run uses Eve's actor-specific guest row, records the before
and after values, and requires a real transition in all twelve cells. Each
Snapback arm then runs a second time with polling fallback disabled: an
out-of-band `SnapbackClient` mutation must update the DOM while the connection
is live, and the surface must report a `guestList` subscription established on
the push transport. Each transport cell now performs two warmups and seven
measured alternating transitions, retaining the samples, median, and p95 that
the preregistered protocol requires. This grew the complete browser gate from
the recorded 40 checks to 43 without pretending that one timing observation is
a sampled latency baseline.

The Snapback-side implementation felt appropriately small once the proof had a
precise shape. The client needed one option that disables its recovery poll,
and the React, Contract, and vanilla providers needed an optional evidence
callback. The product UI did not need a testing-only transport fork. The
harder part was evidence hygiene: atomic writes after cleanup, hashes for the
diary/report/locks, explicit package aliases, and making a missing prerequisite
structurally incapable of becoming a pass.

Review found a second class of false-green risk in process ownership and
remote credentials. The final collectors register children at spawn time,
terminate detached process groups with a bounded TERM→KILL sequence, and make
cleanup failure part of the receipt outcome. The gateway now probes each
backend without retaining credential text. A Supabase or Convex outage is an
explicit remote-dependency skip, not a local failure and not a pass; Snapback
and SQLite remain required. That distinction made the matrix more useful on a
clean checkout without weakening what a green local cell means.

The no-Exact-core check was particularly clarifying. It loads selected
Snapback core and client suites under a deny-loader that rejects any Exact
package import. That preserves a property the Todo demos made easy to assume
but had not made executable: Contract integration is an adapter, not a hidden
dependency of Snapback's core authoring path.

For the native baseline I rebuilt the SwiftUI carriers from the checked-in
project and reran all eight macOS/iOS/provider cells. The retained receipt pins
both carrier binaries and passed 8/8. Exact was more revealing. The newest
pre-existing carrier registered with Acto but correctly rejected the app's
newer Motion schema envelope; treating it as the baseline would have been
revision laundering. A new collector now records the Exact commit plus a hash
of every dirty overlay path, linked package manifests, carrier hashes, Acto
target identity, native hit reachability, and cleanup. Its fresh carrier build
also exposed the same practical contrast as the first diary entry: SwiftUI's
app build is one project, while Exact's shared carrier first rebuilds a large
Rust/archive chain and then enters Xcode's machine-global build service. The
first fresh attempt proved a real source incompatibility: the iOS path used a
macOS-only `nativeHostIdentity` property. I reproduced the earlier platform
guard in a hashed task-local carrier copy instead of changing the very dirty
Exact checkout. The next attempt did not reach that source. On Xcode 26.6 both
macOS and iOS stopped in SwiftBuild SDK discovery while `clang -v -E -dM`
children blocked writing to undrained pipes; unrelated Xcode trees on the same
machine had the identical multi-day signature. The collector's retained
receipt records explicit timeouts, no executed cells, and clean collector
shutdown. It never substitutes the stale host, so the native aggregate remains
pending.

The app-level TypeScript check also reaches the sibling Exact packages and is
not green in the current Exact overlay: it reports existing compiler,
renderer, router, and generated-route errors outside this demo. I left that
checkout untouched and treated both failures as dependency-state evidence.

Compared with React plus Supabase or Convex, Snapback's direct web push was
easier to attribute once fallback could be disabled, because the same generated
query identity survived from subscription setup to the evidence event. The
gateway-backed providers remain useful controlled product comparisons, but
their polling loop cannot support the same transport claim. Compared with
SwiftUI, Contract remains much denser at the product-source layer and much
heavier at the carrier/provenance layer; Step 0 makes both halves visible
instead of letting the shorter `.contract` file stand for the entire loop.

No new guide-gap issue was filed for this entry. The friction was in building a
cross-repository comparison lock and fresh-carrier evidence, not in locating a
documented Snapback authoring capability. The existing Guide accurately covers
the client and live-query surface used here; LLP 0063 owns the new metrology and
product gaps.

## 2026-07-20 — Remote Xcode evidence closes Step 0

The machine-local Xcode 26.6 failure turned out to be an instrument wedge, not
an application verdict. A task-isolated checkout on the remote Apple-silicon
Mac built the clean Exact revision with Xcode 26.3 for both macOS and iOS, then
ran the eight Exact provider cells with native hit reachability. Snapback and
SQLite passed on both platforms; unavailable Supabase and Convex credentials
remained explicit `remote-dependency` skips. The SwiftUI side independently
retained the same eight-cell shape, so the sixteen-cell aggregate could finally
become green without substituting the earlier stale carrier.

The most surprising failure was ordinary host chrome: Exact's diagnostic
console could cover the RSVP control while the semantic view still existed.
The acceptance collector now preflights the native hit path before every
mutation and rejects degraded, host-chrome, occluded, or target-mismatched
paths. Exact gained a documented environment switch that suppresses automatic
console presentation without suppressing the diagnostic itself. This felt
like the right division of labor: the carrier owns presentation policy; the
acceptance instrument remains strict about what a user can actually reach.

The cross-repository lock needed a similar distinction between logical and
physical identity. A manifest cannot directly hash a completion receipt that
itself embeds the final manifest hash. The closure therefore freezes claim
semantics separately, makes the completion receipt bind every prerequisite and
artifact to those semantics, mirrors that receipt into Exact for a registered
aggregate check, and retains the final full-byte comparison in an unreferenced
cross-repository receipt. It is more machinery than a single-repository demo
would need, but it made 19/19 mean the same thing from two clean checkouts.

Compared with React plus Supabase or Convex, the Snapback web path still had
the simpler transport-provenance story because it could name the generated
query and disable fallback. Compared with SwiftUI, Exact plus Contract still
concentrated product behavior into much less app source, but required more
carrier and governance work before the proof was trustworthy. The remote build
did not erase that cost; it converted it from an ambiguous local failure into
a reproducible, reviewable result.

## 2026-07-20 — Step 1 keyed scopes and mutation outcomes

The cleanest implementation boundary was narrower than I expected. Exact
already had the hard logical machinery—canonical argument identity, opaque
authority partitions, same-key attempt sharing, refcounts, and predecessor
fences. Snapback only needed to expose one physical transport attempt for one
logical subscription and let binding-time args reach `liveQuery`. Keeping that
split avoided a second registry in the provider and made the cross-repository
oracle useful: the Exact suite proved its 32 adversarial logical cases, while
the Snapback companion proved the real transport args, partition rotation,
late-handle disposal, and two-provider isolation.

The old multi-live surface made its limitation unusually visible: it preopened
one handle per query name and treated `{ name, args }` as the only server
scope. The additive keyed mode turns the same list into an allowlist and does
not open anything until a generated binding subscribes. The authority barrier
required one extra nuance. Quiesce must rotate and clear Exact's logical
entries immediately, but Snapback cannot reopen them with predecessor auth;
the provider therefore holds the successor physical opens until resume supplies
the new user and authority capture.

Mutation outcomes reinforced the same ownership lesson. Snapback's useful
facts were already low-level: call settlement, receipt outcome and correlation,
overlay class, rollback reason, durable version, and receipt absence or delay.
Exact's three-fact projection could render rejection, awaiting evidence,
missing-promised ambiguity, late confirmation, and contradictory late evidence
without the provider inventing a second product state machine. The fault
matrix also made idempotency concrete: a commit whose response was lost, its
retry, and duplicate receipt delivery produced one effect and one retained
settlement row.

The most awkward part was evidence infrastructure. Filling a later claim's
command changed the Step 0 “semantic” digest even though the workload had not
changed. The projection had excluded status and artifact but not the command.
Normalizing post-Step-0 commands to their frozen pending value preserved the
original semantic hash and made the cumulative-manifest design actually
cumulative.

Compared with a hand-written React hook over Convex or Supabase, the keyed
provider has more explicit authority and evidence machinery, but component
code no longer owns resubscription races or sibling deduplication. The guide
did accurately describe the old boot-scoped Contract surface, so this was a
new capability rather than missing guidance; I updated the Contract and live
query pages and did not file a guide-gap issue.

## 2026-07-20 — Step 2 external stores, Vanilla, and React Expo Android

The best part of this tranche was deleting lifecycle code. Partitime's React
hook had owned a serialized argument key, a `disposed` flag, a late-resolving
handle, connection state, and cleanup in every call site. The replacement is a
single `useSnapbackQuery` projection. Vanilla's 72-line `SubscriptionScope`
became a three-line re-export of `ExternalQueryScope`. That reduction felt
better than merely moving the same code into a utility: the package suite now
owns canonical identity, same-key sibling sharing, independent refcounts,
Strict Mode replay, A→B→A replacement, late-handle disposal, error snapshots,
optimistic settlement, and compatibility refusal as one contract.

The same-key registry was the non-obvious last mile. A per-hook external store
made cleanup safer but still opened parallel upstream attempts for sibling
components with identical queries. Scoping a registry to the provider made the
sharing boundary explicit: same provider plus protocol and canonical identity
shares; different args, authority, or provider does not. Compared with React
over Convex or Supabase, the hook is now similarly small at the component
boundary, while Snapback keeps more visible authority and transport facts. The
portable gateway providers still poll by design, so the common hook does not
pretend their transport is Snapback push.

Vanilla answered two questions the original matrix left open. A real Chrome
page imported the full `@snapback/client` root and ran the lifecycle primitive
from direct `<script type="module">` delivery with no transform. Vite remains
the comparison build because it selects providers and produces comparable
artifacts, but it is no longer a compatibility requirement for the client
module itself. The four Vanilla cells also expose five ordered startup marks:
module evaluation, boot start, provider ready, UI mount, and first authoritative
snapshot. Those are observations, not a performance budget; they establish
where later measurement can attach without claiming one run is a benchmark.

Android was more instructive than the web package work. The Expo carrier reused
the generated API, `SnapbackClient`, and `@snapback/react`; it did not need a
native-specific data cache. The seven-check run built and launched a release
APK, rendered authoritative rows, exposed optimistic pending and confirmed
settlement, rotated authority, observed background/foreground, kept rows during
a server outage, reconnected through a fresh subscription, and excluded server
markers from the carrier. React Native's WebSocket behavior was the sharp edge:
a refused upgrade can emit `error` without the browser-style `close`, which had
left the shared manager wedged until the error path became an explicit loss.
The emulator used `adb reverse`, so this remains a loopback development proof,
not hosted endpoint evidence.

The capability boundary matters more than the green device flow. The Android
carrier is Online only: it executes no handlers locally and proves no durable
offline queue, replay/rebase, or Parity. iOS still has no passing receipt, and
neither `exact-native/ios` nor `exact-native/android` moved. The final
provider-scoped registry and protocol declarations also changed package inputs
after the first Android and browser receipts were written. Their functional
runs are useful, but the cumulative claims stay pending until clean
implementation-revision reruns bind the final sources and carrier artifacts.
That is exactly the kind of difference the Step 0 manifest discipline was
meant to preserve.

This work made the existing React guide materially stale: it still taught the
hand-wired hook and said there was no generated/shipped React binding. The
comparison README's frozen Step 0 wording also predates the direct-ESM run, so
the current result is recorded in the new guide/package coverage without
silently rewriting that locked artifact. I added the framework-neutral and Expo
capability rows and documented the Android/iOS split in the same change. No
separate `guide-gap` issue is needed because the new capability and its guide
coverage land together. Exact itself was not changed in this tranche; its
native Parity work remains owned by Exact LLPs 0331/0332 and the separate
`exact-native/*` roadmap claims.
