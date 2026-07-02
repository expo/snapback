# LLP 0025: Web cursor presence demo reset

**Type:** Plan
**Status:** Implemented
**Systems:** Demo apps, Realtime, Ephemeral state, Web client, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-28
**Revised:** 2026-07-01 (status → Implemented, ratified in the LLP 0032 R1 batch: the demo shipped as `demos/cursors-web`)
**Related:** LLP 0000, LLP 0013, LLP 0015, LLP 0016, LLP 0020, LLP 0021, Diary 0006, commit 0bc9ce8, commit 6389ab7

## Summary

Reset the collaborative graffiti/whiteboard demo effort to one small web-only
presence demo:

- one browser page;
- no durable drawing model;
- no Contract/Exact or native surface requirement in the first pass;
- a blank board that shows every connected client's cursor as an arrow or dot
  with a made-up name and stable color;
- two real browser clients in acceptance, moving independent cursors and seeing
  each other's latest positions.

The demo should prove the LLP 0013 cursor/presence carrier and nothing more. It
should not prove art tools, durable stroke sync, freehand canvas, macOS, Exact
native, or broad adapter ergonomics.

The short-term product feature this needs is a **room-preserving, idempotent
ephemeral collection registration path**. Clients must be able to open the page,
discover the app's already-loaded ephemeral collections, and publish/subscribe
without re-provisioning the server or clearing active rooms. Collection definition
loading and live room state must be separate lifecycle operations.

## Motivation

The graffiti branch tried to turn several unsettled capabilities into one
showcase: durable board state, ephemeral cursor presence, generated Contract
bindings, a browser host, pointer tracking, a live multi-boundary adapter, and a
native-platform story. That was too much load for one demo.

Diary 0006 records useful work, but also the warning signs:

- the first diary entry described a `demos/graffiti/` tree and stroke schema that
  had not actually landed yet;
- opening a second tab called `loadSchema`, and collection replacement cleared
  ephemeral rooms and outboxes, making the first tab's cursor disappear;
- pointer movement had to be captured outside Contract at the DOM level because
  the Contract surface had no pointer-move event or event coordinates;
- the existing Contract adapter assumed one durable query boundary and was the
  wrong shape for a shared multiplayer board plus presence overlay;
- room permission key encoding was easy to get wrong in demo glue;
- reused server processes and per-connection publish-rate budgets made tests
  fragile;
- the macOS/native story became a distraction: the runnable surface was web,
  while native was at best a compiled artifact.

Those are not just implementation bugs. They show that the demo was proving the
wrong thing. A cursor-presence demo should first make the ephemeral lane boring:
connect, publish position, receive everyone else's latest visible position,
expire/disconnect cleanly, and never touch durable storage.

## Context Pack

Governing constraints:

- LLP 0013 owns the semantic contract for cursor and presence state:
  connection-owned latest-state entries, TTL, snapshots plus deltas, coalescing,
  explicit backpressure, and no durable database writes.
- LLP 0015 says demos need deterministic data, machine-checkable acceptance, and
  honest capability gaps.
- LLP 0016 says later demos should not broaden the corpus until they retire glue
  or prove a missing runtime capability.
- LLP 0020 says realtime-heavy demos cannot claim product evidence unless they
  use generated artifacts, real runtime paths, and an honestly reported realtime
  capability class.
- LLP 0021 is relevant only as a caution: Contract/Exact adapter work should not
  be copied into every demo. This reset deliberately avoids depending on it.

Current implementation evidence:

- `main` does not currently contain `demos/graffiti/`; the web graffiti work
  lives in branch history at commits `0bc9ce8` and `6389ab7`.
- `main` does contain the local ephemeral subsystem, generated ephemeral
  references, HTTP helpers, and WebSocket message handling used by the todo
  ephemeral fixture.
- Diary 0006 is the most useful artifact from the abandoned demo because it
  identifies the lifecycle and adapter mistakes directly.

## Design

### Demo shape

Create a new demo, tentatively `demos/cursors-web/`.

The backend has one source-authored ephemeral collection:

```text
webCursors
  scope: demo room id
  routing: room id
  key: connection
  ttl: 5s
  value: { x, y, name, color, updatedAt? }
```

No durable app table is needed for v0. If the server needs a known room id for
auth or seed, keep it as demo configuration rather than a user-facing data model.
The demo may use a permissive local-room auth policy while the auth system is
still immature, but it must say so in `demo.snapback.json`.

The web surface should be ordinary web code first: a plain DOM, Vite, or minimal
React page that consumes the generated Snapback client API. Do not use Contract
or native in the required path. A Contract surface can become an optional follow-up
only after the web cursor demo is stable.

The UI is intentionally small:

- full-window blank canvas or div;
- local pointer movement publishes fractional viewport coordinates, throttled
  below the declared ephemeral publish budget;
- remote cursors render as arrows or dots with name labels;
- each tab gets a made-up name and color, stable for that tab;
- disconnect or TTL expiry removes the cursor;
- reconnect resubscribes and republishes.

### Store feature: idempotent collection ensure

The local ephemeral store currently treats collection replacement as a
provisioning operation that may clear rooms. That is acceptable for admin reset
and test setup, but it is hostile to browser clients. The short-term store/API
feature should split three operations:

- **load app definitions:** server or demo runner installs schema, functions, and
  ephemeral collection definitions before clients connect;
- **ensure collection definitions:** idempotently verify that the already-loaded
  collection definitions match the generated artifact hash, without clearing
  rooms or outboxes when they match;
- **reset ephemeral rooms:** explicit admin/test operation that clears rooms,
  bumps epochs, and tells clients to resubscribe or republish.

`ensure` must be non-destructive on exact match. On mismatch it should fail with
a structured stale-artifact or incompatible-definition diagnostic. It must not
silently clear active rooms as a recovery strategy.

This can be implemented locally before hosted adapters exist. The important
contract is lifecycle separation: app definition changes are provisioning events;
cursor publishes are client events; resetting live presence is explicit.

### Client/runtime requirements

The required web path should use product-shaped ephemeral primitives:

- generated collection reference for `webCursors`;
- generated or package-owned publish/subscribe helpers;
- WebSocket publish/subscribe if available; otherwise the demo manifest must
  explicitly mark HTTP publish plus outbox drain as a temporary capability gap;
- one in-memory overlay store keyed by collection/scope/key;
- client-local TTL pruning from server-provided expiry metadata;
- observable errors for rate limit, oversize payload, stale artifacts, and auth;
- no writes to `_snapback_changes`, SQLite app tables, or retained local stores.

Avoid app code that reimplements room-key encoding, permission-prefix formats, or
wire envelopes. If that glue is still necessary, count it in the diary and keep
the demo Draft.

## Why The Previous Demos Felt Buggy

The failure pattern was not "cursor presence is too hard." The failure pattern
was that the demo treated unsettled plumbing as if it were product surface.

1. **Too many axes moved at once.** Durable painting, ephemeral presence, generated
   Contract bindings, browser host details, native aspirations, and adapter
   generalization all changed together. A bug in any one looked like a broken
   app.
2. **Provisioning ran from clients.** Calling `loadSchema` from each tab turned a
   client page load into a server reconfiguration event. Because collection
   replacement cleared rooms, normal multiplayer use destroyed presence.
3. **The surface fought its framework.** Contract did not expose pointer-move
   coordinates, so the demo mixed DOM listeners with Contract rendering. That may
   be a valid bridge later, but it was the wrong first proof.
4. **The adapter shape was still todo-shaped.** The existing Contract adapter was
   good for one primary durable query and mutation reconciliation. A live board
   needs multiple continuous inputs: durable board state plus ephemeral overlay.
5. **Acceptance was not narrow enough.** "Verified in two tabs" is useful diary
   evidence, but the required gate should be an automated browser test that moves
   two cursors and asserts both labels render at the expected positions.
6. **The demo overclaimed platform scope.** Compiling for native is not the same
   as a runnable native demo. This reset claims web only.
7. **The code did not stay on the paved path.** Demo glue exposed room encoding,
   publish drains, boot ordering, and adapter boundaries that should be hidden
   behind generated or package-owned APIs.

## Acceptance

The first accepted version of this demo should pass all of these checks:

- two independent browser contexts connect to the same local Snapback instance;
- each context gets a distinct generated name and color;
- moving client A's pointer updates client B's remote cursor label and position;
- moving client B's pointer updates client A's remote cursor label and position;
- cursor publishes do not advance the durable storage version or write app rows;
- intermediate pointer moves may be coalesced, but the latest position converges;
- closing one browser context removes or expires its cursor in the other context;
- opening a second context does not clear the first context's room or outbox;
- a stale generated artifact or incompatible collection definition fails with a
  structured diagnostic rather than clearing rooms;
- rate-limit and oversize-payload failures are observable;
- tests do not rely on sleeps where deterministic drains or WebSocket acks are
  available;
- `demo.snapback.json` states the surface is web-only and Online-class.

Diary acceptance:

- create or update a diary entry with the exact glue inventory;
- record whether the demo used WebSocket publish or HTTP publish plus drain;
- record any code that still manually knows room-key encoding or wire envelopes;
- compare the experience to a simple React + Convex or Supabase presence demo.

## Non-Goals

- No drawing, strokes, cells, CRDTs, OT, or durable board state.
- No macOS, iOS, native Exact, or AppKit host claim.
- No Contract/Exact required surface.
- No hosted multi-instance, Redis, or Cloudflare adapter.
- No offline/local-first presence claim.
- No scale benchmark. This is a product-shape and correctness fixture, not proof
  that 100 high-frequency publishers work.

## Open Questions

- Should the first required web surface be plain DOM, React, or a tiny framework-
  neutral generated-client example?
- Should `ensure collection definitions` live under the admin/provisioning API,
  the generated app bootstrap path, or both?
- What exact diagnostic code should represent "same collection id but incompatible
  definition would clear live presence"?
- Should the v0 demo use unauthenticated local-room presence, or should it depend
  on the current board-member auth helper?
- Should WebSocket publish be mandatory for this demo, given the local server now
  has a WebSocket message path, or may HTTP publish remain as a clearly marked
  temporary gap for the first iteration?

## Status

Draft. This Plan supersedes the product direction of the abandoned graffiti-board
demo work, but it does not supersede LLP 0013. LLP 0013 still owns the ephemeral
state contract. This Plan owns the narrower demo reset and the lifecycle feature
needed to keep a simple web cursor page from wiping its own presence state.
