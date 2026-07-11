# LLP 0029: All Aboard capability-gap closure

**Type:** Plan
**Status:** Draft
**Systems:** Demo apps, Contract/Exact, Realtime, Cron, Action egress, Code execution security, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-30
**Revised:** 2026-07-11 (G15 added: the update-economy family — reactive host state, a time primitive, value-based dirtiness — surfaced by the scroll-jank investigation and designed in LLP 0052); 2026-07-11 (G14 added: safe-area insets have no Contract primitive — the iPhone run drew chrome under the notch/home indicator; interim userland device-glue fix shipped with ENG-24169); 2026-07-08 (G5 corrected: live 511 now writes `liveDepartures` with real predicted departure times and the surface does not invent demo trains under a live source with zero station-mappable visits); 2026-07-03 (G2 closed via the re-landed LLP 0032 P5 (ENG-22680) — adapter-owned live push + multi-query mode, store.mjs deleted, DK-10 decided, cron→Contract proof `contract-live.mjs`; G6's body reconciled to its 2026-07-01 S5.D8 closure. Same day, G5/G12 closed for the local-demo slice: `refreshFeed` now fetches 511 SIRI StopMonitoring through action egress when configured, `routeEstimate` proxies OpenRouteService/HeiGIT directions for station-card walk/bike ETAs, and both keep deterministic fallbacks; exact GTFS trip identity remains a non-claim. Earlier 2026-07-02, G4 closed: the LLP 0036 v1 slice shipped — declared entries + `uses` grants, file store, rotating redacted handles, gated config ops, setup wizard; All Aboard and the egress fixture migrated off `SNAPBACK_ACTION_SECRETS`, now a deprecated one-time import. Earlier same day, G4's closing design drafted as LLP 0036; earlier 2026-07-01, G1: interim web-glue swipe layer shipped with the redesign pass — the Contract primitive remains the closure)
**Related:** LLP 0027, LLP 0028, LLP 0009, LLP 0008, LLP 0020, LLP 0015, LLP 0016, LLP 0004, LLP 0013, LLP 0032, LLP 0034, LLP 0036, LLP 0052, Diary 0008

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
| G1 | Native pager gestures absent; web slice **closed 2026-07-11** (Exact LLP 0336 P1 / ENG-24167) | High | L | Exact LLP 0336 P2 |
| G2 | Browser Contract adapter has no live-push, single-boundary — **closed 2026-07-02** (LLP 0032 P5 on LLP 0034 D1: adapter-owned live push, multi-query mode, `store.mjs` deleted, cron→Contract proof) | High | M | LLP 0020 / LLP 0008 |
| G3 | Per-host egress allowlist not enforced (coarse `network:fetch`) | High | M | LLP 0009 |
| G4 | Secrets seam is a static env blob, no rotation/scoping — **closed 2026-07-02** (LLP 0036 v1 slice) | Medium | M | LLP 0036 |
| G5 | No live external feed polling (runs on recorded data) | Medium | M | LLP 0027 / LLP 0028 |
| G6 | Cron run duration always 0; start/finish collapse — **closed 2026-07-01** (LLP 0032 S5.D8) | Low | S | LLP 0028 |
| G7 | Stale-read / demand catch-up trigger unbuilt | Medium | M | LLP 0028 |
| G8 | Native macOS/iOS surface not built or run here | Medium | M | Exact host / LLP 0015 |
| G9 | No Contract geolocation binding (surface glue instead) | Medium | M | LLP 0020 |
| G10 | Notifications ("leave now") not built | Low | L | Notifications (v1 named) |
| G11 | No offline schedule cache (Online-class only) | Low | M | LLP 0008 |
| G12 | Walk/bike is haversine, not real routing | Low | M | LLP 0027 |
| G13 | Timezone/DST simplification (client local + fixed offset) | Low | S | LLP 0027 |
| G14 | Safe-area insets have no Contract primitive (userland device glue) | Medium | M | Exact / Contract layout |

