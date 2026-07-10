# Diary 0002: Admin console — Contract surface vs the embedded console

**Subject:** Snapback admin console (a Snapback subsystem, not a demo app)
**Surfaces:** embedded vanilla-JS console (`src/admin/console.html`); Contract/Exact console (`admin-ui/`)
**Author:** Claude (Opus 4.8)
**Date:** 2026-06-26
**Related:** LLP 0017, LLP 0005, LLP 0012, LLP 0015, LLP 0016; Exact LLP 0268 (single-URL static platform manifests), Exact LLP 0263 (Contract data bindings)

> This diary is a retrospective. The admin console is a subsystem, not a demo, so
> it never triggered the demo-diary convention while I was building it — but the
> Contract surface generated exactly the Contract/Exact dogfooding signal a diary
> exists to hold, and the two builds came out at very different levels of polish.
> This records why, honestly. A companion build diary
> ([0003](./0003-admin-console-contract-parity.diary.md)) covers the parity work
> that follows.

## 2026-06-26 — Building the admin console two ways, and why they diverged

I built the Snapback admin console twice. First as a **single embedded vanilla-JS
file** (`src/admin/console.html`, `include_str!` into the Rust binary). Then,
after deciding to dogfood the stack, as a **Contract/Exact app** (`admin-ui/`)
statically built and served from a `dist/` snapshot. They consume the same
headless admin API (`/_snapback/api/*`). The embedded one is markedly more
elaborate; this is the accounting of why.

### What each one is

- **Embedded console:** one self-contained HTML/CSS/vanilla-JS file. Six tabs
  (Overview, Schema, Data, Functions, Realtime, Diagnostics), a paginated data
  explorer with row detail, an interactive function runner (args JSON + auth +
  output/diagnostics/read-write sets), ephemeral cleanup, deep-linkable tabs,
  light/dark, auto-refresh, a token banner. Zero build step.
- **Contract console:** a `.contract` view + data-binding modules
  (`use … from` targets + `.contract-meta.ts` sidecars) + an `AdminClient` + a
  reactive boundary, built with `exactVitePlugin` + `contractVitePlugin` to a
  static dist that also emits the Exact LLP 0268 native artifacts. A single-scroll
  read-only inspector + Refresh.

### Contract/Exact: what felt good

- **The static-build story is real, and this is an early proof.**
  `contractVitePlugin` compiles `.contract` in a *production* build, and a
  Contract app builds to a self-contained static `dist/` that a plain server
  serves with no runtime Vite. Exact's own corpus still treats production web as
  emerging; the admin console is a working proof of it.
- **The data-binding seam is clean and endpoint-agnostic.**
  `use listX from "./data/x.query.ts"` + a `.contract-meta.ts` declaring
  `reads`/`writes` + a runtime-links slot = point the UI at *any* backend by
  writing a different client. The compiler enforces the read/write declarations.
  Repointing from the todo demo's app API to the admin API was just a new client.
- **Formatting in the JS boundary keeps the `.contract` declarative.** I flattened
  the inspect payload into a `data.ui.*` view model in `admin-boundary.mjs`, so the
  template only reads flat fields and does no formatting. Clean separation, and it
  made the view readable.
- **LLP 0268 is an elegant design.** Once a route registry unlocked the exporter,
  the build emitted `platform-manifest.json` + a `mac` static native envelope +
  `startup.js`/`.hbc` with correct document-relative URLs and no dev-only fields.
  "One URL → web for a browser, native envelope for a shell" is a genuinely nice
  contract.
- **Data-driven styling compiled cleanly.** Ternary attribute values (syncable
  badge color, muting system fields) are an idiom and worked first try.

### Contract/Exact: what felt bad or surprising — the friction tax

- **The reactive boundary models every query as rows (an iterable), and learning
  that cost two opaque errors.** Storing the inspect object directly →
  `n is not iterable` at boot. Wrapping as `[viewModel]` and selecting `rows[0]` →
  `t is not a function or its return value is not iterable`, because
  `async … ready` binds an iterable you `each` over. Final shape: keep it an
  array and `each s in rows` over the single inspect row. The errors were minified
  and gave no hint that "query result must be a row collection."
- **The static native export is gated behind a chain of non-obvious
  requirements**, each found by hitting it:
  1. a route registry (`appRouteModules`) next to the entry, or the exporter never
     runs;
  2. import it from `@exact/router/types`, not the `@exact/router` barrel (which
     drags React into the prerender SSR and dies under Vite 8);
  3. build programmatically with `configFile: false` (a `vite build --config`
     sends the nested prerender server down a config-reload path that fails to load
     the registry);
  4. the entry must live in a **subdirectory** (`/src/main.ts`) — a root-level
     `/main.ts` cannot locate its registry.
  The failure for all of these was the same generic, swallowed
  `Could not locate appRouteModules`. I only found the real causes by writing a
  scratch script that called `ssrLoadModule` directly to surface the hidden error.
