# Diary 0009: All Aboard — the React red-team control arm

**Demo:** All Aboard (`demos/all-aboard/`)
**Surfaces:** Contract/Exact web (baseline, `surfaces/contract/`), React 19 + Vite web (control arm, `surfaces/react/`)
**Author:** Claude (Fable 5), agent-authored, RED-TEAM mandate — tasked with making the strongest honest case for React.
**Date:** 2026-07-01
**Related:** LLP 0027, Diary 0008, ENG-22435, ENG-22417 (the componentized `app.contract` this ports)

## The mandate, stated plainly

Every prior diary in this program was written by an agent told "build this in
Contract." Nobody had been asked to argue the other side. This entry is that
argument: port the All Aboard Contract surface to idiomatic React, get both
arms to identical acceptance, run the same two follow-up edits on each, measure
everything, and recommend — with a straight face — which version should ship.
Recommending React was declared in advance to be a fully successful outcome.
I tried to make React win. The verdict section reports what survived that
attempt.

**Framing caveats, up front:**

- One agent (me) built the React arm *and* judged the contest. I wrote the
  React port with the Contract acceptance suite open in my context, which is a
  tailwind no greenfield port gets.
- Edit order was React-first, Contract-second, for both benchmark edits — so
  Contract got the second-mover advantage (settled design decisions, existing
  verification scripts). I chose that deliberately: I'm the React advocate, so
  the handicap goes on my side. The reverse bias also exists: design decisions
  were made in React idiom and Contract had to express them.
- The Contract arm's toolchain is the sibling `../exact` checkout at whatever
  HEAD it happens to be on, and that repo was being actively committed to by
  another agent *during this benchmark*. That produced the most decision-grade
  incident of the evening (§ "The toolchain incident") but also means some
  Contract-arm friction is wiring, not framework.
- Native was not exercised. Diary 0008 marks native as expected-missing in this
  repo; both arms were judged as what they are here: browser apps.

## Phase 1 — the port

`demos/all-aboard/surfaces/react/`: a self-contained npm project (real
`react@19.2.7` / `react-dom@19.2.7`, `vite@6.4.3`, `@vitejs/plugin-react`),
no sibling Exact checkout, no aliases. Same backend, same boot lifecycle
(`window.allAboard.ready`), same `data-testid` handles, same visual chrome
(verified by side-by-side screenshots of home / stations / trip).

**Glue decision (documented per the mandate):** the shared transit model
(`snapback/shared/model.mjs`) and the shared client (`_kit/client.mjs`) are
imported unchanged — counted once, owned by neither arm. But I did *not* reuse
`store.mjs`/`data.ts`: those exist to close over a hidden mutable store behind
`_tick` cache-buster params, which is the Contract workaround for derives that
can't subscribe to external state. The React-natural shape is a subscribable
store read through `useSyncExternalStore` (components re-render the moment a
poll lands, not on the next clock tick) plus a `useNow(1000)` hook for
countdowns, with helpers taking explicit arguments. That's `src/store.ts` (73
lines) + `src/lib.ts`. The four presentational components mirror the Contract
componentization (StationCard / DirectionBoard / StationsPicker / TripDetail)
with callbacks threaded as props, so the two arms are structurally comparable.

One porting note: the station photo (inline SVG with embedded JPEG) renders in
React as a plain `<img src="data:image/svg+xml;utf8,...">` — the data-URI
restriction that forced Contract's `svgSource=` path is a DOM-mirror
constraint, not a browser one.

## Phase 2 — acceptance parity

`tests/acceptance/browser-react.mjs` mirrors `browser.mjs` check-for-check
(same six assertions, same CDP harness, same server lifecycle). Both suites ran
against this worktree's engine on isolated ports (another live agent session
owned the defaults :4420/:5178 — the Diary 0008 gotcha, hit again; I added
default-preserving env overrides `ALL_ABOARD_API_PORT` / `ALL_ABOARD_VITE_PORT`
to `browser.mjs` rather than touch the shared servers).

| Suite | Baseline | After E1 | After E2 | Final re-run |
|---|---|---|---|---|
| Contract browser (6 checks) | 6/6 | 6/6 | 6/6 | 6/6 |
| React browser-react (6 checks) | 6/6 (first run ever) | 6/6 | 6/6 | 6/6 |

