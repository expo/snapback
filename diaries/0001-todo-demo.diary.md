# Diary 0001: Todo demo

**Demo:** Todo list (the floor reference app)
**Surfaces:** headless (required), Contract/Exact (optional, working)
**Author:** Claude / Codex
**Date:** 2026-06-26
**Related:** LLP 0003, LLP 0004, LLP 0005, LLP 0010, LLP 0012, LLP 0015

## 2026-06-26 — Building the todo demo and binding it to Contract/Exact

This is the concrete build record for the first demo: what felt good, what felt
bad, what surprised me, and where I had to work around something. Snapback and
Contract/Exact observations are kept separate, and I compare the experience to
React + Convex / Supabase at the end.

### What I built

One source-authored backend (`schema.mjs` + `functions.mjs`) feeding a codegen
that emits **both** the Snapback server manifests and the Contract data manifest,
plus a shared client/bridge in `demos/_kit/`. A headless acceptance suite drives
the live Rust server through every LLP 0010 first-acceptance-app criterion (14
checks). A real `.contract` surface compiles against the generated descriptors
and mounts against the live server with cross-surface verification (6 checks).
All 20 checks pass, plus `ref-check` and `cargo test`.

### Snapback: what felt good

- **Diagnostics are a real contract, not an afterthought.** Every failure mode
  the acceptance suite needed already had a distinct, stable code and a sensible
  HTTP status: `SNAPBACK_FUNCTION_NOT_LIVE` (404→ actually 400), `SNAPBACK_MUTATION_CONFLICT`
  (409), `SNAPBACK_SCHEMA_SYSTEM_FIELD`, `SNAPBACK_UNKNOWN_FIELD`,
  `SNAPBACK_UNKNOWN_FUNCTION` (404). I could assert on codes instead of scraping
  prose. This is the single biggest agent-DX win and it is exactly what LLP 0010
  promises — and, refreshingly, the system delivered it.
- **`/inspect` tells the truth about gaps.** `capability_gaps` lists
  `ibex_ctx_db_host_bridge`, `postgres`, `assets`, … explicitly. Building against
  a backend that *advertises what it can't do* is a different experience from the
  usual "find out at runtime."
- **The subscription seam is right.** `subscribe_live` returns the authoritative
  initial snapshot *in the same response* as the subscription id. No `getAllDocs`
  prime race — the thing every Valet demo got wrong (LLP 0012) is already fixed.
- **Deterministic seed bypasses handlers.** `/admin/seed` writes straight to
  storage, so fixtures are reproducible and order-stable (`seed_todo_1..3`),
  exactly as LLP 0010 asks. Reset → seed → assert is trivial.

### Snapback: what felt bad or surprising

- **No JS `ctx.db` handlers yet (the headline gap).** LLP 0004's marquee API is
  `defineMutation({ handler: (ctx) => ctx.db.insert(...) })`. That path isn't
  wired (the Ibex host-call bridge is a capability gap). So I could not author
  real handlers; I authored declarative **HostPlans** (`Insert`/`Patch`/`Delete`
  + `ValueExpr` of `Arg`/`AuthUserId`/`Literal`/`Binding`/`Runtime*`). For todo
  CRUD that vocabulary is enough, but it's a *different authoring model* than the
  docs imply, and anything conditional (e.g. "toggle" computed from current
  state) would need either a richer plan vocabulary or the real handler runtime.
- **The wire format is unforgiving by hand.** serde external tagging +
  snake_case: `field_type`, `indexed_by`, `bind_id_as`, enum variants as
  `"LiveQuery"` / `"AuthUserId"`, nested `{"HostPlan":{"Query":{…}}}` and
  `{"Insert":{…}}`. There is **no published TypeScript type** for any of it — I
  derived shapes from `src/manifest.rs`. Hand-writing this JSON would be a
  silent-bug farm. This is the strongest argument for the generated typed client
  package LLP 0012 calls for; I felt its absence immediately.
- **Live updates are coarse.** Any mutation re-runs *every* subscription and
  enqueues a `live_replace` to each connection's outbox — no read-set matching
  yet. Correct for v0 (it over-notifies, never under-notifies), but it means the
  realtime path won't reveal fan-out cost until matching lands.
- **Realtime is poll/drain, not push.** Updates land in a per-connection outbox
  you `GET /outbox/{id}`. Great for deterministic tests (no `setTimeout`), but a
  real client needs a transport (WebSocket/SSE) that doesn't exist yet.
