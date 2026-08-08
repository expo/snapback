# Web cursor presence

Two browser windows see each other's live mouse cursors through Snapback's
ephemeral realtime: one generated ephemeral collection (`webCursors`), a pure
Contract surface (ENG-22524, Exact LLP 0281 stage 0) whose pointer stream
rides a value channel with a rated publish, plus a hand-wired React control
arm (ENG-22531) that prices the Contract abstractions honestly (verdict in
diary 0011). The guide's presence recipe (`guide/recipes/presence-cursors.md`)
names this demo as the working reference, and
`guide/realtime/ephemeral-state.md` sources its collection-contract snippet
from this demo's schema.

## Run it

```sh
# Contract surface (required): browser acceptance drives two real Chrome clients.
node demos/cursors-web/tests/acceptance/contract-browser.mjs

# React control arm.
node demos/cursors-web/tests/acceptance/react-browser.mjs

# Dev servers (see demo.snapback.json surfaces.* for the full recipes):
#   bun install --cwd demos/cursors-web/surfaces/contract   (once)
#   SNAPBACK_CURSORS_API=http://127.0.0.1:4425 bun run --cwd demos/cursors-web/surfaces/contract dev
```

Toolchain: node>=24, cargo (server), bun + published Exact packages at the
committed lock (Contract arm), local Google Chrome.

## Not claiming

Durable drawing/stroke storage, a native app surface, offline/local-first
presence, hosted multi-instance presence routing, or scale — see
`demo.snapback.json` `notClaiming` and `capabilityGaps`.
