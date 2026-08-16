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

The clean follow-up receipts closed the mutable-input gap: React recorded
13/13 plus its package/recovery checks, Vanilla recorded 17/17 plus lifecycle
5/5 and direct ESM 2/2, and Android recorded 7/7 from a clean revision. The
native receipt hashes 107 source/build inputs and the rebuilt 68.9 MB release
APK. Two harness problems surfaced during the clean device run and were worth
fixing rather than explaining away: concurrent fire-and-forget witness POSTs
could drop `provider-ready`, and APKs with duplicate resource names made
`unzip` prompt interactively. Serial bounded witness delivery and explicit
overwrite extraction made both paths deterministic.

The capability boundary matters more than the green device flow. The Android
carrier is Online only: it executes no handlers locally and proves no durable
offline queue, replay/rebase, or Parity. iOS still has no passing receipt, and
neither `exact-native/ios` nor `exact-native/android` moved. The iOS blocker is
host-wide rather than app-local: macOS 26.5 is creating fresh pipes with only
512 bytes of capacity, so Xcode's clang feature-detection subprocess blocks in
`write`. A reboot is the known short-term recovery, but it is intentionally not
performed without explicit authority on this shared machine. The cumulative
manifest therefore closes only the three clean Step 2 claims and keeps iOS and
Exact Native honest and pending.

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

## 2026-07-20 — Declarative common writes and trusted wall time

Partitime's Snapback backend finally became smaller for a reason that felt like
product progress rather than formatting. `createEvent` and `postMessage` moved
from JavaScript handlers into the closed declarative mutation tier. The event
write still validates and trims product input, inserts the host RSVP in the
same transaction, and returns the bound event id. The wall write now stamps
`createdAt` from `runtimeNow()` and omits it from the public argument schema.
That removed a client-forgeable timestamp and reduced the measured backend
from 190 lines to 137, below the frozen 152-line ceiling.

The strongest ergonomic result was the multi-row event creation plan. A bound
insert id flowing into the host RSVP made the transactional relationship more
obvious than two `await ctx.db.insert(...)` calls, while keeping the generated
write set and Contract invalidation facts intact. The remaining RSVP handler
is a useful boundary rather than unfinished conversion: its indexed read,
host-status rule, and update-or-insert branch exceed the deliberately closed
IR profile.

Trusted time exposed cross-provider coordination work. Removing `createdAt`
from the shared product call meant SQLite, Supabase, and Convex also had to
derive time at their server boundary. That is a better comparison—the user
cannot forge the field in any arm—but the Convex deployment is shared with the
new chat matrix. Deploying the older Partitime-only schema briefly removed the
chat indexes. The deploy receipt made the mistake visible, and I immediately
restored the union schema from the current upstream chat checkout with the
trusted-time change layered on it. This is exactly the kind of external-state
coupling a per-demo deployment identity or pre-deploy schema-union check should
make impossible.

The subsequently merged browser-direct Supabase leg required a distinct
boundary: there is no trusted gateway in front of `supabase-js`. Its public
insert now omits `created_at`, while a database `BEFORE INSERT` trigger stamps
and overwrites that field from `clock_timestamp()`. This keeps the direct arm's
RLS-friendly API without turning client wall time back into authority.

The cumulative proof passed after the change: provider conformance was 13/13
and the browser matrix was 43/43 across React, Contract, and vanilla over all
four providers, including fallback-disabled Snapback push. The Step 4 budget
audit now records the backend line sub-row as passing. It remains red overall:
Contract source is 400 lines against 348, emitted bundles remain far above the
frozen thresholds, and most prospective runtime/native instruments do not yet
exist. The receipt makes that distinction mechanically instead of letting one
successful optimization stand in for Workstream 8 closure.

Compared with React plus Convex or Supabase, the trusted server timestamp is
now equally terse at the component boundary and safer than the earlier shared
`Date.now()` argument. Snapback adds more declared mutation structure, then
returns executable write facts and generated client schemas; the gateway arms
remain shorter but hand-maintain their boundary. Exact/Contract still has the
heavier build and source-volume profile, and its existing mutation diagnostic
correctly notices that feed creation writes `rsvps` without a reader bound in
that component.

The guide did not previously provide a paved page for trusted runtime time/ID
defaults or safe common generated patterns. The new standard-pattern guide
lands with this tranche, and the broader retrieval/migration follow-up is filed
as Exact-project Linear issue ENG-25307 (`guide-gap`). The generated-pattern
soundness RFC remains Draft, so this diary records implementation evidence—not
ratification or a Step 5 claim.

## 2026-07-20 — The Supabase 401 was never real

Revisiting "what did we need from Supabase" produced an uncomfortable answer:
mostly a better probe on our side. The publishable key that the whole gateway
fallback was built around had been probed against `GET /rest/v1/` — the
OpenAPI introspection root, which new-format `sb_publishable_*` projects
deliberately restrict to secret keys. Its 401 body even says "Only secret API
keys can be used for this endpoint." Table reads and Auth endpoints had
accepted the key all along. One wrong probe surface reshaped an entire
column of the matrix: the gateway detour, the "Postgres-on-Supabase, not
Supabase" qualification, and the unanswered supabase-js/RLS/Realtime
questions all trace back to it. The corrected probe
(`tests/acceptance/supabase-probe.mjs`) now asserts the root's 401 as a
regression witness so the misreading is structurally unrepeatable.

What the correction exposed was more interesting than the correction. The
tables had been created over direct Postgres with owner defaults: RLS off and
anon holding every grant including TRUNCATE. Every browser cell going through
the gateway had hidden that; the moment browser-direct became possible, it
became unshippable. `harden-supabase.ts` closed it, and the pleasant surprise
was expressing the host-displacement invariant as an RLS UPDATE policy
(`USING status <> 'host'`): an upsert that would overwrite the host now fails
inside the database no matter how careless the client is. That is a stronger
shape than the gateway's read-before-write check — though writing it took
more care than expected, because createEvent still has to INSERT host rows
while UPDATE must never mint or displace one.

The idiomatic cell itself (`supabase-realtime` React mode, supabase-js +
postgres_changes, no gateway) mostly went smoothly, with two honest bruises.
First, Realtime has a registration gap: a write committed between channel
creation and server-side filter registration is silently never echoed, and
with poll fallback disabled the UI stays stale forever. The fix is the
classic supabase-js discipline — refresh your own subscriptions after your
own writes — which the app layer must remember; Snapback's live queries
hand you read-your-own-writes from the transport. Second, PostgREST's
merge-duplicates upsert happily rewrote a row's primary key mid-experiment,
which broke the seed's `ON CONFLICT (id)` idempotence a run later. Keyed
identity is a contract every client must respect by hand.

Push freshness measured well: median ≈1s end-to-end from an out-of-band
PostgREST write to a rendered DOM change (samples 0.5–1.1s to us-east-1),
versus the snapback cells' same-machine push in the low hundreds of ms —
not a like-for-like comparison, but a real feel for the hosted round trip.

Ephemeral acceptance schemas closed the remote-fixture discipline gap:
`providers.mjs --ephemeral-supabase` seeds `partiful_matrix_test_*` and drops
it. The trap was the hosted pooler silently ignoring the
`options=-csearch_path` startup parameter — the first "ephemeral" run leaked
an acceptance row into the shared fixture while claiming isolation. The
adapter now schema-qualifies every statement instead of trusting
search_path; the leak was removed with the guarded cleanup path.

Claims bookkeeping stayed deliberately minimal: the browser-direct cell's
receipt is retained at `acceptance/results/supabase-realtime-web.json`, but
no claim row was added — adding one would rebaseline the frozen cross-repo
semantics, and that amendment belongs to the Step 3 closure. Only the
README-pinning documentation claim's byte-level artifact hash was refreshed,
following the Step 1 precedent.

## 2026-07-20 — Convex finally got its own client

The original Convex column was fair as a row-shape control and unfair as a
product experience: React called the same HTTP gateway as every non-Snapback
cell, then polled once a second. The follow-up `convex-realtime` mode deletes
that mediation. It imports the generated Convex API, creates a
`ConvexClient`, and lets Convex's WebSocket own query freshness. The component
tree did not change; the same shipped external-store projection consumed the
provider, so the experiment isolates transport/provider work instead of
quietly giving Convex a different UI.

The pleasant part was how little subscription code the native client needed.
`onUpdate` supplied an authoritative initial array and subsequent values,
deduplicated transport subscriptions, and exposed connection state. The
retained 6/6 browser receipt tied six out-of-band HTTP mutations to six new
`guestList` callbacks sampled while `ConvexClient.connectionState()` reported
an established WebSocket and to six rendered RSVP transitions. With the poll
path absent by construction, that is stronger provenance than inferring
realtime from a fast screen update. The final check unmounted the normal React
root and observed both subscription disposal and `ConvexClient.close()`. Five
post-warmup observations landed around 0.2 seconds on this hosted deployment.
They are useful feel, not a benchmark.

The awkward edge was deployment URL normalization. The local `CONVEX_URL`
ended in `/`; the shared adapter appended `/api/query`, producing `//api/query`.
Convex's edge returned an empty redirect body, so the first preflight failed
closed with no green checks. Canonicalizing bare deployment origins fixed both
the new cell and a latent gateway trap; URL paths, query strings, fragments,
and credentials now fail closed, and `.convex.site` maps explicitly to its
`.convex.cloud` sibling. This is a nice contrast with Snapback's local
verified-ready descriptor: Convex deployment is pleasantly hands-off, but a
public origin and deploy authority can still look compatible while selecting a
subtly different request surface.

The acceptance runner now creates a unique `[acceptance]` event and registers
its guarded deletion before opening the browser. That is safer than restoring
Eve's canonical RSVP: parallel runs no longer race on one shared value, while
the cleanup attestation still rejects “test passed but fixture drifted.” No
deploy was needed for this tranche, so the shared schema and chat indexes were
not touched.

This closes only the idiomatic React × Convex leg. Contract still needs a
generated Convex provider-introspection/binding path, production identity is
absent, and no retained-offline or local-handler claim follows from a hosted
WebSocket. Compared with React plus Snapback, Convex's component-facing loop is
similarly concise and its hosted subscription feels excellent; Snapback still
supplies more generated capability/authority facts and the local-first path.
The guide already described provider capability honesty and this is a
comparison-only non-Snapback cell, so no Snapback guide gap was filed.