- **Read-set conflict is opt-in from the client.** The server validates a
  `read_set` only if the client supplies one; it does not yet capture the
  handler's reads at handler time. So optimistic-safety is the caller's
  responsibility for now. Honest, but a sharp edge.

### Workarounds I had to make

- **Executed-DSL codegen instead of hand-JSON or a regex parser.** I wrote a
  small builder DSL and a codegen that *executes* the definition module to
  produce the manifests. Executing (not regex/AST-parsing) sidesteps the Valet
  silent-drop trap (LLP 0006/0010): a typo is a loud runtime error, never a field
  quietly missing from the schema. The codegen also re-implements the server's
  validation rules so the same failure class is caught *early*, at codegen time,
  with the same code family.
- **One source of truth → two manifests.** To avoid the protocol.ts/protocol.rs
  drift LLP 0012 warns about, the Snapback server manifests and the Contract data
  manifest are generated from the same definitions and share one `inputsHash`.

### Contract/Exact: what felt good

- **The compiler and runtime are genuinely usable headlessly.** `compileContractSource`
  → `defineComponent` → `mount` renders to a framework-neutral host-ops tree I
  could assert on directly. The "structured tree is a better test surface than a
  DOM" claim (LLP 0010) held up — I verified rows by `testId` with no browser.
- **The binding grammar enforces real invariants.** `query`/`mutation` bindings,
  `async` slots (loading/error/empty/ready), and `action … mutates …` compile,
  and an action that calls a manifest mutation *without* declaring `mutates` is a
  compile error. That is a strong, checkable agent affordance.
- **`ContractDataManifest` is a clean target.** Generating it next to the server
  manifests made the two surfaces provably consume the same backend facts.

### Contract/Exact: what felt bad or surprising

- **No `@expo/snapback/contract` adapter exists.** The four SDK seams in LLP 0263
  are still pending, so I wrote the bridge myself (boundary hydration from the
  server snapshot, optimistic write-through, plus a `ContractDataProvider`). I
  put it in `demos/_kit/` so it's shared — but this is precisely the "every demo
  re-copies the bridge" smell from LLP 0005/0012. It wants to be a real package.
- **bun is required for the Contract surface, node is not.** Importing Exact's TS
  source by absolute path "just works" because downstream `@exact/*` resolve from
  Exact's `node_modules` — but only under bun (node's type-stripping wouldn't
  resolve the workspace). So the Contract surface carries a toolchain requirement
  the headless surface doesn't. I recorded it in the demo manifest.
- **Log noise without a native host.** Mounting headlessly prints
  `[ExactRenderer] Missing exact.dispatch during protocol flush` on every flush.
  The tree is still correct, but a headless/quiet mode would keep agent logs clean.

### Cross-surface result

A Contract action's `createTodo` lands on the *same* live Snapback server and is
then visible to the headless `SnapbackClient` querying that server — the
two-surface validation in LLP 0012 actually works, not just in a fixture.

### Compared to React + Convex / Supabase

- **vs Convex:** Snapback's function-first + generated-manifest model is very
  Convex-shaped (schema, typed function references, named queries/mutations).
  Convex ships real TS handlers, generated types, and fine-grained reactivity
  *today*; Snapback v0 ships declarative plans, hand-derived types, and coarse
  re-run-all live updates. Where Snapback already feels *better* for an agent: the
  explicit capability manifest, stable diagnostic codes, deterministic
  handler-bypassing seed, and codegen that fails closed. Convex tends to hide its
  gaps; Snapback names them.
- **vs Supabase:** Supabase is table-first with client-side queries and RLS;
  Snapback's paved path is named mutations/queries with *no* direct client table
  writes, which is safer to hand to an agent and matches LLP 0005's stance.
  Supabase realtime is mature; Snapback's is a v0 outbox.
- **Net:** writing the acceptance suite was *tighter* than the equivalent against
  Convex or Supabase would be, purely because I could assert on stable structured
  facts (codes, capability flags, the inspect state) instead of UI or prose. The
  agent-first bet is visibly paying off even at v0 — the cost is that the
  ergonomic authoring surface (real handlers, typed client) isn't there yet.

### What would most improve the next demo

1. A published, typed client/manifest package so `tsc` is honest and nobody
   derives wire shapes from Rust source (LLP 0012).
