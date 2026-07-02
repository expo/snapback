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
- `tests/acceptance/` — `headless.mjs`, `cron.mjs`, `egress.mjs`, `browser.mjs`.
- `tests/egress-probe/` — a fixture backend for the Phase 3 egress test only.

## Regenerate backend artifacts

```sh
node demos/all-aboard/snapback/seed.gen.mjs          # seed.json from the model
node demos/_kit/codegen.mjs demos/all-aboard/snapback # manifests + Contract descriptors
```

## Run the tests

```sh
TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/headless.mjs   # backend, predictions, realtime
TZ=America/Los_Angeles node demos/all-aboard/tests/acceptance/cron.mjs       # demand-armed refresh
node demos/all-aboard/tests/acceptance/egress.mjs                            # opt-in fetch seam
node demos/all-aboard/tests/acceptance/browser.mjs                           # Contract surface (needs Exact + bun + Chrome)
```

The egress probe fixture is generated with the seam enabled:

```sh
SNAPBACK_OUTBOUND_ACTIONS=1 node demos/_kit/codegen.mjs demos/all-aboard/tests/egress-probe
```

## Serve the web surface (URL)

Two processes — the Snapback API and a Vite dev server (which serves the
compiled `.contract` and proxies `/snapback`). The surface consumes Exact
through the paved-road `exactContractWeb` preset (ENG-22463): the checkout is
the sibling `../exact` by default, overridable with `SNAPBACK_EXACT_ROOT`, and
`surfaces/contract/exact.pin.json` records the Exact revision the surface was
last verified against — a mismatched checkout warns on every dev start and
build (`EXACT_PIN_STRICT=1` turns drift into a hard failure; re-pin
deliberately with `EXACT_WRITE_PIN=1` after verifying on a new revision).

```sh
# 1. Snapback API (macOS first run: scripts/bootstrap-ibex-runtime)
cargo run -- --port 4420 --memory

# 2. Vite dev server (separate terminal):
bun run --cwd demos/all-aboard/surfaces/contract dev
#   -> open http://127.0.0.1:5178
```

From a **git worktree** (or with the sibling checkout on the wrong revision)
point `SNAPBACK_EXACT_ROOT` at the Exact checkout to build against:

```sh
SNAPBACK_EXACT_ROOT=/path/to/exact bun run --cwd demos/all-aboard/surfaces/contract dev
```

The page self-initializes on boot (inspect-first: schema/functions load and the
seed runs only when the backend needs them).

## Production web build

```sh
bun run --cwd demos/all-aboard/surfaces/contract build   # -> surfaces/contract/dist/web/
```

`vite build` through the same preset emits the client bundle plus the
surface's own `index.html` (the plugin's shell `'auto'` mode preserves it —
ENG-22445) and stays web-only: no native static artifacts, no desktop
manifests. The build fails if client chunks leak Node/native-only modules.

## Native (macOS / iOS)

The same `app.contract` renders through the Exact `ExactApp` kernel host
(`<exact>/ios/ExactApp`, targets `mac`/`ios`). Building and running that Swift host
is out of scope for this repo; web is the runnable surface here. Nothing in the
`.contract` is web-specific — the host and the `main.ts` boot differ, not the UI.

## Capability gaps (declared, not faked)

Swipe gestures (press affordances stand in), browser live-push in the Contract
adapter (a store bridge stands in), a per-host egress allowlist, live external feed
polling, notifications, offline cache, Postgres, Cloudflare. See
`demo.snapback.json` → `capabilityGaps` / `notClaiming`.