## 2026-07-20 — Step 3 closed the provider type loop

The best result was deleting fifteen hand-maintained Contract binding,
metadata, and runtime-link files and making one generated module the only data
import in the product source. Exact's declaration generator now takes two
independently produced inputs—Snapback and Convex—and emits manifests,
callable bindings, metadata sidecars, row/result types, fixtures, and docs.
Their view-facing projections and types are byte-equivalent even though the
providers retain different capability facts. Convex is the canonical binding
producer in this follow-up, so the successful browser run cannot accidentally
fall back to the old Snapback-specialized path.

The runtime half was pleasantly direct. `ConvexContractProvider` opens
`convex/browser` subscriptions over the hosted WebSocket, configures the
generated callable registry, and never goes through the matrix gateway. The
retained cell passed 6/6 with six out-of-band mutations, connected-WebSocket
samples, rendered RSVP transitions, ordinary surface teardown, and guarded
fixture deletion. The same adapter passed the Exact-owned DataProvider suite:
72 checks passed, 26 skipped for capabilities it explicitly does not claim,
and none failed. Those skips are a feature of the evidence. Convex has no
receipt stream, retained/offline replay, force-state surface, or ephemeral
probe here, and the declaration does not pretend otherwise.

The awkward part was integration volume, not view code. Step-3-specific
authored glue is two files / 485 lines (279-line declaration/generation driver
plus 206-line Convex runtime adapter). It produces 17 generated files / 3,200
lines. The four new or expanded proof files are 1,494 lines. This is better
maintenance ownership than fifteen small handwritten mirrors, but it is not
yet a tiny provider SDK: much of the current generator driver is an explicit
Partitime schema/operation projection that a stable backend producer should
derive. Compared with React plus Convex, Contract's component source is cleaner
while the provider integration remains heavier; compared with the old
Contract gateway arm, the type and capability chain is now closed and the
transport is idiomatic.

Diagnostics produced a second strong result. Six deliberately seeded failures
carry stable codes and source ownership through CLI, LSP, and Agent adapters;
completion, navigation, rename, formatting, and atomic incremental replacement
all have executable witnesses. React and Contract each observe the other's
mutation through the same live product contract, and provider/action failures
project equally without swallowed errors. Headless and native receipts remain
quiet by default. The one useful warning that remains is real product feedback:
feed creation writes `rsvps` even though that component reads only `events`.

Two acceptance-harness races surfaced only under the larger cumulative run.
The Chrome DevTools client registered its reply waiter after sending, so a
fast `Runtime.evaluate` response could disappear and manifest as a random
30-second timeout. Registering correlation before the send fixed the race.
Vite cleanup also treated only numeric exit codes as stopped; signal-terminated
children made repeated cleanup look like failure. Signal-aware idempotent
cleanup, page disposal after each witness, and one bounded startup retry made
the full 43/43 matrix repeatable with zero cleanup errors.

The Snapback guide had no author-facing route from a provider declaration to
the generated Contract boundary. That was new surface rather than friction the
old guide could have prevented, so the Contract adapter page and capability
index now land with it; no separate guide-gap issue is needed. Stable package
publication remains deliberately partial. Completing the React Supabase,
React Convex, and generated Contract Convex legs does not change the opening
ranking: React × Convex stays third, React × Supabase fourth, and Contract ×
Convex fifth. The uncertainty narrows—both hosted providers are stronger than
the frozen polling row suggested—but production identity, offline/local
execution, Contract UI completeness, and bundle cost still dominate the same
ordering.

## 2026-07-20 — React Expo iOS became a real headless proof

The iOS Online tuple now passes the same seven facts as Android, independently:
release build and Simulator launch, generated initial data, optimistic and
authoritative mutation settlement, authority rotation, real background and
foreground callbacks, stale-row retention plus authoritative reconnect, and
release-artifact server-code exclusion. The receipt is bound to clean revision
`7914210` and a 53,973,690-byte release app artifact.

Two failures were useful. First, Xcode correctly refused a workspace whose
committed `Podfile.lock` checksums disagreed with `Pods/Manifest.lock`.
Re-running `pod install` reproduced the older checksums consistently; the
previous checksum refresh had captured a non-reproducible state. Second, the
AppleScript Command-Shift-H shortcut did not reliably background the simulator
app even though the process stayed healthy. Launching Settings with
`xcrun simctl launch --terminate-running-process ... com.apple.Preferences`
triggered the actual OS lifecycle transition and removed GUI focus from the
proof.

Compared with React plus a browser backend, Expo still adds a large native
dependency/build surface. Compared with the earlier polling SwiftUI and
Contract carriers, it preserved much more of Snapback's generated client and
live-query behavior with very little app-specific transport code. It remains
honestly Online rather than Parity: no local handler execution, durable
mutation queue, or replay/rebase claim follows from this result.

## 2026-07-20 — RSVP crossed the native replay boundary

The first Exact Native binding run exposed a sharper blocker than platform
plumbing: Partitime's RSVP was the only product mutation still implemented as
an Ibex JavaScript handler. The generated Rust client could name it, but the
retained native evaluator could not execute it while offline. Calling that
surface Parity would have made the most visible product interaction silently
Online-only.

The fix was smaller and more honest than embedding a second JavaScript engine.
RSVP row identity is the declared `(eventId, userId)` key, not its storage row
id, so the mutation now deletes that actor's RSVP for the event and inserts the
new validated status in one declarative plan. Server execution and Exact's
deterministic local replay therefore consume the same generated steps. The
unused 28-line handler file disappeared, and a live in-memory server check
proved two successive status changes leave one row plus a typed rejection for
an invalid status.

This felt like Snapback at its best: the manifest made the server-only tier
obvious before device work could hide it. The awkward part is that replacing a
row changes its storage id. Partitime never exposes RSVP row ids as product
identity, so that is acceptable for this fixture; a product that does expose
them would need a declarative unique-key upsert or another portable operation,
not this replace pattern. Compared with Convex or Supabase, the native replay
requirement asks more of mutation authoring, but it also makes the offline
claim mechanically inspectable instead of depending on app-authored optimism.

## 2026-07-20 — Exact Native crossed both mobile lifecycle boundaries

The decisive result was not that Rust could compile for two mobile targets; it
was that one generated provider sequence survived both real host lifecycles.
Exact now has small dedicated no-Hermes acceptance applications for iOS and
Android. Each starts the retained Partitime owner, renders its status from the
same C ABI bitmask, is backgrounded by the actual OS, and reconnects through the
foreground callback. Both retained receipts reached `0x7ff`.

The provider proof became better while turning it into a carrier. My first
sequence called a rebase successful while one post mutation was still pending.
That was useful intermediate state, but it was not convergence. The final
carrier settles RSVP and post against authoritative rows and asserts an empty
pending set. It then queues a generated create-event mutation specifically for
the authority-rotation test. That separation makes the two facts crisp:
reconnect converges, and an unrelated predecessor mutation remains durable but
suspended when the authority instance changes under the same user id.

Android exposed the most concrete native integration defect. The first APK
packaged both libraries but the JNI wrapper's ELF dependency named an absolute
workstation path, so the loader could not find the Rust carrier on-device.
Giving the Rust shared object an explicit SONAME and telling CMake not to reuse
the imported path as the dependency name fixed the actual boundary. Inspecting
the packaged ELF graph caught something a host unit test could not.

The iOS carrier was comparatively direct: XcodeGen declares the target, a build
phase cross-compiles a universal simulator archive, Swift lifecycle callbacks
call the C ABI, and launching Settings creates a reproducible background cycle.
The Android module deliberately avoids the existing Hermes reference Activity;
it is a small Kotlin/JNI release app so Contract-on-Hermes cannot accidentally
stand in for Exact Native Parity.

Snapback's side imports the evidence from an immutable Exact commit and
reconstructs every source digest with `git show`; it does not trust a copied
green JSON file. This cross-repository ceremony adds friction, but the ownership
is much clearer than a monorepo-relative smoke test: Exact owns the carriers and
their registry, Snapback owns the capability contract and cumulative claim.

The limit is important. These are simulator/emulator roadmap proofs, not
physical-device performance or complete mobile-product certification. Exact's
renderer, IME, accessibility, pairing, and broader packaging gates remain open.

## 2026-07-20 — The external loop stopped depending on repository topology

The strongest Step 5 result is mundane in the best way: a fresh directory can
now install seven tarballs, launch a relocated native Snapback/Hermes runtime,
generate the real Partitime backend offline, scaffold a second app, start and
load it through `snapback dev`, observe a source edit regenerate and hot-load,
refuse a ready-file aimed at the wrong database, and stop without leaving a
stale descriptor. The same closure bundles the headless, React, and Contract
adapters for a browser. None of those operations reaches a sibling checkout or
builds Hermes from source.

The native distribution detail mattered. The existing macOS binary carried
only checkout-absolute Hermes RPATHs, so copying it would have produced a
plausible tarball that crashed on another machine. Adding
`@loader_path/../Frameworks`, packaging the executable at `bin/snapback`, and
running doctor with every `DYLD_*` override removed made relocatability an
executed fact. The first platform package is deliberately only
darwin-arm64—unsupported hosts get a stable capability error instead of an
accidental source build.

Ready-file attachment exposed a subtler boundary. A file-backed server mints
its admin token beside the database, while the native CLI intentionally trusts
only a token mechanically adjacent to the ready file. The wrapper now accepts
the database-side carrier only after the descriptor's database and token paths
both equal the project-managed targets and the token is an owner-only regular
file; it then passes the token explicitly to the same native host operation.
That keeps the lifecycle vocabulary shared without weakening the native CLI's
general ready-file trust rule.

The self-review caught two lifecycle bugs that the first happy-path proof did
not: watched reload called the seed reset again, which would erase dev data on
every source edit, and a failed initial attach/load could leave the process it
had just started running. Seed application is now restricted to a genuinely new
managed database, attach/load failure stops the managed child, and watched
generation is single-flight with a coalesced pending edit. A package regression
test pins the seed-once behavior; the cold proof still pins watch/load/stop.

Compared with Convex or Supabase, Snapback still asks the package closure to
carry a large native runtime and to coordinate generated manifests explicitly.
The benefit is that local handler execution, offline codegen, and the exact
server artifact are part of the install rather than a remote-service
assumption. The remaining gap is operational, not hidden: npm is unauthenticated
and the `@snapback` scope has not been published, so this is a tarball proof,
not yet a public-registry or clean-machine release claim.