2. JS `ctx.db` handlers (the Ibex bridge) so authoring matches LLP 0004.
3. Handler-time read-set capture so conflict-safety isn't the caller's job.
4. The real `@expo/snapback/contract` adapter so the bridge isn't demo-local.
5. Finer live-query matching + a push transport before the realtime-heavy demos
   (kanban, messaging) in the LLP 0010 ladder.

## 2026-06-26 — Browser-hosting the Contract surface

I added a Vite-hosted browser mount for the same `.contract` surface. The
important part was not UI work; it was making the Contract `use` targets export
live query/mutation functions while keeping descriptor sidecars for the compiler.
Vite proxies `/snapback` to the local Rust server, and the page loads, resets,
and seeds the generated Snapback backend before mounting.

This is still the same Online-class bridge, not Parity. It makes the demo easy
to poke in a browser, but the long-term answer remains the real
`@expo/snapback/contract` package so every demo does not grow its own browser
mount recipe.

## 2026-06-26 — Completing and deleting from Contract

I extended the browser and headless Contract surface beyond create-only. The
existing Snapback backend already exposed `setCompleted` and `deleteTodo`; the
work was adding generated binding targets, descriptor sidecars, Contract actions,
and shared bridge links so completion and deletion still flow through Snapback
mutations.

The useful catch was in acceptance: the first seeded todo is already complete,
so the test had to choose an incomplete row before asserting "mark complete."
That is exactly why this demo needs deterministic seed data and structured tree
checks instead of a casual browser-only poke.

## 2026-06-26 — Styling the Contract surface

I gave the `.contract` surface basic styling so it reads like a real
Contract/Exact app instead of a stack of unstyled `text` nodes: a centered card,
a heading + subtitle, a bordered input next to an accent "Add" button, and todo
rows as bordered pills that show completion state (a green ✓ + strikethrough +
muted, lighter-weight title for done items; a ○ + bold dark title for active).

### Contract styling: what felt good

- **Style is just inline attributes on semantic elements.** `column`/`row` with
  `gap`/`padding`/`align`, plus `radius`/`background`/`borderColor`/`color`/
  `weight`/`textDecoration` — no separate stylesheet, no className indirection.
  It reads like React Native / Tamagui style props, and the layout primitives
  (`column`, `row`, `flex=1`, `maxWidth`) were enough for a clean card with zero
  surprises.
- **Data-driven styling is first-class.** Conditional styling via ternary
  *attribute values* (`color=todo.completed ? "#5f636c" : "#1c1d21"`,
  `textDecoration=todo.completed ? "line-through" : "none"`) compiles cleanly and
  is unambiguous unparenthesized. Exact's own facet labs use the exact same
  pattern, including a todo label with `weight=…completed ? 400 : 600`, so this
  is an idiom, not a lucky edge. Showing the `completed` field that was already in
  the seed cost three ternary attributes and no new wiring.
- **Structured-tree tests kept the markup honest.** The contract acceptance suite
  asserts `textUnder(testId="todo-item")` equals the bare titles, so the
  completion glyph had to be a *sibling* of the title (testId stays on the title
  `text`), not a wrapper around it. A DOM/snapshot test wouldn't have caught a
  glyph leaking into the asserted text; the host-tree assertion did. All 6
  Contract checks (and `ref-check`) stayed green, and I verified the restyled
  input + nested-text button still drive the live mutation in a real browser.

### Contract styling: what felt bad or surprising

- **No light-touch path to the real theme tokens.** The idiomatic answer is
  `use theme from "@exact/facet-contract"` → `theme.colors.*` / `theme.space.*`,
  and the facet-contract lab proves the theme capability self-installs under the
  *same* bare `installContractWebHost()` + `mount()` this demo uses. But wiring it
  here means (a) a facet vite alias on top of the demo's minimal
  `@exact/contract`+`@exact/renderer` alias set, and (b) teaching the headless
  acceptance compiler to resolve a *capability* import — its `compileContractSource`
  call is given `importSemantics` for data bindings only. So I inlined the Facet
  default light-theme palette (`@exact/facet-core` `lightTheme`: accent `#5e6ad2`,
  surface `#fff`, text `#1c1d21`, success `#2a8447`, the 6/10/14/20/28 space scale,
  the 8/10/14 radius scale) as literals. Identical pixels, no new coupling, but
  it's a hand-copy of tokens that can drift from facet-core. The missing seam is
  the adapter handing the surface a resolved theme so a minimal mount can read
  tokens without taking on the facet package + provider itself — the same "the
  adapter should own the boring seams" theme as the data bridge (LLP 0005).
