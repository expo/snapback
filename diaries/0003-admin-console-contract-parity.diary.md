# Diary 0003: Bringing the Contract admin console to parity

**Subject:** `admin-ui/` — the Contract/Exact admin console
**Surfaces:** Contract/Exact console (`admin-ui/`); parity target is the embedded console (`src/admin/console.html`)
**Author:** Claude (Opus 4.8)
**Date:** 2026-06-26
**Related:** LLP 0017; [diary 0002](./0002-admin-console.diary.md) (the retrospective that motivated this); Exact LLP 0268, Exact LLP 0263

> A live build diary, written as I close the polish gap that diary 0002 named. The
> embedded console has tabs, a paginated data explorer, and an interactive
> function runner; the Contract console is a single-scroll read-only inspector.
> The honest question from 0002: how much of that gap was the medium versus my
> fluency with it? I'll find out by trying, and record each thing as it goes.

## 2026-06-26 — Plan and the open Contract questions

Parity gaps to close, in order of rising uncertainty:

1. **Tabs** — needs conditional view rendering keyed off a `state activeTab`. Open
   question: does Contract have conditional view blocks (`if`/`when`/`show`), or do
   I compose this another way? In 0002 I *assumed* not and went single-scroll
   without checking. First job: actually check.
2. **Data explorer** — a parameterized query (`scanTable(table, limit, offset)`)
   driven by a selected-table + offset state, with pagination. Open question: how
   does a Contract `query` take *reactive arguments* (re-run when state changes),
   and can I trigger an imperative fetch on an action?
3. **Function runner** — a free-form form (function select, args textarea, optional
   user id) → run a mutation → render the structured result (ok/kind/reads/writes/
   version/changed/rows/diagnostic). Open questions: text input + multiline input
   binding, and rendering a dynamic result object that isn't a fixed-shape row.

I'll investigate (1)'s premise first, since it gates the whole layout, then build
outward, updating this entry as I learn.

### Investigation: Contract is much more capable than my first pass used

I read the Exact `_contract-labs` (`shell.contract`, `interactivity-lab`,
`forms-lab`). My 0002 assumption — "I'm not sure Contract can do tabs" — was just
unfamiliarity. What's actually available:

- **`when … / else` conditional view blocks.** `when showDetails` renders a block;
  `else` the other; *the branch not taken is unmounted* (not `display:none`). This
  is exactly tabs: `when activeTab == "Overview"` panels. (I'll derive the
  booleans to be safe, since the labs use `when <boolean>` rather than
  `when <comparison>` directly.)
- **Reusable components with `props` + `children`.** `component Card; props title;
  view … children`, invoked as `Card(title="Server") … children`. This kills the
  repetition that made my first `.contract` a wall of copy-pasted rows. The labs
  lean on this heavily (`LabSection`, `ValidationRow`, `HoverCard`).
- **`derive`** for computed values, **`wrap="wrap"`** rows (chips wrap!),
  **`scroll`** containers, `alignSelf`/`minWidth`/`lineHeight`/`letterSpacing`/
  `numberOfLines`, and ternaries with comparisons (`remaining == 1 ? … : …`).
- **`input` / `toggle`** raw primitives, and richer **Facet field components**
  (`FacetInput`, `FacetTextarea`, `FacetSelect`, `FacetButton`) from
  `@exact/facet-contract`. I'll use the **raw** primitives to avoid adding the
  facet dependency to the static build for now (and note facet adoption — which
  would also give a real light/dark theme — as a follow-up).
- **`await` is a statement keyword**, and `task … mount` runs work on mount. So an
  action *can* do async work. For the runner/explorer, whose results aren't a
  fixed query, I'll reuse the boundary-write pattern (like `refresh`): an action
  calls a link that fetches and writes a dedicated boundary key
  (`tableScan`, `runResult`), and a `query` over that key renders it.