### 2026-07-21 — the first registry probe found a product-name collision

npm authentication was available on the remote Mac, but the assumed coherent
`@snapback/*` public namespace was not: `@snapback/cli` is already an unrelated
public 3.x package. The caveat in LLP 0021 did useful work here. Rather than
overwriting or coexisting confusingly with that identity, the publication
script's provisional `@ccheever/snapback-*` mapping staged a clearly labeled
`0.1.0-llp0063.1` prerelease under the non-`latest` `llp0063` tag.

The first fallback tarball run also caught a subtle proof bug. Renamed package
manifests correctly use npm aliases for their internal dependencies, which
means a pre-publication fallback tarball is not an offline closure: npm must
resolve those renamed identities from a registry. The cold-install proof now
rejects that combination and has an explicit registry mode that checks each
published name, version, integrity, and successful publish-ledger status before
installing the source-name aliases. The original identity-tarball closure still
passes end to end.

No registry success is claimed yet. npm required an interactive OTP at the
first real upload and no version became publicly visible. Compared with Convex
or Supabase, a native-runtime package closure makes distribution identity and
platform coverage unusually visible; the upside is that the failure stays a
precise publication/clean-machine gap rather than appearing later as a user's
Hermes build problem.

## 2026-07-21 — agent custody left the ordinary browser bundle

Partitime's cost attribution found an avoidable Snapback edge: the framework-
neutral browser client imported the entire agent credential-custody module only
to run `instanceof AgentAuthorityFence` when constructing a client. Partitime
does not configure agent custody in the browser, but the static import still
made that optional implementation reachable in every Snapback web cell.

A small package-private WeakSet now gives real `AgentAuthorityFence` instances
nominal identity without importing their implementation from the client root.
The focused package test proves a prototype-spoofed object is rejected, and the
full Contract agent-authority suite still passes durable rotation, tuple cuts,
and terminal blanking. In the unchanged Contract × Snapback production build,
`agent-authority.mjs` disappeared from the attribution manifest. The cell fell
from 802,409 to 738,080 minified bytes and from 203,427 to 188,851 bytes under
the deterministic gzip measurement.

This felt like the right kind of tree-shaking work: capability absence now has
a visible cost consequence without weakening the capability's security model.
It is also a useful limit on the result. The Contract × SQLite/Supabase/Convex
cells remain around 468 kB minified, so the compiled Contract views and runtime
still dominate the frozen budget miss. The Step 4 receipt remains honestly red
at 5/26 passing requirements; this change removes one Snapback-owned bucket but
does not turn a partial reduction into a budget claim.

## 2026-07-21 — the Online Contract arm stopped importing offline custody

The next attribution pass found a similar boundary one layer up. Partitime's
Snapback Contract arm only needs live queries and mutations, but it constructed
the monolithic Contract surface that also owns retained state, offline replay,
derived overlays, ephemeral wiring, and coordinated authority custody.

My first extraction tried to use the newer keyed provider directly. The
production bundle compiled and shrank, but the browser gate refused to boot:
the pinned published Exact 0.1.2 runtime does not expose `rotatePartition`.
That refusal was correct. A no-op shim would have erased the authority axis
from logical query identity while pretending the dynamic-scope contract still
held.

The compatibility-safe result is a second package entrypoint,
`online-surface.mjs`. It extracts the published runtime's existing preopened,
boot-scoped multi-live behavior: generated-artifact validation, fixed query
scopes with mismatch diagnostics, live connection delivery, Exact's own force
plane, server-authoritative mutation calls, and complete live-handle cleanup.
The newer keyed provider still gained shared artifact checks plus scoped local
force behavior for runtimes that genuinely support partition rotation, but
Partitime does not claim that path from its stable dependency.

The ownership limit matters. The smaller path is for an Online client with no
auth coordinator or retained store. A coordinated browser session, agent
principal, or offline surface must keep using the full surface constructor so
its boot/quiesce/partition-rotation/resume participant cannot be skipped. That
distinction was more ergonomic than inventing app-local bridge glue: the
package boundary got narrower and the demo got simpler.

On the frozen production workload, Contract × Snapback fell from 738,080 to
659,515 minified bytes and from 188,851 to 165,844 deterministic-gzip bytes.
Review reruns pass 43/43 ordinary browser checks, 19/19 product-UI checks, and
9/9 production-web checks, including fallback-disabled push. The package
suites, Exact's 32-test keyed oracle, the 35-test mutation-projection oracle,
and the production build pass. This is still not a budget exit: the Contract
views/runtime dominate the common cells and the Snapback client root remains
158,644 rendered bytes in this cell.

The production rerun was worth doing separately. It first fell to 7/9 even
when I put the old full surface back in an A/B run. Exact's adoption callback
had passed, but Partitime kept only a shallow copy of the result; the normal
post-adoption viewport and live-data turns later appended to the same
`mismatches` array. That made the evidence look as though adoption itself had
missed anchors. Deep-snapshotting the result in the callback restored the
honest boundary: adoption remains immutable evidence, while responsive and
live updates continue on the mounted tree.

## 2026-07-21 — Step 4 stopped treating missing measurements as prose

The budget receipt originally had fifteen performance rows that could only say
"instrument missing," plus three attribution/amendment rows with no executable
path to green. The new dated amendment turns those placeholders into a real
protocol: two warmups, seven retained calibration samples, a committed
calibration boundary, then seven independently collected holdout samples. It
does not touch the frozen Step 0 byte/source thresholds.

The browser-side collector is deliberately outside the measured application.
A pre-document observer records product shell, authoritative card, live/current
connection, and the bounded event-navigation mutation window. Chrome's
performance, heap, GC, and network domains supply idle CPU, idle bytes, and
heap-per-logical-subscription. Vite's command clock and watch events measure
fresh and incremental builds without editing the repository. A React × SQLite
quick canary exercised the whole path; because it used one sample and a 200 ms
idle window, its receipt is explicitly nonclaim.

Native metrology exposed a useful asymmetry. Exact already reports evaluation
and first-frame stages. React Expo reported only JS-level product events, so a
naive comparison would have called unlike timestamps equivalent. The iOS
carrier now reads React Native's own script-execution duration when the
JavaScript-loaded notification fires, inventories only the admitted startup
JS/Hermes assets, and relates its first committed root effect and authoritative
event to an external launch request. The aggregator refuses samples that lack
those four structured values and requires React and Exact to name the same
host identity.

Cost attribution also became more useful than subtraction alone. Every Vite
cell now emits a stable module ledger partitioned exactly once into framework
runtime, provider runtime, generated app data, or application code. The
vanilla row remains an honest lower bound; the ledger does not pretend a delta
isolates one framework perfectly.

The biggest good surprise was the active Exact AOT/pruning work. Its latest
clean source-linked build of the same Partitime gateway cell reached 267,819
bytes minified and 78,258 gzip, down from the stable package's roughly 468/117 kB.
That is substantial and makes the remaining bundle gap feel tractable, but it
is still 54,336 minified and 11,012 gzip bytes over the frozen limits. The
authored Contract surface is also still 1,095 lines against 348. Neither is
papered over by the new instruments.

Two environmental gaps remain concrete. The authorized Apple host initially
had only 2.6 GiB free; removing about 9.1 GiB of this project's prior ignored
Rust/DerivedData outputs made isolated Xcode verification possible without
touching its dirty evidence worktree. And the available browser inventory has
desktop Safari/Chrome/Firefox, one iOS 26.2 runtime, and an Android Chrome 134
emulator—not the required current/current-minus-one mobile matrix. With no
device-cloud credentials present, those missing citizenship rows must remain
red rather than being inferred from desktop Chrome.

Compared with React plus Convex or Supabase, this is more ceremony, but the
ceremony caught real category errors: total heap versus subscription delta,
React JS effects versus Hermes evaluation, dev-server payload versus a native
binary, and calibration data leaking into holdout thresholds. The amendment is
still pending owner ratification, so no performance claim has been promoted.

### Remote Xcode separated “builds” from “works”

The authorized Xcode 26.3 host was useful precisely because it made two very
different facts visible. Both iOS carriers compile now. React Expo needed the
actual Swift importer shape of React Native's performance logger—the C enum
arrives as a raw value rather than a named Swift case—and the nested app had to
declare the transitive Snapback Contract workspace package explicitly. Exact
had a more conventional generated-project bug: its normal app targets also
compiled the Partitime acceptance file, producing two `@main` declarations.
Excluding that file in `project.yml` fixed the ordinary iOS build without
weakening the acceptance carrier.

The Exact runtime result was much less flattering. It launched and loaded a
7,109,789-byte script graph with 460 modules, then spent 6,414.54 ms in Hermes
evaluation and never produced a frame within 15 seconds. That is the sharpest
performance evidence from this pass. It does not mean Contract or Snapback is
fundamentally unsound, but it does mean the native carrier cannot be described
as merely awaiting polish: its current startup graph or boot path blocks the
acceptance workload before user-visible output.

### Browser citizenship became a ledger, not a checklist

Exact LLP 0211's release profile expands to 21 concrete rows for this workload.
The new collector makes every missing row red and requires exact browser/OS
versions plus durable evidence. I kept the frozen Step 0 harness unchanged
after its content hash correctly rejected my first attempt to extend it. A
separate Chrome probe now proves actual browser find on visible event text,
while the retained product-UI receipt proves dialog focus trap and restoration.

That leaves current desktop Chrome and Firefox at 2/2 each, but the cumulative
matrix at 4/21. Firefox was a useful test-design correction: JavaScript
`element.click()` does not give its button focus, so an early probe falsely
reported broken restoration. WebDriver's real element click proved the trap,
reverse/forward wrap, Escape dismissal, and restoration; Firefox's privileged
WebDriver context then invoked and inspected its native FindBar rather than
substituting `window.find`.

The machine has current desktop Safari, Chrome, and Firefox, but Safari's Allow
Remote Automation setting is disabled and `safaridriver --enable` requires the
owner's administrator password. It also has only one iOS 26.2 runtime, and the
Android emulator's Chrome 134 is stale. Desktop automation cannot substitute
for real mobile IME, password-manager/autofill, or bfcache behavior. Compared
with React ecosystem test farms this is operationally heavier, but the
strictness is useful: it distinguishes “the DOM looks compatible” from “the
named shipping browser actually behaved correctly.”

## 2026-07-21 — ratification turned the performance checklist into a red benchmark

