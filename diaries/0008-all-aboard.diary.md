# Diary 0008: All Aboard — Caltrain next-train

**Demo:** All Aboard (`demos/all-aboard/`)
**Surfaces:** headless (required), cron (required), egress (required), Contract/Exact web (required), native macOS/iOS (expected-missing)
**Author:** Claude
**Date:** 2026-06-30
**Related:** LLP 0027, LLP 0028, LLP 0009, LLP 0015, LLP 0016, LLP 0004, LLP 0008, LLP 0013, LLP 0020, Diary 0004, Diary 0007

## 2026-06-30 — Building All Aboard end to end

### What I built

All four phases of LLP 0027, on one shared Snapback backend:

- **Phase 0 (headless):** durable Caltrain schedule — 21 stations on a single
  north→south axis, 6 service patterns (local / limited / Baby Bullet each way),
  indexed `stopTimes`, plus the live tables `trainStatus` (per-pattern delay) and
  the `feedRefreshState` singleton, and a committed cycle of recorded `feedTicks`.
  The prediction / haversine / countdown math lives in one dependency-free
  `snapback/shared/model.mjs`, imported by both the surface and the tests, so the
  number a rider sees is the number a test asserts.
- **Phase 2 (cron):** a demand-armed minute warm-poll (`defineCron`) whose action
  `refreshFeed` advances the recorded feed one tick **through a mutation**
  (`applyFeedTick`), which fires the existing realtime fan-out for free.
- **Phase 3 (egress):** an opt-in `SNAPBACK_OUTBOUND_ACTIONS` seam that un-denies
  `fetch` + timers and injects `ctx.secrets` for the **action** class only.
- **Phase 1 (Contract/Exact):** a gesture-affordance, geolocation-driven,
  multi-surface `app.contract` that renders the nearest-station board, the assumed
  direction expanded with stops, the opposite direction minimally, walk/bike ETAs,
  and a tap-through train detail with an ordered stop list and a position
  indicator. It runs on web today at `http://127.0.0.1:5178` and shares its source
  with the native Exact host.

Acceptance: headless 11/11, cron 7/7, egress 4/4, Contract browser 6/6, and the
Rust suite stays green (no regressions from the two engine changes below).

### Snapback / engine changes

Only two, both small and behind the existing reserved flags:

1. **Demand deactivation on disconnect** (`src/local.rs`). `disconnect` cleaned
   only ephemeral state, so a durable live subscription — and therefore a
   `whileLive` cron job's demand — never went away. One `retain` on the
   subscription map fixed it; without it the cron activation story is only half
   true (arms, never disarms). This is the correct behavior anyway: a dead
   connection cannot receive deltas.
2. **The action-egress seam** (`src/runtime.rs`, `demos/_kit/codegen.mjs`). The
   ambient deny is now mode-aware: with `SNAPBACK_OUTBOUND_ACTIONS` on, an action
   keeps `fetch`/`setTimeout`/`setInterval` and gets `ctx.secrets`, while queries
   and mutations stay fully denied; the coarse Ibex `network:fetch` capability is
   granted only when the flag is on. Codegen's `BUNDLE_UNSUPPORTED_FETCH` guard is
   relaxed under the same flag (the runtime, not codegen, is the boundary). Default
   posture is unchanged — everything denied, strict.

Everything else — the whole cron subsystem, the action→mutation path, the
realtime fan-out — already existed. Cron was the "primary build" LLP 0027 named,
but it turned out to be **already implemented** (commit `1cb6bcb`); the demo's job
was to be its first real consumer, and it exercised it cleanly.

### Glue inventory

| File | Role | Hand-written? |
|---|---|---|
| `snapback/schema.mjs`, `functions.mjs`, `handlers.mjs` | Backend, authored via the kit | yes (source) |
| `snapback/shared/model.mjs` | Pure transit model shared by surface + tests | yes (source) |
| `snapback/seed.gen.mjs` → `seed.json` | Deterministic seed generator | yes (source) |
| `snapback/generated/*` | Manifests, api, Contract descriptors | generated |
| `surfaces/contract/app.contract` | The one multi-surface UI | yes (source) |
| `surfaces/contract/data.ts` + `.contract-meta.ts` | Pure `use` helpers over the model + store | yes (bridge) |
| `surfaces/contract/store.mjs` | Live-delay / location seam between Snapback and the view | yes (bridge) |
| `surfaces/contract/main.ts` | Boot: load/seed, live subscription, geolocation, mount | yes (bridge) |
| `surfaces/contract/{index.html,vite.config.ts,package.json}` | Web host wiring | yes (copied from todo-v2) |

The honestly-new glue is `store.mjs` + the live-subscription poll in `main.ts`
(see the friction note below).

### Did gesture + geolocation binding work over generated artifacts?

**Gestures: no — and this is the headline gap.** LLP 0027's Context Pack claims
Exact exposes `swipe`/`OnSwipeDown`; it does not. Swipe/pan primitives live only
in two unbuilt Exact RFCs. The Contract event vocabulary is exactly
`press change submit longpress focus blur scrollend refresh`. So the "gesture-first"
interaction became **press-first**: on-screen ◀ ▶ station arrows, a Flip-direction
button (a bare tap is the direction toggle), and tap-a-train for detail. These are
portable to web and native and are agent-checkable by `testId`. I corrected the
manifest's `exact.gestures` to `false` and recorded swipe as a declared gap rather
than fake it. This is the Diary-0007 caution in its strongest form: "primitive
exists in source" was not even true here.

**Geolocation: partially.** There is no Contract geolocation binding (Exact's own
Caltrain twin skips it and hard-defaults a location). I wired `navigator.geolocation`
in `main.ts` and pushed the coordinates into `store.mjs`; the denied/unavailable
fallback selects the nearest station to a default (Mountain View). That fallback
is what the browser acceptance actually exercises, since headless Chrome has no
location. So geolocation "binds" through hand-written surface glue, not a generated
Contract capability.

**Where Contract fought the UI:** two places. (1) Actions are component-scoped, so
child components can't call the parent's actions — my first cut split the board
into child components and failed to compile with `event_unknown_action`. Inlining
the whole thing into one component (every `press=` in scope) was the fix. (2) The
`image src=` DOM-mirror path silently dropped a `data:` URI; `image svgSource=` with
inline SVG markup rendered the generated station "drawing" reliably on both hosts.

### How did read-through refresh / minute-cron / outbound-fetch feel?

Compared to the durable (todo) and ephemeral (cursors) paths, the refresh path was
the most *satisfying* because so little of it was new: `defineCron` +
`defineAction` + a `ctx.runMutation` handler, run through the same codegen, and the
realtime delta fell out of the mutation commit exactly as the durable path
promised. The demand-activation model (`whileLive`) is genuinely nice — the poll
literally does not run until someone opens the app, and stops when they leave.

Two rough edges worth recording:

- **The browser Contract adapter does not push.** `createSnapbackContractSurface`
  reconciles by re-querying after a *local* mutation; it never subscribes to the
  durable live stream, so a server-authored (cron) delta would not reach the
  browser through it. And it is single-boundary (todo-shaped), so it can't back a
  multi-query, arg-reactive app. I therefore fed the live delays into a `store.mjs`
  that the `.contract` derives from on each 1s tick, and drove the store from a
  real `client.liveQuery` subscription + poll. That works and is arguably *more*
  faithful (real durable push in the browser), but it is demo-local glue — the
  opposite of the Diary-0004 win where the adapter moved into `packages/`. Making
  the shared adapter multi-boundary + live-push is the obvious follow-up.
- **`initial_nominal` returns `Some(0)`**, so an `everyMs` job is immediately due;
  once a subscription arms it, the 1 Hz background scheduler fires it within a
  second. That is correct product behavior (first watcher → immediate catch-up),
  but it made my first tests race. The fix was discipline, not code: do all
  exact-value assertions with one-shot queries (which don't arm the job), and only
  subscribe for the deliberately race-robust delta checks.

Outbound `fetch` was, as LLP 0027 predicted, *enablement not construction*: Ibex
already ships `fetch`; the work was un-denying it for one execution class and
adding a secrets object. The un-satisfying part is that the destination allowlist
is still coarse (`network:fetch`, no host) — a known gap, not something I could
close from the demo.

### Compared to React + Convex / Supabase (+ a transit API + a maps SDK)

On Convex I'd get the live-query push *to the browser* for free (the piece I had
to hand-roll here) and a first-class `useQuery`. But I'd hand-write more of the
rest: a cron entry that calls an action, an action that fetches and then calls a
mutation, and the whole schedule/prediction model — none of which is conceptually
different from what I wrote, just spread across more files and a dashboard.
Supabase would push realtime table deltas cleanly too, but cron (pg_cron) and
server-side fetch (Edge Functions) are separate runtimes you stitch together; the
"one backend, one codegen, action→mutation in the same model" story is where
Snapback was tighter.

Where Snapback clearly *reduced* friction: the refresh being a normal mutation
means the realtime delta, the read-set validation, and the durable version bump
are all the same machinery as a user write — I never thought about "realtime" as a
separate system. Where it *added* friction versus a React app: no swipe gestures,
no browser live-push in the Contract adapter, and geolocation is DIY. The Contract
surface itself — layout, state, `derive`, the `every(1000)` clock, control flow —
was pleasant and never the bottleneck, matching the Diary-0004 finding.

### Net

