# Diary 0006: Collaborative graffiti board

**Demo:** Collaborative graffiti/whiteboard (LLP 0024)
**Surfaces:** headless (required)
**Author:** Codex
**Date:** 2026-06-27
**Related:** LLP 0013, LLP 0015, LLP 0024, Diary 0001, Diary 0004

## 2026-06-27 — Building the graffiti board demo

### What I built

I added `demos/graffiti/` as the first official consumer of the LLP 0013 ephemeral
subsystem alongside durable board marks:

- **Durable half:** `boards`, `boardMembers`, and `marks` tables; `listBoardMarks`
  live query; `addStroke` mutation with a 64-point-per-row cap.
- **Ephemeral half:** source-authored `boardCursors` in `ephemeral.mjs`, codegen'd
  into `ephemeral.manifest.json`, registered on the server at suite start.
- **Shared kit extensions:** `defineEphemeralCollection`, ephemeral codegen,
  `SnapbackClient` publish/subscribe/delete helpers, `boardMemberAuth`, and a
  small `EphemeralOverlay` store for headless tests.
- **Headless acceptance:** 13 checks covering LLP 0024's acceptance profile
  (durable peer sync, cursor overlay, coalescing, disconnect cleanup, durable lane
  under cursor flood, oversize rejection, board auth, reconnect snapshot, stale
  upsert rejection, inspect diagnostics).

I also taught `LocalSnapback::reset()` to clear ephemeral rooms/outboxes so demo
resets do not leave ghost cursors from earlier checks.

### Glue inventory

| Bridge file | Role | Approx. lines added |
|-------------|------|---------------------|
| `demos/_kit/define.mjs` | `defineEphemeralCollection` authoring | ~40 |
| `demos/_kit/codegen.mjs` | `ephemeral.manifest.json` + API refs | ~70 |
| `demos/_kit/client.mjs` | HTTP ephemeral publish/subscribe + scope auth helper | ~95 |
| `demos/_kit/ephemeral-overlay.mjs` | In-memory overlay (TTL prune, stale upsert) | ~95 |
| `demos/graffiti/snapback/*` | Demo schema, handlers, ephemeral, seed | ~120 |
| `demos/graffiti/tests/acceptance/headless.mjs` | Acceptance fixture | ~380 |
| `src/ephemeral.rs` / `src/local.rs` | Reset clears ephemeral rooms on admin reset | ~12 |

**Total demo-local bridge (kit + graffiti, excluding generated artifacts):** 6
files, ~812 lines. Generated output adds `ephemeral.manifest.json` and extra API
refs; no hand-written Contract/React surface yet.

### Fan-out note

Headless fixture parameters (no sleeps; drain-based):

- **Simulated clients:** 2 (Ada publisher + Grace observer) on the main cursor
  path; up to 40 cursor publishes in the durable-lane isolation check.
- **Cursor publish burst:** 12 publishes in the coalescing check; 40 in the
  durable-lane flood check.
- **Observed coalescing:** server `ephemeral.coalesced_updates` ≥ 10 after the
  12-publish burst; subscriber drain received ≤ 2 applied ephemeral messages.
- **Durable-lane separation:** `addStroke` live delivery to a peer succeeded
  with `liveDelivery.last_deliveries ≥ 1` while ephemeral coalescing counters
  rose under the same board.
- **Workaround:** HTTP `/ephemeral/publish` + outbox drain (not inbound
  WebSocket publish). Documented as a capability gap in `demo.snapback.json`.

### What helped

- **LLP 0024 gave a crisp split.** Knowing cursors are ephemeral and strokes are
  durable prevented the obvious trap of writing pointer motion into `marks`.
- **Rust ephemeral tests were a spec.** The existing `src/ephemeral.rs` unit tests
  and `local_snapback_reuses_in_memory_ephemeral_store` showed the wire shapes
  and permission prefix before I wrote JS glue.
- **Todo demo patterns carried over.** Schema/functions/codegen/headless layout
  from LLP 0015 meant the durable half was mostly incremental.
- **Admin reset clearing ephemeral rooms.** Without that, headless checks leaked
  cursors across examples and made disconnect/reconnect assertions flaky.

### What felt bad

- **Scope key encoding is easy to get wrong.** Room permissions use
  `7:boardId=12:seed_board_1`, not `boardId=12:seed_board_1`. The first auth
  failures were silent until I aligned `boardMemberAuth` with the Rust
  `encode_component` rules.
- **No generated ephemeral API yet.** `defineEphemeralCollection` is prototype
  kit code, not a committed LLP 0004 spelling. The demo registers collections via
  HTTP after load, not through a single generated bootstrap path.
- **HTTP publish for cursors.** LLP 0024 wants WebSocket publish for product;
  v0 headless still uses HTTP + drain. Honest gap, but agents could copy the
  wrong pattern.
- **Stale server reuse confused one check.** A reused process on the first test
  port returned non-JSON errors for unauthorized publishes; switching to a fresh
  port made the suite reliable. Demo orchestration should probably reset or
  version-stamp reused servers.
- **No browser canvas yet.** The plan defers UI until headless passes; this diary
  only proves the carrier, not the collaborative drawing experience.

### Snapback observations

The durable path felt familiar: ctx.db handlers, live query fan-out, and inspect
stats matched todo/kanban expectations. The new material was ephemeral:
registering collections, separating lanes in the outbox, coalescing counters in
inspect, and connection-owned cleanup on disconnect. `inspect.ephemeral` next to
`inspect.liveDelivery` is the right shape for agents choosing where latency
comes from.

Reset now clearing ephemeral state is a small but important product behavior:
demos and tests treat `/admin/reset` as a full fixture rewind.

### Compared to React + Convex / Supabase

Convex would still feel more finished for generated client hooks and presence
rooms. Here, Snapback's advantage was explicit lane separation and diagnostics —
coalescing counts, oversize rejects, and unauthorized publishes are structured
facts the headless suite asserts. Supabase Realtime channels would be faster to
wire for cursors, but would not give the same durable-vs-ephemeral boundary or
the LLP acceptance fixture tying demo to RFC validation.

### Net

The graffiti demo is a useful LLP 0024 / LLP 0013 prototype. It proves the
durable/ephemeral split on one board, documents kit-level glue honestly, and
gives the ephemeral subsystem a product-shaped headless consumer. It does not
move LLP 0013 beyond Draft by itself — WebSocket inbound publish, hosted
adapters, and generated `defineEphemeral` syntax are still open — but it is the
right first rung to measure fan-out and keep agents from storing cursors in
SQLite.

---

**Erratum (2026-07-01):** the header cites "LLP 0024" as this demo's plan. No
whiteboard demo plan was ever committed at any number — the draft this diary
cited never landed, and today's LLP 0024 is the agent operating-surface spec.
Appended per the diary policy in LLP 0016 (originals are never rewritten);
context in LLP 0032 R3.