- **No web basePath.** `exactVitePlugin` emits the web entry root-absolute
  (`/assets/…`) with no basePath support, while the native artifacts are
  document-relative. Serving under `/_snapback/admin/` needed a post-build rewrite
  of the HTML entry + discovery URLs. The served-app `basePath` option prefixes
  route hrefs but not the entry script.
- **I avoided expressiveness I hadn't confirmed.** I went single-scroll instead of
  tabs because I didn't stop to check whether Contract supports conditional view
  blocks, and skipped empty-state text for the same reason. That's incomplete
  fluency, not a Contract limit — but mid-build, with the pipeline still unproven,
  checking felt expensive.
- **No dev-serve loop for this surface.** The build is programmatic
  `configFile: false`; iterating meant rebuild + reserve-via-Rust — much slower
  than the embedded console's edit-and-refresh.

### Workarounds

- `n is not iterable` → array-wrap the view model and `each` over the single row.
- The swallowed registry errors → a throwaway `diag.mjs` calling `ssrLoadModule`
  to surface the real cause; then `configFile: false` + a subdir entry.
- The basePath gap → a post-build URL rewrite in `build.mjs`.
- A `src/main.ts` shim (`import '../main.ts'`) to put the entry in a subdirectory
  without moving the whole app.

### Why the Contract console is less polished than the embedded one

Honest accounting, not excuses:

1. **Different *kinds* of task.** The embedded console was pure UI in a medium I
   know cold — 100% of the budget went to the surface, so it got tabs, a data
   explorer, a function runner, dark mode. The Contract console was a
   pipeline/integration exercise: most of the budget went into making it build and
   bind at all, and I deliberately scoped the UI to a read-only inspector to
   isolate the unproven build/binding mechanics from UI complexity.
2. **I deferred the hard-in-Contract parts.** The data explorer (a parameterized
   query on a selected table) and the function runner (a mutation with free-form
   args + result/diagnostics) need dynamic queries and form state that are more
   involved in the reactive-boundary model than in imperative JS. I scoped them
   out while the build was unproven.
3. **I played it safe on expressiveness** (no tabs, no empty states) where I hadn't
   confirmed Contract could do it.
4. **Toolchain friction taxes ambition.** A Draft static-build path with sharp
   edges discourages elaborate UI until it's solid.

It is **not** an inherent Contract ceiling. It is where the budget went (proving
the static-bundling + native story, which was the actual goal of that thread) and
what I was sure I could express.

### Compared to React + Convex / Supabase

- **vs React:** in React I'd reach for component state, conditional JSX, a router,
  and CSS/Tailwind — tabs, modals, and grids are trivial, and I'd have built the
  same elaborate surface as the embedded console. Contract's declarative view +
  reactive boundary is *cleaner* for data binding (the read/write declarations are
  machine-checked), but I'm less fluent, so I built less. And the
  static-native-from-one-URL story has no React/Convex/Supabase equivalent — that
  is a distinct Contract/Exact win.
- **The embedded vanilla-JS console is the "zero-toolchain" extreme:** maximal
  expressiveness, no build — but it's a bespoke surface that neither dogfoods the
  stack nor reaches native. The Contract console dogfoods and goes native, at the
  cost (today) of friction and my fluency.

### What would most improve the next Contract surface

1. A **dev-serve loop** for the static-build surface (a `vite serve` with the same
   plugins) so iteration isn't rebuild-only.
2. **Web basePath support** in `exactVitePlugin` so subpath serving doesn't need a
   post-build rewrite.
3. **Specific, non-swallowed errors** from the served-app route-registry loader —
   `Could not locate appRouteModules` hid a resolvable file and a subdir-entry
   requirement.
4. A **documented minimal recipe** for "Contract app → static dist with native
   artifacts" (route registry + `configFile: false` + subdir entry + the
   `@exact/router/types` import are all non-obvious).
5. **My own deeper command of Contract** — conditional rendering, view composition,
   form inputs — so I stop playing it safe. The parity work in
   [diary 0003](./0003-admin-console-contract-parity.diary.md) is where I find out
   how much of the polish gap was the medium versus me.

## 2026-07-09 — ENG-22564: admin build becomes package-local

The admin console now owns Exact `0.1.2` and Vite in `admin-ui/package.json`
with a committed lock. Its shared Snapback build preset resolves installed
package exports instead of `SNAPBACK_EXACT_ROOT`, `build.sh`/`dev.sh` run from
`admin-ui`, and the static native build no longer needs an Exact checkout for
workspace aliases or embedded assets. This removes the most surprising part of
the old recipe: changing a sibling worktree can no longer change an admin build
without touching this repository.

The dev-serve regression smoke also now treats a React-free Contract graph as
the strongest passing outcome; if React is reachable, it still requires Vite's
optimized ESM chunk and rejects raw CJS.