- **Styling bumped into the still-narrow bridge.** Completion is rendered
  read-only because the Contract links only expose `listTodos` + `createTodo`;
  a tappable checkbox (`toggle` → `setCompleted`) would need the bridge widened,
  which is function wiring, not styling, so I left it. The mutation exists in the
  backend (`setCompleted`) and the manifest — it's purely an adapter-surface gap.

### Compared to React + Convex / Supabase

In React you'd reach for CSS/Tailwind/styled-components; here styling is inline
structured attributes on semantic elements (closer to React Native). The win
specific to this stack: the styled output is still a host-ops tree you assert on
by `testId`, so "does the completed item render struck-through and not pollute
the title assertion" is checkable headlessly — no browser, no CSS snapshot. The
cost is the one above: the polished theming story (live tokens, light/dark) is a
facet-package + provider step away, not the inline default it is in a mature
component kit.

## 2026-06-26 — Exact native shell load failure

I chased a failure where the macOS Exact shell showed "This app couldn't be
loaded" for `http://127.0.0.1:5174/` with the Swift decoding error "The data
couldn't be read because it isn't in the correct format." The Vite server was
healthy; the problem was that the Snapback Contract surface had only installed
the `.contract` transform and browser proxy. The native shell asks a dev server
for Exact's native JSON envelope, but this demo answered `/` with ordinary HTML.

The fix was to add Exact's `exactVitePlugin({ entry: "/main.ts" })` beside the
Contract transform so browser requests still get HTML while native requests with
`X-Exact-Platform` get `application/vnd.exact.native+json`, module-graph URLs,
and the native reload socket. I also made the browser boot-status helper
native-safe and resolved Snapback through `__exactServerOrigin + "/snapback"`
when running under the native dev server, so the same proxy path works outside a
DOM.

This exposed a useful product gap: the browser-hosted surface and native shell
were easy to confuse because the error was a generic JSON decode failure, not a
capability diagnostic. Snapback's side did the right thing once reachable, and
the headless suite stayed green, but the Exact/Snapback demo path still needs a
clear "browser surface vs native Exact shell" command split and a structured
diagnostic when the wrong server shape is loaded.

## 2026-06-27 — LLP 0020 Phase 1 artifact buildout

I replaced the hand-derived core manifest shape with a first versioned generated
package slice. The todo backend now emits `artifactKind`/`schemaVersion`,
`inputsHash`, explicit schema/bundle hashes, a capability manifest, generated
function references (`api.mjs`), and TypeScript declarations (`api.d.ts`). The
headless acceptance now calls Snapback through those generated refs rather than
raw function-name strings, and it asserts a stale artifact version diagnostic
(`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`).

### Snapback: what felt better

- **The missing typed package is less abstract now.** Even this tiny generated
  package changes the demo feel: `api.createTodo` is a real generated fact with
  id/name/kind/version, not a magic string. It is still small, but it is the
  right product direction from LLP 0012 and LLP 0020.
- **Runtime drift is now testable.** Rust tests deserialize the checked-in
  generated manifests and round-trip them through the runtime structs, so adding
  a v0 manifest field in codegen without teaching Rust about it fails as a test
  gap instead of silently disappearing from `/inspect`.
- **Capability honesty stayed intact.** The new capability manifest still
  reports `ibex_ctx_db_host_bridge` as missing. Phase 1 did not paper over the
  Phase 2 gap.

### Snapback: what still feels unfinished

- **The source of truth is still the demo generator, not a product package.**
  This lands the shape in `demos/_kit/codegen.mjs` and Rust structs, but it is
  not yet a published `@snapback/*` package or a general CLI.
- **`HostPlan` is still visible.** Generated function refs are public-facing,
  but the underlying function manifest still carries declarative HostPlans
  because the real Ibex `ctx.db` bridge is not built.
- **Type honesty is present but shallow.** `api.d.ts` gives typed function refs
  and arg types, but there is not yet a dedicated TypeScript compile check in CI
  for a consuming app. The next product step should make that check explicit.

Compared with React + Convex, this closes one important gap: generated function
refs now exist instead of being implied by docs. Convex is still far ahead on
real handler execution and generated end-to-end types; Snapback's distinct win
remains the machine-readable capability and diagnostic story.

## 2026-06-27 — LLP 0020 Phase 2 ctx.db bridge slice

