# Diary 0006: Collaborative graffiti board

**Demo:** Collaborative graffiti/whiteboard (`demos/graffiti/`; the LLP 0015 demo-ladder whiteboard reference app — see the 2026-07-01 erratum below on the original "LLP 0024" citation)
**Surfaces:** headless (required), Contract/Exact web (optional)
**Author:** Codex; Claude (2026-07-03 landing)
**Date:** 2026-06-27
**Related:** LLP 0013, LLP 0015, LLP 0034, Diary 0001, Diary 0004, Diary 0007

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

## 2026-07-03 — Landing the demo on main (ENG-22219)

### What happened between the experiment and this landing

The wall existed twice before today, neither on main: the entry above (a
headless-only exercise whose `demos/graffiti/` never landed), and a committed
reference experiment on the off-tree `graffiti-board` branch (base `fc71ac7`)
that built the full web frontend — including a hand-rolled codegen extension
projecting ephemeral collections into Contract query/mutation bindings, a
~300-line custom surface bridge polling one outbox into two boundaries, and a
document-level pointer listener publishing the mouse through the ephemeral
lane. Main then moved ~143 commits. This landing ports the best of that
reference onto current main — and the striking part is how much of its glue
the platform grew underneath in those two weeks:

- **Generated ephemeral Contract bindings are native now.** The reference
  taught `demos/_kit/codegen.mjs` to emit `boardCursors.query.ts` +
  `boardCursorsPublish.mutation.ts` (~155 lines). Main's codegen already emits
  the real pair — `boardCursors.ephemeral.ts` (the `ephemeral` binding kind,
  ENG-22479) and `boardCursors.publish.ts` (the rated-publish budget facts,
  ENG-22525) — from the same `defineEphemeral` source, zero demo-side codegen.
- **The custom surface bridge is gone.** `createSnapbackContractSurface` now
  does live push over the shared socket, ephemeral wiring with resync/linger
  policy, receipts, and the connection axis. The reference's
  `graffiti-surface.ts` poll pump has no successor file: the durable wall is a
  `liveQueries` entry, presence is `ephemeral cursors = boardCursors(...)`.
- **The pointer listener became an authored channel.** Exact LLP 0281 stage 0
  (proven on cursors-web) replaces the host-level `pointermove` glue +
  hand-throttle with a value channel bound in the view and a
  `publish pointer.self -> boardCursorsPublish rate=15` line the analyzer
  checks against the generated sustainedHz=20 budget at build time.
- **The `loadSchema`-wipes-presence footgun is fenced.** The reference's worst
  bug (any tab's boot re-registering collections and clearing every live
  room) is now the paved `client.ensureApp(...)` call (LLP 0034 §5 /
  ENG-22527): inspect-first, provision-only-missing, seed-only-empty, never
  reset.
- **WebSocket inbound publish exists.** The first entry's "HTTP publish +
  drain" capability gap closed; the headless suite now proves
  `ephemeral_subscribe`/`ephemeral_publish` acks in-band on the live socket.

One adapter gap did surface: multi-live mode subscribed every named query with
empty args (fine for All Aboard's zero-arg descriptors, unusable for a
board-scoped wall). Fixed additively — a `liveQueries` entry now accepts
`{ name, args }` — recorded in LLP 0034 §10.4. That closes this diary's own
"the generated adapter is single-query" complaint for scoped queries too.

### Glue inventory (as landed)

| File | Role | Lines |
|------|------|-------|
| `snapback/schema.mjs` + `functions.mjs` | source of truth (both lanes) | 129 |
| `tests/acceptance/headless.mjs` | required-surface suite (17 checks) | 291 |
| `tests/acceptance/contract.mjs` | compile + descriptor acceptance | 125 |
| `surfaces/contract/graffiti.contract` | the whole UI, both lanes | 95 |
| `surfaces/contract/data.ts` (+ meta) | pure helpers: LWW grid, cursor geometry | 157 |
| `surfaces/contract/board.mjs` | constants + per-tab identity | 45 |
| `surfaces/contract/main.ts` | pure bootstrap (ensure, surface, mount) | 173 |
| `packages/snapback-contract/index.mjs` | kit delta: `{ name, args }` liveQueries | +17/−9 |

Total demo-local code ~1,015 lines against generated artifacts — versus the
reference's roughly-equal-sized demo **plus** ~155 lines of codegen extension **plus**
~310 lines of surface bridge and pointer glue that simply no longer exist.
Notable: `main.ts` is bigger than the `.contract` itself, and most of it is
boot-status/identity-chip DOM chrome, not data plumbing.

### Fan-out notes (from the landed headless run)

Two simulated painters (Ada publisher + Grace observer) plus dedicated flood/
rate connections; no sleeps except the TTL check (400 ms against a 300 ms
lease). Publish budget as declared: sustainedHz 20, burst 12. Observed on the
recorded run: an 8-publish burst coalesced to one latest value at the
observer; a 20-publish burst accepted exactly the declared 12 and rejected 8
with `SNAPBACK_EPHEMERAL_RATE_LIMITED`, all 8 visible in
`inspect.ephemeral.rate_limited_publishes`; suite-wide `coalesced_updates`
reached 95 while `liveDelivery.total_deliveries` stayed at 9 — the two lanes'
counters answer "where is my latency" separately, which is exactly LLP 0013's
diagnostics promise. Under a same-connection cursor flood the durable
`paintCell` update was the first envelope out of the mixed outbox.