Charlie ratified `partitime-ws8-prospective-2026-07-21`, so the performance
collector could finally cross the line from quick canary to claim-grade
sampling. The clean calibration retained two warmups and seven observations
for cold/warm startup, authoritative/live data, idle CPU/network, heap per
logical subscription, update fan-out/patches, and fresh/incremental builds in
all twelve cells. I committed that artifact before running holdout, and the
holdout named the calibration commit rather than rereading a moving worktree.

Getting there exposed several harness problems that small canaries had hidden.
The Contract preview's development plugin middleware returned a client-module
404 under a real script request even though a generic curl looked green, so
the production artifact now uses a minimal preview-only Vite configuration.
The external observer also needed to capture the page's boot promise before
application code assigned it; otherwise static SSR copy could be mistaken for
settled live data. Chrome became unreliable when one browser process and one
flattened CDP session accumulated every navigation, so each cell now owns an
isolated Chrome process and each navigation owns a short-lived control socket.
None of those changes relax a product milestone; they remove unrelated harness
state from the measurement.

The Supabase leg made shared-environment cost visible in a less pleasant way.
Another legitimate demo already held most direct/session database slots, so
Partitime could not assume it owned that pool. Public-fixture reads now prefer
the transaction pooler and disable prepared statements, while explicit
ephemeral-schema runs keep the direct endpoint for DDL and teardown. This is
more operational ceremony than a local React-plus-SQLite benchmark, but it is
closer to how React plus Supabase actually behaves in a shared development
machine and it kept the collector from killing unrelated work.

The result is useful precisely because it is red: 29 of 44 Contract holdout
rows pass and 15 fail. Snapback's Contract cell mainly misses heap. The polling
cells add warm-start, idle, and heap misses; SQLite also shows a large update
mutation window, and Convex/SQLite narrowly miss production-build limits. The
instrument no longer lets “we have not measured this” sound like “probably
fine.” It also did not change the frozen byte thresholds or promote any claim.

Contract and Exact have a split story. The stable package still produces
659,515/165,844 minified/gzip bytes with Snapback and roughly 468/117 kB in the
other cells, so the shipping integration remains far too large. Separately,
Exact's source-linked Phase 3c pruning reached 210,609/61,806 for the unchanged
SQLite fixture, below its frozen byte limits. That makes the common-runtime
problem look tractable, but it is not a stable-package victory yet, and it does
nothing by itself for Snapback's additional provider-client weight or the
1,095-line authored Contract surface.

Safari improved after the owner enabled Allow Remote Automation. The first
probe was falsely red because Safari does not focus a button after a mouse
click; focusing the opener and activating it with a real Enter key produced an
honest trap/wrap/Escape/restore pass. Native find remains red. WebDriver's
Command-F did not expose the query as a DOM selection, and trying to bridge
through macOS accessibility triggered Safari's automation-safety UI and made
the session unstable. I kept the red row instead of substituting
`window.find`. With refreshed Chrome 150 and Firefox 152 receipts, the strict
matrix is now 5/21: all four Chrome/Firefox rows, Safari focus, Safari find red,
and all fifteen mobile rows still red.

Compared with React plus Convex or Supabase, the Contract path still asks for
more metrology and packaging discipline than an application team would want
to own. The good part is that the generated surface gave the collector stable
product IDs, boot readiness, and explicit provider modes. The bad part is that
runtime reachability and carrier boundaries remain large enough to dominate
both bytes and heap. This pass made those tradeoffs concrete rather than
fundamental: the source-linked runtime can fit, but the stable distribution,
Snapback interaction cost, native first frame, and mobile citizenship still
need real work.

## 2026-07-21 — the optimized Exact runtime became a stable-package result

Publishing Exact 0.1.5 changed the most important qualification on the bundle
work: Partitime no longer needs a source-linked Exact checkout to fit the
frozen limits. The release included the full 15-package closure, including the
new observability package, and all 15 public registry tarballs byte-matched the
publish ledger. Migrating the Contract arm's four direct npm aliases and
regenerating its Bun lockfile pulled the whole transitive graph to 0.1.5; a
frozen install then proved the consumer is not depending on worktree state.

On the unchanged workload, all eight byte checks are now green. Contract ×
Snapback emits 367,782 minified and 100,995 deterministic-gzip bytes against
limits of 422,417 and 119,451. Supabase emits 210,785/61,883 against
213,488/67,246, while Convex and SQLite each emit 210,771/61,881 against
213,483/67,246. The immutable production-browser suite also passes all nine
checks from the installed package, including static authority, hydration
adoption, base-path routing, metadata, history, and unsolicited push.

That is a real closure of the Contract bundle-size problem, but it is not a
closure of Step 4. The aggregate budget receipt remains 9 pass / 17 red / 16
nonclaims: the 1,095-line authored Contract surface still exceeds its frozen
348-line limit, 15 of 44 performance holdout rows miss, and native carrier
calibration and holdout receipts do not exist because the Exact carrier still
does not reach a first frame. The production-web aggregate remains 11/12;
only the strict citizenship gate is red, with 5 of 21 required rows admitted.
I refreshed both artifacts but kept both claims failing.

For Exact, the pleasant part was that capability pruning survived packaging:
the installed consumer got the same small runtime graph the source experiment
had promised. The less pleasant part was release-closure discipline—one
consumer-facing upgrade traversed 15 packages and added observability's schema
dependencies to the lockfile. Contract now looks much less like it has a
fundamental browser-size problem; its remaining authored-source and runtime
performance costs are concrete follow-up work. Snapback's incremental bundle
cost also fits its preregistered allowance, but its subscription heap and the
native boot path remain specific Snapback/Exact integration concerns. Compared
with React plus Supabase or Convex, the installed Contract arm is finally in
the same browser-byte neighborhood, while still demanding substantially more
evidence machinery to establish that result.

## 2026-07-22 — the update-cost regression was in the production DOM host

The independent holdout evaluator made four previously hidden categories
honest, and update economy was the sharpest finding. Exact 0.1.5 reduced the
Contract cells' subscription heap by roughly thirty percent, but route
navigation jumped from the earlier 0.1.2 observations of 7/15 DOM targets and
patches in most cells (18/237 for SQLite) to 57/531 for Snapback, 24/202 for
Supabase and Convex, and 56/1,133 for SQLite. That looked like a possible cost
of the production AOT compiler until a focused trace showed the renderer was
recursively reapplying every unchanged element's attributes and styles after
each commit.

The repair belongs in Exact's lightweight production DOM host: retain the last
applied props identity, parent identity, and image color scheme, but continue
walking the tree so changed descendants and structural order still reconcile.
A MutationObserver regression now pins a text-only update to one character
mutation and no ancestor attribute or child mutations. Partitime also stopped
rewriting its already-hidden boot sentinel during client-side route remounts;
once mounted UI owns progress, only a later error may make that sentinel write
again.

An unpublished four-cell quick run now records 6/9 targets/patches for
Snapback, Supabase, and Convex, and 9/16 for SQLite. All four fit the unchanged
9/19 frozen limits, and the SQLite bundle remains green at 211,203 minified /
62,050 deterministic-gzip bytes. This is strong diagnostic evidence, not a
claim promotion: the Exact change still needs a release and the full
calibration/holdout cohorts. Compared with React, whose quick SQLite turn was
9/18, Contract is now in the same update-cost neighborhood. The experience is
reassuringly mundane—this was neither a Snapback transport flaw nor a
fundamental Contract-language problem, just a production-host fast path that
the original functional 9/9 browser corpus did not measure.

## 2026-07-22 — “warm memory” was measuring a second page

The polling failures initially looked coupled: Contract completed three
one-second gateway requests inside the three-second idle window while React
completed two, with CPU moving by almost exactly the same ratio. The timer and
provider implementations were equivalent. The actual difference was the
production handoff: static Contract rows were rendered as `live` before the
underlying provider had converged, so the collector called the initial request
idle work. The seed now stays authoritative but `connecting`; only the real
provider may advance the connection axis to `polling` or `live`. This is a
better product truth independent of the benchmark.

The heap miss had a separate custody bug. Warm cache priming navigated the same
Chrome target twice, and bfcache retained the first application document. The
metric said one active logical subscription but `Runtime.getHeapUsage` included
state from the measured page and the cached page. React grew from about 1.27 MB
cold to 1.65 MB warm, vanilla from 0.62 to 0.85 MB, and Contract from 1.75 to
2.48 MB. Priming a sibling target, closing it, and measuring in a fresh target
keeps the shared HTTP cache warm while making cold and warm heaps converge in
all three arms. Because the old threshold came from that invalid baseline, I
preserved both original receipts and registered a proposed versioned
invalidation amendment rather than silently refreshing the numbers.

Removing bad measurement state did not make the candidate magically green.
Against the corrected React diagnostic near 1.27 MB, the installed Contract
feed is about 1.76 MB. Allocation profiles pointed to production representation
rather than the query object: unopened Event Contract IR/AOT closures,
serialized and parsed hydration ledgers, and ordinary feed runtime state. The
event route is now a real lazy chunk, the consumed JSON script leaves the DOM,
and Exact releases the parsed manifest after the adoption turn. With the
unpublished Exact fix the feed reaches roughly 1.72 MB. That is meaningful but
still red, which is a useful distinction: the bfcache jump was an instrument
bug; the remaining runtime gap is real work.

Compared with React plus Supabase, Contract's production hydration gives a
faster authoritative first paint, but its current AOT representation costs more
live heap. The best part of the debugging experience was that the three-arm
control immediately separated browser custody from framework behavior. The
worst part was that a metric named “per active subscription” was actually total
target heap divided by one; even after fixing the extra document, it remains a
strict whole-page runtime budget rather than an isolated provider allocation.

## 2026-07-22 — the native red result belonged to the development lane

The 7.1 MB / 6.4 s Exact launch is real, but its comparison label was not. The
React carrier was a Release/Simulator Hermes app; Exact was the Debug host
loading Vite's development module table with Acto explicitly eager. Exact's
own startup plan says not to use that pairing as a headline and keeps the
agent-on inspection smoke separate from the agent-off first-frame budget.

A local module-table probe made the distortion concrete. With Acto disabled,
the Partitime Exact graph was 261 modules, 2.92 MB of transformed module source,
and 2.31 MB of compact startup source. Enabling Acto raised it to 511 modules,
6.34 MB of module source, and 4.87 MB of startup source. That does not make the
agent-off graph a release artifact—the production lane still needs a normal
tree-shaken bundle compiled to HBC—but it explains why optimizing the old
number as if it were carrier cost would reward removal of the observer rather
than improvement of the product.

