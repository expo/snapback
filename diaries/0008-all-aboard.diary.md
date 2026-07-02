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
