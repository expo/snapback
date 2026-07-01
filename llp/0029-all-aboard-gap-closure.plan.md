# LLP 0029: All Aboard capability-gap closure

**Type:** Plan
**Status:** Draft
**Systems:** Demo apps, Contract/Exact, Realtime, Cron, Action egress, Code execution security, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-30
**Related:** LLP 0027, LLP 0028, LLP 0009, LLP 0008, LLP 0020, LLP 0015, LLP 0016, LLP 0004, LLP 0013, Diary 0008

## Summary

Building **All Aboard** ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md),
[Diary 0008](../diaries/0008-all-aboard.diary.md)) shipped all four phases but left
a set of **honest capability gaps** — declared in `demos/all-aboard/demo.snapback.json`
and worked around in the demo rather than faked. This Plan is the register of those
gaps: for each one, what it is and where the evidence lives, what it costs the
product today, the concrete work to close it, a rough effort, and the owning
subsystem/LLP.

It exists because a demo's value under
[LLP 0016](./0016-diary-driven-change-program.plan.md) is partly in the gaps it
*surfaces*. All Aboard surfaced more than it closed. Two of these gaps
(gesture primitives, browser live-push) are the difference between "a Contract
surface that renders Snapback data" and "the product surface LLP 0020 wants"; two
more (per-host egress allowlist, secrets rotation) are the difference between an
egress *seam* and an egress *subsystem*. None of them were in scope for the demo,
and none should block the next demo — but they should be legible and numbered.

This Plan **does not** redesign the owning subsystems; each gap names the LLP that
owns its contract. It proposes closure work and sequencing, not new semantics.

## Scope

Owns: the catalog of All-Aboard-surfaced gaps and a proposed closure order. Does
not own the gesture model (Exact motion RFCs), the sandbox boundary
([LLP 0009](./0009-code-execution-security.rfc.md)), the sync/realtime contract
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)), the cron contract
([LLP 0028](./0028-cron-scheduled-execution.rfc.md)), or the authoring surface
([LLP 0020](./0020-core-authoring-surface.plan.md)) — this Plan is a consumer that
files work against them.

## Gap register

Effort is rough: **S** ≈ hours, **M** ≈ days, **L** ≈ weeks. Severity is
product-impact for a real transit app, not demo-impact.

| # | Gap | Severity | Effort | Owner |
|---|---|---|---|---|
| G1 | Swipe/pan gestures absent in Contract | High | L | Exact motion RFCs |
| G2 | Browser Contract adapter has no live-push, single-boundary | High | M | LLP 0020 / LLP 0008 |
| G3 | Per-host egress allowlist not enforced (coarse `network:fetch`) | High | M | LLP 0009 |
| G4 | Secrets seam is a static env blob, no rotation/scoping | Medium | M | LLP 0009 |
| G5 | No live external feed polling (runs on recorded data) | Medium | M | LLP 0027 / LLP 0028 |
| G6 | Cron run duration always 0; start/finish collapse | Low | S | LLP 0028 |
| G7 | Stale-read / demand catch-up trigger unbuilt | Medium | M | LLP 0028 |
| G8 | Native macOS/iOS surface not built or run here | Medium | M | Exact host / LLP 0015 |
| G9 | No Contract geolocation binding (surface glue instead) | Medium | M | LLP 0020 |
| G10 | Notifications ("leave now") not built | Low | L | Notifications (v1 named) |
| G11 | No offline schedule cache (Online-class only) | Low | M | LLP 0008 |
| G12 | Walk/bike is haversine, not real routing | Low | M | LLP 0027 |
| G13 | Timezone/DST simplification (client local + fixed offset) | Low | S | LLP 0027 |

### G1 — Swipe/pan gestures absent in Contract

**What & evidence.** LLP 0027's interaction model is swipe-first (left/right =
station, up/down = train). Those primitives do not exist: the Contract event
vocabulary is exactly `press change submit longpress focus blur scrollend refresh`,
the kernel `EventType` has no swipe/pan opcode, and `swipe`/`OnSwipeDown`/`gesture`
appear only in two **unbuilt** Exact motion RFCs. All Aboard shipped press
affordances (◀ ▶ buttons, a Flip button, tap-a-train) and declared `exact.gestures:
false`.

**Impact.** The zero-chrome, spatial mental model LLP 0027 wants is not
achievable; the app is a button UI, not a gesture UI. This is the single biggest
delta between the shipped surface and the product vision.

**Closing it.** Land the Exact motion primitives end-to-end: a directional gesture
recognizer in the kernel, a new `EventType` (pan/swipe with direction + velocity)
over the host-ops protocol, a Contract event attribute (`swipe=` / `onSwipeLeft=`
…), and web + native host bindings. Then the demo swaps press affordances for
`swipe=` handlers that call the same actions. Gate acceptance through Exact's
structured tree, not synthetic DOM events.

