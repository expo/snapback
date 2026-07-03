# Collaborative graffiti wall demo

One shared pixel wall. Every painter sees each other's strokes appear live, and
each other's cursors move in real time. It is the product-shaped consumer of two
Snapback realtime lanes at once:

- **Durable** — `cells` is the persisted wall. Painting a pixel appends a
  server-owned mark; the `listCells` live query streams the wall to every other
  painter over the shared live socket, and the surface renders it
  **last-writer-wins per coordinate** (the r/place trick for "one pixel, many
  writers" without an upsert).
- **Ephemeral** — `boardCursors` is live presence: where each connected painter
  is right now. It is a TTL-bounded latest-state collection (LLP 0013) that is
  coalesced, connection-owned, and **never written to SQLite**.

The whole realtime story is generated surface, no hand-written glue: the wall
binds as a board-scoped live `query` (an adapter `liveQueries: [{ name, args }]`
entry), remote painters arrive through the generated **`ephemeral` binding**
(`boardCursors.ephemeral.ts`), and this tab's pointer leaves through the
authored rated **`publish` line** in `graffiti.contract` — a value channel bound
to `pointermove` on the board, publishing at 15Hz inside the generated
`sustainedHz=20` budget the Exact analyzer checks at build time.

```
graffiti/
  demo.snapback.json              # demo manifest (surfaces, capabilities, gaps)
  snapback/
    schema.mjs                    # cells table + boardCursors ephemeral collection
    functions.mjs                 # listCells live query + paintCell mutation (HostPlans)
    seed.json                     # deterministic starter art (heart + "SB" + sprig)
    generated/                    # codegen output (committed, deterministic)
      contract/                   # generated Contract bindings, incl. the ephemeral pair
  surfaces/contract/
    graffiti.contract             # the pixel-grid + presence UI (bindings + channel publish)
    board.mjs                     # shared wall constants + per-tab painter identity
    data.ts / data.contract-meta.ts  # pure view helpers (LWW grid, palette, cursor geometry)
    main.ts                       # browser boot (idempotent ensureApp, surface, mount)
  tests/acceptance/
    headless.mjs                  # required surface acceptance suite
    contract.mjs                  # Contract/Exact compile + descriptor acceptance
```

## Run it

```sh
# 1. Regenerate the manifests + Contract bindings from source.
node demos/_kit/codegen.mjs demos/graffiti/snapback

# 2. Headless acceptance (the required surface; boots the Rust server itself).
node demos/graffiti/tests/acceptance/headless.mjs

# 3. Contract/Exact compile acceptance (optional; needs an Exact checkout + bun).
SNAPBACK_EXACT_ROOT=../exact bun demos/graffiti/tests/acceptance/contract.mjs

# 4. The live multiplayer wall in the browser.
cargo run -- --port 4431 --memory
SNAPBACK_GRAFFITI_API=http://127.0.0.1:4431 \
  bun run --cwd demos/graffiti/surfaces/contract dev
#   then open http://127.0.0.1:5179/ in two browser windows and paint.
```

On macOS, run `scripts/bootstrap-ibex-runtime` from the repo root first (or point
`HERMES_*` env at a prepared Ibex checkout) so the spawned Snapback server links
Hermes.

## What it proves

**Headless (required):** schema load registers the `cells` table **and** the
`boardCursors` ephemeral collection; generated functions load and inspect, and
the capability manifest reports WebSocket ephemeral publish; deterministic
reset + seed; server-authoritative paint with owned system fields; a paint
live-syncs to a peer connection; append-only marks resolve last-writer-wins;
presence requires the board room permission
(`SNAPBACK_EPHEMERAL_UNAUTHORIZED`); cursor presence publishes, fans out to a
peer, and coalesces to the latest value; presence never advances the durable
wall version; cursor subscribe + publish ride the live WebSocket, not a private
route; disconnect drops a connection-owned cursor; TTL expiry prunes an idle
cursor without durable tombstones; over-rate publishes are rejected
(`SNAPBACK_EPHEMERAL_RATE_LIMITED`) and observable in diagnostics; oversize
payloads are rejected (`SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE`); the durable lane
stays first under a cursor flood on one connection; and `inspect` distinguishes
ephemeral fan-out pressure from durable delivery.

**Contract/Exact (optional):** `graffiti.contract` compiles against the
generated descriptors through the real Exact compiler; the generated ephemeral
read binding and rated publish resolve (and presence publish is *not* a durable
mutation — the budget facts ride the manifest's `ephemeral` section); and Exact
row-shape analysis catches a bad presence field. The browser surface mounts the
wall, paints durable pixels, streams peers' pixels via live push, and renders
peers' cursors via the `ephemeral` binding — two realtime lanes over one
connection.

## What it is NOT claiming

A demo shape, not a scale benchmark. It is an **Online**-class integration
(server-authoritative mutations), not local-first/Parity. Contract has no
canvas primitive in v0, so the wall is a **pixel grid** rather than freehand
vector drawing — coordinates are baked into each cell's press handler at
compile time, and the pointer channel carries presence only. The same
`graffiti.contract` compiles for the macOS native (AppKit/Hermes) target, but
Exact has no runnable macOS NSApplication host yet (only iOS runs native
today), so the runnable GUI is the **web** surface, which works in any macOS
browser.

> **Security — do not copy the client-side room-permission pattern.** The
> browser surface (`surfaces/contract/main.ts`) and the headless suite mint their
> own `boardMember` room permission on the *client* and send it with every
> ephemeral request; the local dev server trusts it. This is honest only because
> the demo declares `external_auth` as a capability gap — there is no auth
> provider, so the client stands in for one. It models an auth check in the wrong
> place. A real app must have a **trusted server-side external_auth provider**
> decide board membership and mint the permission; a client must never assert its
> own room membership. The server-side *enforcement* point is real (`schema.mjs`
> `allow.roomPermission('boardMember')`, proven by the
> `SNAPBACK_EPHEMERAL_UNAUTHORIZED` acceptance check) — only the trusted *minting*
> is stubbed by the client here. See `demo.snapback.json` `capabilityGaps` /
> `notClaiming`.