### G1 — Native pager gestures absent; web slice closed 2026-07-11 (Exact LLP 0336 P1 / ENG-24167)

**What & evidence.** Exact LLP 0336 P1 closed the web half without adding a
misleading `swipe=` event: All Aboard's station and train strips are Contract
`pager` nodes backed by Exact's shared DOM recognizer/arena, claim regions,
wheel normalization, arrow-key bindings, visible witnesses, mounted snapshot,
and dispatch receipts. The old pager/home-key glue and directions long-press
timer are gone. Native still lacks the P2 Motion presenter/recognizer and
protocol handshake, so the cross-surface gap remains open there.

**Impact.** Web now delivers the zero-chrome spatial model through declared
Contract semantics. Native still exposes only the press witnesses, so gesture
parity and G8 remain release work.

**Closing the remainder.** Land LLP 0336 P2's native minimum Motion slice and
router presentations, run All Aboard in the native hosts, and delete the final
sheet-dismissal glue. P1 deliberately reserves `swipe*=` fail-closed; pager is
the honest high-level primitive for this interaction.

**History (2026-07-01; contiguous paging 2026-07-09, ENG-23795).** The
redesign pass shipped the swipe UX on web as demo-local surface glue:
`surfaces/contract/gestures.ts` recognizes the LLP 0027 gestures and
dispatches by clicking the declared press affordances, so one action path
serves gestures/taps/keyboard/tests. ENG-23795 upgraded the model to native
contiguous paging without touching the gap: the `.contract` now declares
3-cell pager strips (adjacent station/train cards physically at ±100% in a
clipped container) and the glue drags the strip 1:1 and settles it onto the
neighbor before dispatching the press — so mid-gesture adjacency is DECLARED
layout, and only the drag itself remains web glue. Two adjacent findings:
`longpress` is already a declared Contract event and the native host-ops
table carries `EventType.LongPress`, but the web DOM mirror never delivers
`onLongPress` (the All Aboard directions affordance declares
`longpress=` for native and needs a glue timer on web — a smaller sibling of
this gap, filed separately); and the product vision is now demonstrable
end-to-end, but this is still glue of exactly the kind LLP 0016 wants
retired — the Contract primitive above remains the closure and deletes the
file. Native still has press affordances only.

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

**Closed 2026-07-02 (LLP 0032 P5, on the LLP 0034 D1/C1 foundation).** The
shared adapter owns live push (DK-10 decided: adapter-owned subscription,
not a separate live-provider seam): single-query surfaces subscribe when
the bound descriptor is live, and the multi-query mode (`liveQueries:
[...]`) gives each named query its own boundary key and connection axis
over one shared socket. All Aboard's `store.mjs` and its poll pump are
gone — its Contract surface binds `liveTrainStatus`/`feedState` directly.
The todo-demo defaults (`queryName: 'listTodos'`, `boundaryKey: 'todos'`,
built-in optimistic reducers) are out of the generic package: binding
facts are required options, and reducers are app logic each demo owns
(`demos/*/surfaces/contract/optimistic.mjs`). The done-when proof is
`demos/all-aboard/tests/acceptance/contract-live.mjs`: a forced cron
tick's committed rows stream into the Contract boundary over the push lane
with zero per-demo glue — the adapter's own subscription is what arms the
demand-activated job. Arg-driven `refetch` remains open for the first demo
that needs it (no current surface re-queries by arg).

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
manager for hosted). Keep it action-only and never client-visible. This design
is now drafted as [LLP 0036](./0036-app-secrets-and-config.rfc.md) (declared
config entries in the manifest, a per-app store behind a per-target seam,
rotation pools, gated ops plus the setup wizard).