I wired a narrow embedded Ibex handler path for the todo demo. `listTodos`,
`createTodo`, `setCompleted`, and `deleteTodo` now run as JavaScript handlers
through `ctx.db`; `listTodosOnce` and `editTitle` stay as HostPlan fixture paths.
The generated function manifest bundles `handlers.mjs`, hashes it into the
bundle freshness marker, and reports the bridge as available instead of listing
`ibex_ctx_db_host_bridge` as a gap.

### Snapback: what felt better

- **The public authoring shape is finally less fictional.** The demo now has
  real `async` JavaScript handlers using `ctx.db.query`, `ctx.db.insert`,
  `ctx.db.patch`, and `ctx.db.delete`, and the same generated refs exercise those
  handlers in headless acceptance.
- **Capability errors are concrete.** A handler that calls `fetch` fails with
  `SNAPBACK_HANDLER_CAPABILITY_DENIED`, and a thrown handler error becomes
  `SNAPBACK_HANDLER_FAILED`; adapters have stable codes instead of raw engine
  output.
- **Hash scope is clearer.** `inputsHash` tracks the whole codegen input set,
  `schemaHash` tracks the schema source, and `bundleHash` tracks functions plus
  bundled handler source.

### Snapback: what still feels unfinished

- **The local Ibex dependency setup is still too manual.** This checkout's
  vendored Ibex submodule did not have the macOS Hermes framework installed, so
  verification needed `HERMES_LIB_DIR`, `HERMES_INCLUDE_DIR`,
  `DYLD_FRAMEWORK_PATH`, and `EXACT_ALLOW_FALLBACK=1` pointing at a sibling Ibex
  checkout. The product path needs a self-contained setup or a clearer doctor
  diagnostic.
- **Read sets are declared, not captured.** Phase 3 still needs runtime read
  capture so mutation conflicts are based on what the handler actually observed,
  not caller-supplied read sets.
- **The bridge is minimal.** It covers the todo query/write forms, not full
  dependency bundling, read-your-writes query overlays, CPU/wall-clock budgets,
  or hosted-untrusted-code isolation.

Compared with React + Convex, this is the first moment Snapback feels like it is
using the same mental model: write a backend handler and call a generated ref.
Convex still wins on polished local setup and mature isolation, but Snapback's
capability manifest and explicit gap reporting made the partial state easier to
describe honestly.

## 2026-06-27 — LLP 0020 Phase 3 captured reads

I added the first handler-captured dependency path. Ibex host calls now record
row reads, missing-row reads, query predicates/table versions, returned row ids,
and auth user facts while a handler runs. The buffered commit validates those
captured dependencies before applying writes, so a stale row read can reject with
`SNAPBACK_MUTATION_CONFLICT` even when the caller supplied no `read_set`.

### Snapback: what felt better

- **The isolation model moved into the runtime path.** `ctx.db.get` and
  `ctx.db.query` are no longer just data access; they also produce the dependency
  facts mutation commit needs.
- **Admin output is more useful.** The generated-function runner now returns
  `captured_reads` and `captured_writes`, so a successful `setCompleted` run can
  show the row it relied on and the row it updated.
- **Reject-only is explicit.** Conflict diagnostics include `retryPolicy:
  "reject"` and the dependency details. That is not a polished retry story, but
  it is an honest v0 policy.

### Snapback: what still feels unfinished

- **The HTTP acceptance server serializes mutations through one instance mutex.**
  That is fine for the current API, but it means the stale-read interleaving is
  proven by a file-backed Rust test with two SQLite connections rather than the
  headless HTTP suite.
- **Query dependencies are conservative.** Query reads capture the whole table's
  change version plus the predicate details; Phase 4 still needs a proper matcher
  so realtime invalidation and conflict checks can reuse those facts with less
  over-invalidation.
- **Read-your-writes overlay is still not complete.** Buffered writes commit
  correctly, but reads during the same handler do not yet layer pending writes
  over the snapshot.

Compared with Convex, this closes a core correctness gap: the backend can now
derive mutation conflict dependencies from handler execution instead of asking
the client to echo them back. Convex still has the mature transaction/retry
model; Snapback's current version is deliberately narrower and more explicit.
## 2026-06-27 — LLP 0021 generated Contract bindings

