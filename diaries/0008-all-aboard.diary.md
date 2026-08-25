# Diary 0008: All Aboard — Caltrain next-train

**Demo:** All Aboard (`demos/all-aboard/`)
**Surfaces:** headless (required), cron (required), egress (required), Contract/Exact web (required), native macOS and iOS Simulator implemented; physical-iPhone product rendering/interactions verified, LLP 0052 D1–D5 performance/stage trace pending
**Author:** Claude
**Date:** 2026-06-30
**Related:** LLP 0027, LLP 0028, LLP 0009, LLP 0015, LLP 0016, LLP 0004, LLP 0008, LLP 0013, LLP 0020, LLP 0052, Diary 0004, Diary 0007

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

## 2026-07-09 — ENG-22564: the registry surface becomes native-self-contained

All Aboard moved from patched Exact `0.1.0` to `0.1.2`. The published package
now contains the optimizer exclusions, startup template/URL builtin, current
runtime-host path, and native Vite-define handling, so the temporary Bun patch
and nearby Exact checkout asset bridge are gone. The surface remains source-
unchanged: package aliases plus the committed lock are finally the whole Exact
dependency story for both web and native artifacts.

## 2026-07-10 — footer owns the opposite direction; the board stops repeating it

Feedback pass on the ENG-23795 board, four items from screenshots of the
running app.

**One fact, one place.** The board had grown two renderings of "when is the
other direction?": the teaser row at the bottom of the train list and the
footer's "Switch to Southbound" control. The teaser row is gone; its one
unique datum — the opposite direction's next-train countdown — moved into the
footer switch ("Switch to / **Southbound** · 15 min"). Same lesson as the
ENG-23795 direction-pill removal: when two affordances answer the same
question, keep the one that also *does* something. In Contract terms this was
pleasantly mechanical — delete the `when oppositeBoard.primary` block, drop
three now-unused DirectionBoard props, pass `oppositeBoard`/`nowMs` to
StickyFooter — the compiler's prop checking caught every call site.

**No cap on the paged-past list.** `boardTrains` kept only the last 2
paged-past trains as compact rows (`offset - 2`), which made "next train
(+5)" show a hole: five trains paged past, three invisible. The cap is gone —
`before` is now `rows.slice(0, offset)`. There will never be a million
trains; a long compact list above the hero honestly communicates "you are
many trains into the future", and the primary use case (ASAP departures,
offset 0) never sees it anyway. One-line change in the helper, zero .contract
changes — the each-loop just renders what it's given.

**The icon is the signal.** The "Location unavailable — showing a default
stop" hint line under the board is gone; location state now lives only in the
footer's location icon color (blue device fix / gray fallback), with the full
sentence retained in Settings. Removing it also removed a press affordance
(the hint doubled as the re-prompt gesture) — the footer icon already carried
the same press through the main.ts glue, so nothing was lost, but it's a
reminder that in this app "text that looks like a status line" is often
secretly a button; grep main.ts for the testId before deleting anything.

**Text glyphs are not icons.** The footer's ⬉ ↻ ⚙ rendered at visibly
different weights and optical sizes (platform font dependent) inside beige
outlined circles — collectively scruffy. Replaced with 24-grid stroke SVGs
(2px round strokes, feather-style) served through `image svgSource=` — the
same inline-SVG host the hand-drawn station art uses — with the stroke color
baked into the markup so web and native render identically, and the location
icon taking the live indicator color. The circles lost their border and
lightened. Contract note: `svgSource` + a string-returning helper is a
perfectly good icon system; there is no icon primitive and this didn't miss
one.

Verification: browser suite 22/24 against the long-running reused :4420
server — the two failures are the suite's fresh admin token vs the old
server process (HTTP 401 on cron manual run, the Diary 0008 stale-server
gotcha again), not the change; re-ran on fresh ports for 24/24. The
geolocation check now drives the footer icon (`location-indicator`) and
asserts the SVG stroke flips to #0A84FF on a device fix; the footer check
asserts the switch countdown and the teaser's absence.

## 2026-07-10 (second entry) — the card answers "when does it arrive", and the trackpad counts as a finger

Two more feedback items on the board.

**Stop chips point at the destination, not the next three stations.** The
hero card's chips were `upcomingStops(…, 4)` — boarding plus the next three
intermediate stops — which answered a question nobody on this screen asked
(the intermediates are one tap away on the trip detail) while omitting the
one the headsign raises: *when does it get there?* New `heroStops` helper:
the boarding chip, an `…` marker, and the run's last two stops with their
arrival times ("6:56p 22nd Street · 7:00p 4th & King"); runs three stops or
shorter just show everything. The Contract `each` took a `when stop.gap`
arm for the ellipsis without fuss — heterogeneous rows in a keyed loop are
just a flag on the item, no separate list plumbing. `upcomingStops` stays
(the live-reconstruction suite leans on its per-stop estimated markers),
with a comment saying why.

**Wheel events are the third input modality, and I'd shipped two.** "Swipe
anywhere in the white area to change trains" already worked — for touch and
mouse drags: `regionOf` routes any pointer sequence starting inside
`board-content` to the hero pager. But a Mac trackpad two-finger swipe never
produces a pointer sequence; it arrives as `WheelEvent`s, and the glue ate
none of them, so the gesture the user actually performs on a laptop
silently did nothing. Added a wheel handler scoped to the same regions
(board pages trains, header pages stations): accumulate `deltaX` when the
gesture is decisively horizontal, commit one page per 70px, then a 450ms
lockout + 250ms quiet-reset so one physical swipe's event burst pages
exactly once. `preventDefault` on the claimed events also stops Chrome's
horizontal-overscroll history navigation from firing on the same swipe.
Lesson for the gesture-glue ledger (LLP 0029 G1): "swipe" on the web is
pointers AND wheel — a native host gets this for free from its scroll-view
APIs, the DOM mirror has to remember the trackpad exists.

Verification: trip-detail-live 7/7 (new heroStops shape check: long run =
boarding/gap/last-two, short run = no gap); browser 26/26 on fresh ports —
the two new checks assert the terminal chip matches the active direction's
corridor terminal and that synthetic wheel bursts page forward and back
exactly once each way.

## 2026-07-10 (third entry) — footer polish, the whole day on the board, dark mode, and the native-host wall

Feedback round from screenshots of both hosts (web and the native macOS app),
plus a dark-mode request. Six items, one Linear ticket (ENG-24056).

**The switch target must not read as the current direction.** The footer's
"Switch to **Southbound**" rendered the direction name in bold Caltrain red —
which reads as "you are on Southbound." Now gray (theme.secondary), same
weight; the red on the board belongs to the active-direction accents only.

