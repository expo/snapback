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