I preserved the old receipt as development-carrier diagnostic evidence and
proposed a second invalidation amendment. The replacement lane is paired on the
same simulator and requires Release configuration, production-bundled Hermes
HBC, no agent or debug overlay before first frame, a native-host frame mark, and
a structured product-owned authoritative-data mark. The collector now refuses
claim-grade receipts that do not attest all of those facts. The amendment is
still proposed, and Exact does not yet ship the qualifying iOS bundle path, so
the native claim remains honestly red.

Compared with React Native, this is less a runtime result than a packaging
lesson. Expo already has a conventional release-HBC lane. Exact has strong
development observability and a static startup envelope, but Partitime exposed
the missing bridge from that machinery to a benchmarkable production iOS
artifact. Acto remains valuable; it simply cannot be charged to every user's
first frame and then compared with a carrier where the equivalent inspector is
off.

## 2026-07-22 — the next 97 KB was a production introspection gate

The corrected one-page heap was still useful because it made a production-only
Contract bug visible. The signal runtime guarded its introspection graph with
`'env' in import.meta`; that shape looked defensive in Node, but it prevented
Vite from replacing the production constant. In an ordinary browser there is
no `process` fallback, so the runtime selected its development default and
registered metadata for every signal, computed, and effect.

Exact now uses a safe existence check around direct
`import.meta.env.PROD`/`DEV` reads, returns before production registration, and
does not look up computed metadata when cause recording is off. Focused
introspection and update-economy tests still pass, the three TypeScript
profiles pass, and an unminified release-artifact test proves the three
per-node registration calls are absent. On the same Contract × Supabase quick
workload, post-GC heap moves from 1,717,728 to 1,620,640 bytes while the route
turn stays at 6 mutation targets and 8 patches.

The retained snapshot also kept us from overfitting the wrong idea. Installing
ten browser listeners on every element looked expensive in allocation
sampling, but selectively installing them did not improve the measured heap;
I discarded that change. The remaining 226,540-byte miss is dominated by V8
code and eager compiled view representation: the snapshot has 137 mount
environments, 139 mounted `hostNodes`/`dispose` units, and the hidden create
view's registered AOT/IR even though the overlay is closed. The shared signal
module also still carries dead introspection code, so LLP 0192's stronger
zero-code promise is not yet met.

Compared with React plus Supabase, this is where Contract's compiler strategy
shows its current tradeoff most clearly. React leaves much of a closed branch
as lazy function code; Contract eagerly materializes more authored structure
so updates and tooling have explicit identities. That is not a fundamental
language failure, but it is a real production representation problem. The next
useful changes are a development-only introspection module boundary and
lazy/compact registration for unopened view regions—not provider or Snapback
subscription surgery.

## 2026-07-22 — the introspection implementation now leaves production too

The allocation gate was only half of LLP 0192's promise. It stopped registering
metadata, but the shared signal module still made the graph registry, bounded
cause tracing, value cloning, and churn implementation reachable as production
code. Exact now gives that machinery the same full-runtime/production boundary
used for error reporting and quiescence: the Contract Vite plugin resolves the
private bridge to a production stub, and Rollup removes both modules entirely.
The unminified reachability fixture pins zero rendered bytes for each module and
the absence of causal-carrier and registration symbols. All 27 focused
introspection, update-economy, and reachability tests and all three TypeScript
profiles remain green.

The external Contract × Supabase quick probe moved from 1,620,640 to 1,608,104
post-GC warm bytes while retaining 6 fan-out targets and 8 host patches. That
12,536-byte improvement is smaller than the preceding allocation correction,
which is useful evidence in itself: most of the remaining heap is mounted
product representation, not dormant diagnostics. The corrected 1,394,100-byte
threshold is still missed by 214,004 bytes, so no memory claim moves.

Compared with React plus Supabase, this closes one avoidable tooling tax without
changing Contract's core tradeoff. Development keeps a much richer explicit
reactive graph; production now pays zero for the inspector. The remaining work
is the representation of authored views—especially unopened regions and their
mount environments—not the fact that Contract supports introspection.

## 2026-07-22 — unopened plans and repeated environments were real, but small

The next two changes tested the retained-heap theory directly. Generated AOT
view registrations now keep each plan behind a first-mount factory, so closed
conditional/resource/component regions retain their compiled identity without
materializing their plan arrays. A runtime fixture proves registration and
lookup invoke no factory, first mount invokes exactly one, repeat mount reuses
it, and untouched siblings remain untouched. That moved the Supabase warm heap
from 1,608,104 to 1,606,532 bytes.

The sibling walkers also used to spread the full `MountEnv` for every node even
after leaving the component root. Exact now creates one immutable false-root
projection per boundary and reuses it through ordinary descendants; component,
keyed-repetition, pager, and other actual context changes still project a new
environment. The first browser attempt timed out before any cell receipt and is
discarded. Its clean rerun measured 1,600,228 warm bytes with update fan-out and
patches still 6/8, a further 6,304-byte reduction.

Both optimizations are worth keeping—the lazy plan also reduced the Supabase
artifact to 209,768 minified bytes across its two chunks, still below the
213,488-byte gate—but neither is the missing 200 KB. The remaining miss is
206,128 bytes. Compared with React, Contract is still retaining substantially
more compiled/mounted host representation, and the next investigation should
measure the large `instance.ts`/effect-supervisor/host-node footprint rather
than continuing to polish unopened overlay plans.

## 2026-07-22 — the direct DOM host was carrying native-shaped baggage

The admitted browser host still allocated the full renderer element shape for
every Contract node, including paragraph, inherited-layout, safe-area, and
kernel-encoding fields that the direct DOM path never reads. Each node also
owned three empty canonical records and an event map even though authored
`originalProps` remains the browser path's semantic and event authority.

Exact now has a narrow direct-DOM element factory, shares the empty
props/style/transition values and unused event map, and leaves the full native
factory intact. Direct-host semantics, production reachability, runtime
coverage, and all three TypeScript profiles pass.

The external Contract × Supabase quick probe measured 1,588,748 post-GC warm
bytes with update fan-out and patches unchanged at 6/8. That is 11,480 bytes
below the shared-environment checkpoint, but still 194,648 bytes above the
corrected React-relative threshold. Host representation is therefore a real
part of the retained-heap cost, but slimming its obviously unused fields is not
enough to close the claim; compiled code and mounted-instance/effect state are
still the larger target.

## 2026-07-22 — ordinary nested containers needed no new mount context

The sibling-environment change did not cover a second repetitive allocation:
every AOT element still spread the complete immutable `MountEnv` before
mounting its children, even when it was already below the component root and
no portal or dismiss boundary changed any field. Exact now passes that context
through by identity. Root transitions, portal repetition resets, and dismiss
layer ancestry still receive explicit projections, and focused identity,
runtime, reactivity, and codegen tests plus all TypeScript profiles pass.

The first external probe never loaded the app because Vite's SSR module
transport disconnected while fetching an unchanged dependency; it is not a
measurement. The identical clean rerun measured 1,585,184 post-GC warm bytes
and kept update fan-out/patches at 6/8. That saves another 3,564 bytes and leaves
191,084 bytes above threshold. The allocation was real and worth removing, but
its size confirms that context-object cloning is no longer the dominant miss.

## 2026-07-22 — direct event dispatch was duplicated per element

Paired quick-run heap snapshots made the next representation cost much less
speculative. Against React, Contract retained 320 additional native listener
wrappers and 724 additional JS closures overall. The admitted direct DOM host
installed nine arrow-function listeners on every element (plus input/change on
controls), so every passive layout and text container captured the same host
node repeatedly.

The first experiment attached listeners only when current props named a
matching handler. That reduced the native listener topology but expanded the
host's event decision code enough to make the frozen V8-heap metric 1,684 bytes
worse, so it was not kept. The narrower retained change preserves the direct
listener topology—and therefore native `currentTarget` and propagation—while
storing a private DOM-to-host identity and sharing one dispatcher function.
Replacement handlers are still read from current `originalProps`.

Eight direct-host tests, production reachability, hydration and plugin suites,
and all TypeScript profiles pass. The external Contract × Supabase quick probe
measured 1,571,580 post-GC warm bytes with update fan-out/patches still 6/8.
That is 13,604 bytes below the nested-environment checkpoint and leaves 177,480
bytes above threshold. The result confirms that closure/context duplication is
material, while the remaining miss is still mainly executable/runtime state
rather than one giant host object.

## 2026-07-22 — asking for attribute objects created attribute objects

The paired heap comparison also showed 178 more retained native `Attr`
wrappers on the Contract page. The direct host's stale-attribute loop used
`element.attributes`, which asks the browser to materialize object wrappers,
then immediately threw those objects away after reading their names.

The host now uses `getAttributeNames()`. Stale removal, hydration adoption, and
presentation output are unchanged, and the direct-host suite passes. The same
external quick probe measured 1,567,664 post-GC warm bytes with 6/8 update
fan-out/patches, 3,916 bytes below shared event dispatch and still 173,564
bytes over threshold. This was small but clean: browser object APIs can create
retained wrapper cost even when application semantics only need strings.

## 2026-07-22 — initial style application did not need a CSSOM wrapper

The direct host also requested `element.style` for every full presentation and
set each validated property independently. Exact now serializes that same
ordered style map into one `style` attribute. Values have already passed the
shared inline-style safety check, and narrow reactive style patches still use
CSSOM, so update semantics stay unchanged.

The direct-host suite passes. The external Contract × Supabase quick probe
measured 1,564,980 post-GC warm bytes with 6/8 update fan-out/patches, 2,684
bytes below the attribute-name checkpoint and still 170,880 bytes above the
corrected threshold. Like the `Attr` result, this is a small browser-wrapper
win rather than the missing core-runtime reduction.

The combined candidate subsequently passed the immutable production browser
corpus 9/9: static routes and JavaScript-disabled authority, byte-identical
hydration adoption with zero recreated nodes, non-root base paths, history and
metadata, exactly three event subscriptions, and unsolicited Snapback push.

## 2026-07-22 — the remaining memory miss is the unfinished production artifact