**Effort.** L (a real Exact feature, multiple layers). **Owner.** Exact motion
RFCs; All Aboard is the first consumer.

### G2 — Browser Contract adapter: no live-push, single-boundary

**What & evidence.** `packages/snapback-contract/index.mjs`
`createSnapbackContractSurface` binds exactly one query (`queryName`/`boundaryKey`)
and reconciles only by re-querying *after a local mutation*; it never subscribes to
the durable live stream. So a server-authored (cron) delta does not reach the
browser through it, and it cannot back a multi-query, arg-reactive app. All Aboard
worked around both by feeding live delays into a `store.mjs` the `.contract` derives
from on a 1s clock, driven by a real `client.liveQuery` subscription — demo-local
glue, the opposite of the Diary-0004 win that moved the adapter into `packages/`.

**Impact.** "Freshness pushed to the client" — LLP 0027's core value — is not
delivered by the shared adapter; every realtime demo will re-hand-roll the store
bridge. Arg-driven navigation (change the query arg → re-query) also has no adapter
support.

**Closing it.** Extend the shared adapter to (a) hold **multiple named query
boundaries**, each with its own args; (b) expose `refetch(name, args)` for
arg-driven re-query; and (c) **subscribe to the durable live stream**
(`openLiveStream` + `subscribeLive`) and write deltas into the matching boundary —
so a cron-written row updates the browser with no local mutation. Keep todo working
(single-boundary is the degenerate case). Then All Aboard drops `store.mjs` and
binds `stationBoard`/`feedState` directly.

**Effort.** M. **Owner.** [LLP 0020](./0020-core-authoring-surface.plan.md)
(authoring surface) over [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)
(the live path already exists).

### G3 — Per-host egress allowlist not enforced

