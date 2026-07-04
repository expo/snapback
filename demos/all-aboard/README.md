# All Aboard — Caltrain next-train demo

Answers one question before you touch anything: **when is the next train, north and
south, from the station I'm closest to?** Built on Snapback (backend + cron +
action-egress seam) with a Contract/Exact surface that renders on web today and is
native macOS/iOS-ready from the same `app.contract`.

See [LLP 0027](../../llp/0027-all-aboard-caltrain-demo.plan.md) for the design and
[Diary 0008](../../diaries/0008-all-aboard.diary.md) for the build experience.

## Layout

- `snapback/` — schema, functions, JS handlers, the shared transit model
  (`shared/model.mjs`), and the deterministic seed generator.
- `surfaces/contract/` — the one multi-surface `app.contract` plus its web host
  wiring (`main.ts`, `vite.config.ts`).
- `surfaces/react/` — the red-team control arm (stock React 19 + Vite, web-only,
  same product/testIds/backend; ENG-22435, re-baselined by ENG-22450); its
  suite is `tests/acceptance/browser-react.mjs`.
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
dependencies (`"@exact/contract": "npm:@ccheever/exact-contract@0.1.0"`,
plus renderer/devtools; imports stay `@exact/*`), and the committed
`surfaces/contract/bun.lock` **is the pin** — it replaced `exact.pin.json`.
No sibling Exact checkout, no `SNAPBACK_EXACT_ROOT`. Bump Exact deliberately
by editing the alias versions, running `bun install`, re-verifying, and
committing the lockfile. The surface also carries a temporary Bun patch for
`@ccheever/exact-devtools@0.1.0`; remove it when a published Exact devtools
package owns the native optimizer escape hatch and registry-safe static
native fallback.

```sh
# 0. One-time (and after dependency bumps): install the surface's packages
bun install --cwd demos/all-aboard/surfaces/contract

# 1. Snapback API (macOS first run: scripts/bootstrap-ibex-runtime)
SNAPBACK_OUTBOUND_ACTIONS=1 cargo run -- --port 4420 --memory

# 2. Vite dev server (separate terminal):
bun run --cwd demos/all-aboard/surfaces/contract dev
#   -> open http://127.0.0.1:5178
```

The page self-initializes on boot (inspect-first: schema/functions load and the
seed runs only when the backend needs them).

For real data, open `http://127.0.0.1:4420/_snapback/admin/setup` after the
app boots and set `caltrainFeed` (511.org token) plus `directions`
(OpenRouteService/HeiGIT key). Without those keys, `refreshFeed` falls back to
the recorded feed ticks and station-card walk/bike ETAs fall back to haversine.

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
