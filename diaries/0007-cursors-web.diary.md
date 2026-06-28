# Diary 0007: Web cursor presence

**Demo:** Web cursor presence (`demos/cursors-web/`)
**Surfaces:** web (required)
**Author:** Codex
**Date:** 2026-06-28
**Related:** LLP 0013, LLP 0015, LLP 0016, LLP 0020, LLP 0025, Diary 0006

## 2026-06-28 - Building the LLP 0025 reset

### What I built

I replaced the abandoned graffiti-board scope with a web-only cursor presence
fixture:

- source-authored `webCursors` ephemeral collection with `roomId` scope,
  connection-owned keys, 5s TTL, allow-all local auth, and latest WebSocket
  delivery;
- a plain DOM page under `demos/cursors-web/surfaces/web/` that tracks pointer
  coordinates, publishes fractional viewport positions, and renders connected
  clients as colored cursor labels;
- generated `api.mjs` and `schema.manifest.json` as the page's Snapback contract;
- a dependency-free Chrome DevTools Protocol acceptance test that opens two
  browser contexts, moves real mouse coordinates, and checks both DOM overlays.

### Snapback changes

The important core change was not the page. `LocalEphemeralBackend` now has an
idempotent `ensure_collections` path, and `replace_collections` preserves rooms
and outboxes when the loaded collection definitions are exactly unchanged.
`/ephemeral/collections/ensure` exposes that as the browser bootstrap check.

That directly fixes the Diary 0006 failure where a second tab called schema load
and cleared the first tab's room. The page now assumes app definitions were
loaded by the runner, then verifies the generated collection definitions without
re-provisioning the server.

I also wired WebSocket close to `disconnect`, so connection-owned cursor entries
are removed promptly when a tab closes. TTL is still the backstop, but the normal
two-tab demo no longer waits for expiry to make a departed cursor disappear.

### Glue inventory

| Bridge file | Role |
|-------------|------|
| `demos/_kit/client.mjs` | Adds `ensureEphemeralCollections`; existing WebSocket helper is reused |
| `demos/cursors-web/surfaces/web/main.mjs` | DOM pointer capture, WebSocket envelopes, overlay render |
| `demos/cursors-web/tests/acceptance/browser.mjs` | CDP harness in place of Playwright dependency |

The page still manually sends the current v0 WebSocket envelopes
(`ephemeral_subscribe`, `ephemeral_publish`, `ephemeral_delete`). That should move
behind generated or package-owned helpers, but at least the room key and
permission encoding are not handwritten in the demo.

### What felt good

- The generated ephemeral reference was enough for the page to avoid naming
  collection internals by convention.
- The existing `EphemeralOverlay` worked for browser state once the WebSocket
  message shapes were applied.
- CDP kept the acceptance test dependency-free and closer to the actual browser
  behavior than a headless-only mock.
- The durable/ephemeral boundary is now easy to assert: after cursor movement,
  durable storage version remains `0` while `inspect.ephemeral` shows one room.

### What felt bad

- The client API still exposes wire envelopes too directly for browser authors.
  Convex-style presence would hide subscribe/publish request IDs, stream acks,
  and byte encoding behind a hook or generated helper.
- There is no packaged static-web dev command yet. The acceptance test provides
  its own tiny static server.
- Allow-all auth is right for this v0 fixture but too weak to copy into a real
  shared document demo.

### Compared to Convex or Supabase

React plus Convex would be quicker for a cursor room because the presence hook
and browser client are product surfaces already. Supabase channels would also be
less code for a two-tab pointer demo. Snapback's win here is stronger lifecycle
and modeling clarity: schema reload, stale collection definitions, durable
version, rate limits, and room diagnostics are all structured server facts rather
than comments in demo glue.

### Net

This is the smaller proof LLP 0025 asked for. It does not claim drawing, native,
Contract, offline presence, or hosted adapter support. It does prove that the
local Snapback ephemeral lane can hold cursor presence without writing durable
rows, and that browser page load no longer has to destroy active rooms to verify
generated collection definitions.