An end-to-end two-painter check through the real Exact runtime (the same
links/provider path the browser uses — not committed, superseded by the
acceptance suites) confirmed: 59 seeded cells on both surfaces, a painted
pixel crossing via live push, the cursor arriving with `self=false` on the
peer and `self=true` locally, and the entry dropping on disconnect.

### What helped / what felt bad

Helped: the committed reference experiment was an excellent map — its schema,
seed art, acceptance shape, and hard-won findings (scope-key encoding, the
loadSchema footgun, throttle-to-budget) all carried over even where its code
did not. cursors-web was a working template for the channel/publish grammar;
todo-v2 for the durable Contract surface; the kit conformance suites caught
nothing because the adapter change was genuinely additive (13/13 before and
after).

Felt bad, still true today:

- **Helper shapes are hand-mirrored.** The generated contract-meta types
  `BoardCursorsEntry`/`Value` precisely, but the Exact compiler populates
  `queryResultTypes` only for `kind === 'query'` descriptors (LLP 0034 §10.3),
  so presence entries flowing through view helpers get shape checking only
  because `data.contract-meta.ts` re-declares the same shapes. The acceptance
  suite proves `shape_unknown_member` fires — but through my mirror, which can
  drift from codegen silently. ENG-22526 (Exact 0284 §8) owns the real fix.
- **Runner split.** Kit tests that import Exact TS (`regression-ephemeral-
  wiring`, `regression-optimistic-clobber`) crash under plain `node` with the
  current Exact checkout (`.js`-suffixed TS imports); they pass under `bun`.
  Nothing in the file headers says which runner a given suite needs.
  _Resolved (ENG-22655): a `requireBunRuntime` harness guard turns the crash
  into a clear "run under bun" message + exit 3, the file headers state the
  requirement, and `demos/_kit/tests/README.md` maps every suite to its runner._
- **The room permission is client-asserted.** The browser surface mints its
  own `boardMember` room permission the way the headless suite does. Honest
  for local dev, and declared as the `external_auth` capability gap — but an
  agent copying the surface could mistake it for an auth pattern.
  _Resolved (ENG-22657, docs/demo-hardening): the gap can't be closed in-demo
  (there is no server-side membership authority to build without inventing the
  external_auth provider the demo declares as missing), so the client-side
  assertion sites now carry loud "DEMO ONLY — do not copy; a real app enforces
  membership server-side via external_auth" comments, plus a prominent README
  security callout. Server-side enforcement stays real; only the trusted minting
  is stubbed._
- **`assertEqual` is key-order-sensitive** (JSON string compare), which cost
  one confusing test failure on an object that was deep-equal.
  _Resolved (ENG-22658): the harness now canonicalizes object key order (arrays
  stay ordered) before the string compare, so key-order-only differences pass
  while genuine inequalities still fail._

### Addendum (same day) — adversarial-review hardening

A 25-agent adversarial review of the landing confirmed one major finding and a
handful of minors, all fixed in the follow-up commit:

- **The TTL acceptance check was vacuous** — `currentEntries()` defaults to
  `{ prune: true }`, so the "fresh snapshot excludes the expired cursor"
  assertion was being satisfied by the client backstop no matter what the
  server sent. A prune-by-default overlay is right for product code and
  quietly wrong for acceptance assertions: the fix reads with
  `{ prune: false }` and also drains the original observer to watch the
  server's expiry Remove fan-out (`sweep_room_locked`) actually land. Lesson
  for the suite pattern: when the client has a backstop, acceptance checks
  must explicitly disable it to observe the server.
- **The `{ name, args }` seam invited silent wrong-data** — binding-site args
  are not consulted on the multi-live read path, and duplicate `liveQueries`
  names would clobber each other. Now: duplicates are rejected
  (`SNAPBACK_CONTRACT_LIVEQUERY_DUPLICATE`), deep-differing binding args are
  diagnosed (`SNAPBACK_CONTRACT_LIVEQUERY_ARGS_MISMATCH`) plus dev-warned,
  the invariant is stated in LLP 0034 §10.4, and a new
  `regression-multilive-scoped.mjs` (5 checks) gates all of it — the kit
  change finally has an automated test of its own.
- **The demo manifest declared capabilities the resolver never probed**
  (`ephemeralBinding`, `valueChannels`) — an older Exact checkout failed deep
  in the compile instead of skipping with the coded diagnostic. The resolver
  now takes `requiredCapabilities`, probes each (provider-seam content probe
  for the ephemeral handle, channels module for value channels), and the
  missing diagnostic names exactly what a candidate lacked.

### Net

The wall is now an on-main reference app: one schema generating both lanes'
client surface, 17 headless checks green against a real server, a 3-check
Contract/Exact compile acceptance green against the sibling checkout, and a
95-line `.contract` that renders shared durable pixels and live fading cursors
with no hand-written transport glue at all. Still open: automated two-browser
CDP acceptance (cursors-web has one; the wall's browser checklist is manual
today), the macOS AppKit host, hosted ephemeral adapters, and the Exact-side
ephemeral row-shape gap above.
