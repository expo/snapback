# Diary 0005: Redesigning the Contract admin console from scratch

**Subject:** `admin-ui/` — the Contract/Exact admin console
**Surfaces:** Contract/Exact console (`admin-ui/`); reference for completeness is the embedded console (`src/admin/console.html`)
**Author:** Claude (Opus 4.8)
**Date:** 2026-06-27
**Related:** LLP 0017; [diary 0002](./0002-admin-console.diary.md) (the retrospective), [diary 0003](./0003-admin-console-contract-parity.diary.md) (parity work); Exact LLP 0268

> The brief: redo the admin panel from scratch with Exact/Contract, spend real
> effort, and make it the most polished, clear, *good-to-use* version I can —
> with all the functionality you'd want in an admin panel, but not bloated. This
> is a from-scratch rewrite of `app.contract`, `theme.ts`, and the boundary, not
> a patch on the parity work. Written as I built it.

## 2026-06-27 — Setup: design against ground truth, and be able to *see* it

Two decisions up front shaped everything.

**Capture the real payloads first.** The prior Contract boundary read
`s.schema.schema_hash`, but the live server emits `schema.schemaHash` (camelCase)
— so the old console silently showed "Schema hash —". The inspect payload is
genuinely mixed-casing: top-level `capabilityManifest` and `liveDelivery` are
camelCase while `recent_diagnostics` and `capability_gaps` next to them are
snake_case; `server`/`admin`/`storage`/`runtime`/`ephemeral` are snake_case;
function entries are camelCase but their `runtime.HostPlan` is PascalCase. No
amount of reasoning gets that right. So I ran a populated server and dumped real
`/inspect`, `/data/{table}`, and function-run JSON, then built the view model
against those files. That one habit caught the latent bug and several others
before they shipped.

