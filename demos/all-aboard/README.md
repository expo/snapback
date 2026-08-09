# All Aboard — Caltrain next-train demo

Answers one question before you touch anything: **when is the next train, north and
south, from the station I'm closest to?** Built on Snapback (backend + cron +
action-egress seam) with a Contract/Exact surface that renders from the same
`app.contract` on web, macOS, and the iOS Simulator. Physical-iPhone product
startup, rendering, taps, scrolling, and framework swipes are also verified;
the LLP 0052 candidate's unlocked D1–D5 performance trace remains ENG-24221.

See [LLP 0027](../../llp/0027-all-aboard-caltrain-demo.plan.md) for the design and
[Diary 0008](../../diaries/0008-all-aboard.diary.md) for the build experience.

Design (ENG-23719, paging + footer reworked under ENG-23795): a white board
under a Caltrain-red sticky header, over a sticky white footer. The header
shows the station name beside the day's hand-drawn scene (three original
scenes per station — ENG-23684 — rotating by epoch day) and is the
station-paging surface: it clips a 3-cell strip whose adjacent stations'
cards physically sit at ±100%, so a swipe drags real neighboring content
(native contiguous paging, no fade). The board below scrolls vertically and
pages horizontally between trains the same way — touch drag, mouse drag, or
trackpad two-finger swipe, anywhere in the white area between header and
footer; the selected card's stop chips show the boarding stop plus an
ellipsis and the run's last two stops (arrival at the end of the line), with
the full stop list on the trip detail; all sooner trains stay
visible as compact rows once paged past (the list just grows and the user
scrolls — the primary use case is the next few trains anyway), every row
selects its train on tap — a fast View-Transitions morph animates the row
expanding into the selected card where the browser supports it — and
tapping the selected card opens the trip detail, which leads with the
minutes until that train reaches your station. The header distance line is a directions affordance (tap =
preferred maps app, long-press = Apple Maps / Google Maps / copy-address
sheet; the URL-open intent uses Exact's native shell bridge and the browser's
window.open fallback; ETA mode auto-picks biking beyond an 18-minute walk). The sticky
footer carries the live-status dot (green live / gray not, with the honest
DEMO DATA / SCHEDULE / STALE label when not live), the "Switch to
Southbound/Northbound" direction control (gray, so it never reads as the
current direction) with the opposite direction's own next-train countdown,
and round stroke-icon Clipper / location / refresh / settings buttons (the
Clipper ticket opens the device-appropriate get/refill link — app store on
iOS/Android, clippercard.com elsewhere; the location icon is the only
home-board location signal: blue on a device fix, gray on fallback) — no
bottom tabs, no direction pill, no train arrows, no service-filter chips,
no opposite-direction teaser row on the board. The board lists every
remaining departure for the day, gradually fading rows more than three past
the selected train. The whole app respects the OS appearance: dark mode
follows `prefers-color-scheme`, flips live without a reload, and a
`?appearance=dark|light` URL param pins it for tests and screenshots (the
Caltrain-red header and NEXT TRAIN pill keep their brand red in both
schemes). The stations sheet
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
EXACT_ALL_ABOARD_SOURCE_ROOT=/path/to/exact \
  bun test demos/all-aboard/tests/acceptance/update-economy-helpers.test.ts  # migration/conformance helpers
EXACT_ALL_ABOARD_SOURCE_ROOT=/path/to/exact \
  node demos/all-aboard/tests/acceptance/update-economy.mjs                  # mounted D1–D5 report (20s default)
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
dependencies (`"@exact/contract": "npm:@ccheever/exact-contract@0.1.4"`,
plus renderer/devtools; imports stay `@exact/*`), and the committed
`surfaces/contract/bun.lock` **is the pin** — it replaced `exact.pin.json`.
No sibling Exact checkout, no `SNAPBACK_EXACT_ROOT`. Bump Exact deliberately
by editing the alias versions, running `bun install`, re-verifying, and
committing the lockfile. Version `0.1.4` is the coherent 13-package closure at
Exact `9a3a3498`: it includes LLP 0052's host/time/equality/memo/profiler
semantics plus the native optimizer, embedded startup assets, router/pager
runtime, and native Vite-define handling. No patch or sibling checkout is
needed on the ordinary path (ENG-22564, ENG-24185, ENG-24188).