The React port passed all six checks on its first-ever run. Honest caveat: it
was written test-in-hand.

## Phase 3 — the matched edits

Same features, same design values (#dc2626, same chip styling, same testIds),
implemented independently per arm. React first, Contract second (bias noted
above). "Attempts to green" counts compile+verify cycles until the feature
verified live AND the arm's 6-check suite passed.

**E1 — urgent departures** (countdown ≤ 5 min renders red; hero also gets a
"Leaving soon" badge). Verified live on both arms by a shared CDP script
asserting the color↔minutes mapping across hero / secondary rows / opposite
line, both directions (observed urgent and calm cases on both arms; zero
mismatches).

**E2 — 12h/24h toggle** in the station card header changing every displayed
clock time app-wide. Verified live on both arms across toggle/untoggle on home
and trip screens (10 and 13–21 time strings per pass, zero misformatted).

| Edit × Arm | Attempts to green | Diff (+/−) | Files touched | Wall clock (edit→suite green) | Suite regressions |
|---|---|---|---|---|---|
| E1 React | 1 | +41 / −4 | 2 | ~1.6 min | none |
| E1 Contract | 1 | +16 / −3 | 3 | ~1.2 min | none |
| E2 React | 1 | +37 / −11 | 5 | ~2.2 min | none |
| E2 Contract | 1 | +25 / −13 | 3 | ~1.5 min | none |

Both arms were boringly first-try on both edits. I expected the Contract
grammar to fight the edits; it did not: ternary color attrs with
function-call conditions compiled, `when isUrgent(...)` with a call expression
compiled, the template-string ternary chip label compiled, and threading
`use24h` + `toggleTimeFormat` through three component boundaries was mechanical
(props declaration + call-site args — the same shape as React's prop
drilling). Contract's diffs were consistently ~40–60% smaller; part of that is
JSX/prettier multi-line style-object formatting inflating the React counts, but
the one-line-per-node attr grammar is genuinely denser. Contract's E2 tax was
real but small: `data.ts` signature changes had to be hand-mirrored in
`data.contract-meta.ts` (`params:` lists) — a duplicate with no checker I
could see; I updated it correctly on the first try, so I can't report what
happens when it drifts.

## Phase 4 — measurements

**Hand-authored LOC (final state, both edits in; shared glue counted for
neither arm):**

| | raw lines | code lines (no blanks/comments) |
|---|---|---|
| Contract arm (app.contract, data.ts, data.contract-meta.ts, store.mjs, main.ts, index.html, vite.config.ts, package.json) | 771 | 601 |
| React arm (src/* incl. 4 components + ui.tsx + store.ts + lib.ts + main.tsx, index.html, vite.config.ts, package.json, tsconfig.json) | 1,169 | 1,009 |
| Shared, counted once (model.mjs + _kit/client.mjs) | 913 | — |
| Acceptance (browser.mjs / browser-react.mjs) | 211 / 203 | — |

Contract expresses the same app in ~60% of the code. The single-file
`app.contract` reads like a spec; the React arm is spread across nine files.
(Counter-caveat: ~80 of React's lines are a reusable mini-kit (`ui.tsx`), and
JSX formatting conventions pad line counts.)

**Production bundle (`vite build`, pre-gzip JS):**

| | result |
|---|---|
| React arm | 873.4 kB single JS asset (534.3 kB gzip), built in 513 ms. Of that, ~662 kB is app *data* riding the bundle (610 kB base64 station photos + seed + manifests), so framework + app code ≈ 210 kB, which is mostly react-dom. |
| Contract arm | **DNF.** `vite build` with the surface's config hung indefinitely at 0% CPU (main thread parked) on two attempts (>5 min each, no output, no `dist/`), run from the Exact checkout exactly as the dev flow runs. The surface's package.json defines only a `dev` script; no production web build path is demonstrated anywhere in this demo. A supported path may exist elsewhere in the Exact repo (the blog's static pipeline), but it is not wired here. |

**Dev loop (measured with the same CDP probe on both arms — style-only edit
while sitting on the trip screen, heap marker planted):**

| | React | Contract |
|---|---|---|
| HMR apply time | 307 ms | 310 ms |
| UI state preserved (stayed on trip screen) | yes | yes |
| JS heap preserved (no full reload) | yes | yes |
| Syntax-error overlay | yes, `file:line:col` correct, caret code frame | yes, message correct but file locus garbled (`app.contract:389:37` / `:7470:18` for a 289-line file; message says the right line, locus disagrees), no code frame |
| App under the overlay | last-good UI stays rendered | blanks (torn down on failed reload) |
| Recovery on fix | automatic | automatic |
| Semantic-error quality | n/a (TS types catch prop misuse in-editor) | genuinely good message: `press= references "toggleTimeFormatX", which is not a declared action or callback prop` — the Diary 0008 `event_unknown_action` complaint is visibly fixed (it now names callback props), though an unrelated `duplicate_source_imports` hint crowds the overlay |

Contract HMR being a dead tie with react-refresh — state-preserving at ~310 ms
— was the biggest positive surprise of the exercise.

## The toolchain incident (decision-grade, so it gets its own section)

At 22:00:27, mid-benchmark, my Contract dev server logged `server restarted` —
at the exact second another agent committed to the sibling Exact repo (the
config aliases `@exact/*` into `packages/*/src`, so vite watches a live repo I
don't control). The restarted server came up in a state where the page would
not boot at all (two verification runs failed with `window.allAboard` never
appearing) until I manually restarted it. Worse, on current Exact HEAD (and on
a pinned pre-incident commit I checked via a detached worktree), the plugin no
longer serves the surface's own `index.html` at `/` — it serves its generated
router shell. The app still boots (the entry still resolves), so **the
acceptance suite still passes 6/6**, but the surface's boot-status affordance
and page-level CSS are silently gone; final screenshots show black page chrome
where `#f4f6fb` used to be. A real regression rode in from a repo this demo
doesn't control, invisible to this demo's tests, in the middle of an evening.
Nothing comparable is even possible on the React arm: its entire toolchain is
version-locked in its own `bun.lock`.

I spent ~35 minutes of the benchmark diagnosing this (including a curl-vs-
browser misdiagnosis of my own: the shell swap looks total from curl, while a
real browser still boots the app). Mitigation shipped with this branch: the
surface's vite config now honors `SNAPBACK_EXACT_ROOT` (the convention
`browser.mjs` already used), so the Exact toolchain can be pinned to a
detached worktree. My own errant contribution — running `vite build` with the
React arm's vite 6 binary against the Contract config from the wrong cwd —
scaffolded `src/` + `node_modules/` into the surface dir; the plugin also does
this on normal boots (`src/__generated/routes`), which makes the surface dir
state opaque to clean up.

## What was nice / what was annoying

**React arm — nice:** zero capability negotiation (geolocation, data-URI
images, mono font stacks all just work); the store layer got *simpler* than
the Contract arm's (`useSyncExternalStore` replaces store.mjs + `_tick`
cache-busters + the generated links indirection — the refresh mutation is one
`client.mutate` call); TS types make prop threading self-checking; error
overlay is exact; the whole arm is self-contained and boringly reproducible;
`vite build` works in half a second.