The original todo Contract surface now matches Todo v2's binding layout:
`todo.contract` imports generated modules from `snapback/generated/contract/`,
and the local `surfaces/contract/data/` sidecars are gone. Its Contract
acceptance suite asserts both facts, so a future regression back to hand-written
demo sidecars should fail loudly.

This made the original demo feel less like a special first example and more like
a normal generated Snapback app. The remaining Contract friction is no longer
"copy these sidecar files into each demo"; it is the larger adapter and packaging
work captured in LLP 0021.

I also added the first stale Contract artifact diagnostic to the shared adapter:
the acceptance suite now deliberately corrupts the generated Contract data
manifest `inputsHash` and expects `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`.
That moved one LLP 0021 acceptance point from prose into an executable check.

## 2026-06-27 — LLP 0020 Phase 4 matcher slice

I added the first live-query dependency matcher for the todo path. Live
subscriptions no longer rerun for every mutation when Snapback can prove the
change is irrelevant: table summaries skip disjoint functions, and captured
`ctx.db.query` equality predicates skip rows outside the subscribed result. The
todo `userId` auth filter is now just one equality predicate; a separate
`completed == true` test proves the matcher is not only a user-scope shortcut.
Hidden-row deletes carry the old row only in the internal change event so the
matcher can prove invisibility without sending the row to the client.

### Snapback: what felt better

- **Fan-out cost is finally visible.** `/inspect` now includes `liveDelivery`
  counters for attempted fanout, delivered replacements, and matcher skips. That
  made the acceptance checks assert the runtime behavior directly instead of
  inferring it only from an empty outbox.
- **The v0 replace fallback stayed simple.** The matcher only decides whether
  to rerun a subscription. When it cannot prove disjointness, the runtime still
  sends a full `live_replace`, which keeps the correctness story easy to test.
- **Auth mattered from the first matcher.** The slice is narrow, but it avoids
  the worst product smell: notifying a user about a row they cannot see.
- **The matcher now reuses captured query facts.** Live subscriptions store the
  `CapturedReadDependency::Query` facts produced by the handler run, then refresh
  those facts after each delivered `live_replace`.
- **The required surface now proves the equality case.** The headless acceptance
  suite temporarily loads a test-only `completed == true` live query and checks
  both the skip and the later refresh when a row moves into the predicate.

### Snapback: what still feels unfinished

- **This is not a precise dependency matcher.** It handles table disjointness and
  equality predicates, not range predicates, joins, aggregations, or permission
  epochs.
- **Transport is unchanged.** The headless demo still drains deterministic
  outboxes. That is good for tests, but it is not WebSocket/SSE product push.
- **Permission changes are not modeled yet.** There is no auth epoch or
  server-directed resubscribe path for a permission change; this only handles
  row-level visibility for normal mutations.

Compared with Convex, this is still behind the mature live-query invalidation
story, but it closes an important honesty gap: the demo can now prove that some
irrelevant writes do not refresh subscribers, and it records the fan-out work it
did.

## 2026-07-09 — ENG-22564: the Todo surface stops borrowing Exact HEAD

Todo now installs Exact `0.1.2` through its own `@exact/*` alias dependencies
and committed `bun.lock`. The `exact.pin.json`, source import, and Vite binary
from `../exact` are gone. This makes the browser/build loop feel like an app
dependency again: `bun install`, then the local scripts. The acceptance resolver
still accepts an explicit checkout for unpublished Exact work, but packages are
now a capability-probed final rung instead of an unimplemented promise.

## 2026-07-23 — LLP 0079 SC-2a: migrating onto the @snapback/vite managed-dev plugin

The Contract surface just became the first consumer of the LLP 0030 MVP plugin
(`packages/snapback-vite`). The old shape — `SNAPBACK_TODO_API` env, a
hand-rolled `/snapback` proxy with `rewrite`, and browser-boot
`client.ensureApp({schema, functions, seed})` — is gone. One `bun run dev` now
attaches to a running backend through the `HostReadyDescriptor` ready file or
spawns a managed child, loads the generated manifests and seed over host-ops
during bring-up, and relays only an explicit method+path allowlist of app
routes at `/__snapback`. The browser imports `virtual:snapback/dev` for the
base path and never sees the backend origin or any token material.

### What felt good

- **The CLI helpers made the plugin thin.** `readReadyDescriptor`,
  `validateDevTarget`, `managedAdminToken`, `waitForReady`, and the DYLD scrub
  are all `@snapback/cli` exports, so the plugin's lifecycle controller is
  genuinely a projection — no second dialect, exactly what LLP 0030/0041 asked
  for. Managed spawn-to-ready is ~1s against the debug binary.