All Aboard does what LLP 0016 asks of a new demo: it proves missing runtime shape
(demand-armed cron refresh → realtime, and an action-egress seam) rather than
retiring glue, and it lands its honest gaps (swipe, browser live-push, per-host
egress allowlist) instead of faking them. The product answers its one question —
*when is the next train, north and south, from here?* — before you touch anything,
on a surface that is one file away from running on a Mac.

## 2026-07-01 — Real station photos

Swapped the placeholder per-station SVG "drawing" for the actual station photos
from the Wikipedia [List of Caltrain
stations](https://en.wikipedia.org/wiki/List_of_Caltrain_stations). A small
Python generator (`snapback/shared/station-photos.gen.py`) pulls each station's
Wikimedia Commons image via the MediaWiki API, cover-crops it to the 560×150 card
banner, re-encodes it as a q72 JPEG, and emits `station-photos.gen.mjs` — a map of
`stationId → { dataUri, attribution, sourceFile }`. Twenty-one photos total
~454 KB of JPEG (~610 KB base64 in source).

### What felt good

The existing seam made this almost a drop-in. `stationPhoto()` already returned
**inline SVG** for the Contract `image svgSource=` attribute (chosen originally
because the DOM mirror blocks `data:` URIs on a raw `src=`). Embedding the real
JPEG as a base64 `<image href>` *inside* that SVG meant the whole rest of the app
— the `derive photoUrl`, the card layout, the web/native parity, the zero-egress
tests — did not change at all. The photo rides the exact path the drawing did. A
bottom scrim gradient plus the name overlay carried straight over, so the station
name stays legible over any photograph. This is the payoff of the demo's
"deterministic, zero-egress, one model" posture: real assets went in without
opening a network path or touching the transactional layer.

### What felt bad / surprising

- **Attribution is on me.** The photos are CC BY / CC BY-SA / CC0, which *require*
  crediting the author. Nothing in the pipeline reminded me of that; I had to pull
  `extmetadata` (Artist + LicenseShortName) myself and add a `stationPhotoCredit`
  helper plus a caption row on the card. An asset pipeline that carried
  license/attribution as first-class metadata would have made this a non-choice.
- **Base64-in-source is clearly the shortcut, not the destination.** 600 KB of
  base64 in a committed `.mjs` is fine for a deterministic demo but is exactly what
  the [asset-storage subsystem](../llp/0000-snapback.explainer.md#asset-storage) is
  supposed to own. Recorded as a `temporaryPolicy` shortcut in the manifest.
- **Wikimedia rate-limits hard (HTTP 429)** on an unthrottled loop; the generator
  needed a 2 s spacing and backoff. Not a Snapback thing, but worth noting for
  anyone re-running the fetch.

### Compared to the alternative

In a React app I'd have dropped `<img src="https://upload.wikimedia.org/...">` and
been done in a line — at the cost of runtime egress, a hotlink that can rot or get
rate-limited, and a non-deterministic test. Here the constraint ("no egress on the
product path") pushed the fetch to *build time* and made the runtime artifact a
pure, committed, deterministic asset. More work up front, but the result is
hermetic and the acceptance tests stay honest.

## 2026-07-01 — Splitting the one-component workaround (ENG-22417)

The 2026-06-30 entry recorded that my first cut split the board into child
components, failed with `event_unknown_action`, and inlined the whole UI into
one 219-line component. The Exact repo's LLP 0280 §5 phase 1 asks for the
inverse experiment: split it back apart using **only the existing mechanism**
— actions threaded as ordinary callback props — and record what remains
painful. This isolates missing *constructs* from missing *diagnostics*.

### What changed

`app.contract` is now a root `AllAboard` (all state, derives, actions, the
mutation, the ticker task, and the contract block) plus four presentational
components in the same file: `StationCard` (header card), `DirectionBoard`
(home screen), `StationsPicker` (stations screen), `TripDetail` (trip
screen). Actions flow down as props — bare (`press=doRefresh`, `press=goHome`)
and curried (`press=goToStation(prevStationId)`, `press=openTrip(d.id)`) —
and the one-component workaround comment in the header is gone. 219 → 276
lines; every `testId` and every visual attr is unchanged (verified by
normalized diff, and the DOM parent chains are identical — component
boundaries mount no wrapper node).

### The workaround was a diagnostics failure, not a language gap

The compiler has supported this the whole time: `checkEventHandler` accepts
an event handler whose root resolves to a **prop** (`names.get(root.name) ===
'prop'`), and the runtime defines actions as scope values, so `goToStation=
goToStation` in a component call hands the child a callable that arrives as a
reactive prop. The June failure happened because nothing at the error site
said so — `event_unknown_action` names the missing action and stops. I read
"actions are component-scoped" as "children cannot call parent actions" and
inlined. LLP 0280 §2.3's two-way fix-it (thread it / extract a behavior) is
precisely the repair; the mechanism needed no new grammar at all.

### Verification

Compile via the acceptance path (Vite-plugin pipeline, accumulate mode): zero
errors, zero warnings — the only diagnostic is the same pre-existing
`duplicate_source_imports` hint the monolith had. Suites, all against this
worktree's engine: Contract browser **6/6** (every check drives a threaded
action prop: prev-station, flip, open-trip, refresh), headless **11/11**,
cron **7/7**, egress **4/4** — identical to the 2026-06-30 baseline.

### What remains painful (the LLP 0280 phase-1 deliverable)

- **Threading verbosity is real but shallow.** `StationCard` takes 11 props;
  its instantiation line is ~270 characters; 28 prop declarations across the
  four components; +57 lines for zero behavior change. It is boilerplate, not
  complexity — nothing became harder to reason about, there is just more of
  it. An `actions=` group prop (LLP 0280 declines it) never felt *needed*;
  named threading stayed legible even at 11 props.
- **Function-typed props are decorative.** `goToStation: (id) => void`
  compiles to `{ kind: 'function' }` with the signature kept as raw text.
  Nothing checks arity or parameter types at the call site or the use site —
  passing `openStations` where `(id) => void` is expected compiles clean, and
  a non-function value would fail *silently* at press time (`makeHandler`
  bails without a warning unless the handler is a call expression). This is
  exactly the hole action-typed props (LLP 0280 §2.3.1, ENG-22416) close.
- **Event-attr names are silently reserved on component calls.** On a
  component instantiation, `press=`/`change=` are classified as events and
  wrapped by `makeHandler`, not passed as plain props. The Caltrain twin
  leans on this (`press=openTrip` works *because* of it), but it means a
  component's prop namespace has an invisible reserved list; I dodged it by
  using domain names (`goToStation`, `openTrip`) for everything.
- **The root contract block now claims children's markup.** `has button
  "Change station"` is asserted by `AllAboard` but rendered by `StationCard`;
  the live-tree check still passes, but nothing ties the child's label to the
  root's claim statically — rename the button text in `StationCard` and the
  root contract fails only at runtime verification. Behavior-carried contract
  blocks (LLP 0280 §2.1) are the eventual home for shared claims. I also did
  not need a cross-boundary `press … -> action` clause; whether one can name
  a child's prop-bound handler from the root is untested here.
- **Boundary renames create expression drift.** The child sees `stationId`
  where the root wrote `station.id` (three lines changed for it). Trivial,
  but it is the review tax every prop boundary charges.
- **What did *not* hurt:** reactive props (the 1s `nowMs` tick flows through
  prop getters and countdowns keep ticking), currying a prop with another
  prop as the argument, bare-prop handlers, prop forwarding depth, and visual
  parity — component mounting splices the child view with no wrapper node, so
  the split is pixel-neutral by construction.

### A test-environment note

The browser suite failed 0/6 twice before any of my code ran: a leftover
`--memory` demo server **from the main checkout** (a different branch/engine)
was squatting `:4420`, and its `/admin/*` routes answer 404 where this
branch's engine accepts them — so the page's self-init died at `loadSchema`
with a bare `HTTP_404`. The suites' reuse-if-healthy convention trusts
whatever answers `/health` on the port. Worth a follow-up: have `/health`
report an engine/build identity the suites can assert before reusing.

## 2026-07-01 — Redesign pass: full-bleed poster board + a real gesture layer

### What changed

The surface went from "cards on a gray page" to **the station itself as the
screen**: full-bleed poster-stylized artwork per station, with the departure
board typeset directly on it — identity up top, the giant countdown at the
bottom where thumbs live, three glass rows after it, the opposite direction as
one line, and a `heroOffset` state so the rider can walk the upcoming trains.
And the LLP 0027 interaction model finally exists on web: swipe left/right
changes station (finger-follow drag, page-turn settle), swipe up/down walks the
trains, a bare tap flips direction, swipe-right closes the sheet screens, and
arrow keys drive everything on desktop.

The pieces, and what each one was:

| Piece | Kind |
|---|---|
| `station-photos.gen.py` — fetch + poster stylization → 640×1136 art | build-time pipeline (Pillow) |
| `model.mjs stationPhoto()` — portrait SVG wrapper, scrims baked in | shared model (source) |
| `app.contract` — full-bleed stack, hero selection, same 4-component split | Contract source |
| `data.ts boardTrains/delayLabel/shortHeadsign/distanceLabel` | pure bridge helpers |
| `gestures.ts` — pointer recognition → clicks the declared affordances | **web surface glue** |
| `main.ts installWebChrome()` — height chain, dark bg, touch-action CSS | **web surface glue** |

### The art pipeline: "AI hand-drawn" without the AI

The brief floated AI-generated hand-drawn station images so text overlays
better. What shipped gets the same property deterministically: median-smooth →
saturation lift → 18-color median-cut quantize → soft ink-edge overlay. A
travel-poster look that flattens photographic noise (so white type reads on any
station), homogenizes 21 photos of wildly different quality into one visual
language, and — because it is pure Pillow over the committed Wikimedia
originals — stays reproducible, offline after first fetch, and zero-egress at
runtime. I compared photo/duotone/ink-wash/poster contact sheets with mock
board text before choosing; the poster column won on both looks and
legibility. The scrims deliberately live in the SVG wrapper (`model.mjs`), not
the JPEG bytes, so design tuning never refetches. Cost recorded honestly:
~1.5 MB of base64 in a generated .mjs (up from ~610 KB), still the
asset-pipeline shortcut the manifest declares.

### Gestures: the DOM mirror is a fine substrate, with three sharp edges

Contract still has no swipe primitive (LLP 0029 G1), so gestures are glue — but
the glue is deliberately dumb: every recognized gesture **clicks the same
testId'd press affordance the .contract declares**. One action path for
gestures, taps, keyboard, acceptance tests, and (someday) native. Three things
bit me on the way:

- **The mirror wipes inline styles per re-render of a node whose props
  changed** (`applyProps` → `clearElementAttributes` + re-apply). The
  finger-follow drag works *because* the dragged container's Contract props are
  static — glue-owned `transform` survives the 1s ticks. This is load-bearing
  and undocumented; if someone adds a dynamic attr to `board-content`, the drag
  will start snapping mid-gesture.
- **My own click suppressor ate my synthetic clicks.** After a drag you must
  swallow the browser's trailing click so a swipe released over a train row
  doesn't open it — but the suppressor (armed before dispatch) also swallowed
  the glue's `el.click()` for vertical swipes. Horizontal escaped only because
  its press fires 135 ms later, after the suppressor expired. Fix: a
  `dispatching` bypass flag. Classic self-inflicted event-layer bug.
- **`event.target.closest` is not universal** — synthetic keyboard events
  dispatched on `window` have no `.closest`, which silently killed the handler
  under test. Guard with `typeof target.closest === 'function'`.

### The web host had one more surprise: index.html is decorative

The full-bleed layout needs `html/body/#exact-root { height: 100% }` — and it
turned out the Exact dev server serves its **own generated HTML shell**; the
demo's `index.html` is never consulted. The old design never noticed because
normal-flow cards get height from content, and `status()` fell back to
`console.log` when its element didn't exist (which is why boot messages only
ever appeared in the console). Absolute-inset children have no such luck: the
app rendered a complete, correct, dark DOM into a zero-height stack — a white
screen with everything "working". `main.ts` now injects the page chrome
(`installWebChrome()`): height chain, dark background, `touch-action` rules
([data-testid="board-content"] { touch-action: none } so the browser never
fights the gesture layer), and the boot-status element itself. Worth knowing
for every future full-viewport Contract demo on web.

### What Contract was good at

The redesign itself — stack + absolute inset, the scrimmed art via
`svgSource=`, `spacer`, per-service tinted pills, `fontVariant="tabular-nums"`
so the countdown doesn't jitter, conditional colors at the terminus chevrons —
was pleasant and compiled first try, warnings only. The action-threaded
component split from ENG-22417 carried over cleanly; the four components kept
their names and testIds through a total visual rewrite, which is exactly what
presentational components are for. `heroOffset` as plain state + a pure
`boardTrains(stationId, dir, now, offset)` derive made "swipe up = later train"
a two-line action with clamping in one place.

### Compared to React

In React I'd have had the gesture layer as a hook over the same pointer events
(equivalent work), CSS in a file that actually loads (less work), and
`IntersectionObserver`-style mid-drag rendering control (more control). The
Contract version's win is that the *entire interactive surface* stays declared,
testable, and native-portable — the glue only ever presses buttons that are
already there. The loss is exactly LLP 0029 G1: none of the gesture layer is
expressible in the language yet, so feel lives outside the artifact.

### Verification

Browser acceptance grew three gesture checks (synthetic pointer sequences
through the real glue): 9/9, plus headless 11/11, cron 7/7, egress 4/4. The
visual loop ran as phone-viewport CDP screenshots across five stations, both
sheets, terminus dimming, delay states, and each gesture — the fastest way to
iterate a Contract surface I've found so far.

## 2026-07-02 — Production build + pinned Exact consumption (ENG-22463)

### What changed

The Contract surface's toolchain wiring, not the app. `vite.config.ts` dropped
the hand-rolled plugin pair + 11-entry alias matrix for the paved-road
`exactContractWeb({ data: 'snapback', exactRoot, app: { entry: '/main.ts' } })`
preset (`@exact/devtools/contract-web`; Exact LLP 0264 + the
ENG-22441/22445/22446 remediation this repo's Diary 0009 red-team triggered).
`package.json` finally has a `build` script next to `dev`, both honoring
`SNAPBACK_EXACT_ROOT` with the sibling `../exact` as default, and
`exact.pin.json` at the surface root records the Exact revision the surface
was verified against. Surface-specific config stayed hand-authored where it
belongs: the `__SNAPBACK_API_ORIGIN__` define, the `/snapback` ws proxy, and
root/port. The preset now owns the aliases, browser resolve conditions, the
wa-sqlite optimizeDeps exclusion, the client-bundle native-leak gate, and the
pin drift check.

### What the flip conditions look like closed

- **Flip condition #2 (production build DNF):** `vite build` had hung at 0%
  CPU on 2/2 attempts in Diary 0009. Through the preset it completes in
  ~1.5-1.8 s, emits `dist/web/` (client bundle + the surface's own
  `index.html`), and stays web-only — no mac/windows startup artifacts, no
  desktop manifests.
- **Flip condition #3's silent shell takeover:** the plugin logs
  `HTML shell mode: preserve — project root has its own index.html` and both
  dev and build keep this surface's HTML (boot-status pill, gesture
  touch-action rules intact). The takeover is now structurally off the table
  (shell 'auto', ENG-22445).
- **Flip condition #1 (sibling-checkout-at-HEAD):** demonstrated itself
  mid-task, unprompted. Between two builds, another agent session moved the
  sibling Exact checkout (bb24ab15 → 422baa08); the very first unpinned
  default-path build printed the `pin drift:` banner naming both revisions
  and the two remedies. That is exactly the failure mode that restarted and
  bricked the red-team's dev server twice, converted from a silent hazard
  into a one-line diagnosis. Warning-only by default; `EXACT_PIN_STRICT=1`
  makes CI fail on drift.

### Friction, honestly

- No published `@exact/*` packages yet (ENG-22480), and this repo has no root
  node_modules, so the config cannot `import '@exact/devtools/contract-web'`
  by bare specifier — it dynamic-imports
  `packages/exact-devtools/src/contract-web.ts` from the resolved checkout.
  Upside: `SNAPBACK_EXACT_ROOT` now repoints the preset code itself along
  with the aliases and pin check (the hand-rolled config kept loading plugin
  code from the literal sibling path even when pinned elsewhere). Published
  packages will delete this workaround.
- Build output lands in `dist/web/`, not `dist/` — the app plugin's layout.
  Fine, but you have to notice.
- A pre-check failure in `browser.mjs` (API/vite/Chrome not coming up) exits
  `PASS — 0/0`: the `finally` calls `process.exit(report.ok ? 0 : 1)` before
  the thrown error can surface, and zero checks is vacuously ok. Bit me when
  the first cold `cargo run` exceeded the 90 s health deadline. Harness
  follow-up material.
- `todo/` and `todo-v2/` contract surfaces still carry the old hand-rolled
  config shape; same preset move applies there.

### Verification

Against the pinned revision (9b22261264fe, a clean origin/main worktree):
`vite build` green with `pinned Exact checkout verified` + `shell mode:
preserve` in the log and the own-HTML markers asserted in `dist/web/`;
browser acceptance 12/12 (boot, board, presses, trip detail, mutation +
freshness, live push paved path, cron delta, second-window D4, three
gestures); headless/cron backend suites untouched by this change and re-run
green; dev-script smoke (cwd = surface dir, env fallback) serves the
surface's own HTML with the agent surface reachable.

## 2026-07-02 — Declared config + secrets migration (LLP 0036 v1)

Migrated the demo and its egress fixture off `SNAPBACK_ACTION_SECRETS` onto
the new declared-config subsystem: `functions.mjs` now exports a
`defineConfig` block declaring `caltrainFeed` (a rotating 511.org key pool,
optional while the demo runs the recorded feed) and `refreshFeed` carries
`uses: ['caltrainFeed']`, so the Phase 3 live fetch already has its grant.
The egress-probe fixture declares its `feedKeys` pool and its acceptance
suite grew from 5 to 14 checks, covering rotation, redaction, the gated
`/_snapback/api/config/*` ops, reset survival, and the deprecated env-blob
import.

### What felt good

- **The cron precedent made the manifest work mechanical.** `defineConfig` →
  walk branch → `buildConfigEntries` → manifest field was a straight copy of
  the `defineCron`/`buildCronJobs` shape, validation style included. When a
  subsystem's authoring surface has a good precedent, adding the next one is
  boring in the best way.
- **Declaring config next to the functions that use it reads well.** The
  entry (what/why/where-to-get-one) and the `uses` grant sit in the same
  file; the wizard renders entirely from source-authored metadata. Compared
  to Convex/Supabase env-var pages, the declaration living in code — typed,
  reviewed, versioned — is the part that feels genuinely better, closer to
  Rails credentials but per-deployment.
- **The printed install line is the money shot.** Load a manifest with a
  missing required key and the server prints
  `config: 1 required entry missing (feedKeys) → http://127.0.0.1:PORT/_snapback/admin/setup`;
  the page walks you through it. The `git clone` → paste-key → running story
  the RFC promised actually exists now.

### What felt bad or surprising

- **Codegen's fetch scanner and the probe fixture fight.** Regenerating the
  egress fixture needs `SNAPBACK_OUTBOUND_ACTIONS=1` at *codegen* time or the
  handler's `fetch(` trips `BUNDLE_UNSUPPORTED_FETCH`. Correct behavior, but
  nothing tells you the flag applies to codegen too until the regen fails.
- **Rotation-cursor coupling in tests.** The pool cursor advances once per
  granted invocation, so acceptance checks that run the probe action for
  unrelated assertions also consume pool members. Fine once you know; the
  first draft of the suite asserted `key-a` where `key-b` arrived.
- **The old blob API broke loudly, which is the design working.** The old
  handler read `ctx.secrets.feedKeys`; the new surface is
  `ctx.secrets.rotating('feedKeys')` returning a redacting handle. Every
  consumer had to migrate — there was exactly one — and the deprecated env
  var still works as a one-time import, so `egress.mjs` kept its env-driven
  setup path with zero extra plumbing.
- **`asBearer()` is sugar, not a boundary.** Without host-mediated fetch
  (G3), the "unwrap only at the host fetch boundary" helper can't exist yet;
  it's `'Bearer ' + expose()`. The LLP banner says so — but it's the gap I'd
  close next, together with the destination allowlist.

### Verification

`cargo test` green (148 tests incl. the new `tests/config_v0.rs`);
`demos/all-aboard/tests/acceptance/egress.mjs` 14/14 against real spawned
servers (both egress-on and egress-off runtimes); manual drive of a
file-backed instance: printed setup line, wizard page served, set via the
wizard source, `dev.sqlite3.config.json` at 0600, values surviving a server
restart, status never echoing a value.

## 2026-07-03 — Real 511 feed + routed walk/bike actions

Turned the Phase-3 egress plan into the product path. `refreshFeed` now tries
511 SIRI StopMonitoring with the declared `caltrainFeed` key, maps observed
Caltrain visits onto the six service-pattern delay rows, and commits through a
new `applyLiveFeedSnapshot` mutation. If outbound actions or config are absent
it falls back to the recorded ticks and writes the reason into `lastError`.
`routeEstimate` now calls OpenRouteService/HeiGIT directions through a
server-side action with the `directions` key; the station card caches the
result by rounded location/station/mode, while the station picker keeps the
cheap local estimate to avoid a burst of routing calls.

### What felt good

- **The action/config split was exactly the right place for this.** The keys
  stayed out of the browser, queries/mutations still have no fetch, and cron
  can run the same `refreshFeed` action that manual refresh uses.
- **The existing fallback made this shippable.** Without real keys the demo
  still behaves deterministically, but now the fallback is an explicit runtime
  state (`recorded-fallback` + `lastError`) instead of an invisible omission.
- **Local HTTP mocks were enough.** The new `real-data.mjs` suite proves 511
  parsing, action routing, and ORS response handling without burning API quota
  or making CI depend on external services.

### What felt bad or surprising

- **The product had an egress seam, not a product call path.** `refreshFeed`
  carried a grant, but still called `applyFeedTick`; the shared client had no
  app-data `action()` method; Contract could only bind generated mutations, so
  the refresh button needed a small web-host bridge.
- **Directions had to use GET.** The embedded fetch shim supports headers and
  text/arrayBuffer responses, but not request bodies or `response.json()`, so
  the ORS call uses the simple GET endpoint and parses `await response.text()`.
- **Exact trip identity is still a real gap.** The seeded schedule is a
  synthetic six-pattern model, not static GTFS trips, so the live feed maps
  service/direction delays onto patterns. That is useful for the demo board but
  not a claim of exact GTFS-RT trip matching.

### Verification

Regenerated All Aboard artifacts with `SNAPBACK_OUTBOUND_ACTIONS=1`; added
`demos/all-aboard/tests/acceptance/real-data.mjs` to exercise app-data actions
against local 511/ORS mocks. Full verification for this change is recorded in
the task transcript with the code change.

## 2026-07-03 — Contract production build and static native artifacts

Fixed the remaining Contract `vite build` failure for the registry-installed
Exact toolchain. There were two stacked Exact-side issues: Vite's native
optimizer left an ignored relative `./inspector.js` import inside optimized
host-ops chunks without copying the sibling file, and the static native startup
artifact path assumed devtools lived inside an Exact repo checkout with
`packages/exact-host-windows/src/runtime.rs` plus the vendored Ibex URL builtin.

The surface now declares native-environment `optimizeDeps.exclude` entries for
the Contract runtime / renderer host-ops path, and carries a temporary Bun patch
for `@ccheever/exact-devtools@0.1.0`. The patch falls back to emitting a static
`module-bundle.json` when the registry package lacks host startup source assets;
the native host already supports that envelope path.

### What felt good

- **The host fallback path was already there.** Once I noticed static envelopes
  can omit `startup` and carry `moduleBundle`, the fix avoided vendoring 160 KB
  of Exact host/runtime source into the demo.
- **Bun package patches are a workable pin.** The workaround survives reinstall
  and keeps the demo on registry packages instead of reopening the sibling
  checkout dependency.

### What felt bad or surprising

- **The first failure hid the second.** Fixing the optimizer miss revealed the
  registry-packaging assumption immediately afterward; the build could not have
  emitted startup.js/HBC from the published package alone.
- **The native build output is large.** The fallback module bundle is about
  3.5 MB per target before gzip. That is fine for proving the static artifact
  path, but Exact should package startup assets and go back to startup.js/HBC
  when the upstream fix lands.

### Verification

`bun install --cwd demos/all-aboard/surfaces/contract --frozen-lockfile` and a
cold-cache `bun run --cwd demos/all-aboard/surfaces/contract build` both pass.
The build emits `__exact/platform-manifest.json`, mac/iOS `exact-native.json`
envelopes, and per-target `module-bundle.json` payloads.

## 2026-07-04 — "Why is it still demo data?" (ENG-22751)

The issue read "make it so the All Aboard app uses real data — right now I
can't get it to do anything except use demo data." The punchline of the
investigation: the live path already worked. Driving the whole user path
against the running server — admin `config/set`, then `refreshFeed` through the
real Ibex action fetch — committed live snapshots fine, including against a
mock that mimics the real `api.511.org` wire shape (UTF-8 BOM before the JSON,
gzip content-encoding). What was broken was the *experience around failure*:
four distinct setup mistakes (no egress flag, key set before the app booted,
`--memory` eating the key on restart, an invalid key) all landed in the same
visible state — a normal-looking board on canned data, with the reason buried
in `feedRefreshState.lastError` where no surface ever showed it.

The fix is mostly about honesty rather than plumbing: `refreshFeed` now
commits an actionable `lastError` (naming `SNAPBACK_OUTBOUND_ACTIONS=1` or the
setup URL), both surfaces render it as a `feed-problem` line under the board
footer, the README's real-data flow is corrected (persistent `--db`, app-first
boot order), and the real-data suite now tests the setup-page path and the
real-511 response shape instead of an idealized mock.

### What felt good

- **`lastError` was already durable, live-pushed state.** Surfacing it was a
  derive + one conditional row in each surface; the realtime fan-out delivered
  it with zero new machinery. This is the Snapback model paying off.
- **The acceptance harness made the diagnosis fast.** Booting the real server
  and driving the real action path from a scratch script took minutes; the
  mocked real-data suite passing while the user's path failed pointed straight
  at the seams between them.

### What felt bad or surprising

- **Silent fallback is a trap amplifier.** The recorded feed doubling as the
  error fallback meant every misconfiguration *looked like success*. A demo
  that can fake its own data needs to say when and why it is doing so.
- **The error message leaked the API key.** `fetchJson` quotes the failing URL
  in its error, the 511 key rides in the query string, and `lastError` is
  client-visible via the `feedState` live query. Redaction had to be added the
  moment the error became user-facing — it should have been there the moment
  the error became *durable*.
- **The tested path was not the user's path.** The suite injected keys via the
  deprecated env blob and served idealized JSON; the user goes through the
  setup page against the real API. The gap is exactly where the bug lived.
- **Docs steered into two of the traps.** The README's own run command used
  `--memory` (so setup keys die with the process) and said "open setup after
  the app boots" without saying the app page must be opened first for the
  config entries to exist at all.

### Verification

`real-data.mjs` (now 5 checks: BOM+gzip mock, config/set path, redacted
actionable fallback), `browser.mjs` and `browser-react.mjs` (15/15 with the
new feed-problem check), plus `headless.mjs`, `cron.mjs`, and `egress.mjs`
unchanged. Full end-to-end against the real 511 API still needs a real key
(free, email-delivered) — everything short of that is exercised.

## 2026-07-04 — second pass: walking the README against the real 511 API (ENG-22751)

The issue stayed open after the first landing, so this pass re-walked the
documented real-data flow from scratch — fresh worktree, fresh `--db`, both
servers on isolated ports — but this time let the refresh hit the **real**
`api.511.org` instead of a loopback mock. The whole path holds: open the app
(backend provisions, both config entries appear), set a key through
`/_snapback/api/config/set` (the setup-page lane), press Refresh, and the
fetch goes out over the real Ibex action egress. With an invalid key the
board renders `feed-problem`: `live 511 fetch failed: HTTP 401 from
https://api.511.org/…api_key=[redacted]… This API key provided is invalid.`
— redaction confirmed against the live wire, not just the mock. The
ENG-22753 provenance guard also proved itself en route: both browser suites
refused the stale June-29 `--memory` server still squatting :4420 (bundleHash
mismatch) and self-isolated.

What that walk exposed: the 401 message named the failure but not the fix.
The no-key and no-egress fallbacks give instructions; a *rejected* key — the
exact state a rider hits the moment their emailed 511 key is mistyped or not
yet activated — dumped a raw transport error. Same for HTTP 429, which is a
plausible steady state (the warm poll runs at 60/hr against a per-key
window). Both now map to instructions, placed ahead of the diagnostic so the
surface's 180-char tail truncation can never eat the actionable part; the
suite asserts that ordering.

Also checked, for the record: there is no keyless live Caltrain source to
fall back to — `api.511.org` 401s without a key ("The API key is not
provided."), and caltrain.com serves only HTML redirects, no public JSON.
The credential is the true boundary, and the board now narrates every state
up to it. What still stands between a rider and live data is exactly one
free emailed key — nothing in the repo.

### Verification

`real-data.mjs` 6/6 (adds the 429 pooling check and the 401
instruction-ordering assertions), `browser.mjs` 15/15, `browser-react.mjs`
15/15 (both self-isolated off the squatted ports), `headless.mjs`, `cron.mjs`,
`egress.mjs` green; manual: fresh server + Vite, headless Chrome render of
the board showing the actionable, redacted 401 line straight from the real
511 API.

## 2026-07-04 — location permission that actually asks (ENG-22795)

### What I built

The bug: on web, the board settled on "Location blocked — showing a default
stop" without the user ever seeing a permission prompt. Chrome had auto-denied
the boot-time `getCurrentPosition` (quiet prompt UI, or a per-origin block
inherited from whatever previously ran on `127.0.0.1:5178` — dev-server ports
are shared origins, so one old "Block" outlives the app that earned it), and
the surface treated that one answer as final.

Both web arms now ask permission-state-first: `navigator.permissions.query`
decides whether to skip a doomed request (hard-blocked), actively request
(promptable), or just fetch (granted); a `change` listener adopts the real
location the moment access is granted — a site-settings flip lands with no
reload. The location-hint line became a press affordance that re-requests a
fresh fix (`maximumAge: 0`) from a real user gesture, which is what Chrome's
quiet prompt and Safari want before they will show UI. Denied copy now says
what to do: "allow location for this site, then tap here".

### What felt good

- The whole fix is web-surface glue. Snapback (backend, schema, functions,
  live queries) is untouched; the shared model's nearest-station selection
  consumed the new location with zero changes. The blast radius a permission
  bug *should* have.
- The two arms stayed structurally parallel: the same `watchLocation` shape,
  the same hint copy, the same press semantics — one in DOM-interception
  idiom, one in prop-drilling idiom (main → App → StationCard). Diffing them
  side by side is still a fair React-vs-Contract comparison.
- CDP made the paved path machine-checkable end to end:
  `Emulation.setGeolocationOverride` + `Browser.grantPermissions`, then assert
  the hint flips to "📍 Using your location" and the station snaps to the
  pinned position. Order matters — pin the position *before* granting, or the
  permission-change listener races to read the host's real location.

### What felt bad or surprising

- Contract has no geolocation binding (a declared gap since Phase 1), so the
  press affordance can't mean anything inside the `.contract`: the button's
  declared action just re-stamps the clock, and the real behavior is a
  capture-phase DOM interception in `main.ts` — the exact idiom the refresh
  button already used. It works, but the app's most browser-native behavior
  lives invisibly outside the declared tree.
- The hint had to become a *button* for an unrelated reason: the bare-tap
  gesture (flip direction) exempts only `button, a, input, …, [role="button"]`
  targets, so a tappable plain-text hint would have flipped the board on every
  press. Gesture layers make "just make it clickable" a two-step decision.
- The first test run parked the board on San Francisco — end of the line —
  and two downstream checks quietly depended on the Mountain View start
  (prev-station clamps at orderIndex 0; no Baby Bullet in that direction).
  Fixed by making the press request a fresh fix and moving the pin back
  through the same affordance, which doubled as the assertion that a retry
  press re-reads the position instead of serving the 60s cache.

### Verification

`browser.mjs` 16/16 and `browser-react.mjs` 16/16 (each adds the
grant→adopt→fresh-retry check; both self-isolated off the squatted :4420/:5178
via the ENG-22753 provenance guard), react-surface `tsc --noEmit` clean,
`./ref-check --verbose` 0 errors.

## 2026-07-04 — demo/live source honesty

The `feed-problem` line answered "why did live data fail?", but the normal
demo state still looked too much like live transit. This pass makes the board
state explicit in both surfaces: a `data-source` badge says **DEMO DATA** for
seeded/recorded/fallback delays and flips to **LIVE** only when
`feedRefreshState.lastSource` is `511-siri-stop-monitoring`. Walk/bike ETAs now
also prefix haversine fallback estimates with `~`, while routed
OpenRouteService estimates stay plain.

### What felt good

- The source signal was already in Snapback state. Adding the badge was a pure
  derive + footer row in Contract and React; no backend shape or live-query
  plumbing changed.
- The new check fits the existing browser acceptance path: press Refresh,
  observe `recorded-fallback`, assert the board still says DEMO DATA. That made
  the data-honesty rule concrete instead of leaving it as documentation.

### What felt bad or surprising

- Merging this after the ENG-22751/ENG-22795 upstream work was a useful reminder
  that "fallback reason" and "current source" are separate UI facts. Collapsing
  them would have made intentional demo runs noisy or failed live runs vague.
- The browser cron checks had a latent false negative: recorded feed ticks wrap,
  so a reused server at tick 5 legitimately advances to 0. The test needed to
  assert change across a cyclic sequence, not numeric monotonicity.
- The two hand-written surfaces still need parallel edits for every tiny
  user-facing truth. This was low-risk, but it is exactly the drift pressure a
  shared adapter or generated surface helper should eventually reduce.

### Compared to React + Convex / Supabase

In a plain React + Convex app this would be one component edit, but the data
source would still need to be modeled deliberately. Snapback's advantage here
is that `lastSource` is durable, queryable, and shared with the Contract surface
and tests; the cost is keeping the Contract and React presentation layers in
lockstep until that duplication is retired.

## 2026-07-07 — All Aboard deployed live on Cloudflare (LLP 0049)

### What I built

The full LLP 0049 phase set (ENG-23627–ENG-23632): All Aboard running at
`https://snapback-all-aboard-proof.ccheever-0f6.workers.dev` on the LLP 0040
proof target — gateway Worker serving the built Contract web bundle
same-origin, coordinator Durable Object with SQLite, two handler isolates
(transactional + action), deploy-time secrets for `caltrainFeed` (a real
two-key 511 pool) and `directions`, host-mediated action egress, and the
demand-armed alarm warm poll. The browser surface is the UNCHANGED generated
Contract surface; the only deployment-specific bit is the documented
`SNAPBACK_ALL_ABOARD_API=same-origin` build hook.

### What felt good

- **The app bundle port was almost mechanical.** Schema, mutations, and the
  SIRI parsing chain moved from `snapback/handlers.mjs` into the Cloudflare
  bundle nearly verbatim — the ctx contract really is engine-neutral. The
  mutations needed zero changes.
- **The kit client doubled as the acceptance driver.** Because the gateway
  speaks the kit wire protocol, `demos/_kit/client.mjs` — the same code the
  Contract surface runs — drives Miniflare and the real deployment. When the
  suite passes, the browser path has genuinely been exercised, snapshots,
  hibernation socket, action transport and all.
- **Secret placement slots fit the two real APIs exactly.** 511 wants the key
  in a query param, ORS in a header; the two-slot design covered both with no
  generalization pressure, and the coordinator-owned redaction meant the
  forced-401 upstream echo test passed on the first try.

### What felt bad / surprised me

- **The handler server serializes invocations per isolate.** A slow action
  fetch would have queued every query and live push behind it — invisible in
  Miniflare timings until the concurrency check was written. The fix (a
  separate action-handler Worker) is honest and mirrors the local fresh-VM
  action fence, but it was a real trap: the platform's unit of concurrency is
  the Worker, not the invocation.
- **First-deploy service bindings are circular.** Gateway ↔ handler bindings
  both fail validation (code 10143) on a fresh account whichever deploys
  first; deploy.sh needed a bootstrap pass with `services` stripped. The
  expired-token era hid this — the notes proof had never actually deployed.
- **Real ORS 406s what the mocks accepted.** The handler sent
  `Accept: application/json`; real OpenRouteService answers GET directions
  with `application/geo+json` and 406s a strict accept. Mock-first testing
  never exercises upstream content negotiation — found only in the Phase 4
  remote run.

### Compared to React + Convex / Supabase

Convex gives you hosted actions/cron/env-vars out of the box, so "deploy the
demo with live data" is an afternoon there. What it does not give you is the
posture this slice proves: secret values that structurally cannot enter the
app isolate (fail-closed `.expose()`, descriptors-only payloads), an idle
deployment that arms zero wakeups by construction, and a capability manifest
that names every remaining gap instead of implying parity.

## 2026-07-08 — the deployed URL white-screens in the macOS Exact host (ENG-23643)

Opening the live `.workers.dev` URL in the macOS Exact host gave a white
screen, with the Log Console reporting `Unexpected response (200):
<!doctype html>`. Two independent defects hid behind one symptom:

- **Static native discovery is opt-in for handwritten HTML.** The Exact vite
  plugin injects the `<link rel="exact:platform-manifest">` discovery tag only
  into HTML it generates itself (router/SSG shell mode). All Aboard keeps its
  own `index.html` (`shell: 'auto'` preserving the surface's file), so the
  built page never pointed at the `__exact/platform-manifest.json` the build
  was already emitting. The native loader fetched the root, got web HTML with
  no manifest pointer, and gave up. One static link line fixed it — but
  nothing at build time warned that `staticPlatformTargets` was emitting
  artifacts no HTML referenced. That's a paved-road pothole: the preset builds
  the native artifacts and the manifest, then silently loses the only
  discovery path to them.
- **SPA fallback swallows protocol endpoints.** Cloudflare's
  `not_found_handling: single-page-application` answers *every* miss with
  `index.html` 200 — including `/__exact/agent/logs`, which the Log Console
  probes. HTML-as-200 is the worst failure shape for a protocol client: the
  gateway now carves `/__exact/*` out of the fallback and answers misses with
  explicit JSON 404s.

The satisfying part: the fix was diagnosable end-to-end with curl because the
macOS loader's discovery chain (root HTML → link → manifest → envelope →
startup.js) is plain HTTP + JSON, and the remote acceptance suite now walks
exactly that chain, so the regression class is pinned. Snapback itself was
blameless here — both defects live in the deployment/HTML seam between the
Exact static-native contract and Cloudflare asset serving.

## 2026-07-08 — live 511 departures, not demo trains with live badges

The deployed app had a more serious honesty bug than the earlier DEMO/LIVE
badge work: `refreshFeed` really fetched 511, used real keys, and stamped
`lastSource: 511-siri-stop-monitoring`, but the board still computed next
trains from the seeded clock-face schedule plus a coarse delay overlay. At 3am
that could render a train in a few minutes even when the live StopMonitoring
feed did not have that departure.

### What I changed

I added a `liveDepartures` sync table and made the 511 parser write one row per
station-mappable StopMonitoring visit: station, direction, service, headsign,
train number, scheduled time, predicted time, delay, status, source. The
Contract surface now prefers those rows whenever `feedRefreshState.lastSource`
is live; if 511 returns no station-mappable visits, the live board shows no
trains instead of falling through to demo schedule rows. `trainStatus` stays as
a coarse status/delay overlay for recorded fallback mode and legacy checks.

The same parser fix went into the Cloudflare bundle, including a direction
classification bug: the old code considered `StopPointName`, so a current stop
such as San Francisco or San Jose could accidentally decide the train's
direction. Direction now comes from explicit direction/destination fields first.

### What felt good

- The Snapback shape was exactly the right one once the data model was honest:
  action fetches, mutation replaces the live departure snapshot, live queries
  push `liveDepartures` over the same stream as `trainStatus` and `feedState`.
- Exact's generated data bindings handled the new query cleanly. The paved
  `contract-live.mjs` check now sees `liveTrainStatus`, `liveDepartures`, and
  `feedState` connected through the shared stream.
- The Cloudflare proof was useful as a real forcing function. The final remote
  run mapped 69 future departures from 74 real 511 visits, and the deployed web
  smoke booted on the live source with a future countdown instead of a fabricated
  near-term demo train.

### What felt bad or surprising

- The first "real data" closure was too easy to overclaim. Real upstream fetch
  plus a green LIVE badge is not enough if the product row shown to the rider is
  still synthesized from seeded slots. The acceptance suite now asserts
  `liveDepartures` directly so that mistake cannot hide behind `lastSource`.
- StopMonitoring naming is messy. Mapping 511 stop names to the demo station IDs
  needed explicit aliases, and unmappable visits must be a visible empty-live
  state rather than a reason to show fallback trains.
- A browser-only bug surfaced while testing the real Contract path:
  `SnapbackClient` referenced `process.env` unguarded, which white-screened in
  the browser. The fix was small, but it was another reminder that the kit client
  is both a Node test driver and app runtime code.

### Verification

Local acceptance: `real-data.mjs` 6/6, Cloudflare egress 15/15, Cloudflare cron
12/12, All Aboard Cloudflare recorded path 18/18, `contract-live.mjs` 2/2, and
browser Contract 17/17. The deployed Cloudflare acceptance now reaches 21/21,
including macOS/iOS native static discovery and a direct assertion that live
511 refresh writes future `liveDepartures` rows. The deployed URL remains
`https://snapback-all-aboard-proof.ccheever-0f6.workers.dev`.

## 2026-07-08 (second pass) — the 180s budget and an honest STALE badge

The morning's work made the rows real; the ENG-23642 close-out made the
*cadence and freshness story* real. Three things landed on top:

- **Cadence 60s → 180s.** `warmPoll` now fires every three minutes. The
  coordinator was already manifest-driven, so this was a one-line schedule
  change plus every place the old minute cadence had leaked into comments,
  docs, and the remote suite's armed-alarm assertion.
- **A transactional upstream budget.** The new `claimFeedPoll` mutation stamps
  `feedRefreshState.lastUpstreamPollAt` *before* `refreshFeed` may touch 511,
  so cron and manual Refresh serialize on the DO write path and share one
  poll per 180s window (175s guard, 5s alarm-skew tolerance). Denied claims
  answer `updated-recently` with a `retryInMs` and write nothing. Testing
  rigs with short synthetic cadences pass a clamped `pollBudgetMs` (the
  coordinator sends it only under `SNAPBACK_TESTING`, next to the existing
  mock-feed-URL knob) — it can lower the window, never raise it.
- **LIVE is now freshness-gated.** `feedSourceBadge` takes the clock: a live
  source whose snapshot is older than `staleAfterMs` (390s = two cycles +
  grace, seeded) renders a red STALE badge and reports non-live. The real
  rows stay on screen — they are observed departures that self-expire per
  departure — but the board stops claiming they are live. Both surfaces, plus
  a small pure-helper suite (`badge-freshness.mjs`, 6 checks) over the matrix.

The budget rippled through every suite that hammered `refreshFeed`
back-to-back: real-data, Cloudflare egress, the browser cron-delta check, and
the remote suite all now clear the budget (`resetFeed` zeroes it) where they
mean to exercise the fetch path, and real-data + the remote suite assert the
denial path explicitly. One genuinely interesting race fell out on the real
deployment: the suite's own live subscription arms the alarm, whose
immediately-due poll claims the budget before its 511 fetch commits — a
manual refresh denied in that window sees `lastSource` still `seed`. The
remote suite now waits for the in-flight holder to commit before judging.

Two pre-existing reds surfaced and got filed rather than fixed here:
ENG-23706 (the local in-process cron acceptance never claims its forced-tick
run, red on pristine main) and ENG-23707 (browser-react control arm 0/17 —
unguarded `process` on main; after this branch's client guard, the React
surface's admin-write boot).

## 2026-07-08 — the live train detail must join the journey, not invent it (ENG-23729)

A rider screenshot showed Train 154's detail as `San Carlos -> San Jose
Diridon · 0 min · 2 stops` with both stops stamped `7:03p`. The live-departures
work had made the *board* honest, but the *detail* path fabricated the trip: it
rendered exactly two stops — the boarding station and the headsign destination —
and gave both the boarding stop's timestamps, with `durationMinutes` hardcoded
to 0.

The fix leaned on a fact the ingest already preserved: 511 StopMonitoring is
stop-centric, so one physical journey arrives as one `liveDepartures` row per
monitored station, joined by `DatedVehicleJourneyRef` (`departureId`), each with
that station's own predicted time. `getTrainRun` now joins those rows back into
a trip, walks the service pattern for the stop sequence from the boarding
station to the destination, and fills only feed-uncovered stations from the
pattern's corridor travel times anchored at the boarding stop — marked
`estimated` and rendered with a `~` so interpolated minutes never pose as
observed ones. Duration and stop count are derived from the actual stop list.

Observations: having the whole reconstruction live in one pure helper
(`data.ts`) made the regression suite trivial — `trip-detail-live.mjs` feeds
synthetic `liveDepartures` rows straight into `getTrainRun` with no server, no
browser, and pins the exact failure ("distinct endpoints can never render as a
0-minute duplicated-timestamp pair unless the feed says so"). The Contract
change was two lines (`use` + one `text` call) because the view was already
data-shaped. The subtle part was restraint: the honest fix is a join plus
clearly-labeled interpolation, not a fully synthetic schedule dressed up as
live — the same overclaim the previous diary entry warned about, one screen
deeper.

## 2026-07-08 (third pass) — ENG-23719: white board, red header, day-rotating hand-drawn art

Redesigned the station screen away from the full-bleed poster: white
background, a Caltrain-red sticky header carrying the station name and the
day's hand-drawn scene (ENG-23684 art, epoch-day mod 3 so the scene changes
each midnight), a vertically scrolling train-first departures board under it,
a direction row with a flip pill, and a floating settings button instead of
bottom tabs. Gestures became region-scoped: the header swipes between
stations, the board swipes between trains (later trains to the right),
vertical is native scrolling, and the old bare-tap direction flip is gone.

### What felt good

- The `.contract` rewrite was almost entirely declarative churn. The whole
  visual redesign — poster to white-board — never touched state, queries,
  actions, or the live bindings; `heroOffset`, `boardTrains`, and the async
  stale/ready arms all survived intact under completely different pixels.
  In a React+Convex app this would have been a similar-sized JSX rewrite, so
  no friction win there, but the state/view separation Contract enforces made
  it mechanical to confirm nothing behavioral moved.
- The glue/testId discipline (every gesture clicks a visible press affordance)
  paid for itself again: the acceptance suite needed only three targeted
  updates (swipe start points now that region decides meaning, settings sheet
  instead of bare-tap flip, ETA toggle behind settings), and stayed at 17/17.
- Inlining 63 SVG scenes via a tiny gen script (`gen-station-art.mjs` →
  `station-art.gen.mjs`, JSON.stringify per scene) was a five-minute job and
  works identically under Vite, node acceptance, and the native bundle path.

### What felt bad or surprising

- Contract still has no scroll-aware gesture primitives, so the redesign
  moved complexity INTO the web glue: the board must yield vertical to native
  scrolling (`touch-action: pan-y`) while claiming horizontal, and the header
  claims everything. Getting the region logic right also broke the synthetic
  test swipes silently — events dispatched on `#exact-root` no longer mean
  anything when the pointerdown target's region decides the gesture, so the
  harness now dispatches from `elementFromPoint`. A real `swipe=` primitive
  (LLP 0029 G1) would have deleted all of this.
- The sticky-header layout needed absolute-positioned bands (header top=0
  height=106, scroll top=106 bottom=0) rather than flex, because a `scroll`
  child's height inside a plain flex column isn't a proven pattern in this
  renderer. Absolute bands work, but the layout reads more like CSS-in-1998
  than the rest of the file.
- The rolldown build prints three `IMPORT_IS_UNDEFINED` warnings against
  `data.ts` at unhelpfully post-transform offsets. Runtime is fine (17/17,
  every helper exercised), so they look pre-existing/benign, but opaque
  offsets into a compiled `.contract` make warnings like this hard to chase.

### Verification

Browser Contract suite 17/17 against a fresh worktree bootstrap (station
header swipe, board train swipe, settings sheet, ETA-in-settings, service
filters, live push, D4 double-boot all green). Screenshot pass over
home/trip/settings/stations on a 390×844 viewport to eyeball the design.

## 2026-07-08 — two agents, one throttle (ENG-23730 reconciling with ENG-23642)

ENG-23730 asked for exactly what I set out to build: stop treating the 60s
warm poll as a 511 request cadence, gate `refreshFeed` behind a freshness
window, keep the fallback honest, prove it in tests. I built it — a read-only
`checkLiveFeedFreshness` mutation both engines called before egress, plus a
codegen relaxation to allow `writes: []` — and while my suites were going
green, ENG-23642 landed on `origin/main` with a *transactional* budget:
`claimFeedPoll` stamps `lastUpstreamPollAt` inside the mutation, so two
triggers racing one window can never both fetch, and a granted-but-failed
attempt naturally waits out a full window. Their claim-stamp design is simply
better than my check-then-fetch (which I had documented as "accepted race
slack"), so the right move was to throw mine away and keep theirs.

What this session actually landed, then, is the residue ENG-23730 still
named: LLP 0028's stale "All Aboard targets a 60s freshness window" text (the
cadence-vs-budget distinction now lives in §Schedule/cadence and §Demand
gating), a miniflare-side proof that the budget gates the deployed action
route (the coordinator injects `pollBudgetMs = 0` for scheduled test runs, so
nothing on the Cloudflare engine had ever exercised the deny path), and an
explicit expiry-then-refetch check in the local suite via the lower-only
`pollBudgetMs` override.

Process note worth keeping: with several agents working sibling worktrees of
this repo concurrently, "current repo evidence" in an issue can be stale by
the time implementation finishes. The expensive part of this task wasn't the
gate — it was noticing, mid-verification, that `origin/main` had moved five
commits and now contained a sibling implementation, then having the
discipline to diff intent against the landed design instead of pushing a
duplicate. Fetch before you rebase, and read what arrived.

## 2026-07-08 — board-first startup: paint the trains, then connect (ENG-23727)

Opening All Aboard used to read like an ops console: `Booting All Aboard…`,
`Ensuring backend provisioning…`, `Connecting to live delays…`, then finally a
departure board. For an app whose whole answer is "when is the next train," a
plain webpage would have had the answer on screen in milliseconds. This entry
reworks startup so the first paint IS the board — deterministic schedule data
from the bundle — with health/ensure/live-subscribe running behind it.

### What I changed

- `main.ts` mounts the .contract immediately behind new deferred links
  (`deferred-links.ts`): each generated query link hands the runtime a
  forwarding handle that stays silent, so every binding holds `pending` and
  the `loading` arm renders. When `createSnapbackContractSurface` finishes in
  the background, the handles subscribe through and live rows replace the
  schedule in place. Mutations queue behind the attach.
- The `.contract`'s `loading` arm now renders the same `DirectionBoard` as the
  live arms (schedule rows, no delays) under a small honest pill —
  "Connecting for live updates…", flipping to "Offline — showing scheduled
  departures" when the connect attempt fails (capped-backoff retries behind
  it). Freshness reads "Scheduled times" and the data-source badge reads
  `SCHEDULE` until a real feed row exists, so nothing poses as live.
- Startup timing instrumentation (`allAboard.startupTiming`): html received,
  script start, first board paint, backend connected, live data applied. Two
  new browser acceptance checks pin the property: paint must precede backend
  attach (and land within 100 ms of script start), and an open with the API
  origin force-refused (CDP Fetch interception) must still render a station,
  a numeric countdown, and the honest labels — never a blocking loader.
- React arm mirrored: render `<App/>` first, attach behind, same timing facts.

### What felt good

- Contract's async-region semantics carried the whole product change: a query
  binding is `pending` until its first delivery, so "board first, live later"
  fell out of a links shim plus a better `loading` arm. The live arms replace
  the loading arm with the identical DirectionBoard shape — no layout churn,
  and the swap is declarative rather than imperative DOM patching.
- Measured on localhost dev: html received ~5 ms, board paint 23–29 ms after
  the surface script starts executing, backend attach ~70 ms later, live rows
  right behind it. The ceremony is simply gone; on a warm backend the SCHEDULE
  badge is visible for about one frame before LIVE data lands.
- The D4 inspect-first property needed zero rework: the same idempotent
  `ensureApp` runs, just after first paint instead of before it, and the
  second-window acceptance check stayed green untouched.

### What felt bad or surprising

- `createSnapbackContractSurface` refuses to exist until every live
  subscription lands, and the generated bindings throw if links are read
  before configuration — so "mount before connect" required ~100 lines of
  hand-rolled deferred-links glue that every offline-tolerant Snapback app
  would need verbatim. This belongs in the adapter as a first-class mode
  (surface handle returned synchronously, bindings pending until attach);
  filed as ENG-23736. ENG-23390's serialized-subscribe cost is the
  same underlying posture: the adapter treats the connection as a
  precondition, not a background acquisition.
- The React control arm's hand-rolled inspect-first provisioning
  (`inspect` + `loadSchema`/`loadFunctions`/`seed`) has been silently broken
  for browsers on fresh backends since the minted-admin-token hardening
  (ENG-23443): those are admin-gated writes and the page has no token. The
  contract arm's `ensureApp` is app-auth and worked all along; the React arm
  now uses it too. Comparison note: this is exactly the kind of seam a
  Convex/Supabase app never sees because provisioning isn't a client concern
  at all there — Snapback's ensure-on-mount is fine, but only the paved call
  is safe; the do-it-yourself variant rotted.
- Two origin/main breakages surfaced during verification: the kit client's
  unguarded `process.env` white-screened every browser open, and the suites'
  cron manual-run POSTs needed the minted admin token. Both fixes were also
  in the then-uncommitted live-departures work, which landed (ENG-23642,
  ENG-23719, ENG-23729, ENG-23732) while this change was in flight — this
  branch carried the identical fixes and rebased onto them cleanly.
- The Cloudflare local recorded-path suite failed its final check
  ("post-reset feed state returns to the seed label") on the origin/main this
  work started from — pre-existing and unrelated (filed as ENG-23737); the
  ENG-23642 landing carried the fix, so it resolved mid-flight.

### Verification

browser 19/19 (two new startup checks included), browser-react 18/18,
contract-live 2/2, headless 12/12, `ref-check` clean. The blocked-API check
doubles as the offline story: station, countdown, `SCHEDULE` badge, honest
note, retries ticking in the console. The deployed Cloudflare bundle picks up
the board-first shell on its next deploy (not redeployed here).

## 2026-07-09 — native-feeling paging, sticky footer, directions (ENG-23795)

The ask: make station/train paging feel like real iOS paging (adjacent cards
physically present, no fade replacement), move direction switching into a
sticky footer with live/location status dots, replace the `‹ Board` pill and
corner badge with native-feeling equivalents, drop the train arrows and
service filters, and add a real directions story (tap → maps app, long-press
→ actions sheet, maps-app preference, 18-minute auto-bike rule) plus an
end-of-line hint in the stations list.

### What I changed

- Both paging surfaces are now *declared* 3-cell strips in the `.contract`:
  the header clips prev/current/next station identity cards at `left`
  ±100%, and the selected-train card does the same with its neighbor trains.
  `gestures.ts` stopped fading and nudging: it drags the strip 1:1, settles
  onto the neighbor, and only then dispatches the same press affordance a
  tap would use. The commit press re-renders centered, so clearing the
  transform two frames later is invisible.
- Train selection model: the ‹ › arrow buttons are gone. Every board row
  selects its train on press; the rows physically adjacent to the hero carry
  the `train-prev`/`train-next` testIds so keyboard/gesture/test dispatch
  kept one stable handle. Paged-past trains render as compact rows above the
  hero (the issue's "sooner trains still appear in small form").
- Sticky footer: status dot (green live / gray not — the DEMO DATA /
  SCHEDULE / STALE label stays beside it when not live, because ENG-23642's
  honesty bar outranks minimalism), ⬉ location indicator (blue on a device
  fix), center `Switch to / Southbound` control (same `flip-direction`
  testId), and ↻ / ⚙ system-style icon circles. Direction pill, floating red
  settings button, and E3 service-filter chips deleted.
- Directions: the header distance line is an affordance
  (`station-directions-<id>`, mode in the aria-label). Tap opens the
  preferred maps app (new `directions.ts` glue; Apple/Google URL builders in
  `data.ts`), long-press opens a declared bottom sheet (Apple Maps / Google
  Maps / copy station address / cancel), Settings gained a persisted
  maps-app cycle, and `etaMode` gained an `auto` default that resolves to
  bike beyond an 18-minute walk — per station, which fell out of making the
  resolver take the station as an argument.
- Stations list rows carry `… <terminal> <time>` from the next departure's
  own final stop; trip screen got a plain `‹` back, the service badge beside
  "Train 191", and a TRIP PROGRESS caption on the position bar (it was the
  unlabeled "green line" the issue called confusing — it's the live corridor
  position, so it got a label, not deleted).

### What felt good

- The paging strip was expressible entirely in the Contract layout language:
  `left="-100%"`/`width="100%"` absolute cells inside a clipped container
  rendered exactly right on the first try (the DOM mirror passes percentage
  offsets through cleanly). The glue then only owns *transform during
  gesture* — adjacency is declared structure the native host gets for free.
  This is the best split of "what's product" vs "what's web glue" this demo
  has hit; the mid-gesture neighbor card is real content, not a screenshot
  trick.
- Removing the arrows without orphaning the gesture/keyboard dispatch was a
  data-shape fix, not a glue fix: `boardTrains` precomputes each row's
  absolute offset and testId (`train-prev`/`train-next` land on the rows
  adjacent to the hero). The press-affordance philosophy survived a UI that
  no longer has dedicated navigation buttons.
- The 24-check browser suite adapted with surprisingly little violence —
  `flip-direction`, `refresh`, `open-settings` kept their testIds through a
  full footer relocation, which is the testId-not-DOM-shape bet paying off.

### What felt bad or surprising

- `longpress` is *in the Contract event vocabulary* and the native host-ops
  table delivers `EventType.LongPress`, but the web DOM mirror never wires
  `onLongPress` — the declared event compiles and silently does nothing on
  the primary web host. The affordance declares `press=` + `longpress=`
  anyway (correct for native, honest degradation to sheet-on-tap), and
  `directions.ts` supplies the 500ms timer on web. Filed ENG-23820; when the
  mirror delivers it, the glue timer deletes.
- A component `view` must have exactly one root — my first directions sheet
  (scrim + card as siblings) failed with a clear enough compiler error, but
  I only hit it in the Vite overlay at runtime-compile time; a lint-time
  check would have caught it earlier.
- Nesting the directions button inside the change-station button was my one
  real bug: both presses fired (the synthetic long-press click opened the
  *stations* sheet). Contract happily compiles nested pressables; the DOM
  mirror bubbles clicks into both. Un-nesting was easy but nothing warned.
- Time-sensitive assertions bit once more: comparing the full `hero-meta`
  line across a page-and-back flickers when a live delay delta lands
  mid-check and moves the predicted time by a minute. Train-number
  comparison is the stable key. (Same lesson as the ENG-23727 pass, new
  disguise.)
- The React control arm is now two redesigns behind the product surface;
  mirroring this pass would have roughly doubled the change. Filed ENG-23821
  to decide freeze-vs-rebaseline instead of silently diverging further.

### Compared to React/Convex-style stacks

The paging strip + glue split is where Contract earned its keep this pass:
in the React arm this would be a scroll-snap carousel with imperative
scrollTo — easy on web, nothing reusable for native. Here the adjacency is
declarative layout any host renders, and the web-only part is one transform.
The directions/maps work cut the other way: preference storage, platform
detection, URL building, and clipboard are all "just JavaScript" in React,
but needed a deliberate module-state seam (`data.ts` + glue interception)
because contract state is invisible to the glue and device capabilities are
invisible to the contract. The seam pattern (deviceLocation, backendState,
now mapsApp) is settling into a convention, but it's three copies of a shape
Exact should eventually own.

### Verification

browser 24/24 (paging strips at ±100%, row-selection model, footer controls,
directions tap/long-press/copy rows, terminal hints, maps-app persistence,
auto-ETA), headless 12/12, cron 7/7, badge-freshness 6/6, `ref-check` clean.
Screenshots of the paged board (compact earlier row + strip), directions
sheet, stations hints, and the labeled trip progress bar were captured via
CDP during the build. The React arm (`browser-react.mjs`) is intentionally
untouched (ENG-23821). The deployed Cloudflare bundle picks the redesign up
on its next deploy (not redeployed here).

## 2026-07-09 (second entry) — the control arm is a snapshot, not a sibling (ENG-23821)

Decision, not code: the React control arm is now **formally frozen** at its
ENG-22450 baseline (notes in the demo README, the surface's `App.tsx` header,
and `demo.snapback.json`'s react-control expectation). It had silently missed
two redesigns (ENG-23719, ENG-23795), and the honest framing is that the
red-team comparison was a point-in-time gate whose verdicts are recorded here
and in the gate issues — not a commitment to build every UI twice forever.
Re-porting each redesign would roughly double the demo's UI work for no new
comparison signal. If a future gate wants a fresh apples-to-apples run, that
is a new re-baseline issue (the freeze note says exactly that), and the
re-baseline cost is itself a data point the diary should then record.

## 2026-07-09 — the deferred-links shim moves into the adapter (ENG-23736)

The ENG-23727 entry above ends on the friction that mattered: mount-before-
connect required ~100 lines of hand-rolled deferred-links glue every
offline-tolerant Snapback app would copy verbatim. That glue is now the
adapter's job. `@snapback/contract` grew a render-first mode
(`packages/snapback-contract/render-first.mjs`, re-exported from the package
root):

- `createRenderFirstSnapbackContractSurface(options)` takes the same options
  as `createSnapbackContractSurface` plus a `connect` hook (the app's
  health/ensure preflight — D4 semantics stay app-owned facts) and `onRetry`,
  and returns **synchronously**: `links` (every manifest binding, queries
  pending, mutations queued, ephemeral maps silent), `attached`
  (promise of the real surface), `surface()`, `diagnostics`,
  `onFirstDelivery`, `dispose`. Connection, ensure, and subscription
  establishment run behind the mounted app on the same 1s→15s capped backoff
  All Aboard shipped with; bindings go live in place on attach.
- Failure posture is split honestly: transient errors retry forever behind
  the bundled-data UI; a structured contract diagnostic (stale generated
  artifacts) is a build defect — it rejects `attached` immediately, retries
  nothing, and still hands back mountable links, so the app paints either
  way instead of dying at module scope.
- `main.ts` here dropped `deferred-links.ts` (deleted) and `connectBackend`
  for a single `createRenderFirstSnapbackContractSurface` call; the ensure
  facts (`provisioned`) move into the `connect` hook, the offline pill into
  `onRetry`, and HMR teardown is one `renderFirst.dispose()`.
- A dispose that races a late-succeeding construction disposes the freshly
  established surface (live subscriptions, receipt listener) instead of
  leaking it — the same ENG-23383 posture the base adapter has.

Ergonomics note for the comparison ledger: this is the second time an All
Aboard product requirement (paint like a webpage) turned into adapter
surface. The pattern held: prove the behavior in the app with a shim, then
promote the shim wholesale — the adapter version is the shim plus the retry
loop and teardown discipline the app copy had accreted anyway. What a React +
Convex app gets implicitly (queries just render `loading` until the socket
is up) Snapback's Contract path now gets as one entry point.

Verification: package suite 8/8 files green including the new
`render-first.test.mjs` (sync links, silent-until-attach forwarding, queued
mutations, backoff schedule, diagnostic-no-retry, dispose-races-construction,
promise-shaped runtime, ephemeral forwarding); browser 24/24 on the adapter
path — the ENG-23727 startup checks measured board paint at 233 ms vs backend
attach at 295 ms with code-to-board 42 ms (inside the 100 ms budget), and the
backend-unreachable open still rendered the honestly-labeled schedule board;
browser-react 18/18, contract-live 2/2, headless 12/12, `ref-check` clean.