**Closed (2026-07-02).** The LLP 0036 v1 slice shipped: declared entries with
per-function `uses` grants, the 0600 sibling-file store, granted rotating
handles with redacted coercion, the gated `/_snapback/api/config/*` ops, and
the setup wizard. All Aboard declares `caltrainFeed` (with `refreshFeed`
carrying the grant), the egress-probe fixture declares its `feedKeys` pool,
and `SNAPBACK_ACTION_SECRETS` is a deprecated one-time import source.
Verified by `demos/all-aboard/tests/acceptance/egress.mjs` (14 checks) and
`tests/config_v0.rs`.

**Effort.** M. **Owner.** [LLP 0036](./0036-app-secrets-and-config.rfc.md)
(design), on the [LLP 0009](./0009-code-execution-security.rfc.md) security
floor (same territory as G3).

### G5 — No live external feed polling

**Closed (2026-07-03).** `refreshFeed` now uses the action egress class and the
declared `caltrainFeed` grant to fetch 511 SIRI StopMonitoring JSON, map mappable
Caltrain visits onto the six committed service-pattern `trainStatus` rows, and
commit through `applyLiveFeedSnapshot`. Missing config, disabled outbound actions,
or a malformed feed fall back to the recorded tick path and write `lastError` into
`feedRefreshState`. Verified without touching the real network by
`demos/all-aboard/tests/acceptance/real-data.mjs`.

**Correction (2026-07-08).** The first closure was too weak: a live delay overlay
on the demo clock-face schedule could still invent "next trains" at times when
511 had no such station departure. `refreshFeed` now also writes
`liveDepartures`, one row per mappable StopMonitoring visit, and the Contract
surface prefers those real predicted departure rows whenever
`feedRefreshState.lastSource` is `511-siri-stop-monitoring`; if 511 returns no
station-mappable visits, the live board shows no trains instead of falling back
silently to demo schedule rows.

**Residual non-claim.** This is real station-level 511 departure prediction plus
a coarse status overlay. It is still not exact static-GTFS schedule parity,
full stop-pattern reconstruction, or GTFS-RT trip-to-schedule identity matching.
That limitation is now called out in `demo.snapback.json`.

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

**Closed 2026-07-01 via LLP 0032 S5.D8** — duration measured from real
wall-clock around the run; test `s5_d8_cron_run_records_nonzero_duration`.
(This body lagged the register; reconciled 2026-07-02.)

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
Exact's Rust kernel host), and the Contract surface build now emits macOS/iOS
static native envelopes. With the current registry Exact devtools package those
envelopes use module-bundle fallback payloads rather than startup.js/HBC because
the package does not include Exact host runtime source assets. This repo still
does not build or run the Swift `ExactApp` host. Snapback's admin can *serve*
static native discovery artifacts only when `SNAPBACK_ADMIN_DIST` is configured
(`src/contract_exact.rs`, `src/admin.rs`), otherwise it returns
`SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`.

**Impact.** The multi-surface claim is *architecturally* true (one `.contract`, two
hosts) but not *demonstrated* — no one has watched All Aboard run on a Mac or a
phone.

**Closing it.** Build `ExactApp` for `mac`/`ios`, point it at either the emitted
static envelope or a native-enabled Exact dev server for the All Aboard surface
(the `.contract` unchanged; the `main.ts` boot and host differ), and add a native
acceptance check (structured tree, like the web one). Optionally wire
`SNAPBACK_ADMIN_DIST` so the Snapback admin can serve the native envelope. Note:
native geolocation would use the Exact location module (see G9).

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

**Closed (2026-07-03).** `routeEstimate` is a server-side action with a declared
`directions` grant. The web surfaces install a route-estimate invoker, cache by
rounded rider location + station + mode, and use OpenRouteService/HeiGIT summaries
for the selected station card. Missing config, disabled outbound actions, or
transport failures fall back to the deterministic haversine estimate; station-list
rows intentionally keep the local estimate to avoid bursty quota use. Verified by
`demos/all-aboard/tests/acceptance/real-data.mjs`.

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

### G14 — Safe-area insets have no Contract primitive