**The board shows the whole rest of the day.** `boardTrains` capped the rows
after the hero at 3; now it returns every remaining departure (a 96-row
model-side limit a full Caltrain weekday direction never reaches). Rows more
than three past the selected train fade by 0.12 per step, floored at 0.38 —
the tail is scannable but the eye stays on the next few departures. The
`fade` value is computed in the helper next to `offset`/`testId`; the
.contract just says `opacity=d.fade`.

**The directions sheet was pinned to the left on macOS.** `alignSelf=center`
on an absolutely positioned node centers on the web mirror but not in the
native kernel's layout. Restructured: an absolute full-width wrapper with
`align="center"` and an inset, the sheet a plain flex child with
maxWidth 600. Cross-host lesson: don't combine alignSelf with
position=absolute in a .contract — center through a wrapper's align, which
both layouts implement.

**Tap-vs-sheet on native is a capability gap, not a design choice.** The
user asked for "tap opens the Settings maps app, long-press opens the menu"
— which IS the web behavior (directions.ts glue). On the native host every
press opens the sheet because opening a URL is web glue the native kernel
does not have. Folded into ENG-24056 rather than papered over.

**Clipper button.** Fourth footer icon (stroke ticket), press intercepted by
main.ts glue: iOS → the Clipper app's App Store listing, Android → its Play
listing, desktop → clippercard.com. Same device-capability seam as maps and
geolocation; on native it is declared and inert until the URL-open gap
closes.

**Swipes on the native macOS host: filed, not fixed.** All Aboard's gestures
are ~400 lines of web glue over the DOM mirror; the native kernel has no
counterpart and Contract has no swipe primitive to declare (LLP 0027 gap /
LLP 0029 G1). Filed ENG-24056 (Exact project) asking for host-implemented
gesture primitives, with the pager strips here as the ready-made test case
and the URL-open + keyboard gaps as scoping notes.