- **Host-ops as the bring-up surface just worked.** `schema.load`,
  `functions.load`, and `app.reset`+seed over `POST /_snapback/api/host-ops`
  with the auto-minted `<db>.admin-token` needed zero server changes. The
  `deny_unknown_fields` strictness on server inputs bit once (an ephemeral
  ensure probe), and the diagnostic named the offending field immediately.
- **Boot code shrank.** `main.ts` lost the seed import and the provisioning
  step; boot is now health-check → mount. Reload semantics got strictly
  better: reset/seed happens only for a fresh managed database (`if-new`), so
  a page reload — and even a second attached Vite session — preserves data by
  construction rather than by a carefully-ordered ensure.
- **The allowlist refusals are pleasant to debug.** Hitting
  `/__snapback/_snapback/api/host-ops` or `/__snapback/admin/reset` returns a
  structured `SNAPBACK_DEV_PROXY_ROUTE_REFUSED` JSON body with next-checks,
  not an opaque 404/HTML proxy error.

### What surprised me / friction

- **The Exact preset overrides the host.** `exactContractWeb` pins
  `server.host: true` (LAN exposure for device testing), which the plugin's
  loopback default refused with `SNAPBACK_DEV_HOST_EXPOSED` — the failure the
  RFC wanted, but it means every Exact-preset consumer must carry an explicit
  `allowNonLoopbackHost: true` opt-in. Worth an upstream conversation: the old
  config *believed* it was loopback (`host: '127.0.0.1'`) while the preset
  silently exposed the full-root `/snapback` proxy on the network. The
  allowlist makes that exposure much narrower now, but the opt-in should be a
  conscious Exact-level decision, not plugin-config boilerplate.
- **`bun --bun` still cannot relay WebSocket upgrades.** The plugin's raw
  upgrade handler never fires under bun's `node:http` shim — the same
  limitation graffiti/cursors-web recorded for Vite's own proxy. The surface
  falls back to outbox polling (unchanged from before); WS-through-relay is
  proven by the package test under a node-run Vite server, which LLP 0030
  explicitly allows as a dedicated WS test. Running the demo's Vite under node
  is blocked by Exact packages shipping raw `.ts` sources, which node will not
  import from `node_modules` even with type stripping.
- **Worktree environment, not Snapback:** this worktree carried a
  source-patched sibling-ibex `hermesvm` (the chat-matrix trap from diary
  0017) that made every JS handler die with `SNAPBACK_RUNTIME_CREATE_FAILED`
  at baseline. Restoring the main checkout's Hermes frameworks plus
  `cargo clean -p ibex-runtime` fixed it; the plugin was blameless but the
  triage cost real time because the structured diagnostic has empty `details`.

### Comparison

This lands the dev loop where Convex's `npx convex dev` has been: one command,
backend lifecycle owned by tooling, the browser talking only app routes over a
stable relative path. The differences that matter: the attach/managed split is
explicit and validated (Convex silently multiplexes; Snapback refuses a
target mismatch with a structured code), and destructive reset/seed authority
is mode-scoped instead of ambient. Against Supabase local dev (docker compose
+ studio), this is dramatically lighter. What is still missing versus both:
watch/codegen/hot-push in the same command — that is SC-2b (LLP 0030 step 9),
deliberately gated behind this lifecycle/authority boundary proving sound.

## 2026-08-15 — portable Contract output on the published Exact suite

The Contract web surface moved from Exact 0.1.2 to the repository's established
0.1.7 portable-artifact suite and rebuilt cleanly after regenerating its ignored
Snapback codegen cache. That removed checkout-local paths from the generated
sourcemaps without touching minified output by hand. The dependency upgrade was
less work than carrying demo-specific sourcemap surgery and aligns Todo with the
same published Contract toolchain used by newer surfaces. No Snapback Guide gap
was involved.

## 2026-08-16 — owner-stamped generic writes

LLP 0264 Phase 1a made the Todo insert stop echoing `ctx.auth.userId` into
its owner field. Omitting the field is both shorter and more trustworthy: the
host now stamps it, and authored owner input refuses even when equal to the
caller. This is a cleaner boundary than the common Convex/Supabase convention
of copying the session id in application code. No product behavior or
capability claim changed; the migration closure tracks the corpus-wide flip.