```sh
# 0. One-time (and after dependency bumps): install the surface's packages
bun install --cwd demos/all-aboard/surfaces/contract

# 1. Snapback API (macOS first run: scripts/bootstrap-ibex-runtime)
#    SNAPBACK_OUTBOUND_ACTIONS=1 is what allows live 511/directions fetches;
#    the persistent --db is what lets keys set in the setup page survive a
#    server restart (with --memory the config store is in-memory too).
SNAPBACK_OUTBOUND_ACTIONS=1 cargo run -- start --port 4420 --db .snapback/all-aboard.sqlite3

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
and `__exact/platform-manifest.json`. The registry-only `0.1.4` path emits
production `startup.js` for both hosts and records the explicit module-bundle
fallback when no Hermes compiler is installed; the commit-pinned source gate
uses Exact's prepared compiler to prove matching Hermes bytecode envelopes
against the recorded revision before a future package release. The build fails
if client chunks leak Node/native-only modules or production update-economy
profiler code.

## Native (macOS / iOS)

The same routed `.contract` source renders through the Exact `ExactApp` kernel
host (`<exact>/ios/ExactApp`, targets `mac`/`ios`). ENG-24168 built and ran the
production envelopes on macOS and an iOS Simulator: both rendered the live
Snapback-backed board, the native Motion pager committed a station change after
trackpad follow/settle, and root-scoped Escape dismissed the Settings router
presentation. ENG-23988 separately rendered the product surface on a physical
iPhone over Tailscale and verified taps, native scrolling, and framework swipes.

For commit-pinned source verification, set `EXACT_ALL_ABOARD_SOURCE_ROOT` to
the Exact checkout pinned by `exact-source.json`, then run the native source
acceptance:

```sh
EXACT_ALL_ABOARD_SOURCE_ROOT=/path/to/exact \
  node demos/all-aboard/tests/acceptance/native-source.mjs
```

That gate builds both static envelopes from the pinned Exact sources and checks
their manifests/startup payloads. Set `EXACT_ALL_ABOARD_BUILD_HOSTS=1` on macOS
to add clean macOS and iOS Simulator host builds. The LLP 0052 candidate's
physical-device receipt under `measurements/2026-07-11-eng-24189-native/`
records build/sign/install/runtime connection without substituting the separate
product-rendering run for a migrated D1–D5 performance trace.

## Update-economy evidence (LLP 0052)

All Aboard now consumes Exact's reactive host bindings, deadline/temporal
primitives, value-equal host-operation skips, keyed derive memoization, and
lazy update-economy profiler. Its old universal ticker and ambient host-state
cache-busters are gone. The mounted acceptance runner independently flips the
D1 host inputs under a frozen clock, drives a D2 terminal deadline, checks D3
equal-text suppression and D4 structural sharing, and runs D5 control/reporter
trials while recording app-dataflow, host-work, attribution, frame, and
overhead gates.

The committed 20-second receipt is
`measurements/update-economy.final.web.json`, with a readable checksum-linked
summary beside it in `measurements/update-economy.final.md`. Phase 0 web and
macOS-native evidence remains next to that final report so the before/after
economy is reproducible. Use `--output /path/to/report.json` for an uncommitted
local run.

## Capability gaps (declared, not faked)

Native URL opening/clipboard, a per-host egress allowlist, exact GTFS trip
matching, notifications, offline cache, Postgres, Cloudflare. See
`demo.snapback.json` → `capabilityGaps` / `notClaiming`.