After the safe host and environment reductions, the corrected Contract ×
Supabase quick baseline is 1,564,980 post-GC warm bytes against 1,394,100,
with update fan-out and patches already green at 6/8. Paired heap snapshots
put the Contract/React JavaScript delta mainly in compiled code, object shapes,
arrays, and closures—not in the one active query subscription. The generated
feed makes that concrete: it retains 97 expression closures, 87 lazy view
registration factories, and a parallel compact runtime-IR skeleton containing
158 objects and 97 arrays.

Three tempting reductions clarified the design boundary. One effect per
static ownership subtree measured 1,554,740 bytes, but it replaces Contract's
per-element/text dependency graph with union tracking. Compact interpreted
view-value plans combined with that grouping measured 1,545,280 bytes, but
undo the compiled-expression side of Exact LLP 0185. Prototype-backed mounted
units preserved the model but only reached 1,560,208 bytes. None was retained:
the two larger wins spend Contract's intended update semantics for less than
20 KB, and the representation-only win is too small for its added machinery.

This changes the shape of the remaining work. The missing 170,880 bytes are
not a Snapback subscription leak and are unlikely to disappear through more
DOM-wrapper polishing. LLP 0185's production artifact matrix already says
production ships closures but not runtime IR; the implementation has not yet
reached that state. The next credible memory slice is to generate structural
and hydration identity into the AOT artifact, link child/branch closures
directly, and stop retaining the duplicate production view tree while keeping
fine-grained effects, compiled expressions, source attribution, and on-demand
authorized editable IR. Until that larger S2 slice is implemented and
remeasured, the memory claim remains red.

## 2026-07-23 — a real iOS IME found a Contract custody bug

Synthetic composition tests had not exposed the production failure. On iOS
26.5 Mobile Safari, the Japanese Romaji keyboard wrote marked text into the
native Description control, but Contract's direct web host forwarded each
composing `input` and immediately reapplied the stale controlled value. The
candidate buffer visibly snapped back. This was an Exact/Contract bug, not a
Snapback subscription or Partitime form bug.

Exact `72ea2d978…` now leaves marked text under browser ownership from
`compositionstart` through `compositionend`, skips controlled-value writes
during that interval, publishes the final value once, and suppresses Safari's
duplicate post-composition `input`. The compatibility DOM mirror follows the
same rule. Focused tests retain the preview across an unrelated Contract
commit and prove one Japanese final callback. The 89-test host slice, the
registered IME acceptance gate, and all JavaScript typecheck profiles pass.

The rebuilt production Partitime candidate was then exercised with actual
system-keyboard taps for `kanpai`, not injected text. The screenshot shows
underlined `かんぱい`; selecting the first native candidate leaves `乾杯`
visible, and the simulator Accessibility tree reports the Description value as
`乾杯`. The receipt binds the Snapback and Exact revisions, production asset,
browser/OS builds, screenshots, and local evidence digests. This is one real
iOS-current citizenship row, not a general mobile-forms claim.

The current−1 lane was instructive in a different way. The available iOS
26.3.1 simulator returned the correct semantic control value, but a system-only
Safari probe rendered all Japanese and emoji glyphs as missing boxes in both
body text and a native form value. The same probe renders normally on iOS
26.5. That runtime is retained as an invalid environment receipt; none of its
five rows is promoted.

Fresh Chrome and Firefox runs pass focus restoration and native find. Desktop
Safari could not be rerun after the Exact change because the remote macOS
console became non-interactive: Safari scripting saw a document while System
Events saw no frontmost process and zero Accessibility windows. The harness
now fences Safari process exit between WebDriver and ordinary native-Find
phases, but the locked console remains a red environmental prerequisite rather
than a product pass.

Compared with React plus a data service, the failure shape is specific to a
controlled compiled host: the data layer was not involved, while Contract's
host had to state explicitly when the browser temporarily owns the value.
Partitime's strict citizenship runbook helped here—the missing mobile and
locked-console rows stayed red, and stale desktop receipts were not carried
across the Exact candidate change. No Snapback guide gap was encountered in
this slice.

## 2026-07-23 — the corrected native lane reached the production-runtime boundary

The ratified v2 native method now has real collectors on both sides. They pair
the same simulator host, alternate carrier order, keep warmups out of reported
samples, require Release/Simulator Hermes HBC with Acto and debug overlays off,
take first frame from the native host, and accept first authoritative data only
from a structured Partitime product marker. The Exact app entry-point isolation
also had to be carried into the working Exact branch so the ordinary Release
target—not the dedicated acceptance target—could compile.

The first implementation still used Exact's startup-artifact endpoint. Its
2,561,112-byte HBC across 265 modules contains no agent module, but inspection
found the `__exactDevModules` envelope: it is a smaller development carrier,
not the production-bundled HBC the amendment requires. I rejected that sample
before committing it. The corrected path builds one production Vite/Rollup
graph instead. It is 1,515,793 bytes, maps 358 source modules, and omits the
development module table, but it still contains five lazy dynamic imports for
development/inspection surfaces. Hermes cannot turn that graph into the
required single HBC. This is now an explicit fail-closed preflight rather than
a mislabeled green artifact.

For completeness, forcibly staging the rejected module-table HBC reached a
second boundary: the ordinary ExactApp Release target built, installed, and
launched, but stopped before the bytecode-evaluation mark. Exact's authenticated
armed-runtime resources explain that refusal: Ibex does not yet advertise an
executable Exact Apple target because its report-derived CapSec cells are
incomplete. A diagnostic runtime would bypass this, but would violate the
ratified production lane, so all four native performance rows stay red.

This was mostly an Exact production-carrier gap, not a Snapback subscription or
Contract application-size problem. Snapback's contribution is the paired
custody and product-data witness; it behaved as intended by distinguishing a
development HBC, a production bundle, and an executable production launch.
Compared with Expo, Exact still needs both a single-HBC-safe production graph
and the authenticated executable runtime that make release performance
collection routine. No Snapback guide gap was encountered.

## 2026-07-23 — the H1 production regression was real, and the repaired holdout is still red

The first full holdout against Exact's H1 hydration candidate stopped at the
first Contract cell. Source-map tracing found an Exact runtime read of
`def.file.uses.find(...)`; production Contract modules deliberately remove
that compiler-only inventory. Adding only optional chaining would have hidden
the crash while also losing the ratified diagnostic for opaque author code
that runs during candidate preparation.

Exact `f5251ef80…` instead retains a minimal production table containing only
each opaque import's spec and span. Full descriptors and ordinary imports stay
out of the client artifact. A production-shaped hydration regression proves
the diagnostic still names its authored locus, and codegen tests prove a
declared pure import retains no runtime descriptor metadata. The focused and
neighboring suites pass 101 tests, all JavaScript typecheck profiles pass, and
the actual Contract × Snapback production cell boots and records metrics.

The clean full holdout then completed all twelve web cells and all twelve
production/incremental build cells against the original committed calibration.
There were no cleanup errors and all four remote/local backends were healthy.
Of 44 Contract validation rows, 34 now pass. Cold startup, authoritative/live
data, idle network, update fan-out, DOM patches, and both build-latency
categories are green. The remaining ten failures are:

- warm startup in all four cells (Snapback misses by 0.1 ms; the other cells
  miss by 10.8–15 ms);
- memory in all four cells (roughly 1.64–1.91 MB observed against
  roughly 1.39–1.61 MB allowed); and
- idle CPU in Contract × Snapback and Contract × Supabase.

The aggregate budget receipt improves to 15 pass / 11 red. It also shows that
minified JavaScript remains slightly over threshold for the three non-Snapback
Contract cells, authored source and push freshness remain red, and native v2
has no admissible holdout. Production web remains 11/12 because the strict
citizenship matrix is still incomplete. This is useful evidence, but not Step
4 exit and not a reason to move either frozen claim to green.

The experience is sharper than the earlier quick probes: the remaining web
miss is not one generalized “Contract is slow” result. Most runtime categories
are green, build latency is now comfortably green, and the hard remainder is
the production representation/memory project already identified at Exact LLP
0185 plus smaller startup/idle work. No Snapback guide gap was encountered.

## 2026-07-23 — Safari remote automation was enabled, but the console stayed locked

The current clean Safari 26.5.2 rerun reached a ready Partitime page through
safaridriver, so Developer → Allow Remote Automation is correctly enabled.
Its native click still never reached the create trigger: after the click, the
feed and trigger were present, the trigger remained focused, and no overlay
existed. At the same time, System Events reported the Safari process with zero
Accessibility windows and no frontmost process. The ordinary Safari document
existed by scripting, but native Find could not see its visible copy.

The collector now retains that post-click DOM state. This matters because the
same timeout could otherwise look like a Contract focus-scope regression.
Here both native input and Accessibility failed at the host-console boundary,
while browser script execution remained available. The complete 0/2 receipt is
claim-eligible evidence of a red environment prerequisite, not a product pass
and not a skipped row. No Snapback guide gap was encountered.

The cumulative collector initially threw away those two completed failures and
reconstructed them as generic “evidence missing” rows. That preserved the red
count but lost the useful distinction between an unrun check and a clean
machine invalidation. It now admits both outcomes from a complete, clean,
source-bound WebDriver receipt: green results become passing rows, while
failures retain the receipt hash and diagnostic under an explicit machine-check
failure code. The cumulative result stays 5/21; its Safari reds are now
auditable evidence rather than absence.

## 2026-07-23 — the H2 producer boundary is safer, and the fresh holdout remains red

Charlie ratified Exact LLP 0386 §3.8 and both dated WS8 invalidations. Exact
`8659784e0…` now validates hydration producers before emission: static export
fails closed, request-time and direct SSR report diagnostics without changing
the frozen v1 response contract, real serialized HTML is parsed back against
the manifest, and duplicate component anchors no longer silently select the
last record. The implementation passes the focused 129-test
hydration/server/renderer corpus, all JavaScript typecheck profiles, both
hydration check scripts, and a real release web build.

The independent full holdout at Snapback `baa1082e…` and that Exact revision
consumed the unchanged committed calibration `b991f364…`. All twelve browser
cells and all twelve production/incremental build cells completed, the four
providers were healthy, and cleanup was clean. Thirty of 44 Contract rows pass.
The fourteen failures are all four warm-startup, subscription-memory, and
production-build rows, plus idle CPU for Snapback and Supabase. This run is a
little noisier than the preceding H1 holdout: production-build p95 crossed the
frozen boundary in all four cells. The values are retained rather than
discarded or rebaselined.

