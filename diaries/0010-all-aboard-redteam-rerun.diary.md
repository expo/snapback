# Diary 0010: All Aboard — React control arm, second red-team exercise

**Demo:** All Aboard (`demos/all-aboard/`)
**Arms:** `surfaces/contract/` (Contract/Exact, pinned toolchain) vs `surfaces/react/` (stock React 19 + Vite)
**Author:** Claude (Fable 5), agent-authored, RED-TEAM mandate — tasked with making the strongest honest case for React; second control-arm exercise, judged independently of the first
**Date:** 2026-07-02
**Related:** LLP 0027, LLP 0034, Diary 0008, ENG-22450, ENG-22435, ENG-22463, ENG-22486

## Framing caveat

Read this with the mandate in mind. I was instructed to bring the two arms back
to product parity, exercise both hard, and recommend a web surface for this
demo while making the strongest honest case for React — recommending React was
declared a fully successful outcome in advance, so there was no incentive to
flatter Contract. I did **not** read Diary 0009 (the first red-team) or the
Exact repo's strategy LLPs; where this diary disagrees with 0009, that is the
point of running the exercise twice. Caveats on the evidence itself: one agent
did all the work in one overnight session, so wall-clock numbers are
LLM-agent-shaped (fast typing, occasional environment retries), not
human-shaped; the Contract arm ran against the **pinned** Exact revision
(`exact.pin.json` → 9b22261264fe) in a dedicated worktree, so toolchain drift
— the thing that reportedly wrecked the first exercise — was controlled for by
construction this time; and the matched edits ran **Contract-arm first**
(the prior exercise ran React first), so within each edit the Contract cell
absorbs the design cost (choosing filter semantics, control placement) and the
React cell inherits settled decisions. Bias directions cancel across the two
exercises; they do not cancel within this one.

## What happened (chronology, one session, 2026-07-02 ~01:17–02:3x PT)