**Dark mode in a literals-everywhere .contract.** The palette-literals-
inlined convention met its limit: theming means one source of truth per
color. Added `themePalette(nowMs)` in data.ts — light is the shipped
ENG-23719 palette verbatim, dark the same relationships on a warm near-black
board (#14171C, raised cards #1E232B, lifted red accent #F06478 because
brand #C8102E fails as text on dark) — and a `derive theme` threading the
token object through every component as an ordinary prop. The scheme is
device glue like geolocation: main.ts follows prefers-color-scheme, adopts
flips live via the change listener, honors ?appearance=dark|light for
tests/screenshots, and exposes the same setter as window.__aaSetColorScheme
for the acceptance check. Scheme-dependent colors computed in data.ts
(delayColor, serviceTint, feedSourceBadge, footer icon strokes) read the
module state directly — they re-derive through the ticking clock, so no
signature changed. The Caltrain-red header and NEXT TRAIN pill keep brand
red in both schemes on purpose. The refactor itself was ~40 mechanical
literal→token swaps in the .contract; the compiler's prop checking made the
threading safe, and nothing about Contract resisted the pattern — but note
there is no first-class theme primitive either; this is userland.

Verification: browser 29/29 on fresh ports (new checks: gray switch color,
rest-of-day fade monotonic with a floor, Clipper opens clippercard.com under
a desktop UA, dark flip restyles the board within a tick and restores);
trip-detail-live 7/7; ref-check clean; light and dark screenshots eyeballed
against the running dev server.

## 2026-07-11 — the iPhone: safe area and the free-scrolling board (ENG-24169)

First real run on a physical iPhone (screenshot feedback): the red header
drew under the status bar with the station name colliding with the clock,
the footer controls ran into the home-indicator corners, and the departures
board panned in every direction instead of scrolling vertically. Three
defects, two repos.

**Safe area is a Contract gap, closed in userland.** The iOS host DOES
publish real insets — `viewSafeAreaInsetsDidChange` → presentation
controller → a Hermes eval that sets `globalThis.exact.safeAreaInsets` —
and the Exact renderer even has a full safe-area system (regions,
edge modes, contentInset-vs-framePadding strategies). Neither reaches this
app: the renderer's system is fed from `@exact/core` window-state, whose
`__exactSafeAreaRegionsChanged` hook only `@exact/js` window-management
registers, and the contract native startup never loads that module. So the
insets sit in a global nobody reads. Contract itself has no `safeArea`
attribute (`pinToSafeArea` in layout-intent is a stub that lowers to
nothing). The fix is the by-now-familiar device-glue seam: data.ts grows
`safeAreaInsets(nowMs)` next to geolocation/appearance — it reads the host
global live on every derive, so the 1s clock adopts rotation/inset changes
within a tick — and the .contract derives `insets`, `headerHeight = 106 +
insets.top`, `footerHeight = 64 + insets.bottom`, `barHeight = 64 +
insets.top`, threading them as ordinary number props. The red surfaces
bleed under the notch (height grows), only their content shifts (the pager
strip starts at `top=topInset`; the sub-screen bars pad and keep
`justify="center"` centering in the remaining 64). Even if the renderer
default someday engages here it would be the wrong shape for this design —
it pads the ROOT, showing board-white above a pushed-down header; an app
that draws its own full-bleed chrome has to consume insets itself.

**Arithmetic in attrs works.** `paddingBottom=18 + bottomInset` parses fine
mid-attr-list — the expression grammar is expression-first and a following
`name=` terminates it. Still computed the main heights as root derives:
one source of truth, and the components stay dumb.

**The free scroll was a host bug, not an app bug.** The board's UIScrollView
got its contentSize from `ExactRenderTree.buildNodeSnapshot` (exact repo,
shared iOS/macOS presenter snapshot), which bubbles descendant content
extents up into scrollable bounds and only treated scrollView/list children
as self-clipping. The ENG-23795 hero pager — offscreen cells at ±100%
inside an `overflow="hidden"` wrapper — therefore leaked 2× the board
width into the scroll's contentSize, and UIKit happily enabled horizontal
panning over content the presenter itself clips (`clipsToBounds =
overflow == 1`). Fixed in ExactRenderTree: `overflow == 1` children now
clip their content contribution just like scroll containers, matching the
presenters' visual semantics, with a regression test in
ExactRenderTreeTests modeling exactly this pager-inside-scroll shape. The
lesson for Contract apps: the ±100% clipped-strip paging pattern is only
sound if every layer (web mirror, hit-testing, content sizing) honors
overflow — the third of these didn't until today.

Verification: the contract surface builds; browser acceptance 26/29 with my
change vs 25/29 baseline on the same run environment (the 3 remaining
failures are pre-existing light-palette assertions that fail because the
host macOS is in Dark mode, plus a flaky boot check that passed with the
change); a targeted CDP check injects `exact.safeAreaInsets = {top:59,
bottom:34}` into the web surface and measures header 165 / pager top 59 /
scroll span 165→(H−98) / footer 98 with controls clear of the indicator,
then removes the global and watches the chrome return to 106/64 within a
tick. The exact-side ExactRenderTreeTests run is noted in that repo's
commit.

## 2026-07-11 — the detail screen answers the main question; hunting the scroll jank; a morph that earns its keep

Three items from live phone use.

**Minutes-to-boarding on the trip screen.** The detail screen listed every
stop's clock time but never said the one thing the app exists to say: how
many minutes until this train reaches *your* station. New `boardingCall`
helper (boarding stop's countdown, name, time, and an honest `departed`
flag once its call is past) renders as a hero-styled headline card between
the title block and the progress bar. The board and the detail screen now
lead with the same number.

**The scroll jank had a specific shape.** The 1s ticker writes `nowMs`,
every derive recomputes (boardTrains over the whole rest of the day,
heroStops rebuilding a trip, terminalHint, the art lookup), and the tree
re-renders — a periodic main-thread stall that lands mid-scroll and reads
as jank. The observation that unlocked the cheap fix: nothing visible in
this app changes faster than minute precision, and the runtime
equality-skips same-value state writes (signals.ts Object.is). So the tick
stays at 1s but writes `now() - now() % 5000` — 4 of 5 ticks write the same
number and are free; presses that need an immediate re-derive still stamp
the precise clock. 80% of the periodic stalls gone for one line. The
lesson generalizes: with equality-skipped writes, quantizing a clock IS the
render throttle, no scheduler needed. (Remaining suspects if it still
stutters on device: the non-passive wheel listener adds scroll latency on
desktop only; and the every-5s pass still re-derives everything — caching
boardTrains would be the next lever.)

**Tap-to-select morph, via View Transitions.** Is animating the row
expand/collapse tacky? Fast, no; slow, yes. The gesture glue now wraps
compact-row presses in `document.startViewTransition`: the tapped row is
named before capture, the new hero card gets the same name after the
press's state flush (one macrotask — rendering is suppressed inside the
callback, so no rAF there), and the browser morphs one into the other in
170ms (duration pinned in the web-chrome CSS). Progressive enhancement all
the way down: no API, reduced-motion, or gesture-driven presses (the strip
already slides) fall back to the instant update. Contract note: this is
again glue over the mirror — a declared transition primitive would subsume
it the same way swipe= subsumes gestures.ts (ENG-24056's family).

**Why a ticker can stall a scroll view at all (the thread question).** The
VM does run off the UI thread on the native hosts — but the tick's render
does not stay in the VM: it produces a patch the UI thread must apply, and
what lands in the patch is decided by REFERENCE, not value. The renderer's
change detection is props-identity based (dom-mirror.ts: "same props
reference means nothing to apply", ENG-23260), and derives that return
fresh-but-value-equal objects every call — themePalette was the worst,
since every themed node reads it — mark the whole tree dirty each tick. So
the UI thread re-applied props across the tree once per second regardless
of where JS ran; on web (the DOM mirror shares the page's main thread)
there is no separation at all. Two fixes landed: the clock quantization
(above) makes 4 of 5 ticks produce no render, and themePalette now returns
per-scheme module singletons so a render that changes no color contributes
no theme-driven work to the patch. The general rule this leaves behind:
under identity-based dirtiness, a derive's return-value identity is part
of its contract — cache what didn't change.

A gotcha worth recording: the first suite run after these changes failed
3/29 with dark-palette colors where light was asserted — because the host
Mac's auto-appearance had flipped to dark overnight, headless Chrome
inherited prefers-color-scheme: dark, and the app now honors it. The
feature working was the test breaking. The suite now pins every page open
to `?appearance=light` (the override shipped for exactly this) and only the
dark-mode check flips schemes, explicitly. If a UI follows ambient OS
state, its tests must pin that state — "passes during the day" is a real
failure mode.

Verification: trip-detail-live 8/8 (boardingCall minutes/departed/null
shapes); browser 29/29 on fresh ports (the trip-detail check now also asserts the
numeric boarding countdown), with the nowMs-derived polls widened to
tolerate the 5s clock bucket and the suite pinned to the light scheme.

## 2026-07-11 (second entry) — the pager and keys leave app glue (Exact LLP 0336 P1 / ENG-24167)

All Aboard is now the acceptance fixture for Exact's first shared interaction
slice. The station header and selected-train strip are Contract `pager` nodes:
their prev/current/next cells stay physically adjacent, while Exact's web arena
owns pointer drags, trackpad wheel normalization/lockout, claim arbitration,
rubber-band/spring/settle motion, trailing-click suppression, and arrow keys.
The header claims `station-header`; the hero pager crosses its component
boundary to claim `board-content`. Visible chevrons and train rows remain the
ordinary tap affordances and static/runtime witnesses.

The old `gestures.ts` did not disappear entirely because LLP 0336 draws the P1
boundary carefully. It is now a small P2 remainder containing only swipe-right
and Escape/ArrowLeft dismissal for stations/settings/trip. Home pager logic,
wheel state, and home key switches are gone. The `f/r/s/g/Enter` bindings live
as Contract `key` lines, with the same visible command witnesses. Directions
keeps only maps/clipboard/preference side effects; Exact's long-press delivery
replaced its local 500ms timer, and the sheet declares its modal barrier plus
`dismiss=`.

Acceptance retained the old synthetic pointer and wheel sequences instead of
turning them into click-only checks. The candidate Exact packages pass the full
browser suite with explicit checks for adjacent cells, framework-computed
`touch-action`, pointer and wheel paging, pager arrows, mnemonic case-folding,
modal long-press, and the still-deferred sheet dismissal. One useful extraction
finding landed back in Exact: touch policy must be refreshed after every DOM
mirror sync (not lazily on first pointerdown), and spring-back must install its
transition after the transform helper's reset.

## 2026-07-11 (third entry) — one router, native Motion, and G1/G8 close (Exact LLP 0336 P2 / ENG-24168)

P2 removed the remainder instead of growing another adapter. All Aboard now has
four filesystem-shaped Contract route modules (home, stations, settings, trip)
behind Exact's React-free Contract router adapter. `app.contract` receives route
props and calls router `navigate`, `replace`, `back`, and `setSearch`; screen and
trip selection are no longer a private second navigation state. Browser history
and the native host URL/history channel observe that same router. Settings,
stations, and trip are router presentations, so framework-owned Escape/back
dismissal deleted the last sheet logic from `gestures.ts`; the file is gone.

The candidate Exact checkout added the native half of the same pager contract:
complete binding descriptors cross the binary protocol, AppKit/UIKit recognizer
adapters feed a main-owned Rust Motion pager, presenter layers follow and settle
without per-frame runtime renders, and one generation-tokened semantic commit
returns through Contract before re-centering. The arena kept the web rules:
deepest eligible same-axis claim wins, equal depth fails closed, and native key
events are root-scoped. A real integration run caught one subtle bug here:
router-owned key callbacks were being invoked inside Contract's action state-write
wrapper. Splitting those callback scopes made native Escape dismiss Settings
cleanly while preserving the wrapper for actual Contract key actions.

G8 is no longer an architectural assertion. A production source build emitted
`startup.js` and Hermes bytecode for macOS and iOS; ExactApp rendered the live
Snapback-backed board in both hosts (528 nodes in the first run). On macOS, a
synthetic trackpad sequence over the station header produced one URL/station
commit after native-owned follow/settle and no per-frame JS dispatch. On iOS the
same routed Contract source rendered in the Simulator. Browser acceptance stayed
on its synthetic pointer/wheel traces and added router-owned Escape coverage.

The durable pre-publication seam is a commit-pinned source gate: Snapback records
the Exact revision in `demos/all-aboard/exact-source.json`, builds both native
envelopes through `EXACT_ALL_ABOARD_SOURCE_ROOT`, and optionally compiles both
Swift hosts. The ordinary registry path remains deliberately pinned to 0.1.2;
ENG-24185 owns publishing the coherent P1/P2 package set and advancing it.
Exact ENG-24183 and ENG-24184 own the full Motion substrate and later interaction
vocabulary, respectively—neither is hidden inside the now-closed G1/G8 claim.

---

## Erratum (2026-07-11): the "reference-decided patch on every host" mechanism was wrong for native

The thread-question entry above (2026-07-11, "Why a ticker can stall a
scroll view at all") states that "what lands in the patch is decided by
REFERENCE, not value" and that "the UI thread re-applied props across the
tree once per second regardless of where JS ran." The LLP 0052 review round
falsified the native half of that claim against the pinned
`@exact/renderer@0.1.2` sources, and the entry stands corrected as follows
(per the diary rules, this is an appended erratum; the original entry is
unchanged):

- The props-reference gate quoted from `dom-mirror.ts` (ENG-23260) governs
  the **plain-web DOM mirror only** — the mirror explicitly does not install
  when a real protocol host owns pixels.
- On **native**, canonical element props and style were **already
  value-diffed** before encoding (`propsEqual`, `collectChangedStyleKeys` in
  `host-ops.ts`; only non-empty buffers dispatch) — fresh-but-value-equal
  element props produced no protocol ops, so the UI thread did not re-apply
  element props across the tree.
- Native's real equality hole is **raw text**: every re-fired text binding
  calls `updateTextContent`, which re-emits the string without comparing it
  to the previous value, and each text set remeasures in the kernel
  (ENG-23161). The per-second native cost was a batch of same-text ops, not
  a tree-wide prop re-apply.
- The web half of the entry stands: the mirror's element gate is
  props-reference-based, the mirror shares the page's main thread, and the
  recompute cascade is real on every host.

The palette-singleton and quantization fixes were right for the right
reasons on web and for adjacent reasons on native (they stop the recompute
cascade and the text re-emits at the source). The corrected per-host
mechanism table lives in LLP 0052 (Design → "the equality landscape");
the framework-side closure is tracked there and as LLP 0029 G15.

## 2026-07-11 (fourth entry) — Phase 0 makes update economy measurable (ENG-24189)

LLP 0052 could not responsibly set numeric gates from the original jank report:
the two userland mitigations had landed together, and renderer telemetry did not
count equal-but-attempted work. The demo now has a temporary, explicitly scoped
four-arm experiment (`pre`, `clock-only`, `palette-only`, `current`). It changes
only the clock quantization and palette identity seams and defaults to the
shipped `current` behavior. Native bundles can pin the same arm at build time;
the browser uses a query parameter. This keeps the comparison inside the real
All Aboard app instead of reconstructing a toy tree.

The accompanying runner owns every process it starts: a memory Snapback server,
source-pinned Exact Vite server, and Chrome with a unique profile and debugging
port. It waits for backend attach, resets Exact's development counters, samples
20 one-second ticks per arm at a pinned viewport, and records reactive churn,
host attempts/equality, protocol/layout work, DOM mirror visits/applies, commit
time, and frame intervals as raw JSON. That isolation was more work than a
microbenchmark, but it prevents the machine-global port/process contamination
that has repeatedly made cross-worktree UI evidence ambiguous.

The Exact side felt pleasantly composable once the framework exposed one
reporting authority shared by its equality predicates and renderer counters:
All Aboard only selects the two historical mitigations and asks the public
reactive runtime for churn. The friction remains package staging. The registry
pin cannot compile the current router grammar, so this pre-publication run must
use the already established commit-pinned source override; ENG-24185 continues
to own coherent package publication rather than hiding that release step in a
demo benchmark.

The first full web capture made the original complaint numerical. Over 20.25
seconds, reverting both mitigations produced 21 commits, 10,206 effect runs,
3,280 same-text writes, 3,360 protocol ops, 12,117 mirror visits, and 6,237 DOM
`applyProps` calls. Every applied element description was value-equal. The
palette singleton made each active wave substantially cheaper but did nothing
to the 158 same-text attempts and 160 protocol ops per wave; the 5 s clock
reduced the number of waves but did nothing to their shape. Together the two
app fixes cut aggregate commit time by 87%, yet each remaining wave still ran
304 effects and walked all 577 mirrored nodes. That is unusually crisp evidence
for the framework split in LLP 0052: D3 quiets the host boundary, while D1/D2/D4
are needed to stop the upstream work and the residual mirror walk.

The raw report and readable summary live under
`demos/all-aboard/measurements/`. They also set the Phase-1 warning threshold
(100 attempts at 80% equal) and dev overhead bound. The native row remains
honestly incomplete: Xcode listed the paired physical iPhone as offline during
the run, so a simulator/mac trace can exercise the plumbing but cannot be
substituted for the device performance result.

## 2026-07-11 (fifth entry) — the same Phase 0 matrix on a real AppKit host

The macOS-native run closed two uncertainties that the browser runner could not.
First, it reproduced the four application arms in the real 528-node AppKit tree:
clock quantization reduced commit frequency, the palette singleton reduced
element attempts per commit, and the corrected native mechanism was visible in
the counters — value-equal elements were already encoder-no-ops while equal raw
text still produced protocol and layout work with D3 disabled.

Second, the first D3-on pass found an honest one-op residual rather than rounding
it away. The protocol tap decoded 53 bytes per commit as an unchanged, two-entry
`SetPagerBindings` snapshot, not framing. Exact then cached descriptor equality
without suppressing the zero-count detach signal; the same host rerun at
`928b1bd60` recorded three value-equal commits with zero protocol ops, zero bytes,
and zero layout requests. This was a good example of why the LLP 0052 gate says
zero: treating a redundant host mutation as bookkeeping would have hidden a real
boundary leak.

The awkward part was external native-agent boot. The static All Aboard entry did
not call Exact's app-agent seam, and the lazy agent module's canonical `/src`
identifier pointed at the Snapback surface root rather than the source-pinned
Exact checkout. A small runner bridge now calls the seam and aliases both the app
bootstrap and canonical lazy module id. The module-bundle endpoint returns the
source-pinned graph and Acto can capture a single coherent native tree,
screenshot, and diagnostics snapshot instead of relying on ad hoc pixels.

The profiler receipt is deliberately modest. It confirms Hermes work on
`com.exact.runtime`, but an agent reporter call polluted the recording window, so
it does not justify a parse/measure/layout percentage. The raw counters and
protocol tap are the quantitative evidence; a later native signpost trace should
answer the stage-attribution question cleanly. The named physical iPhone was
offline, so this evidence is macOS-native only and says so explicitly in the
durable report under `demos/all-aboard/measurements/`.

## 2026-07-11 (sixth entry) — the app-level jank workaround becomes framework semantics (LLP 0052 / ENG-24188)

This pass deleted the workaround that started the investigation. All Aboard no
longer owns a universal ticker, quantized clock state, `nowMs` cache-busters, or
ambient module reads for scheme, safe area, location, and backend lifecycle.
The root declares typed `host` bindings; logic uses target-relative
`invalidateAt` deadlines or a deliberately granular `now("5s")`; countdown and
freshness leaves use terminal `temporal` bindings; route estimates are a
Contract `resource` with an authored expiry; and the two board composites opt
into keyed `memoRows("id")`. Exact's DOM and raw-text equality gates make a
redundant render host-quiet even where an app has not opted into memoization.

What felt good in Exact was the explicitness. A location or scheme reader now
names the host value in its arguments, a clock reader names its cadence, and a
resource owns its result and TTL instead of laundering them through a module
cache. One clock authority and one host-publication path made deterministic
tests much easier than coordinating timers, media queries, permission events,
and cache invalidations independently. The profiler's terminal-binding plus
upstream-cause attribution also turned "the tree did work" into a reviewable
receipt rather than a hunch.

The hardest app bug was instructive. Router remounts exposed that ETA and maps
preferences are ordinary shared application state: they should not become
`appGlue`, but per-root Contract state lost session continuity when storage was
denied. Two separate realm-lifetime scalar signals behind snapshot-readable
stores fixed that without coupling the preferences or broadening host state.
The first implementation then revealed a Contract boundary mistake:
`StationHeader` used `mapsApp` without declaring/passing the prop, so its root
derive was correctly `google` while the accessible label stayed at the
platform default. The mounted browser test, not a helper unit test, found the
stale presentation. A second test now keeps one ETA press coherent across the
visible label, durable value, and router query.

Snapback itself stayed pleasantly boring during the framework migration. The
generated live bindings, action→mutation refresh path, cron demand activation,
and render-first adapter did not need new engine behavior. The friction was
cross-repository productization: the demo needs a coherent Exact closure rather
than five independently drifting packages, a commit-pinned source lane while
that closure is under review, and then a registry-only cold install proving the
published graph. That release bookkeeping is real work and should remain a
first-class gate instead of an undocumented sibling-checkout assumption.

Compared with React plus Convex or Supabase, the backend subscription story is
similar once generated bindings exist, but the UI economy has a different
shape. In React I would expect effects for media queries/geolocation, an
external-store subscription for preferences, timer hooks for countdowns and
expiry, and `useMemo`/memoized selectors whose identity conventions are local
knowledge. Contract now declares host, time, resource, and memo semantics in
the program, and Exact can enforce and profile them across web and native. The
tradeoff is stricter boundary work: capability descriptors, pure-helper
arguments, and child props must be precise, while ordinary TypeScript/React
would allow more ambient shortcuts.

Verification before the final measurement was broad: browser 34/34; the
app-specific migration suite 4/4 with 52 assertions; headless 12/12; cron 7/7;
adapter live-push 2/2; badge/deadline 6/6; trip detail 8/8; and a source-pinned
production build emitted web plus ready macOS/iOS Hermes envelopes. The clean
20-second D1–D5 report is committed as
`demos/all-aboard/measurements/update-economy.final.web.json` with a readable
receipt beside it.

One limitation stays separate from the result. The initially observed gzipped
511 fixture failure was independently fixed under ENG-24219 and the restored
real-data lane is part of the final verification. ENG-23988's separate product
startup lane did render on a physical iPhone and verified interactions. The
LLP 0052 candidate attempt built, signed, installed, created the UIKit/Hermes
runtime, and connected the target, but the device locked before its clean
rendered measurement launch. No candidate screenshot, rendered-tree, frame,
D1–D5 counter, or native stage-attribution claim is inferred from that partial
receipt; ENG-24221 owns the unlocked-device follow-up.

## 2026-07-11 (seventh entry) — physical iPhone startup over Tailscale (ENG-23988)

The physical-device closeout exposed two independent seams that localhost and
production-envelope checks did not cover. First, a Tailscale-loaded page cannot
use Snapback's loopback API origin directly; the Vite surface now supports a
`same-origin` browser value backed by a separate localhost proxy target and
accepts LAN hostnames. Second, the preserved HTML shell still hardcoded the
static platform-manifest link that Exact now injects only during production
builds. In dev that path fell through to the HTML shell, so the iPhone host read
HTML where it expected a manifest and showed a white screen before JavaScript
startup. Removing the stale link restored Exact's dev content negotiation while
the production build continued to inject the real static link and envelopes.

The concrete workflow mattered: `bun install` reapplied cleanly, the
render-first cycle regression passed, the source-pinned build emitted ready iOS
and macOS Hermes envelopes, and the Tailscale URL served both the app and
`/snapback/health`. On a rebuilt physical iPhone host,
`http://100.88.75.121:5178/` then rendered the All Aboard board; taps and native
scrolling worked, and a follow-up check confirmed the framework swipe gestures
worked too. The host briefly remained on its own title screen while the
roughly 5 MB dev startup artifact loaded, which is useful UX feedback but was
not another startup failure. Compared with a browser-only React/Supabase-style
demo loop, the native discovery and package/source pin layers add meaningful
diagnostic surface area; Exact's explicit startup-artifact endpoint made the
final fault mechanically testable once the request path was inspected.

## 2026-07-11 (eighth entry) — LLP 0052 release closeout (ENG-24188 / ENG-24185)

The final review materially improved the framework, not just its test count.
It found late-mounted host/temporal consumers after hydration release, bounded
memo values that could be mutated into accessors, app-glue values larger than
the equality budget, temporal builtins forged through native IR, unattributed
and dropped profiler rows, and a lazy devtools edge that still emitted a small
update-economy chunk in production. Each became a fail-closed implementation
rule and regression before Exact `9a3a3498` landed. On the Snapback side, the
review also replaced a ProMotion-specific p95 threshold with a cadence-aware
gate that catches both sustained drops and the original sparse one-second
stalls; the raw Phase 0 arms prove the new tail oracle discriminates the bad
case instead of merely sounding quantitative.

Publishing was deliberately one coherent operation. Exact's 13 paved-road
packages were packed, dry-run, cold-installed through their alias dependency
closure, then published publicly as `0.1.4`. All Aboard's five roots and Bun
lock now resolve that one version from npm, while `exact-source.json` retains
the exact commit for pre-publication/source-conformance work. This is more
release ceremony than a typical React app consuming Convex or Supabase, but it
eliminates a worse class of ambiguity: a demo that passes only because a nearby
framework checkout happens to contain unpublished code. The final registry-only
build/browser run and checksum-linked mounted report make that boundary
reproducible.

The physical-iPhone update-economy trace remains intentionally separate. A
general product run rendered and interacted correctly on device, and the
candidate built/signed/installed/connected, but no locked-device attempt is
promoted into frame or native-stage evidence. ENG-24221 owns that last hardware
measurement without holding the cross-platform semantics or package release
open.

## 2026-07-12 (ninth entry) — restore the board-first paint budget (ENG-24386)

The cold-clone lane exposed a real regression in the board-first promise after
the Exact 0.1.4/router work: the board still beat the backend, but it took
283–495 ms after the surface module started against the existing 100 ms bar.
Local reproduction measured 314 ms. The backend was innocent. `main.ts`
started `@exact/renderer/web-host` as a dynamic import and awaited it before
mounting the router; the larger current package graph made that post-start
module fetch part of the critical path.

Making the web host a static dependency restored the intended startup shape:
the browser loads the required rendering runtime with the entry graph, then
surface execution installs it synchronously and mounts the board. A fresh
unique-port acceptance run passed 34/34 with code-to-board at 68 ms and backend
attach at 213 ms after script start. The fix keeps both product constraints —
useful schedule data inside 100 ms and live attachment behind it — without
loosening the threshold or adding placeholder HTML that would fork the
Contract-rendered UI.

What felt good was how small the correction was once the timing facts were
split correctly: Exact's explicit renderer entry and Snapback's existing
startup instrumentation made the critical-path dependency visible. What felt
surprising was that an import originally introduced to overlap work became a
serialization point as the dependency graph evolved. A plain React app might
hide the same shift inside bundler chunking, while a Convex/Supabase backend
would not change this client-side cost; the useful difference here was the
hard acceptance witness, not the framework choice. The cold-clone rerun after
the full ENG-24338–ENG-24388 integration remains the landing gate.

## 2026-07-12 (tenth entry) — make the paint witness honest end to end

Review found that the ninth entry's 68 ms result was true but incomplete.
Static ESM dependencies load and evaluate before `main.ts` can record
`scriptStartMs`, so moving the renderer from a dynamic import to a static one
moved most of the cost before the stopwatch. The user still waits for that
work. The acceptance oracle now starts at the navigation response boundary;
the script-start delta remains in the result only as a diagnostic. The first
cold isolated proofs measured 888 ms and 1.45 s response-to-board; the slower
reported only 94 ms from entry-body start, leaving 1.36 s hidden. The 2.2 s
dev-server bar adds roughly 50% host-load headroom over that observed maximum
instead of pretending Vite's cold transform work is free.

A clock-real regression imports a renderer stand-in whose top-level evaluation
waits 2.6 seconds. It demonstrates the old metric's failure mode directly: the
entry-body delta stays below 100 ms, while the response-to-board oracle sees
the full delay and rejects it. This made the proof more like what a user of a
React/Convex or React/Supabase app would care about—time from receiving the app
to useful UI—not time from an implementation-chosen point inside its module
graph. The static import can still be the right optimization; it simply no
longer gets performance credit by moving work across the measurement boundary.

A second review caught another optimistic boundary in the React control arm:
calling `requestAnimationFrame` next to concurrent `root.render()` did not prove
that React had committed a useful board first. `App` now emits its witness from
a layout effect only after the home screen has both station identity and a hero
departure in the committed tree. The bootstrap records the following animation
frame only after crossing a complete rendering opportunity, and does not begin
health/provision/live attachment until that boundary resolves. The acceptance
timing includes the commit timestamp and asserts commit → frame → backend
order, so an empty or merely scheduled React
root can no longer satisfy the board-first claim.

Final batch review found that the Contract arm still used the older,
single-`requestAnimationFrame` witness. Because an rAF callback runs before
its frame is painted, that path could release `client.health()` in a microtask
before the rendering step and call the timestamp a paint. Contract now records
the successful router mount as its useful-board commit, crosses two animation
frames (leaving a complete rendering opportunity between them), and only then
releases backend attachment. The shared timing oracle and both browser arms
require the explicit commit timestamp and reject commit/paint inversion. This
keeps the React control and Contract paved road honest under the same
commit → paint → backend ordering instead of comparing differently optimistic
clocks.

## 2026-07-12 (eleventh entry) — calibrate the shared-runner paint gate

The first integrated GitHub cold-clone proof passed at 2102 ms from HTML
response to useful board paint, only 98 ms inside the 2200 ms local/dev budget.
An unrelated follow-up that changed only `local-proof.yml` then measured
2507 ms and failed. Its decomposition made the source of variance visible:
1666 ms before the entry body, 667 ms from entry to useful-board commit, and
173 ms across the commit-to-paint witness. The board still beat backend attach
by 211 ms, and all other 33 browser checks passed.

That is a shared two-core runner calibration problem, not evidence that the
product regressed between the two commits. The cold-clone workflow now sets an
explicit 3800 ms ceiling: approximately 1.5 times the observed 2507 ms CI
maximum, following the same headroom rule used for the default. The local and
ordinary acceptance ceiling stays 2200 ms, and the clock-real 2600 ms static
evaluation regression remains red under that default. This keeps the hosted
clean-clone lane stable without weakening the tighter development signal or
hiding whether paint still precedes backend work.

## 2026-07-13 (twelfth entry) — make the auth target choice explicit

The auth program made the shared `SnapbackClient` discover protocol v1 before
online work. That was ergonomic on the local target—the generated surface
picked up the new handshake without app-specific glue—but it exposed an honest
Cloudflare boundary: the narrow proof still declares `external_auth` missing
and has no `/auth/session` route. Its All Aboard bundle was therefore probing a
protocol the deployed target does not implement. Treating the resulting 404
(or the static asset fallback's HTML 200) as permission to downgrade would
have hidden receiver skew, so the fix is an explicit build-time target profile
and a target-owned client factory that disables all four auth protocols.

What felt good was that the same surface source remains usable on both targets:
local/native builds retain auth discovery, while the Cloudflare deploy selects
its pre-auth profile in one command. The canonical Cloudflare acceptance now
records every client fetch and proves the real query path never asks for
`/auth/session`. What felt bad was that the checked-in Cloudflare capability
manifests had drifted behind the Rust target declaration; regenerating them
also surfaced the missing v0/dev-only tuple and all-negative hosted-auth facts.
The dual web/native production build found two more target seams worth making
explicit: native `same-origin` must resolve to the host-supplied gateway origin
rather than the literal sentinel, and Vite reuse provenance must include the
target profile as well as the API origin.

Compared with a React client configured directly for Convex or Supabase, this
adds an explicit target-profile seam that those hosted SDKs usually choose for
the application. The extra configuration is friction, but it preserves a
useful property for Snapback: one client cannot silently reinterpret a missing
security protocol as an anonymous legacy server. Exact was neutral here; its
Vite build-time define was a convenient carrier, while the auth decision and
the Cloudflare capability truth remained Snapback-owned.

## 2026-07-15 — one URL-open intent reaches web and native (ENG-24997)

The directions experience finally uses the same declared effect on every
host. All Aboard now exposes URL opening as a named Contract capability. On
macOS and iOS it calls Exact's existing CapSec-admitted
`desktop.shell.openExternal` bridge; with no Exact host bridge, the same helper
falls back synchronously to `window.open`, preserving the browser popup path.
The header press opens the persisted preferred maps app, long-press still
opens the Apple/Google choice sheet, and those two sheet rows now invoke the
same capability before closing. The Clipper footer action moved onto the same
bridge. Copy-address remains browser clipboard glue and stays an explicit
native gap rather than being bundled into the URL-open claim.

What felt good was that Exact already had the hard platform primitive. The
implementation was mostly making ownership honest: Contract actions own the
intent and app state, while a small adapter chooses native host call versus
browser fallback. The native production-envelope test now proves both macOS
and iOS bundles carry the host operation, and a focused unit test pins native
bridge precedence, browser fallback, and empty-input behavior. No new Exact
kernel or Snapback backend work was needed.

What felt bad was the old split between declared UI and DOM interception. The
web sheet listener used to augment Apple/Google presses because Contract could
only close the sheet; once the Contract actions gained the capability, leaving
that listener in place would have opened every URL twice. Retiring those two
augmentations while keeping copy-address made the migration less mechanical
than replacing `window.open`. The related metadata also had to be corrected in
three places: capability inventory, known gaps, and non-claims.

Compared with React plus Convex or Supabase, the final helper is no more code
than a typical `Linking.openURL`/`window.open` adapter. Contract adds useful
friction by requiring the effect to be declared in contract metadata; that
made the native omission visible and testable instead of letting a web global
quietly no-op. Snapback is neutral for this change—the demo diary and build
gates live here, but URL opening remains an Exact host concern.

## 2026-07-25 — seed-true resetFeed (the reset every external arm tripped on)

The All Aboard external review (Kimi, 2026-07-24) reported that every single
arm tripped on reset semantics: `resetFeed` stamped
`feedRefreshState.lastSource: 'reset'` while the seed carries
`lastSource: 'seed'`, so no app-reachable call could return the board to the
honest seed-labeled boot state — the only seed-true path was the admin-token
app reset, and the SB-SWIFTUI arm built an entire second-port `/reseed`
control seam to work around it. This entry closes that finding
(issues/20260724-all-aboard-seed-true-reset.md): `resetFeed` is now seed-true.

The design read was the easy part. Grepping every consumer showed nobody
depends on the `'reset'` label — the suites call `resetFeed` for exactly three
effects (tick 0, all on-time, clear the ENG-23642 upstream-poll budget), and
the badge helper treats `'reset'` and `'seed'` identically as DEMO DATA. So a
second `reseedFeed` mutation would have preserved semantics nobody consumes at
the cost of every future arm having to learn which reset is the honest one.
`resetFeed` itself became seed-true.

The interesting constraint was the seed-source mechanism. The obvious move —
have `seed.gen.mjs` also emit a generated module constant the handler imports,
one source of truth — is structurally impossible: Snapback handler files are
closed single-file scripts, and codegen's `scanUnsupportedHandlerSource`
rejects import/export by design. Passing the fixture as a mutation argument
felt wrong too (any client could then "reseed" arbitrary rows). What worked is
restore-by-construction: the mutation rewrites every handler-mutable field to
its seed literal (`lastSource: 'seed'`, `tickIndex: 0`, `fetchedAt: 0`,
`observedAt: 0`, empty `liveDepartures`, `lastUpstreamPollAt: null`), and the
fields it does not touch (`staleAfterMs`, `tickCount`, the static schedule)
are exactly the fields no mutation in the file ever writes — so they still
hold seed values by construction. The headless suite now asserts the
post-reset feed tables byte-equivalent to `seed.json`, which is what keeps
that invariant from drifting: add a mutation that touches a seed-only field
and forget the reset, and the byte comparison fails.

Two runtime details were pleasantly honest. First, `null` on an optional field
round-trips the way a reseed needs: patching `lastUpstreamPollAt: null` stores
SQL NULL, and `claimFeedPoll`'s `Number(state.lastUpstreamPollAt) > 0` guard
reads that as "no claim on record" — identical to the fresh-seed row. Second,
the byte-equivalence check had to name its exclusions rather than fuzzily
"mostly match": `_version`/`_updatedAt` are Snapback-managed system columns
stamped on every commit, and a null column is storage's representation of an
optional field the fixture omits. Everything else is compared byte-for-byte
after canonical key ordering.

The warm-poll trap from this diary's first entry did its job as documentation:
the byte-equivalence assertion sits before the suite's single subscription is
created, so the 180s cron cannot commit a tick between the reset and the
snapshot reads. That discipline (one-shot queries until the last check) is
still the load-bearing determinism trick of this suite.

Compared with Convex or Supabase — whose seed-true resets four diaries praised
as "the most honest test hook of any row" — Snapback needed one extra idea
(the closed-handler constraint forces restore-by-construction instead of "read
the fixture and write it"), but the result lands in the same place: one
app-reachable mutation, byte-audited against the committed fixture. Remaining
step: mirror the byte-identical `handlers.mjs` change into the
`expo-jam-allaboard` copy (shared with live sessions, deliberately not touched
here) so its second-port `/reseed` seam can be retired.

## 2026-07-30 — Exact 0.1.7: the portable-artifact pin finally lands

Upgraded the Contract surface's whole lockstep Exact suite from the registry
0.1.4 pins to `@ccheever/exact-*@0.1.7` (aliased as `@exact/*`), regenerated
`bun.lock` from the public registry, and production-rebuilt the dist in place
through `scripts/check-required-surface-builds.mjs`
(issues/closed/20260716-upgrade-exact-portable-artifact-pins.md).

Exact observations, separate from Snapback. The 0.1.6 attempt's two blockers
are really gone in 0.1.7: the narrowed `@exact/contract/runtime/production`
entry now exports `defineCapability`/`onFlush`/`signal`/
`registerNativeContractKeyBinding`, so `@exact/router/contract` production-
builds from the registry package without any alias or shim. The only source
migration the new grammar demanded was the one the 0.1.6 attempt predicted:
each `pager` needs a stable scalar `value=` identity — `value=station.id` on
the station header strip and `value=board.hero.id` on the hero pager. Two
attributes, no behavioral rework; the surface's own typecheck and URL-open
tests passed unchanged on the first try. That is what a good breaking change
looks like: the error at build time named the missing symbol, and the
documented migration was exactly sufficient.

The portability claim itself held up under the byte-level scan: the rebuilt
dist (25 MB including the static native startup bundles) contains no absolute
checkout path — sourcemap `sources` are all relative, workspace imports use
the `/__exact_workspace__/` token. The one surprise was on the Snapback gate
side, not Exact's: the `windows-drive-root` marker misfired on escaped source
text (`case N:\n`, the regex source `[\s:"]`) that 0.1.7's richer bundles now
embed. Real leaks always carry a directory segment, so the marker now requires
one; regression tests cover both the false-positive and true-positive classes.

One fresh-worktree trap worth recording: the surface's Vite build consumes the
demo's ignored codegen cache, so a clean worktree fails with
`SNAPBACK_CODEGEN_CACHE_INVALID` until
`SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs
demos/all-aboard/snapback` regenerates it — the error's own remediation line
points at the CLI, but running codegen directly needs the outbound-actions env
var that `scripts/check-generated-artifacts` knows about and the error does
not mention.

## 2026-08-02 — Exact 0.1.10 closes the production-route cold-clone failure

The Contract surface's lockstep Exact suite now pins the published 0.1.10
closure. The upstream repair started with the missing
`isCompiledComponent` production export, then closed the wider rewritten
runtime namespace with a router-derived parity gate. The cold consumer also
found two packaging/host-boundary defects that an in-workspace test could not:
module-lexer dependencies had to be declared in the devtools package, and the
external Contract-web preset had been selecting the production-only direct
DOM host during `vite dev`. Preserving the full renderer pair in development
restored geolocation SVG updates, pager pointer/wheel/key input, and
long-press delivery as one class.

The touch-policy check now asserts LLP 0336's accepted edge-preserving shape:
the claim regions and edge guards stay browser-owned (`auto`), while the
interior pager cells carry `pan-y`. This is a semantic realignment, not a
weakened check; the suite still drives both swipes, wheel paging, arrow keys,
mnemonics, and long-press afterward.

Evidence: the required registry production build passed, and
`scripts/cold-clone-check.sh` completed its frozen registry install,
production build, and all 34 browser checks (`34/34`, 92s). That is the exit
witness for the closed production-runtime ticket.

## 2026-08-25 — unreachable boot stays board-first, and cold-clone failures speak

The F-3 cold-clone witness found a regression in a promise this diary had
already treated as settled: blocking the backend still painted the bundled
schedule board, but it also raised the fixed-position `boot-status` error over
that board. The browser client wraps a bare transport failure as the structured
`SNAPBACK_CLIENT_REFUSED` diagnostic. All Aboard's render-first adapter quite
reasonably treats diagnostics as terminal build defects, so the generic
transport wrapper accidentally took the hard-failure path instead of the
retry path.

The app now narrows that boundary at its health/ensure preflight: only the
generic client transport refusal is rethrown as an ordinary retryable error.
Specific Contract diagnostics keep their loud terminal behavior. The existing
offline acceptance now records the boot-chrome text when it regresses and
passes with a numeric scheduled departure, the `SCHEDULE` badge, and
`Offline — showing scheduled departures`; the online boot path remains green.

Snapback's bundled deterministic schedule plus the read-only backend host
projection made the product fix pleasantly small. The sharp edge was that
"has a diagnostic" had come to mean both "typed build refusal" and "fetch did
not reach a server" at the adapter seam. A Convex- or Supabase-style client
would usually expose transport state separately, but the app would still need
the same product decision about retained/default data and honest labeling.
Exact remained neutral here: its pending Contract bindings continued to mount
and render the schedule correctly throughout.

The other half of the issue was observability. `scripts/cold-clone-check.sh`
already retained the full browser log, but on failure it normally emitted only
the temporary pathname. It now prints the machine-readable report section
before exiting. A fail-only report probe exercises that branch without running
the expensive clone/build/runtime sequence; an injected one-check failure
printed its JSON and exited 1. This is straightforward shell plumbing, but it
turns an opaque remote failure into evidence that survives the temp directory.

Verification: fail-first browser acceptance reproduced the sole failure at
`33/34` with `Boot failed: SNAPBACK_CLIENT_REFUSED: Failed to fetch`; after the
fix the same suite passed `34/34`. The targeted cold-clone report probe printed
the injected machine-readable JSON and exited 1. The full cold-clone sequence
was not rerun in this JS-only lane; the F-3 witness remains recorded precisely
in the resolved ticket.

## 2026-08-25 — offline retry ownership moves into render-first

Review found that the first offline repair made the right product visible for
the wrong architectural reason. `SNAPBACK_CLIENT_REFUSED` is the client's
fallback diagnostic for any otherwise-uncoded exception, so stripping that
code in All Aboard's `connect` hook could also turn malformed protocol data
into an endless Offline state. It missed the second establishment seam too: a
transport failure during Contract surface creation or live subscribe still
terminated attachment and repainted the boot chrome.

The retry decision now lives in the render-first Contract adapter and uses the
client's transport provenance rule. Fetch-dispatch failures retry from either
the app preflight or live-subscribe construction; a code-only
`SNAPBACK_CLIENT_REFUSED` stays terminal. An HTTP response is also terminal,
including a 502 HTML response labeled `SNAPBACK_HTTP_ERROR`: the transport did
answer, so replaying behind Offline would hide an ambiguous proxy/server or
protocol defect. The classifier moved into the lower Contract package and the
client's existing `outbox-shared` export now points to that one implementation,
avoiding a client↔Contract package cycle.

Snapback felt better after the boundary correction: the app now expresses only
its product preflight, while the reusable adapter owns retry across every way
attachment can fail. Exact remained neutral again; pending bindings continued
to render the bundled board. Compared with Convex or Supabase, the useful
difference is not a branded error code but an explicit no-Response provenance
fact that prevents server answers from being mistaken for outages.

The cold-clone report injection is now an inventoried Node test rather than a
manual assertion. It proves exit 1 plus marker/JSON forwarding and separately
proves the missing-marker message, without entering the expensive install,
build, or browser phases. The focused 34-check browser suite is the local
offline witness; the full cold-clone rerun and the separate first-paint budget
failure remain outstanding.