**React arm — annoying:** ~68% more code for pixel-identical output; every
inline-style node is a small essay (`{ display:'flex', flexDirection:'column',
gap: 12 }` vs `column gap=12`); the `<button>` UA reset had to be hand-built
(Contract's `button` node is pre-reset); react-dom is ~180 kB of bundle for an
app whose own code is a few kB; nothing machine-checks UI claims — the
contract block has no React equivalent, and the acceptance suite is the only
behavioral net.

**Contract arm — nice:** the density (601 lines, one primary file, reads like
a spec); attr-grammar styling; both benchmark edits landed first-try with
diffs ~half of React's; HMR at parity with react-refresh *including* state
preservation; the `event_unknown_action` diagnostic now names callback props
(the exact Diary 0008 complaint, fixed); the contract block states verifiable
claims in-source.

**Contract arm — annoying:** the toolchain incident above (live-HEAD sibling
dependency, silently swapped index.html, mid-commit restart brick); no
demonstrated production web build; error locus garbled + no code frame + app
blanks under the overlay; the contract-meta sidecar is hand-mirrored
duplication; `_tick` cache-buster derives are a leaky reactivity workaround
(the store cannot push); compile warnings (LLP 0278 §5 mutation-observability,
duplicate-imports hint) print on every reload with no way I found to resolve
them from the surface side; `ui-monospace` alone falls back to serif in
headless Chrome (React arm shipped the full stack).

## The verdict

**(a) Which version should ship: the React arm, as this demo's user-facing web
surface, today.** The two arms are behaviorally identical, equally green, and
equally editable — the mini-benchmark refuses to separate them on authoring
(all eight cells first-try; Contract actually wins diff size). What separates
them is everything around the code: the React arm is version-pinned,
self-contained, builds for production in 513 ms, and fails loudly with exact
error loci; the Contract arm's toolchain broke twice in one evening for
reasons originating outside this repository, silently lost its own index.html,
cannot currently produce a production web bundle from this demo, and reports
errors at line 7470 of a 289-line file. For a web app someone ships and
operates, that is the whole ballgame. If the criterion were "fewest lines that
read most like the product spec," Contract wins; that is not the shipping
criterion.

**(b) The strongest case for the losing side (Contract), stated as strongly as
I can honestly state it:** Contract expressed the identical app in 60% of the
code, in one file that reads like a specification; its edit diffs were half of
React's; its HMR is at full parity including state preservation; its semantic
diagnostics (unknown action naming callback props) are *better* than anything
React gives you at runtime; it carries machine-checkable UI claims in-source
(`contract` blocks) that the React arm simply cannot express; and the same
file is claimed to render natively on macOS/iOS — the one capability that
would make the React arm strictly inferior, and the demo's stated reason to
exist (LLP 0027). Every operational failure I hit was toolchain wiring
(sibling-checkout-at-HEAD, plugin build path, overlay locus), not language.
Nothing in the Contract *language* lost this contest; the delivery vehicle
lost it.

**(c) What would flip my recommendation to Contract** (all four; the first two
are the load-bearing ones):

1. **A pinned, versioned toolchain** — published `@exact/*` packages or a
   lockfile-pinned vendored checkout, so this repo's surface cannot be broken
   or visually altered by a commit in a sibling repo. (The
   `SNAPBACK_EXACT_ROOT` hook added on this branch is the minimum viable
   version of this.)
2. **A working production web build** for this surface (`vite build`
   completing, or a documented equivalent pipeline wired into the demo).
3. **Error locus parity**: correct file:line:col into the `.contract` source,
   a code frame, and last-good UI kept under the overlay instead of a blank.
4. **The native claim exercised** here (the same `app.contract` demonstrably
   running on the Exact macOS host in this demo's acceptance story), since
   that is the advantage React cannot answer.

Items 1–3 are engineering-months, not years. If they land, the measured
authoring advantages (density, diffs, contract blocks, HMR parity) make
Contract the better ship for this demo, and I would say so.

## Punch list

| # | Severity | Arm/owner | Item |
|---|---|---|---|
| 1 | high | Contract toolchain | `vite build` of the surface config hangs at 0% CPU (2/2 attempts, no output, no dist). No production web build path exists in the demo (`package.json` has only `dev`). |
| 2 | high | Contract toolchain | Error overlay file locus is garbled for `.contract` sources (`:389:37` / `:7470:18` in a 289-line file) and there is no code frame; failed reload blanks the app instead of keeping last-good UI. |
| 3 | high | Repo wiring | Sibling-checkout-at-HEAD toolchain: upstream commits restart the dev server mid-flight (one restart bricked boot until manual intervention) and current Exact HEAD silently serves its router shell instead of the surface's `index.html` (boot-status + page CSS lost; acceptance-invisible). Pin via `SNAPBACK_EXACT_ROOT` (added) or versioned packages; consider an acceptance check on served-HTML identity. |
| 4 | medium | Contract lang/tooling | `data.contract-meta.ts` `params:` lists are hand-mirrored duplicates of `data.ts` signatures with no apparent drift checker (E2 required editing both in lockstep). |
| 5 | medium | Demo tests | `/health` still carries no engine/build identity (Diary 0008 follow-up, re-bitten): reuse-if-healthy trusted a different checkout's API *and* vite. The new port-override envs mitigate; identity assertion would fix. |
| 6 | medium | React arm | `browser-react.mjs` duplicates the ~55-line CDP harness from `browser.mjs`; extract to `_kit` if the React surface stays. |
| 7 | low | Contract surface | `family="ui-monospace"` falls back to serif in headless Chrome (CI screenshots show serif times); use a full mono stack. |
| 8 | low | Contract runtime | DOM mirror still blocks `data:` URIs on `image src=` (the `svgSource` workaround stands; the React arm renders the same asset with a plain `<img>`). |
| 9 | low | Contract compiler | LLP 0278 §5 mutation-observability warnings + `duplicate_source_imports` hint print on every compile of this surface with no surface-side resolution path; the hint also crowds real errors in the overlay. |
| 10 | low | Contract toolchain | The plugin scaffolds `src/__generated/` and `node_modules/.vite` inside the surface directory on boot — opaque state in a hand-authored dir; document or relocate. |

## Ledger

- Both arms, final state: browser acceptance 6/6, both edits kept, visual
  parity screenshot-verified (modulo incident-caused page-chrome regression on
  the Contract arm, which is upstream, not this branch).
- What did not run: the Contract production bundle (hung — measured as DNF);
  native anything; a drift test of the contract-meta sidecar.
- Learning-effect bias: React-first on both edits (Contract had settled
  designs + existing verify scripts); the React port itself was written with
  the acceptance suite in context.
- Environment: engine built from this worktree (`bootstrap-ibex-runtime` +
  `cargo build`, 45 s) on :4431; Contract vite :5188 from the sibling Exact
  checkout; React vite :5189 self-contained; another agent session's servers
  on :4420/:5178 left untouched.

## 2026-07-02 — Independent cross-family verdict (GPT/Codex)

> Provenance: OpenAI Codex CLI v0.142.5 (gpt-5.5), read-only sandbox, run at the
> orchestrating session's request AFTER the diary above was written. The judge
> was instructed to read both surfaces, configs, and acceptance suites but NOT
> this diary, so the verdict below is uncontaminated by the one above. Verbatim.

## Verdict
Ship `surfaces/react/`.

## Top reasons
- React has the lower ship risk: its Vite config is stock React/Vite with local dependencies and no Exact aliases (`surfaces/react/vite.config.ts`, `surfaces/react/package.json`); Contract imports Exact source from a sibling checkout and aliases many internals (`surfaces/contract/vite.config.ts`).
- Contract's acceptance can legally skip when Exact is missing (`tests/acceptance/browser.mjs:76`); React installs/runs from its own surface instead (`browser-react.mjs:59`).
- React is more editable for the next feature: root state, live store, helpers, and components are separated with typed props (`App.tsx`, `store.ts`); Contract concentrates most UI/action/style logic in one 289-line grammar file (`app.contract`).
- React's live-state model is explicit `useSyncExternalStore` snapshots (`store.ts`); Contract relies on mutable module state plus `_tick` cache-buster helper args (`data.ts`).
- React has a concrete build/deploy path and checked-in `dist` output; Contract exposes only a dev script run from Exact.

## Strongest case for the other side
- Contract is the product's intended differentiator: one `.contract` is meant to render web and native from the same UI definition.
- Contract is much more compact at the surface layer: one main UI file plus helpers, while React spreads the same UI across multiple TSX files.
- Contract exercises generated Snapback Contract mutation bindings, not just direct `client.mutate`, so it better proves the Exact/Contract integration path.

## What would flip my verdict
- Contract has a self-contained, pinned dependency story: no sibling Exact checkout, no source-alias matrix, reproducible install/build from `surfaces/contract/package.json`.
- Contract acceptance no longer skips for missing Exact in normal CI, and both suites explicitly assert urgent highlighting and 12h/24h toggle behavior.
- Contract provides a production build/preview artifact equivalent to React's `vite build`/`dist`.
- The `.contract` UI is split or otherwise made easier to edit without large single-file changes and duplicated meta declarations.

## Confidence
medium — the code/config evidence is clear, but I did not run builds or tests per the read-only/no-build instruction.

> Orchestrator note: two independent model families reached the same ship-React
> verdict via the same causal story (operational packaging, not the language),
> and their flip conditions overlap on pinned consumption + a working external
> production build. One genuine dissent between the judges worth preserving:
> Codex scored the single-file multi-component `.contract` surface as LESS
> editable than React's file-per-component split — the opposite of this diary's
> (and the corpus's) compactness-as-win framing. Flip conditions tracked as
> ENG-22446 (pinned consumption), ENG-22441 (external production build),
> ENG-22443 (error-locus parity), ENG-22445 (index.html takeover); the
> acceptance-must-not-skip point folds into ENG-22446's CI story.
