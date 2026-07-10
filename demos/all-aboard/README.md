# All Aboard — Caltrain next-train demo

Answers one question before you touch anything: **when is the next train, north and
south, from the station I'm closest to?** Built on Snapback (backend + cron +
action-egress seam) with a Contract/Exact surface that renders on web today and is
native macOS/iOS-ready from the same `app.contract`.

See [LLP 0027](../../llp/0027-all-aboard-caltrain-demo.plan.md) for the design and
[Diary 0008](../../diaries/0008-all-aboard.diary.md) for the build experience.

Design (ENG-23719, paging + footer reworked under ENG-23795): a white board
under a Caltrain-red sticky header, over a sticky white footer. The header
shows the station name beside the day's hand-drawn scene (three original
scenes per station — ENG-23684 — rotating by epoch day) and is the
station-paging surface: it clips a 3-cell strip whose adjacent stations'
cards physically sit at ±100%, so a swipe drags real neighboring content
(native contiguous paging, no fade). The board below scrolls vertically and
pages horizontally between trains the same way; sooner trains stay visible
as compact rows once paged past, every row selects its train on tap, and
tapping the selected card opens the trip detail. The header distance line is
a directions affordance (tap = preferred maps app, long-press = Apple
Maps / Google Maps / copy-address sheet; ETA mode auto-picks biking beyond
an 18-minute walk). The sticky footer carries the live-status dot (green
live / gray not, with the honest DEMO DATA / SCHEDULE / STALE label when not
live), the location indicator, the "Switch to Southbound/Northbound"
direction control, and system-style ↻ / ⚙ icon buttons — no bottom tabs, no
direction pill, no train arrows, no service-filter chips. The stations sheet
adds an end-of-line hint per row (`… San Jose Diridon 9:16`). Regenerate the
inlined art with `node demos/all-aboard/scripts/gen-station-art.mjs` after
changing the SVGs.

## Layout

- `snapback/` — schema, functions, JS handlers, the shared transit model
  (`shared/model.mjs`), and the deterministic seed generator.
- `surfaces/contract/` — the one multi-surface `app.contract` plus its web host
  wiring (`main.ts`, `vite.config.ts`).
- `surfaces/react/` — the red-team control arm (stock React 19 + Vite,
  web-only, same backend; ENG-22435, re-baselined by ENG-22450). **Frozen at
  its ENG-22450 baseline by decision (ENG-23821):** it was a point-in-time
  paved-road comparison gate, so it deliberately does not track product
  redesigns (it predates ENG-23719's red-header board and ENG-23795's paging
  redesign). Its suite is `tests/acceptance/browser-react.mjs`; a future gate
  that wants a fresh comparison should file a new re-baseline issue.
- `tests/acceptance/` — `headless.mjs`, `cron.mjs`, `egress.mjs`, `browser.mjs`,
  `real-data.mjs`, `browser-react.mjs`.
- `tests/egress-probe/` — a fixture backend for the Phase 3 egress test only.

## Regenerate backend artifacts

```sh
node demos/all-aboard/snapback/seed.gen.mjs          # seed.json from the model
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/all-aboard/snapback # manifests + Contract descriptors
```

## Run the tests

```sh
TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/headless.mjs   # backend, predictions, realtime
TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/cron.mjs       # demand-armed refresh
node demos/all-aboard/tests/acceptance/egress.mjs                            # opt-in fetch seam
TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/real-data.mjs  # mocked 511 + directions product actions
node demos/all-aboard/tests/acceptance/browser.mjs                           # Contract surface (needs bun + `bun install` in surfaces/contract + Chrome)
```