So tabs, a data explorer, and a function runner are all expressible. The 0002 gap
was ~70% my fluency, ~30% genuine friction (no dev-serve, swallowed errors, the
boundary's iterable model). Building now.

### Build 1 — theme, reusable components, tabs

Refactored `app.contract` from a single-scroll wall into a tabbed console:
`theme.ts` (a self-contained light palette + font stack, no facet dependency),
reusable `Card`/`Kv`/`Chip`/`Tab`/`Field` components, a sticky-feeling tab bar
driven by `state activeTab` + derived per-tab booleans, and `when` panels. The
five read views (Overview, Schema, Functions, Realtime, Diagnostics) moved into
panels. Wrapping chip rows (`wrap="wrap"`) replaced the comma-joined gaps string.

**Result: it works, and looks on par with the embedded console's read views.** Two
friction notes:

- **Component-level `use` is for behaviors, not imports.** I put
  `use colors from "./theme.ts"` inside each component and got
  `expected "=" in behavior instantiation` — inside a component, `use x = beh()`
  instantiates a behavior. Imports stay top-level; components just reference them
  (`derive c = colors()`). Once I learned that, the six little components were
  trivial, and they *eliminated* the copy-paste wall from the first version.
- **Deep-linkable tabs fell out for free** and double as a screenshot hook:
  `state activeTab = initialTab()` reads `location.hash`, so `…/admin#Functions`
  opens that tab. Verified Overview / Schema / Functions each render their own
  panel via `when` — conditional rendering was never a problem, just unfamiliar.

The honest scorecard so far: tabs were a short job once I'd read three labs. In
0002 I'd called this a maybe-can't; it was a didn't-look.

## 2026-06-26 — Build 2: the data explorer (parameterized, on-demand read)

Goal: the Data tab browses rows of a selected table with pagination — the
embedded console's data explorer. This is the first thing that needs *imperative,
parameterized* data, not the one fixed `inspect` read.

The pattern that worked: a dedicated `tableScan` boundary key + a `loadTable`
*link* (a "mutation" that fetches and republishes), driven by an action that
writes state and calls the link. `openTable(name)` writes `dataTable`/`dataOffset`
and calls `loadScan({ table: name, offset: 0 })`; `pageBy(±50)` re-fetches. The
link **pre-shapes** rows in JS into `{key, text, sys}` cells, because Contract
templates do static field access (`cell.text`), not dynamic `row[col]` — so the
boundary flattens the dynamic grid into something the `.contract` iterates with
`each col / each drow / each cell`. Equal `flex=1` cells align into columns;
`numberOfLines=1` truncates. Pager buttons render under `when sv.canPrev` /
`when sv.canNext` (cleaner than a `disabled` attribute on the raw `button`).

**Result: it works** — selecting `todos` fetches and renders the grid (verified
by driving a real click through the Chrome DevTools Protocol, since screenshots
can't click). What was new vs. the embedded console: there I'd hold table/offset
in plain JS and re-render imperatively; here the same flow is state + an action +
a reactive boundary key, and the re-render is automatic. Equivalent effort once
the boundary-write idiom clicked — and notably **no new Contract-language
limit**: object-literal action args, nested `async`, and conditional pager
buttons all just worked.

## 2026-06-26 — Build 3: the function runner (form state + async result)

Goal: the Functions tab runs a generated query/mutation with args + auth and
shows the structured result — the embedded console's runner. The new bits: form
inputs bound to state, and displaying an async *result object* (not a fixed-shape
query) after a run.

Same shape as the explorer: a `runResult` boundary key + a `runFunction` link
that parses the args text, invokes the admin API's runner, and republishes a
shaped result (`ok`, `kind`, `reads→writes`, facts line, error, pretty-printed
payload). The form is `state runName/runArgs/runUser` bound to raw `input`
primitives (`value=runArgs change=setArgs submit=runFn`); the function list rows
are `button press=selectFn(fn.name)` wrapping the `FnRow` component, highlighting
the selection. Errors — bad JSON args, or a runtime diagnostic like
`SNAPBACK_AUTH_USER_MISSING` — become displayable `runResult` state, so the
runner shows them inline exactly like the embedded console.

**Result: it works end-to-end** (verified by CDP: select `listTodos`, set
`user_ada`, click Run → `ok`, `reads todos → writes —`, `version 1 · 3 rows · 0
ms`, and the JSON payload). Two pleasant surprises: passing ternaries as component
props (`Chip(label=rr.ok ? "ok" : "failed", tone=rr.ok ? "ok" : "warn")`) just
works, and `text rr.payload` **preserves the newlines** of the pretty-printed
JSON — I'd expected to lose them. The one thing I left for facet adoption: the
args field is a single-line `input`, not a multi-line textarea (the raw textarea
is a Facet component; the raw primitive set is `input`/`toggle`).

## 2026-06-26 — Scorecard: was it the medium or me?

Diary 0002 asked how much of the polish gap was Contract versus my fluency with
it. Having now built tabs, a data explorer, and a function runner, the answer is
clear: **almost all of it was me.** Everything the embedded console did, the
Contract console now does — Overview, Schema, a paginated Data explorer, a
Functions runner with inline results, Realtime, Diagnostics, plus deep-linkable
tabs — and none of it hit a Contract ceiling. The pieces I'd flagged as
"maybe-can't" in 0002 (tabs, conditional rendering, dynamic grids, async results)
were all just things I hadn't looked up.

The reusable-component model (`Card`/`Kv`/`Chip`/`FnRow`) made the second version
*shorter and cleaner* than my first single-scroll wall — the opposite of the
"Contract is more verbose" worry. The genuinely-Contract friction that remains is
small and real: the boundary's everything-is-rows model (two opaque errors to
learn), no dev-serve loop (rebuild-only iteration), the swallowed build errors
from 0002, and the missing raw textarea. None of those is a UI ceiling; they're
toolchain/ergonomics gaps, and they're the right things to file against Exact.

What's still *not* at parity, and deliberately deferred: dark mode and a live
theme (would come with adopting `@exact/facet-contract`), the ephemeral
cleanup/forced-resync controls, and the args textarea. All are additive, none
needs a new capability.

Net: the embedded console won the first round because I spent its Contract
sibling's budget proving the static-bundling + native story, then scoped the UI
to read-only and played it safe. Given a budget aimed at the UI and three labs
read first, Contract reached parity without drama. The honest correction to 0002:
the gap was ~90% fluency, ~10% medium — and the 10% is ergonomics, not
expressiveness.

## 2026-06-27 — LLP 0021 build recipe becomes a preset

I moved the static/native build recipe out of `admin-ui/build.mjs` and into
`packages/snapback-contract/build-preset.mjs`. The admin build file is now just
the mount-specific invocation: root, `/_snapback/admin/` base path, `/src/main.ts`
entry, route registry, and `mac` native target.

This directly removed one diary-only workaround from the admin console. The
sharp edges are still real — `configFile: false`, `exactVitePlugin` before
`contractVitePlugin`, the route registry, the subdirectory entry, and the
post-build base-path rewrite — but they now live in one product-shaped function
with structured preflight diagnostics instead of an admin-only script comment.

Running `./build.sh` still emits the browser bundle plus Exact static native
artifacts. The build continues to print the existing Contract warnings about
opaque theme imports; those are separate Exact/project-check ergonomics, not a
regression from moving the recipe.

## 2026-06-27 — Generated admin Contract bindings

I replaced the admin console's hand-written `data/` binding files with a small
source-of-truth list (`contract-bindings.mjs`) plus
`generate-contract-bindings.mjs`. The generator now writes
`generated/contract/`: the `use ... from` query/mutation modules, the
`.contract-meta.ts` descriptor sidecars, and the runtime-link registry. The
`.contract` file imports the generated modules, `main.ts` configures the
generated links from the admin boundary, and `build.mjs` regenerates everything
before running the shared build preset.

This was a useful LLP 0021 migration, but only in a specific way. The generated
runtime-link pattern made the work mechanical: one binding list, one generator,
and no chance for `inspect.query.ts` to drift from `inspect.query.contract-meta.ts`
or from `runtime-links.ts`. That is a real improvement over the original
one-file-per-binding admin glue, and it is the same failure mode the todo v2
exercise caught with `setPriority`.

It did not erase the admin integration bridge. `admin-boundary.mjs` still owns
the system-app shape: privileged `/_snapback/api/*` fetches, inspect flattening,
dynamic table cells, function-runner shaping, and boundary publication. That
still feels different from an ordinary generated app-table adapter, and LLP 0017
says it should stay different unless we deliberately promote an admin-specific
adapter. So the migration helped by shrinking the glue and making the remaining
glue obvious. It did not make admin a normal app surface.

`./build.sh` passed after the migration and emitted the same browser/native
artifacts as before. It still prints the existing Contract warnings about opaque
theme imports; those warnings were already present before this change.

## 2026-06-27 — Pulling the bridge lifecycle into the adapter

The next friction point was `admin-boundary.mjs`: after generated bindings, it
still owned too much generic Contract ceremony — creating the mock boundary,
storing single-row resources as iterable row collections, exposing query links,
writing resource updates, tracking async commands, and deciding what HMR cleanup
should dispose. I moved that into
`packages/snapback-contract` as `createSnapbackSystemContractSurface`.

That helper is intentionally not the ordinary app-table adapter. Admin is still
a system app over `/_snapback/api/*`, so the admin file keeps the privileged
client calls and the view-model shaping: inspect flattening, table-cell shaping,
function-runner JSON parsing, and diagnostic display. But the generic lifecycle
is now package code: resources in, generated links out, `publishOne`, `flush`,
`pendingCount`, and `dispose`.

This was the clearest LLP 0021 improvement so far. The code I had to reason
about in the admin file shrank to "what does admin data look like?" instead of
"how do Contract query resources work again?" I also added a smoke test that
compares `contract-bindings.mjs` to the bridge links and exercises table/function
publishing through a fake runtime. That test catches the exact class of drift the
diary has been complaining about.

The remaining glue is real but now better named: `admin-client.mjs` plus the
view-model functions in `admin-boundary.mjs`. That may deserve an admin-client
package later, especially if the embedded console and Contract console should
share one client. It is no longer boundary/link glue.