**What & evidence (2026-07-11, ENG-24169).** Contract has no `safeArea`
attribute and no inset value an app can bind (`pinToSafeArea` in the runtime's
layout-intent lowering is a stub that resolves to nothing). The Exact renderer
carries a full safe-area system (regions, per-edge modes, contentInset vs
framePadding strategies), but it is fed from `@exact/core` window-state, whose
`__exactSafeAreaRegionsChanged` hook only `@exact/js` window-management
registers — and the contract native startup never loads that module. The iOS
host publishes real insets into `globalThis.exact.safeAreaInsets`, where they
sat unread; on the first iPhone run the red header drew under the status bar
and the footer ran into the home-indicator corners.

**Interim (shipped with ENG-24169).** The same userland device-glue seam as
geolocation/appearance: `data.ts` `safeAreaInsets(nowMs)` reads the host
global live off the ticking clock (with `setSafeAreaInsets` as an explicit
override), and the `.contract` derives chrome heights (`106 + insets.top`,
`64 + insets.bottom`) threaded to the header/footer/scroll/sub-screens as
number props. Correct behavior, wrong ownership — every full-bleed Contract
app would have to re-implement this.

**Closing it.** Either wire window-state into the contract native startup so
the renderer's declarative system engages (and grow a Contract `safeArea=`
attribute over it, letting apps opt chrome nodes in/out per edge), or expose
the insets as a first-class Contract binding. Note the renderer default
(container padding on root children) is the wrong shape for apps that draw
their own full-bleed chrome — the attribute must support the "surface bleeds,
content insets" split before the userland glue can be deleted.

**Effort.** M (runtime wiring + notation). **Owner.** Exact / Contract layout;
All Aboard is the first consumer.

### G15 — Update economy: no reactive host state, no time primitive, identity-based dirtiness

**What & evidence (2026-07-11).** Three composing gaps made the app ship
near-whole-screen patches to the UI thread on every 1s tick (the scroll-jank
investigation, Diary 0008 2026-07-10/11): (1) glue/module state cannot
invalidate a derive, so the ticking clock became the universal invalidation
token — the "nowMs cache-buster" seam is reinvented five times in this one
demo (geolocation, maps preference, color scheme, backend state, safe-area);
(2) there is no time primitive, so wall-time enters the app dataflow at 1 Hz
and everything downstream recomputes; (3) renderer dirtiness is
props-REFERENCE-based (the ENG-23260 fast path), so derives returning
fresh-but-value-equal objects mark the whole tree dirty. The VM running off
the UI thread does not help: the patch is applied on the UI thread.

**Interim (shipped 2026-07-10/11).** Clock quantization (`now() - now() %
5000`, exploiting the signal layer's Object.is write-skip) plus reference-
stable palette singletons. Conventions, not fixes — each must be known and
re-applied per app, per derive.

**Closing it.** [LLP 0052](./0052-contract-update-economy-and-host-state.rfc.md)
owns the design: reactive `host` bindings (subsumes G9 and the binding half
of G14), host-side countdown/clock text plus `now(granularity)`, value-based
dirtiness at the patch boundary, derive memoization semantics, and a
dev-mode patch profiler.

**Effort.** M–L across five items (LLP 0052 sequences them; the profiler is
S and first). **Owner.** LLP 0052 / Exact runtime; All Aboard is the first
consumer.

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

- ~~**Adapter vs. store (G2):** should the shared adapter own live-push, or should
  a separate "live provider" seam sit beside it so the reconcile-after-mutation
  adapter stays simple? The store bridge suggests the latter may be cleaner.~~
  **Decided 2026-07-02 (DK-10): the adapter owns live-push.** The LLP 0034
  D1/C1 implementation proved the adapter-owned subscription (single-query and
  multi-query modes over one shared socket) and the separate-seam alternative
  died with `store.mjs`; ledgered in LLP 0000, docket row closed in LLP 0032.
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