The egress probe fixture is generated with the seam enabled:

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/all-aboard/tests/egress-probe
```

## Serve the web surface (URL)

Two processes — the Snapback API and a Vite dev server (which serves the
compiled `.contract` and proxies `/snapback`). The surface consumes Exact
from the **npm registry** through the paved-road `exactContractWeb` preset
(ENG-22463, ENG-22480): `surfaces/contract/package.json` declares npm alias
dependencies (`"@exact/contract": "npm:@ccheever/exact-contract@0.1.2"`,
plus renderer/devtools; imports stay `@exact/*`), and the committed
`surfaces/contract/bun.lock` **is the pin** — it replaced `exact.pin.json`.
No sibling Exact checkout, no `SNAPBACK_EXACT_ROOT`. Bump Exact deliberately
by editing the alias versions, running `bun install`, re-verifying, and
committing the lockfile. Version `0.1.2` includes the native optimizer,
embedded startup assets, runtime/host updates, and native Vite-define handling
that previously required the temporary `0.1.0` Bun patch and a nearby Exact
checkout; the patch and source-asset bridge are gone (ENG-22564).

```sh
# 0. One-time (and after dependency bumps): install the surface's packages
bun install --cwd demos/all-aboard/surfaces/contract

# 1. Snapback API (macOS first run: scripts/bootstrap-ibex-runtime)
#    SNAPBACK_OUTBOUND_ACTIONS=1 is what allows live 511/directions fetches;
#    the persistent --db is what lets keys set in the setup page survive a
#    server restart (with --memory the config store is in-memory too).
SNAPBACK_OUTBOUND_ACTIONS=1 cargo run -- --port 4420 --db .snapback/all-aboard.sqlite3

# 2. Vite dev server (separate terminal):
bun run --cwd demos/all-aboard/surfaces/contract dev
#   -> open http://127.0.0.1:5178
```

The page self-initializes on boot (inspect-first: schema/functions load and the
seed runs only when the backend needs them).

## Real data (live 511 departures + routed ETAs)

Without keys the app runs entirely on the seeded schedule and recorded feed
ticks — that is demo data, and every failed live refresh falls back to it.
To get real data:

1. Start the API server **with `SNAPBACK_OUTBOUND_ACTIONS=1`** (above). Without
   it, action fetch is denied and every refresh silently falls back.
2. Open the app once (`http://127.0.0.1:5178`) so the backend provisions
   itself — the setup page renders the app's declared config entries, and they
   only exist after this first boot.
3. Open `http://127.0.0.1:4420/_snapback/admin/setup` and set `caltrainFeed`
   (511.org token, free at <https://511.org/open-data/token>) plus optionally
   `directions` (OpenRouteService/HeiGIT key) for routed walk/bike ETAs.
4. Press **Refresh** on the board (or wait for the 3-minute cron while the
   page is open). Both ride the same upstream budget (ENG-23642): at most one
   511 poll per 180s, so a Refresh inside the window answers "updated
   recently" from the committed rows instead of re-fetching.

When a live 511 snapshot commits, `feedState.lastSource` is
`511-siri-stop-monitoring` and the board prefers `liveDepartures` rows with
real predicted departure times. If 511 returns no station-mappable visits, the
live board shows no trains instead of inventing clock-face demo departures.
When the board is still on the recorded feed for a *reason* (egress off, no
key, bad key, 511 outage), the reason now shows directly under the board footer
(testId `feed-problem`) — the same actionable message `refreshFeed` commits to
`feedRefreshState.lastError` (with the API key redacted). An intentional demo
run (no keys, no error) shows nothing. The board footer shows which one you are
looking at: an amber **DEMO DATA** badge (testId `data-source`) while the seeded
schedule and recorded feed drive the board, flipping to a green **LIVE** badge
only after a real 511 snapshot commits. Haversine walk/bike ETAs are prefixed
`~`; routed OpenRouteService ETAs show plain.

## Production web build

```sh
bun run --cwd demos/all-aboard/surfaces/contract build   # -> surfaces/contract/dist/web/
```

`vite build` through the same preset emits the client bundle plus the
surface's own `index.html` (the plugin's shell `'auto'` mode preserves it —
ENG-22445), and is configured to emit Exact static native envelopes under
`surfaces/contract/dist/web/__exact/native/{mac-appkit-hermes,ios-uikit-hermes}/`
and `__exact/platform-manifest.json`. With the current registry Exact package,
those envelopes use a `module-bundle.json` fallback instead of `startup.js`/HBC
because the package does not ship the Exact host runtime source assets. The
build fails if client chunks leak Node/native-only modules.

## Native (macOS / iOS)

The same `app.contract` renders through the Exact `ExactApp` kernel host
(`<exact>/ios/ExactApp`, targets `mac`/`ios`). Building and running that Swift
host is out of scope for this repo, but the committed surface build path now
generates macOS and iOS static native envelopes plus module bundles the host can
consume. Nothing in the `.contract` is web-specific — the host and the `main.ts`
boot differ, not the UI.

## Capability gaps (declared, not faked)

Swipe gestures (press affordances stand in), browser live-push in the Contract
adapter (a store bridge stands in), a per-host egress allowlist, exact GTFS trip
matching, notifications, offline cache, Postgres, Cloudflare. See
`demo.snapback.json` → `capabilityGaps` / `notClaiming`.