1. **Phase 0 (~16 min):** worktree, recon (read `app.contract`, `data.ts`,
   `main.ts`, `gestures.ts`, the snapback-contract adapter, the kit client's
   liveQuery/stream machinery), environment setup. Found port 4420 squatted by
   the main checkout's leftover `--memory` server and vite 5178 already
   serving, so the whole session ran isolated (API 4470, Contract vite 5378,
   React vite 5379 — the suites' env overrides worked exactly as designed).
   Found the sibling Exact checkout at 422baa08, **already drifted past the
   pin written ~40 minutes earlier**; created a dedicated worktree at the
   pinned revision (plus `bun install` and the `vendor/ibex` submodule it
   needed) and pointed `SNAPBACK_EXACT_ROOT` there for every Contract-arm
   operation. The preset banner confirmed `pinned Exact checkout verified:
   9b22261264fe` on every dev/build.
2. **Phase 1 (~15 min):** ported the redesigned product into the React arm
   (details below). First live render was already at visual parity; every
   interaction worked on the first probe.
3. **Phase 2 (~10 min):** grew `browser-react.mjs` from 6 to 12 mirrored
   checks; added the ENG-22486 vacuous-pass guard to both runners; both suites
   12/12 on first run.
4. **Phase 3 (~26 min):** E3 (service-filter chips) and E4 (ETA mode), each
   Contract-arm-first then React; all four cells green on the first product
   attempt; suites grew to 14/14 on both arms.
5. **Phase 4 (~25 min):** LOC, production builds + static-serve smoke, the
   symmetric error-DX experiment, the symmetric HMR experiment, full suite
   sweep (headless 11/11, cron 7/7, egress 4/4, browser 14/14,
   browser-react 14/14).

## Phase 1 — re-baselining the React arm (the port itself as a data point)

The React arm was still the pre-redesign product (light-theme cards) plus two
control-arm edits (12h/24h time format, urgent "Leaving soon"). The redesigned
Contract product includes neither, so parity meant **porting the current
`app.contract` product and deleting the stale edits** — the re-baseline is a
supersede, not a merge.

What the port produced: full-bleed poster art, hero countdown with
`heroOffset` stepping and ▲▼ clamping, delay labels/colors, the
loading/stale connection treatment (mirroring the Contract `async`/`stale`
arms: the stale pill shows on kit connection values `stale|disconnected` —
the same mapping the Contract runtime uses, which I confirmed by reading
`view.ts` in the pinned checkout), dark-sheet stations picker with distance
labels, dark-sheet trip detail with the service-colored position bar, edge
chevrons with terminus dimming, the same ~280-line gesture recognizer
installed over `#root`, D4 inspect-first boot, and **real server push**: two
kit `liveQuery` handles (`transport: 'stream'`) on one shared connection into
a `useSyncExternalStore` store — the old 1.5 s poll pump is gone, and
`window.allAboard` exposes the same facts shape (`livePush`, `connections()`,
`provisioned`) the Contract adapter exposes.

**Effort, honestly:** ~15 minutes of authoring across 12 files after ~15
minutes of reading the Contract arm. Zero rendering iterations — the first
screenshot was at parity, which says as much about `app.contract` as about
React: the .contract file **is** a complete, transcribable product spec; I
never once opened the running Contract app to answer "what does it look
like", only the source. What actually cost iterations (3 rounds, ~5 min) was
TypeScript strictness against the untyped shared `.mjs` modules — the model's
inferred types say lookups are nullable where seeded reality is not, so the
boundary needs honest casts. Notably, the old React arm dodged this by never
typechecking at all (its tsconfig included `vite.config.ts`, which didn't even
resolve `node:path` types); this port leaves `tsc --noEmit` strict-clean.

The one place React needed *more* understanding than Contract: the live-push
seam. Contract's `query delayRows = liveTrainStatus({})` plus
`createSnapbackContractSurface(...)` is configuration; the React arm hand-wires
the same behavior in ~130 lines (store + handles + facts). The kit client made
that easy — but the stale-arm semantics ("which connection values count as
degraded?") had no React-facing documentation; I had to read the Contract
runtime's source to mirror it faithfully.

## Phase 2 — acceptance parity and the vacuous pass

`browser-react.mjs` now mirrors `browser.mjs` check-for-check: boot, board,
three presses, mutation + freshness, paved-path facts, cron delta with no
pump, second-window D4, three gestures (dispatched at `#root`), then E3/E4.
Differences between the files are exactly the differences between the arms
(direct `client.mutate` vs generated mutation binding; hand-wired handles vs
generated bindings; `#root` vs `#exact-root`).

ENG-22486 confirmed: both runners' `finally` blocks exited
`process.exit(report.ok ? 0 : 1)` after the pre-check exception was swallowed,
and zero checks is vacuously ok. Both runners now declare `EXPECTED_CHECKS`,
print the swallowed setup error, and fail any run that performs fewer checks
than declared. A forced setup failure (bad `CHROME_BIN`) exits 1. The Contract
suite's declared-capability-gap skip path returns before the try block and is
unaffected.

## Phase 3 — matched edits, Contract arm first

| Cell | Wall clock | Product attempts to green | Diagnostics encountered | Acceptance regressions | Arm diff (insertions) |
|---|---|---|---|---|---|
| E3 Contract | ~8 min (incl. new check) | 1 — compiled and behaved first try | none from the compiler; one probe hit the dev server's first-connect-after-edit full reload (env, not code) | none (13/13) | 53 across 3 files (app.contract 21, data.ts 29, contract-meta 3) |
| E3 React | ~4 min | 1 — tsc clean, suite first try | none | none (13/13) | 72 across 3 files (App 9, DirectionBoard 30, lib 33) |
| E4 Contract | ~7 min (incl. new check) | 1 — compiled and behaved first try | same first-connect reload on the probe, once | **check itself** failed once — my selector matched the `station-search` input, a test bug either arm would have caught (Contract ran first, so it paid) | 53 across 3 files (app.contract 22, data.ts 26, contract-meta 5) |
| E4 React | ~5 min | 1 | none | none (14/14) | 60 across 4 files (App 9, StationCard 21, StationsPicker 5, lib 25) |

Reading the cells: **effort is a wash.** Neither arm needed a second product
attempt on either edit. The Contract cells carry two small recurring taxes —
the `data.contract-meta.ts` params row must be updated whenever a helper
signature changes (twice this session; forgetting it is a known trap I
pre-knew from the corpus), and the dev server's first page-connect after an
edit batch can deliver a deferred full reload that flakes automation (twice;
invisible to a human with the tab already open, real for probes). The React
cells carry the threading in TSX being slightly wordier per component
(interface row + prop + JSX attr vs one `name=value` pair on the call line),
which is why React's E3 diff is larger for identical behavior. The
Contract-first ordering means Contract cells also absorbed each edit's design
decisions (chip labels/testIds, where the ETA control sits, wide-fetch-then-
filter); the React cells transcribed them.

## The metrics

### Re-baseline effort (Phase 1+2)

| Measure | Value |
|---|---|
| Recon (reading the Contract arm + adapter + kit) | ~15 min |
| Authoring the port (12 files) | ~15 min |
| Iteration rounds to strict-clean tsc | 3 (untyped .mjs boundaries) |
| Rendering iterations to visual parity | 0 — first screenshot matched |
| Suite growth 6 → 12 checks + guard, to green | ~10 min, first run 12/12 |
| Phases 0–2 total (incl. env setup) | 26 min by wall clock (01:17:35 → 01:43:48) |

### Acceptance (end state, all against the isolated stack)

| Suite | Result |
|---|---|
| headless / cron / egress (shared backend) | 11/11, 7/7, 4/4 |
| browser.mjs (Contract) | **14/14** (12 baseline + E3 + E4) |
| browser-react.mjs (React) | **14/14** (mirrored) |
| Vacuous-pass guard | forced setup failure exits 1 in both runners |

### Hand-authored LOC (same product, post-E3/E4)

| Contract arm | LOC | React arm | LOC |
|---|---|---|---|
| app.contract | 371 | App.tsx + 4 components | 847 |
| data.ts | 285 | lib.ts | 254 |
| data.contract-meta.ts | 41 | store.ts | 92 |
| gestures.ts | 282 | gestures.ts | 279 |
| main.ts | 208 | main.tsx | 214 |
| vite.config.ts + index.html | 118 | ui.tsx + vite.config.ts + index.html | 208 |
| **Total** | **1305** | **Total** | **1894** |

Contract is 31% smaller overall; excluding the byte-identical gesture glue,
the authored product layer is ~1023 vs ~1615 (−37%). Fairness notes in both
directions: React's `ui.tsx` (116) and `store.ts` (92) are per-project
infrastructure, not per-feature cost, and React needs no `contract-meta`
sidecar (41 lines of pure tax that must track helper signatures by hand).
The per-edit diffs above are the better marginal-cost signal, and they are
close (Contract 53/53 vs React 72/60 insertions).

### Production builds (both green)

| | Contract (`exactContractWeb` preset, pinned checkout) | React (stock vite) |
|---|---|---|
| Wall / reported | 2.77 s / 1.37 s (rolldown) | 1.56 s / 0.59 s |
| dist | `dist/web/`: index.html 1.87 kB + JS 2,085.93 kB (gzip 1,247.40) + 3.16 MB map | `dist/`: index.html 1.88 kB + JS 1,823.72 kB (gzip 1,202.26) |
| Static-serve smoke | boots + renders against the live API | boots + renders against the live API |

Both bundles are dominated by the ~1.5 MB inlined poster art (shared,
deliberate, declared in the manifest). Net of art, the Contract client is
roughly 586 kB of code+runtime vs React's 324 kB — call it **+260 kB min /
+45 kB gzip for the Contract web runtime** on this app. One benign
`INEFFECTIVE_DYNAMIC_IMPORT` warning on the Contract build; chunk-size
warnings on both.

### Error DX (symmetric experiment: `headsign` → `headsgn.toUpperCase()` in the hero render expression, applied live to each arm, then reverted)

| | Contract | React |
|---|---|---|
| UI behavior | **blanks** (board unmounts; overlay covers) | **blanks** (React unmounts the root; page fully empty) |
| Vite overlay | **yes** — `[plugin:exact-contract] cannot read "toUpperCase" of undefined`, with `app.contract:261:22`, a caret **code frame of the .contract source**, and the context `(text binding in DirectionBoard)` | **no** (Vite doesn't overlay runtime errors) |
| Console | the same framed diagnostic + the raw interpreter stack (frames in the Exact runtime's interpreter.ts) | `TypeError ... at DirectionBoard (src/components/DirectionBoard.tsx?t=…:223:146)` — transformed-module coordinates in the raw stack (sourcemap-resolvable in DevTools UI); React 19 adds "An error occurred in the <DirectionBoard> component. Consider adding an error boundary." No code frame. |
| Static detection | **not caught** — the compiler types helper results opaquely (`HeroBoard` is a string, not a shape), so the page loaded and failed at render | **caught** — `tsc --noEmit`: `TS2551: Property 'headsgn' does not exist on type 'Departure'. Did you mean 'headsign'?` at the exact source line |
| Recovery on fix | HMR back to good state | HMR back to good state |

Honest summary: Contract has clearly better **runtime** error reporting (the
DSL-source code frame with binding context is the best runtime diagnostic I
have seen from either toolchain), React has clearly better **static** error
prevention (this exact bug never reaches a browser if you run tsc — or an
editor). Neither arm keeps last-good pixels; React could buy that with a
ten-line ErrorBoundary, Contract with whatever the runtime chooses to do —
the app author has no equivalent lever today.

### HMR (symmetric experiment: benign copy edit with the Limited chip selected)

| | Contract | React |
|---|---|---|
| Edit → new pixels | **221 ms** | **222 ms** |
| Full page reload? | no (window marker survived) | no |
| Component state (selected chip) survived? | **yes** | **yes** |

A dead tie, and a correction to my prior: the pinned Exact revision hot-swaps
the .contract without resetting app state on this path. The one HMR
difference observed all session is the first-connect-after-edit full reload
noted above, which only automation sees.

### Operational stability log (whole session)

| Event | Impact |
|---|---|
| Port 4420 squatted by the main checkout's leftover `--memory` server; 5178 already serving | none — ran isolated on 4470/5378/5379 via the suites' env overrides; killed nothing that wasn't mine |
| Sibling Exact checkout drifted past the pin before the session even started (pin written 01:01, sibling at 422baa08 by 01:17) | Contract arm required creating a dedicated pinned worktree + `bun install` (520 packages; one package failed until `vendor/ibex` submodule init) — after that the preset verified the pin on every dev/build and **the pinned workflow held for the entire session** |
| Snapback worktree needed `vendor/ibex` + `scripts/bootstrap-ibex-runtime` (artifacts copied from peer) + `DYLD_FRAMEWORK_PATH` for manual binary runs | ~3 min, once; the suites set the env themselves |
| Cold `cargo build` | 47 s (the ENG-22486 "0/0" scenario was a cold `cargo run` exceeding the 90 s health deadline; now guarded) |
| Contract dev server: deferred full reload on first page-connect after an edit batch | 2 probe retries; no human impact |
| Dev server restarts needed | **zero on both arms** across ~50 min of continuous use, HMR included |
| React arm install | `bun install`: 69 packages, 74 ms |
| Post-rebase re-verify: one transient `browser.mjs` 13/14 on the first run after the API restart (fresh backend + first page-connect after the HMR-experiment edits); 14/14 on the immediate re-run and twice more back-to-back. browser-react passed 14/14 on every run. | Contract-suite session total: 6 pass / 1 transient; consistent with the first-connect-reload flake class above |

## Per-arm: nice / annoying

**Contract — nice:** the single-file `app.contract` is a legible, complete
product spec (Phase 1 transcribed it without ever opening the running app);
`query` bindings + `async/loading/stale` arms express the live-data product
policy declaratively in the artifact; the runtime error overlay with DSL
code frames; contract blocks carry verifiable claims in the artifact; the
same file is the native app, which nothing in the React arm even attempts;
compile-clean-first-try on both edits.

**Contract — annoying:** the `contract-meta` sidecar must be hand-synced to
helper signatures (twice this session; silent drift is the failure mode);
opaque result types mean member typos ship to runtime; the toolchain is a
pinned sibling checkout of a 12k-file repo (the pin workflow *worked*, but I
had to build a worktree to hold it, and the sibling had drifted within the
hour); the deferred-reload race flakes automation; helper-result shapes live
in your head (or in data.ts), not in the language.

**React — nice:** completely self-contained toolchain (69 packages, 74 ms
install, stock vite — nothing to pin, nothing drifted); `tsc` catches the
typo class with did-you-mean precision; the ecosystem answer exists for every
gap (ErrorBoundary for blank-on-error, devtools, libraries); smaller client
bundle; every measured product behavior — push, D4, gestures, HMR latency,
state preservation — matched the Contract arm exactly.

**React — annoying:** the product layer is ~37% more code for pixel-identical
output, spread across 9 files + a ui kit; the live-data seam is hand-wired
(and its degraded-connection semantics had to be copied out of the Contract
runtime's source to stay faithful); no in-artifact verifiable claims — all
verification lives in the external suite; inline-style objects are the honest
mirror of Contract attrs but noticeably noisier; the arm is web-only, full
stop.

## The verdict

**(a) Ship the Contract surface as this demo's web surface.**

Two reasons, in order of weight. First, purpose fit: All Aboard exists (LLP
0027, the manifest's `systems` and `requiredCapabilities`) to exercise
Snapback's generated Contract descriptors, the paved-road live bindings, the
contract blocks, and the one-artifact-to-native claim. The React arm — by
design, as a control — exercises none of those: it consumes the kit client
directly, carries no generated bindings, no contract block, and cannot render
natively. Shipping it as *the* web surface would keep the pixels and delete
the demo's subject. Second, on the web-only merits the arms finished this
exercise close to tied — React wins operations (nothing to pin), static
safety, and bundle weight; Contract wins artifact economy (−31% LOC), runtime
diagnostics (source-mapped DSL code frames), declarative live-data policy,
and in-artifact claims — and a near-tie does not overcome the purpose-fit
asymmetry. The measured product outcomes (parity visuals, 14/14 both,
identical 221/222 ms HMR, state preserved both) mean neither arm can win on
"it works better."

**(b) The strongest case for React** (which I tried to make win): every
rider-visible behavior matched Contract with zero product-attempt retries,
on a toolchain that is 69 packages and 74 ms from a clean install — versus a
pinned checkout of a sibling repo that had *already drifted* by the time this
session started and needed a purpose-built worktree, a 520-package install,
and a submodule to hold still. The only error-DX difference a disciplined
team feels is in React's favor: the typo class never reaches a browser
because tsc catches it with a suggestion, while Contract's compiler happily
ships it to the runtime (opaque helper types). The client is ~260 kB lighter.
Any engineer on Earth can maintain it, and the ten-line ErrorBoundary that
fixes blank-on-error is a stock pattern rather than a runtime feature
request. If this demo's job were "ship riders a Caltrain web app," React is
the defensible, boring, correct choice — and nothing in this exercise
embarrassed it.

**(c) Checkable conditions that would flip my recommendation to React:**

1. **The native claim stays theoretical.** The manifest lists native as
   `expected_missing`. If, by the next re-evaluation checkpoint
   (2026-09-09), nobody has actually built/run the ExactApp host against this
   `app.contract`, the demo's decisive Contract-only advantage is unexercised
   fiction and the ops/static-safety case for React should win.
2. **The pin workflow fails a cold consumer.** If a fresh clone on a machine
   without a prepared Exact checkout cannot reach a green `browser.mjs` by
   following the README (published `@exact/*` packages absent — ENG-22480 —
   or the pin/worktree dance regresses), while `browser-react.mjs` stays
   green from `bun install`, ship React. I could hold the pin only because I
   control a checkout; an outside cloner may not.
3. **The static-safety gap persists through another exercise.** If the
   Contract compiler still cannot catch a typo'd member on a helper result
   (the contract-meta result types staying opaque strings) by the next
   matched-edit round, the error-class asymmetry compounds against Contract
   for any team larger than one.
4. **The contract-meta tax draws blood.** If a real regression ships because
   the sidecar params drifted from a helper signature (this session required
   two manual syncs), that converts an annoyance into evidence.

## Punch list (severity-tagged)

- **P1 (fixed here, upstream tracking ENG-22486):** both browser runners
  could exit `PASS — 0/0` on setup failure; now guarded with
  `EXPECTED_CHECKS` + surfaced setup errors in both. Consider moving the
  guard into `_kit/harness.mjs` (`finish({ expected })`) so the other demos'
  suites inherit it.
- **P1 (Contract toolchain):** the sibling Exact checkout drifted past the
  pin within ~40 minutes of the pin being written, before this session even
  began. The pin *detects* drift; it cannot *hold* a shared sibling still.
  Until `@exact/*` packages publish (ENG-22480), the README should recommend
  a dedicated pinned worktree (what this session did) rather than the
  mutable sibling.
- **P2 (Contract compiler):** typo'd members on helper results
  (`board.hero.headsgn`) compile clean because contract-meta result types
  are opaque. Structural result types (or even a declared-fields lint) would
  close the one error class where React is categorically safer.
- **P2 (Contract dev server):** first page-connect after an edit batch can
  receive a deferred full reload ("Inspected target navigated or closed" to
  CDP). Benign for humans, flakes agents/automation on cold connects; worth
  a look in the exact repo's vite plugin.
- **P2 (React arm, accepted debt):** the live-data seam's degraded-connection
  mapping (`stale|disconnected` → show the reconnecting pill) duplicates
  Contract-runtime policy by hand in `App.tsx`; if the kit's connection
  vocabulary changes, the React arm drifts silently. A kit-level
  `isDegraded(connection)` helper would deduplicate.
- **P3 (both arms):** neither keeps last-good pixels on a render-expression
  throw. React: add an ErrorBoundary around the board. Contract: no
  app-author lever exists today — runtime feature material.
- **P3 (React arm):** `main.tsx` boot facts (`window.allAboard`) are
  hand-maintained to mirror the adapter's shape; a shared fixture/type for
  the facts object would keep the two suites honest if the shape evolves.
- **P3 (repo hygiene):** `demos/todo*` contract surfaces still carry the
  hand-rolled vite config shape this demo left behind (noted in Diary 0008;
  still true).

## 2026-07-02 — Independent cross-family verdict (GPT/Codex)

> Provenance: OpenAI Codex CLI v0.142.5 (gpt-5.5), read-only sandbox, run at the
> orchestrating session's request AFTER the diary above was written. The judge
> was instructed to read both surfaces, configs, pin file, and acceptance
> suites but NOT this diary or 0009, so the verdict below is uncontaminated.
> Verbatim.

## Verdict
Ship `demos/all-aboard/surfaces/react/` today.

## Top reasons
- Lower ship risk: React uses local stock Vite/React dependencies and scripts (`surfaces/react/package.json:5-20`, `vite.config.ts:19-46`); Contract requires a sibling Exact checkout and skips acceptance entirely when absent (`tests/acceptance/browser.mjs:14-15`, `82-87`).
- Build/deploy story is simpler: React's suite self-installs missing deps (`browser-react.mjs:70-81`); Contract's Vite runs from `exactRoot` and imports plugin source from that checkout (`surfaces/contract/vite.config.ts:28-45`).
- Maintainability for ordinary web engineers is better: React splits root, store, helpers, and components (`App.tsx:49-83`, `store.ts`, `components/*`), while Contract concentrates product state, actions, view, and contract grammar in one specialized `.contract` file (`app.contract:70-143`).
- Test coverage is effectively tied: both arms have the same 14-check browser contract for boot, gestures, live push, second window behavior, filters, and ETA mode (`browser.mjs:48-52`, `browser-react.mjs:44-47`).
- The React arm's hand-wired live-query code is not ideal, but it is explicit and small enough to audit (`main.tsx:132-154`); the Contract arm's generated binding path is cleaner but depends on more project-specific machinery (`contract/main.ts:149-164`).

## Strongest case for the other side
- Contract is more purpose-fit for demonstrating Contract/Exact: generated Snapback `query`/`mutation` bindings are first-class in the UI grammar (`app.contract:81-99`, `131-132`).
- Contract has the cleaner product model: state, derives, actions, async stale/loading UI, and test-id contract sit together declaratively (`app.contract:70-143`), with no React external store.
- The Exact pin mechanism is honest and improving: `exact.pin.json` records a verified revision, and the Vite preset reports drift with strict-mode support (`exact.pin.json:1-5`, `vite.config.ts:1-23`).

## What would flip my verdict
- A reproducible Contract install/build path that does not require an untracked sibling checkout, or a CI job that fetches the pinned Exact revision and runs the 14-check suite without `SNAPBACK_CAPABILITY_EXACT_MISSING`.
- `EXACT_PIN_STRICT=1` enabled in the shipped Contract build/test path, with documented failure behavior when the checkout revision differs from `exact.pin.json`.
- Evidence that Contract production `vite build` passes from a clean checkout using only committed/pinned inputs.
- At least one next-feature edit showing Contract compiler errors are local and understandable enough for non-Exact specialists.

## Confidence
medium — I read the relevant code/configs/tests but did not run builds or acceptance suites, per the read-only/no-build instruction.

> Orchestrator note — the gate result, recorded precisely: this is a **split
> verdict**. The builder-judge (who ran both arms: 14/14 suites, matched
> edits, builds, error probes) flipped to ship-Contract; the code-reading
> judge (read-only, no builds) stayed ship-React, with every one of its flip
> conditions concentrated on **cold-clone reproducibility** — the sibling
> checkout, acceptance skipping when Exact is absent, strict pin mode not
> defaulted in the shipped path. Those are precisely the phase-2 distribution
> items (published @exact/* packages, ENG-22480; CI strict-pin job). Compared
> to exercise one — where BOTH judges said ship-React on live operational
> breakage — the disagreement has narrowed from "the toolchain breaks under
> you" to "prove a stranger can build this from a clean clone." LLP 0286
> §Decision.3's outcome is recorded as: primary instrument flipped;
> cross-family dissent names distribution as the remaining condition, which
> becomes the checkpoint's named criterion rather than a full lane
> re-examination. The reopen-vs-proceed reading is the author's call and is
> recorded in LLP 0286.
