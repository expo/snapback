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