The aggregate is therefore 14 pass / 12 red / 9 nonclaims. Production web
remains 11/12 because citizenship is still red. The producer checks add about
377 minified bytes to each Contract cell; Contract × Snapback remains
comfortably below its threshold, deterministic gzip remains green everywhere,
and the three other minified cells remain about 9.2 KB over. This is a useful
H2 safety checkpoint, not Step 4 exit. No Snapback guide gap was encountered.

## 2026-07-23 — memory needed two questions, not one mislabeled number

Exact LLP 0381's production-program work made a measurement flaw concrete.
The existing Partitime row called `memoryPerActiveSubscriptionBytes` observes
one warm subscription and reports the target's total post-GC heap. It is useful
as a footprint constraint, but it cannot tell us whether Contract has a large
fixed runtime, an expensive per-subscriber representation, or both.

The proposed WS8 amendment now keeps both questions. It retains total heap for
one canonical subscription and separately fits marginal heap across 1, 8, 32,
and 64 independent logical subscribers. The marginal judgment uses the
one-sided upper confidence bound, so measurement uncertainty makes the result
harder—not easier—to pass. Thresholds come only from same-backend React
calibration, the already-frozen 1.10 multiplier, and a fixed 4,096-byte
resolution floor; Contract observations cannot select their own target.

Writing the method before the collector was valuable. It forced us to specify
provider deduplication, independent callback/disposer ownership, count
randomization, cohort isolation, target-isolated cleanup, and invalid-sample
policy.
A fail-closed validator makes those choices executable. The amendment remains
proposed, so I did not run calibration or turn this design into a performance
claim. No Snapback guide gap was encountered.

The first no-DOM React smoke also prevented a bad cleanup rule from freezing.
React retains target-scoped high-water caches after unmount, so same-document
heap recovery mislabeled ordinary framework behavior as an observation leak.
The corrected method warms one unreported subscriber before the zero-active
baseline and proves the isolation property that matters across observations:
every logical handle is gone, the harness reports zero active/ready
subscribers, the provider/root is disposed, and Chrome attests that the fresh
target no longer exists. The post-disposal heap is still retained as
diagnostic evidence, but cannot exclude an observation or feed a claim.

Non-claim one-sample Supabase diagnostics now complete for both arms. React's
four-point fit was about 3.37 KB per logical subscriber with a roughly 5.86 KB
one-sided upper bound; Contract's was about 0.84 KB with a roughly 1.68 KB
upper bound. The ordinary product totals were still about 1.26 MB and 1.63 MB.
One sample per count has only two fit degrees of freedom and is not suitable
for promotion, but it is a useful engineering signal: the observed Contract
problem looks much more like fixed product/runtime representation than
per-subscriber data binding. No threshold was derived or retained.

## 2026-07-23 — the Exact production graph is a real HBC; the security target is still closed

The native collector no longer depends on Exact's development module service.
Exact gained a build-only transform that leaves literal route imports available
to Rollup but turns opaque inspection/HMR imports into explicit rejected
promises. Partitime now selects native variants, imports the shared runtime
bootstrap, and bundles the product through one production entry. The result is
a 437-module IIFE with no dynamic imports or development module table; Hermes
compiled it to a 3.17 MB HBC, and the Exact Release/Simulator app admitted the
same bytes.

That separated two problems which previously looked like one. The production
graph/HBC problem is solved. The app still stops before bytecode evaluation
because Ibex refuses to prepare an armed runtime on iOS: its current registry
advertises no executable target, and it has no report-backed iOS target row.
Exact now logs that immutable prelude failure, and the Snapback collector waits
for and records the specific refusal instead of racing to the later generic
`JS evaluation failed` mark.

This is an Exact/Ibex release-custody boundary, not a Snapback or Contract app
failure. React/Expo makes the analogous Release/HBC launch routine; Exact still
requires its report-derived CapSec target program to land before the paired
performance lane can run honestly. A diagnostic runtime would be easier, but
would violate the ratified lane and erase the security property the Release
carrier is supposed to measure. No Snapback guide gap was encountered.

## 2026-07-23 — the next Exact release needs its own bundle gate

The published Exact 0.1.5 runtime remains below every frozen Contract bundle
threshold, but the current source-linked Exact checkout does not. After
retaining the newer hydration and citizenship work, the three gateway cells
emit about 220.5 KB of minified JavaScript against roughly 213.5 KB limits;
deterministic gzip still passes. This does not invalidate the retained 0.1.5
claim, but it is a release-blocking regression for the next runtime.

Two Partitime packaging changes made the comparison entry point more honest.
Snapback-only client, adapter, and manifest imports now stay behind the
Snapback backend branch instead of entering every cell's module graph, and the
supported native-ESM browser matrix no longer receives Vite's legacy
module-preload polyfill. All four Contract production builds completed. The
Snapback browser path passed 4/4, including fallback-disabled push, and the
Supabase path passed 3/3 after a parallel gateway-port setup collision was
rerun alone.

The remaining raw-byte miss is mostly in Exact's newer hydration transaction
and direct production host, not Snapback transport code. Compacting the
hydration snapshot saved a small amount without weakening its all-or-nothing
fallback, but ordinary minifier changes were not enough to close the gap.
That makes the next step an Exact production-runtime representation problem,
not a threshold rebaseline or a reason to remove browser correctness. No
Snapback guide gap was encountered.

## 2026-07-23 — real Safari autofill exposed one missing Contract semantic

The strict citizenship run could not use WebDriver typing as an autofill
witness. The iOS simulator instead received a committed, synthetic vCard and
selected that contact as its local My Info identity. This kept the run
non-sensitive while exercising Safari's real keyboard accessory and contact
autofill path.

The first native attempt exposed a small but important Contract gap: a built-in
`input` diagnosed `autoComplete` as unknown, even though Exact's web host
already safely passes that standard attribute through to the DOM. Exact
`1974a6129…` added the schema-owned input attr, compiler and renderer tests,
and regenerated reference/editor artifacts. Partitime then marked Location as
`autoComplete="street-address"`.

On iOS 26.5 Safari, focusing the resulting field presented both the native
`AutoFill Contact` accessory and the synthetic home-address suggestion.
Selecting it wrote `123 Market Street` through the ordinary controlled-input
path, and the field remained editable. This is a much stronger witness than
script injection: it crosses the browser-owned suggestion UI, Exact's direct
DOM host, Contract's change binding, and the app's form state.

The change was easier than a React workaround would have been once the schema
authority was located: one semantic attr, no raw DOM escape, and the existing
host sanitizer/lowering remained the single implementation path. The friction
was discoverability—the supported attr list correctly refused the spelling but
offered no paved substitute. That is an Exact/Contract capability gap, not a
Snapback guide gap.

## 2026-07-23 — the complete current−1 Safari runtime turned missing rows into real tests

Installing iOS 26.4 replaced the invalid iOS 26.3.1 simulator image rather than
papering over its broken Japanese/emoji font rendering. The new current−1
runtime exercised the same product build with the native Japanese Romaji
keyboard, committed synthetic contact, and Safari Page Menu as iOS 26.5.

The current−1 IME produced visibly marked `かんぱい` and offered `乾杯` as a
native candidate before Return committed the value. Its contact accessory
offered the synthetic `123 Market Street` home address and populated the
controlled Location input. Native Find reported `1 of 1` for `Sunset Supper
Club`; after dismissing the Find UI, the event still opened. The current
runtime supplied the matching autofill and Find observations. These are
browser-owned behaviors, not JavaScript event injection.

Focus and bfcache are better served by a machine receipt than screenshots
alone, so the acceptance corpus now has a dedicated iOS Safari WebDriver
collector. It binds the named simulator and built candidate, tests
Tab/Shift-Tab/Escape containment, then retains an unsubmitted event-wall draft
across a real document leave/back traversal, requires
`pageshow.persisted === true`, edits the restored draft again, and returns to
the feed. This division of labor felt right: native UI for IME/autofill/Find,
and browser instrumentation for the otherwise invisible bfcache flag. No
Snapback guide gap was encountered.

## 2026-07-23 — narrow production entries closed the byte and build gaps

The final Contract bundle work was mostly about reachable graphs, not missing
minifier tricks. Exact now exposes a bounded production hydration reader and a
frozen no-op adoption capture instead of making the browser retain the
producer transcript. Its direct DOM host also carries the node selected by
whole-tree preflight into commit, avoiding a second validation turn after the
mutation boundary. Importantly, the ordinary diagnostic validator kept its
human-readable messages; the size win is isolated to the production path.

Snapback had the same shape of issue at a smaller boundary. The Online
Partitime cell needs `SnapbackClient`, not every optional client capability, so
`@snapback/client/online` now re-exports the identical class through a public,
tree-shakeable entry. The Contract surface likewise passes the three Exact
runtime functions the Snapback adapter actually calls instead of a runtime
namespace. That put all four fresh Contract builds below their frozen byte
limits: Snapback is 366,504 minified bytes, and the three gateway cells are
213,102/213,092/213,092.

Production build latency had a separate fixed cost. This app owns its HTML
shell, but its Vite config loaded Exact's full development agent/server plugin
for production builds. Keeping that plugin for `vite serve` while retaining
the compiler and production boundary plugins for `vite build` cut quick
one-sample builds from roughly 0.9–1.1 seconds to 0.47–0.55 seconds. Those
probes are deliberately nonclaim; the ratified calibration/holdout still has
to establish the result.

This felt like a good paved-road outcome. Snapback and Exact both needed
capability-scoped public entries, but the application did not lose hydration,
push, diagnostics, or dev tooling to get there. The complete browser baseline
remains 43/43. The headless-client guide now names the Online entry, so this
did not create a new guide gap.

## 2026-07-23 — a green build exposed two unfairly red instruments

The fresh claim-grade calibration and holdout did exactly what they were
supposed to do: they kept the optimized build result honest. All four Contract
production-build p95s landed at 299–421 ms in holdout against 918–1,097 ms
committed thresholds. The same run also made it obvious that two other rows
were measuring the wrong thing.

The first-UI observer did not start until `DOMContentLoaded`. React creates its
product shell from JavaScript, so that still observed a UI mutation. Contract
ships a complete prerendered shell, but the collector ignored it until the
module graph had evaluated. A nonclaim document-start probe observes Contract
× SQLite at 30–31 ms, versus the old 62–94 ms surrogate and a 39 ms warm React
probe. That is an instrument correction, not permission to weaken startup.