**What & evidence.** The Phase 3 seam un-denies `fetch` for the action class and
grants the coarse Ibex `network:fetch` capability
([LLP 0027#external-data-and-action-egress](./0027-all-aboard-caltrain-demo.plan.md#external-data-and-action-egress)),
but the engine checks bare `network:fetch` without the request's host, even though
the Rust `CapabilityManager` can already match `network:fetch:<host>`. So egress is
scoped by *module/kind*, not by destination.

**Impact.** An egress-enabled action can call *any* host — an SSRF/exfiltration
surface. Acceptable for a trusted local demo on recorded data; not acceptable for
hosted or untrusted app code.

**Closing it.** Thread the request URL's host into `checkCapability` at the Ibex
fetch/ws/http call sites, then have Snapback grant `network:fetch:<host>` per action
from a declared destination allowlist (e.g. `*.511.org` + the maps host) instead of
the wildcard grant. Add an app-level URL check as the interim v0 guard. This is the
SSRF/egress seam owned by [LLP 0009](./0009-code-execution-security.rfc.md).

**Effort.** M (small engine change + a Snapback policy surface). **Owner.**
[LLP 0009](./0009-code-execution-security.rfc.md).

### G4 — Secrets seam is a static env blob

**What & evidence.** `ctx.secrets` is populated from `SNAPBACK_ACTION_SECRETS`
(a JSON object parsed once, `src/runtime.rs`). It has no rotation, no per-action
scoping, and no real store — LLP 0027 wants a *pool of keys rotated across requests*
to respect feed rate limits.

**Impact.** Fine as a seam; insufficient for a real feed integration that needs key
rotation and rate-limit headroom, and it puts all secrets in one process-wide blob.

**Closing it.** A scoped secrets store: keys addressed by name, granted per action
(not global), with a rotation helper (`ctx.secrets.rotating('caltrainFeed')`
returning the next key). Back it with a real store seam (env for local, a secret
manager for hosted). Keep it action-only and never client-visible.

**Effort.** M. **Owner.** [LLP 0009](./0009-code-execution-security.rfc.md) (same
territory as G3).

### G5 — No live external feed polling

**What & evidence.** `refreshFeed` advances a committed cycle of recorded feed ticks
through a mutation; it never fetches a real feed. Live 511.org/Caltrain GTFS-Realtime
integration is Phase 3's live half and is not built.

**Impact.** The app is "live" against recorded data, not the world. Fine for a
deterministic demo; not a real departure board.

**Closing it.** With G3 + G4 in place, the egress action fetches the real feed
(511.org GTFS-RT or Caltrain's own), maps entities → `trainStatus` delays/positions,
and commits through the existing `applyFeedTick`-shaped mutation. Add rate-limit
handling via the rotating key pool and cache-by-freshness. Keep the recorded path as
the test/offline default.

**Effort.** M. **Owner.** [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md) over
[LLP 0028](./0028-cron-scheduled-execution.rfc.md); depends on G3, G4.

### G6 — Cron run duration always 0

**What & evidence.** In `execute_cron_claims` (`src/local.rs`) the finished
timestamp is set to the claim's start (`finished_at_ms = claim.started_at_ms`), and
`startedAt`/`dueAt` collapse to claim time, so `durationMs` is always 0 and the
ledger's timing is placeholder.

**Impact.** Cron observability ([LLP 0028](./0028-cron-scheduled-execution.rfc.md)
requires per-run duration) reports a wrong number; you cannot see a slow refresh.

**Closing it.** Stamp a real start time before the action runs and a real finish
time after it returns; compute `durationMs` from them. One small change in the claim
executor plus a test asserting a nonzero duration for a sleep-y action.

**Effort.** S. **Owner.** [LLP 0028](./0028-cron-scheduled-execution.rfc.md).

### G7 — Stale-read / demand catch-up trigger unbuilt

**What & evidence.** `CronRunTrigger::Recovery` and `CronRunTrigger::DemandCatchUp`
are defined but never constructed (`src/cron.rs`); only `Scheduled` and `Manual`
runs exist. The "first subscriber after a long idle triggers one immediate,
collapsed catch-up refresh" that LLP 0027's read-through model describes is not
wired — `whileLive` only gates the *scheduled* poll.

**Impact.** After idle, the first rider sees stale data until the next minute tick
(or a manual Refresh) instead of an immediate catch-up. All Aboard leans on the
`everyMs` job being immediately-due to approximate this, but there is no true
stale-read trigger and no collapse ledger for concurrent demand.

**Closing it.** A read/subscription boundary that inspects `feedRefreshState`
freshness and, when stale, claims one `DemandCatchUp` run (collapsing concurrent
demand behind the same in-flight run) outside the query transaction — the shape
LLP 0028 specifies. Surface `catching-up` in the activation state.

**Effort.** M. **Owner.** [LLP 0028](./0028-cron-scheduled-execution.rfc.md).

### G8 — Native macOS/iOS surface not built or run

**What & evidence.** The same `app.contract` is native-ready (it renders through
Exact's Rust kernel host), but this repo does not build or run the Swift `ExactApp`
host; the demo marks `native` as `expected_missing`. Snapback's admin can *serve*
static native discovery artifacts only when `SNAPBACK_ADMIN_DIST` is configured
(`src/contract_exact.rs`, `src/admin.rs`), otherwise it returns
`SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`.

**Impact.** The multi-surface claim is *architecturally* true (one `.contract`, two
hosts) but not *demonstrated* — no one has watched All Aboard run on a Mac or a
phone.

**Closing it.** Build `ExactApp` for `mac`/`ios`, point it at a native-enabled Exact
dev server for the All Aboard surface (the `.contract` unchanged; the `main.ts` boot
and host differ), and add a native acceptance check (structured tree, like the web
one). Optionally wire `SNAPBACK_ADMIN_DIST` so the Snapback admin can serve the
native envelope. Note: native geolocation would use the Exact location module (see
G9).

**Effort.** M (toolchain + a Swift build, not new UI). **Owner.** Exact host +
[LLP 0015](./0015-demo-application-suite.plan.md) surface conventions.

### G9 — No Contract geolocation binding

**What & evidence.** There is no Contract geolocation capability; All Aboard wires
`navigator.geolocation` in `main.ts` and pushes coordinates into `store.mjs`, with a
default-station fallback when denied. Exact's own Caltrain twin skips geolocation
entirely. Native would need the `@exact/exact-location` module instead.

**Impact.** Geolocation "binds" through hand-written, web-only surface glue; the
native surface would need a *different* path, so the one-`.contract` story has a
platform seam here.

**Closing it.** A Contract geolocation capability (like the Facet theme capability)
that resolves to `navigator.geolocation` on web and the location module on native,
exposing `coords` + permission state to the view uniformly, with a declared fallback.
Then the surface drops the `main.ts` geolocation glue.

**Effort.** M. **Owner.** [LLP 0020](./0020-core-authoring-surface.plan.md).

### G10 — Notifications ("leave now") not built

**What & evidence.** Phase 4 of LLP 0027, explicitly future: "leave now to walk/bike
and still make the train" depends on a Notifications subsystem plus time/geofence
math. Not built; the v1 walk/bike display is the precursor.

**Impact.** The highest-value *action* the app could take (tell you when to leave)
is absent.

**Closing it.** The Notifications subsystem (named v1 in
[LLP 0000](./0000-snapback.explainer.md)) plus geofence/ETA math that fires when
`walk/bike ETA ≈ time-to-departure`. Depends on live data (G5) to be trustworthy.

**Effort.** L. **Owner.** Notifications subsystem (unbuilt); All Aboard is a
motivating consumer.

### G11 — No offline schedule cache

**What & evidence.** The demo's honest realtime class is **Online**
([LLP 0020](./0020-core-authoring-surface.plan.md)); the static schedule could be
cached for offline browsing but is not.

**Impact.** No schedule access without the server; a real transit app wants the
timetable in your pocket underground.

**Closing it.** Cache the static `stations`/`trips`/`stopTimes` locally (they change
a few times a year) via the local-first path
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)), keeping live positions
Online. This is a capability-class upgrade, not a rewrite.

**Effort.** M. **Owner.** [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).

### G12 — Walk/bike is haversine, not routing

**What & evidence.** v0 computes walk (~3 mph) and bike (~9 mph) ETAs by haversine
from seed coordinates — zero egress, deterministic. Real routing
(OpenRouteService, Mapbox alternative) is the declared Phase-3 accuracy upgrade.

**Impact.** ETAs ignore streets, hills, and crossings — good enough to decide, off
by a few minutes.

**Closing it.** A routing egress action (default OpenRouteService) proxied through
Snapback (key in the secrets seam, G4), cached by (location-bucket, station) to
respect the free quota, replacing the haversine estimate. A Maps deep-link
complements it. Depends on G3/G4.

**Effort.** M. **Owner.** [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md);
depends on G3, G4.

### G13 — Timezone / DST simplification

**What & evidence.** Predictions use the client's *local* time, and the seed
schedule is authored in Pacific with a fixed-offset assumption; real timezone/DST
handling is a documented shortcut (`demo.snapback.json` → `temporaryPolicy.clock`).

**Impact.** A rider outside Pacific sees the board in their own clock, which is
wrong for a Bay Area line; DST transitions would be off by an hour.

**Closing it.** Anchor predictions to `America/Los_Angeles` explicitly (an IANA
timezone, not a fixed offset), in a shared helper used by surface + tests, and pin
the test clock accordingly. Small and self-contained.

**Effort.** S. **Owner.** [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md).

## Proposed sequencing

Ordered by unblocking value, not severity alone:

1. **Quick correctness wins (S):** G6 (cron duration), G13 (timezone). Isolated,
   low-risk, improve honesty immediately.
2. **The product-surface pair (M):** G2 (adapter live-push + multi-boundary) then
   G9 (geolocation capability). Together these retire the biggest chunk of
   demo-local glue and make the *next* realtime Contract demo cheaper — the
   LLP 0016 test of whether a demo retired glue.
3. **The egress subsystem (M):** G3 (per-host allowlist) + G4 (secrets rotation),
   which then unblock G5 (live feed) and G12 (routing). Sequence G3→G4→G5/G12.
4. **Cron completeness (M):** G7 (demand catch-up trigger), rounding out the
   read-through story LLP 0028 specifies.
5. **Reach surfaces & features (M–L):** G8 (native run), G11 (offline cache),
   G1 (gestures), G10 (notifications) — larger, each its own effort, none blocking.

No single item is required for the next demo. G1 and G10 are genuinely large
(new Exact/Notifications capabilities) and should be scheduled as their own work,
not smuggled into a demo.

## Non-goals

- Redesigning any owning subsystem's contract — this Plan files work, it does not
  redefine gesture, sync, cron, egress, or authoring semantics.
- Committing to timelines or owners beyond the effort sizing.
- Turning All Aboard into a production departure board — the demo proves shape,
  not scale ([LLP 0000](./0000-snapback.explainer.md)).

## Open questions

- **Adapter vs. store (G2):** should the shared adapter own live-push, or should a
  separate "live provider" seam sit beside it so the reconcile-after-mutation
  adapter stays simple? The store bridge suggests the latter may be cleaner.
- **Allowlist location (G3):** declared in the demo manifest, in the function
  manifest per action, or in a runtime policy file
  ([LLP 0009](./0009-code-execution-security.rfc.md))?
- **Gesture scope (G1):** minimum viable is directional swipe; is fling/pinch worth
  bundling, or does that over-scope the first cut?
- **Native acceptance (G8):** can the native structured-tree assertion reuse the web
  browser harness shape, or does it need a distinct CDP-equivalent for the kernel
  host?

## Status

Draft. A register of the gaps All Aboard ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md),
[Diary 0008](../diaries/0008-all-aboard.diary.md)) surfaced and left open, each with
concrete closure work, a rough effort, and the owning LLP. Nothing here blocks the
next demo; the intent is to make the debt legible and sequenced so it is closed on
purpose rather than rediscovered.
