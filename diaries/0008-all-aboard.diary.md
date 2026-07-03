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