**Build a screenshot loop.** "Most polished" is not a thing you can write blind.
`cargo` wouldn't compile here (the vendored `ibex-runtime` build script wants a
macOS Hermes framework that isn't installed), but a prebuilt `target/debug/snapback`
existed — it just needed `DYLD_FRAMEWORK_PATH` pointed at a macOS `hermesvm.framework`
slice to run. With the server up and seeded from the todo-v2 demo, headless
Chrome (`--screenshot`, `--virtual-time-budget`) gave me per-tab, per-theme
shots, and a small CDP driver (Node's built-in `WebSocket` + `fetch`) let me
click `data-testid` targets to capture interactive states. Iterating against
screenshots is the only reason the result looks the way it does.

## What I built

An app-shell, not a centered column: a fixed **sidebar** (the Snapback toggle
mark drawn from primitives — a pill with a knob, which is *literally* the brand —
plus navigation and a light/dark switch) beside a scrolling content pane. Seven
surfaces:

- **Overview** — dashboard stat tiles + Server/Storage/Runtime/Admin cards with
  tone-colored values, and capability gaps.
- **Schema** — per-table cards: fields with types, system fields muted, indexes.
- **Data** — a real paginated table with a header row, muted system columns, and
  disabled-state pagination.
- **Functions** — a runner with a multi-line JSON args field that shows the
  **captured** read/write sets and the inline diagnostic on failure, plus an
  expandable per-function detail (auth, syncability, required capabilities, the
  host plan as a friendly summary *and* raw JSON).
- **Capabilities** — the whole `capabilityManifest`. This surface didn't exist
  before and is the one I'm happiest about: it answers "what can this target
  actually do" at a glance.
- **Realtime** — durable subscriptions, live-delivery stats, the full ephemeral
  counter set, and the token-gated cleanup control.
- **Diagnostics** — severity-dotted entries with details.

Everything renders only what the `admin` capability block reports — no
placeholder controls, which LLP 0017 is firm about.

## What felt good

- **The boundary/view-model seam is genuinely nice.** All formatting and casing
  live in `admin-boundary.mjs`'s `data.ui.*`; the `.contract` only reads flat,
  statically-named fields. When the casing surprised me, I fixed it in one place
  and the template never knew.
- **Reusable components shrank the work.** `Card`, `Kv`, `Badge`, `StatTile`,
  `FieldRow`, `DiagRow` plus `when` panels — the seven-surface console is not much
  longer than the old single-scroll one. The "Contract is verbose" worry keeps
  not being true.
- **Dark mode without Facet was easy, and it's reactive.** `colors(mode)` returns
  one of two hand-tuned palettes; `theme` is component state; the resolved palette
  `c` is *passed as a prop* to every child component. Flip the switch and the whole
  tree re-renders. Components can't see parent state, so threading `c` as a prop is
  the trick that makes a live theme work — and it's fitting that a brand whose mark
  is a toggle switch ships with a real one.
- **`data-testid` everywhere paid off** the moment I wanted to drive the UI from a
  screenshot harness.

## What was hard — the post-paint relayout finding

The one real fight. After a `Run`, the result's badges row ("failed / live query
/ 0 ms") rendered *on top of* the line below it. Same thing at the bottom of an
expanded function detail. It survived a 3-second settle, so not a transition.

I stopped guessing and inspected the DOM via CDP. The badges row had
`display:flex; flex-flow:wrap` and a visible child of height 21 with
`position:relative` — yet the row's own height was **0**. The *identical* markup
in the Schema header measured at 21. The difference wasn't the styles; it was
*when* the content mounted: Schema renders on first paint; the run result is
**published into the boundary after first paint**. The Exact layout kernel (it
measures and writes explicit sizes; this isn't plain CSS) under-measures content
that arrives in a later boundary update — bare flex rows collapse to 0, and tall
multi-line text overflows its container. The Data explorer escaped it only
because its rows all have padding, which gives intrinsic height regardless of the
kernel measuring the children.

Two fixes, both clean:

1. **Dynamic rows get an explicit `minHeight`** (and drop `wrap`, since they're
   short) — so a collapsed measurement still reserves space.
2. **Code/JSON output renders in fixed-height `scroll` blocks.** A `scroll`
   (ScrollView) with an explicit `height` is deterministic — the kernel uses that
   height, the long content scrolls inside, and nothing overflows into siblings.
   It's also just a *better* pattern for run payloads and host plans than an
   unbounded pre block.

I tried a wrong fix first — making `Badge` a single text leaf instead of a
`column > text`, on the theory the flex child was the problem. It didn't help
(the row still collapsed), but I kept it: a text-leaf badge is simpler and the
kernel measures text reliably, so it's a small robustness win regardless.

## Contract/Exact observations

- **Type keyword is `boolean`, not `bool`.** A literal `mono=true` failed
  `prop ... is not assignable to declared type "bool"` because the literal's type
  is `boolean`. The old components declared `: bool` and got away with it only
  because they were always passed *values*, never literals. Worth a compiler hint.
- **A mutation with an empty invalidation set warns** (`mutates_unknown_write_set`).
  I'd routed theme persistence through a no-op `pref` mutation; the warning was the
  nudge to drop it. The in-session toggle + `prefers-color-scheme` is plenty.
- **`opaque_import_in_pure_context`** still fires for `colors()`/`fonts()` called
  in `derive` — the known ergonomics wart from diary 0003. Non-fatal; lived with it.
- **The DSL is richer than the parity work used.** `scroll`, `spacer`, `image`,
  `toggle`, `multiline` inputs, `disabled`/`opacity`, `boxShadow`, `borderLeftWidth`,
  `justify`, `lineHeight` are all there. `multiline` alone retires diary 0003's
  "no textarea" lament. Reading `packages/exact-contract/src/compiler/builtin-schema.ts`
  (the element + style-prop authority) up front saved a lot of guess-and-rebuild.
- **No dev-serve loop still stings.** Every change is rebuild → re-screenshot.
  The static-build story is the product win, but a watch mode for this surface
  would change the ergonomics of iterating on polish.

## Against the alternatives

A Convex or Supabase dashboard is a separate hosted React app talking to a
backend API. The thing I keep noticing here is the *seam*: this console is a
`.contract` file plus a JS view model plus a declarative binding list, and the
same artifact statically builds to both a plain-browser bundle and an Exact
native envelope. There's no dashboard service to deploy — the Rust server that
owns the data serves the console, which is exactly right for a *system* app that
has to keep working when the app's own schema is broken. The cost side is real
too: the layout kernel's post-paint measurement quirk is the kind of thing you'd
never hit in React-DOM, and the rebuild-to-see loop is slower than HMR. Net, for
a first-party admin surface that must be one binary with no toolchain at runtime,
the trade landed well.

## Still deferred (honestly)

- Direct row edits, raw SQL, and the ephemeral mutating controls beyond cleanup —
  gated on the API exposing them; shown as honest gaps, never as dead buttons.
- A non-loopback token-entry flow (the client reads a stored token; there's a
  clear error state, but no in-UI "paste a token" affordance yet).
- End-to-end load in the native ExactAppMac shell — the envelope builds; running
  it in the shell is still unverified here.
- A shared admin client package between this console and the embedded one.