Idle CPU had a different resolution problem. The same React controls moved by
0.02–0.32 task ms/s between independent cohorts, while formula-derived limits
were only 0.199–0.742 ms/s and the already-declared absolute ceiling was 25
ms/s. A relative five-percent comparison below one task millisecond per second
was classifying Chrome/CDP scheduler jitter as framework cost. The proposed v3
method keeps the 25 ms/s ceiling and adds a pre-sampling 1 ms/s de minimis
floor.

The authored-source row was also asymmetric: React's 11,552-byte stylesheet
was absent, while Contract's inline styles were counted, and later static
hydration/prerender support had been added only to the candidate without a
source-workload rollover. The proposed replacement compares complete shared
product-authoring bytes and reports asymmetric platform support separately.
The current product row is 21,618 Contract bytes against 27,517 React bytes;
neither proposal can promote a claim before ratification.

## 2026-07-23 — locale-default formatting broke otherwise-correct hydration

A source-bound immutable-production rerun failed Exact's adoption gate even
though static rendering and client rendering each looked right in isolation.
Partitime's `fmtWhen` helper delegated both field selection and punctuation to
locale-default `toLocaleString`: Bun rendered `Sat, Aug 1 at 6:00 PM`, while
Chrome rendered `Sat, Aug 1, 6:00 PM`. Exact correctly treated those as
different authored bytes and recreated the tree instead of claiming adoption.

The app now pins the `en-US` calendar and `America/Los_Angeles` product time
zone, reads named `formatToParts` fields, and owns the punctuation joining
them. A focused probe requires Node and Bun to render all three fixture dates
identically; the immutable browser gate remains the browser-side proof.

This was app-authoring friction shared by React SSR and Contract SSG rather
than a fundamental Contract defect. Exact's capability index already marks
`ssg.static-export` as an owned Guide GAP, so there was no page that falsely
promised a locale-determinism paved road. The failure mode was unusually good:
the adoption gate rejected the mismatch and made the non-deterministic helper
obvious instead of silently replacing the first paint.

## 2026-07-23 — physical Android closed the last citizenship rows

The remaining Android rows needed browser-owned behavior, not a desktop
emulation or synthetic DOM events. A physical Nothing A069P running Android
16 supplied Chrome 150 Stable, Gboard's Japanese QWERTY layout, Google
Autofill, hardware key delivery, the system Back action, and Chrome's native
Find UI. Chrome 150 was admitted as current because it was the broadly
released Android Stable major on the run date; the Chrome 151 announcement
explicitly described an early-Stable rollout to only a small percentage of
users.

The real IME path produced visibly marked `かんぱい`, then committed the native
`乾杯` candidate through exactly one `compositionend` with no non-composing
input before it. Chrome's synthetic local address profile populated
`123 Market Street` through one input and one change event while the Contract
dialog stayed open. Hardware Enter, Shift-Tab, Tab, and Escape proved the
dialog trap and opener restoration. A document leave followed by Android Back
returned with `pageshow.persisted === true`, retained the unsubmitted wall
draft, and accepted another edit. Native Find reported `1/1` for the visible
event title, and a physical tap still opened the event after the Find UI was
dismissed.

Each row is tied to one device receipt plus the relevant screenshots and
content hashes. The phone's font scale was the normal `1.0`; the run therefore
also exposed narrow-screen visual pressure in the event detail layout that
the five citizenship assertions do not themselves judge. That should remain
visible as product-UI work rather than being mislabeled as an IME, autofill,
focus, bfcache, or Find failure.

The desktop Safari, Firefox, and Chrome receipts were then rerun from clean
Snapback commits against the current Exact `ab8e87a6…` source. The cumulative
collector admitted all 21 rows with no skips or cleanup errors, making the
strict citizenship result claim-eligible. The separately invoked
production-web aggregate then consumed that committed receipt and passed all
12 requirements, including immutable artifacts, no-JavaScript authority,
zero-recreation hydration, history, metadata, non-root base paths, push, and
the Exact capability registry. Neither result promotes an unratified
performance instrument. No Snapback guide gap was encountered.

Merging the later product-UI work exposed an evidence-custody collision: the
older Exact LLP 0211 bridge and the newer strict Partitime collector both wrote
`step4-web-citizenship.json`, while the downstream validators expected the
older envelope. The two receipts now have distinct paths. Production and UI
closure validate the 21-row Partitime receipt—including every local evidence
hash and source receipt—while the incomplete Exact bridge remains available as
independent red evidence. This is the kind of integration failure a typed,
single-writer artifact registry would have prevented; the fail-closed
aggregate caught it before claim promotion.

The first post-merge budget preflight caught a second integration drift before
sampling: the proposed source-v2 comparison still described the partial UI,
not the final 156-variant product workload. React had grown from the proposed
27,517 bytes to 41,447 and Contract from 21,618 to 36,212 as both arms gained
the full form, validation, menu, sheet, RSVP, wall, responsive, and visual
states. Because v2 was never ratified, it is retained as superseded evidence
rather than treated as an authority. The v3 proposal freezes the final file
inventory and hashes and still derives its 45,591-byte Contract limit solely
from React plus the existing 1.10 multiplier. Contract is below it, but that
fact is not a claim until the proposal is ratified.

Before handing those decisions back to the owner, I tightened the authority
edge itself. Each July 23 proposal now carries the exact statement that
ratifies it, and every claim-eligible collector rejects a status-only edit or
an approximate approval. That was a small but useful reminder that a
fail-closed benchmark needs to protect not only numbers and source hashes, but
also the transition that gives them authority.

The native observer then got its first honest end-to-end exercise. A clean,
cached Release build installed on the iOS 26.3 simulator and reached the real
Partitime first-authoritative-data marker with every Ibex and Exact observer
marker present, no diagnostic runtime, no early agent, and clean teardown. The
quick sample looked plausible—19 ms Hermes evaluation and a 2.18 MB HBC—but it
is deliberately recorded as a non-claim probe. The useful result is not the
number; it is that the proposed measurement lane actually reaches and observes
the product without weakening the ordinary carrier by default.

The proposed web-v3 lane received the same pre-ratification treatment. Its
quick path reached all 12 UI/backend cells and all 12 build cells from clean
Snapback and Exact revisions, including the real remote Supabase and Convex
fixtures. Every backend preflight found the expected three rows, teardown was
clean, and the receipt binds the preregistered invalidation content. This was a
useful plumbing proof after the earlier source and observer changes: the whole
matrix is runnable without silently dropping a remote arm. It is not
performance evidence. Zero warmups, one sample, and a 200 ms idle window make
the recorded values diagnostic only, and the receipt remains
`claimEligible=false` until the owner ratifies the instrument and the full
calibration and independent holdout cohorts run.

Charlie then supplied all four exact July 23 Step 4 ratification statements.
The memory-v2 construct, web-v3 instrument, completed authored-source-v3
inventory, and native-observer-v3 lane are now authoritative. Recording that
transition is intentionally separate from running them: ratification permits
calibration and holdout collection but does not turn the earlier quick probes
or their diagnostic numbers into evidence.

The first claim-grade web-v3 calibration found a long-run harness defect after
eight cells: Chrome had already destroyed a measurement target, but the
attached CDP connection lost the `Target.closeTarget` response and then also
timed out trying to list targets. Treating that silence as successful cleanup
would weaken custody; failing the whole cohort after many minutes made the
instrument unnecessarily brittle. The shared web/memory cleanup path now
rechecks target absence over a fresh browser connection and, if the original
connection really is stalled while the target remains, closes it through that
fresh connection and proves absence again. The timed interval and application
bytes are unchanged. Focused tests cover ordinary closure, lost-response
recovery, stalled-connection recovery, and the still-present failure case.
The next attempt exposed a separate avoidable delay: gateway preflight had
already recorded an unhealthy later remote backend, but the collector did not
reject it until it reached that backend after sampling earlier cells. Web and
memory collection now validate every selected backend immediately after the
one cohort preflight, before producing the first sample.
This was benchmark-infrastructure friction rather than Snapback, Exact, or
Contract authoring friction, and it did not expose a guide gap.

## 2026-07-25 — integrated product checks needed authority and route isolation

The first clean integration run of the final React and Contract product
surfaces failed five of twelve focused UI checks even though the individual
features were present. Three failures belonged to the acceptance boundary:
React detail assertions ran before its initial live query delivered, both
authoring arms mutated one in-memory Snapback fixture even though the
responsive oracle required the canonical three rows, and CDP waited for the
Contract async key handler long enough to miss the deliberately bounded
optimistic row. The runner now waits for the semantic detail surface, gives
each product arm its own in-memory Snapback authority, and installs its
pending-state witness before dispatching Enter. The isolated reduced-motion
run observed `Sending…` for about 459 ms, confirming that the app behavior was
right and the polling observer was wrong.

One failure was real Contract application integration friction. Closing the
create sheet navigates from `/events/new/` to the feed, and the Contract host
replaces the mounted tree for that route. Exact's local `focusRestore` correctly
targeted the old opener, but that node no longer existed after the remount.
Partitime already carried a semantic `focusTestId` on its navigation event; the
route owner now applies it after the replacement tree commits. That makes the
cross-route focus contract explicit without weakening the overlay primitive or
requiring the app to retain a stale DOM node.

After these repairs, the focused Chrome product lane passed 12/12 and the
ordinary Contract × Snapback push lane passed 4/4. This felt like normal
whole-application integration work rather than a fundamental Contract or
Snapback limitation: Contract supplied the overlay and route ingredients, but
the app still had to join their lifetimes. The existing Contract adapter guide
covered the provider boundary; no missing Guide instruction caused these
failures, so no `guide-gap` ticket was filed.

## 2026-08-15 — production provenance becomes checkout-independent

Rebuilding all three web surfaces exposed two separate sources of local-path
leakage. The shared Partitime cost-attribution plugin serialized Rollup module
IDs verbatim, while the Contract prerender path used Vite's development server
and therefore embedded an unnormalized Exact hydration manifest even after the
surface moved to Exact 0.1.7. The build inputs now preserve repository-relative
provenance and deliberately redact absolute external module IDs; the prerender
does the same before serializing hydration state. Regenerating the ignored
codegen cache and installing the Convex surface cache were enough to make all
three full builds runnable. This was build-pipeline friction rather than a
Snapback authoring or Guide gap, so no `guide-gap` ticket was filed.
